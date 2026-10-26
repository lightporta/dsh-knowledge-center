/**
 * A local, cross-process directory lock with conservative crash recovery.
 *
 * Prepare the owner file before publishing the directory with rename(). An
 * active lock is therefore always nonempty and cannot be replaced by another
 * candidate directory. Cleanup removes only the observed owner's unique file,
 * then uses nonrecursive rmdir: a delayed cleanup cannot remove a new owner.
 *
 * Windows reports a temporary sharing conflict (EPERM/EACCES/EBUSY) when a
 * rename loses a race to an owner that is listing or deleting its own marker,
 * and when a directory deletion has not completed yet. Such a conflict proves
 * neither a live lock nor a permanent permission error, so every filesystem
 * step below is retried within a bounded deadline before it is reported.
 */
import { promises as fs } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { hostname } from 'node:os'
import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'

const OWNER_FILE = /^owner-([1-9]\d*)-([a-f0-9-]+)\.json$/
const TRANSIENT_CODES = new Set(['EACCES', 'EPERM', 'EBUSY'])
const CONTENTION_CODES = new Set(['EEXIST', 'ENOTEMPTY', ...TRANSIENT_CODES])
const CLEANUP_TIMEOUT_MS = 1_000
const CLEANUP_RETRY_MS = 25

function checkSignal(signal) {
  if (signal?.aborted) throw signal.reason ?? new Error('Lock acquisition aborted.')
}

function delay(milliseconds, signal) {
  checkSignal(signal)
  return new Promise((fulfill, reject) => {
    const finish = () => {
      signal?.removeEventListener('abort', abort)
      fulfill()
    }
    const timer = setTimeout(finish, milliseconds)
    const abort = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      reject(signal.reason ?? new Error('Lock acquisition aborted.'))
    }
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
  })
}

/**
 * Retry one deletion step while the filesystem reports a temporary conflict.
 * A missing path already satisfies a deletion, and an unexpected error such as
 * EIO is reported at once instead of being waited on.
 */
async function retryTransient(operation, { deadline, signal }) {
  for (;;) {
    checkSignal(signal)
    try {
      return await operation()
    } catch (error) {
      if (error.code === 'ENOENT') return
      const remaining = deadline - performance.now()
      if (!TRANSIENT_CODES.has(error.code) || remaining <= 0) throw error
      await delay(Math.min(CLEANUP_RETRY_MS, remaining), signal)
    }
  }
}

/** 'gone' when the path is absent, 'empty' when it holds nothing, else 'occupied'. */
async function directoryState(path) {
  try {
    return (await fs.readdir(path)).length === 0 ? 'empty' : 'occupied'
  } catch (error) {
    if (error.code === 'ENOENT') return 'gone'
    throw error
  }
}

/**
 * Remove the shared lock directory only while it is still empty.
 *
 * A published owner always writes its marker before rename(), so a nonempty
 * path is another generation and must stay intact even when a delayed rmdir
 * reports EPERM. An empty path that cannot be removed yet is retried, and a
 * persistent failure is reported rather than silently leaving the lock behind.
 *
 * @returns {Promise<boolean>} whether this call removed the directory.
 */
async function removeEmptyDirectory(lockPath, retry) {
  for (;;) {
    checkSignal(retry.signal)
    try {
      await fs.rmdir(lockPath)
      return true
    } catch (error) {
      if (error.code === 'ENOENT') return false
      if (error.code === 'ENOTEMPTY' || error.code === 'EEXIST') return false
      if (!TRANSIENT_CODES.has(error.code)) throw error
      let state
      try {
        state = await directoryState(lockPath)
      } catch (inspectionError) {
        if (!TRANSIENT_CODES.has(inspectionError.code)) throw inspectionError
        state = 'unreadable'
      }
      // Windows also reports EPERM for a directory that already holds a newer
      // owner. Re-read before retrying so that generation is never disturbed.
      if (state === 'occupied' || state === 'gone') return false
      const remaining = retry.deadline - performance.now()
      if (remaining <= 0) throw error
      await delay(Math.min(CLEANUP_RETRY_MS, remaining), retry.signal)
    }
  }
}

/**
 * Remove only this unique owner marker, never recursively remove the lock.
 *
 * The default budget is independent of the caller's signal: an aborted or
 * failed acquisition still has to clear its own marker, otherwise a live PID
 * stays recorded as the owner of the path.
 */
async function removeOwner(lockPath, ownerFile, retry = { deadline: performance.now() + CLEANUP_TIMEOUT_MS }) {
  await retryTransient(() => fs.unlink(`${lockPath}/${ownerFile}`), retry)
  return removeEmptyDirectory(lockPath, retry)
}

async function inspectAndRecover(lockPath, retry) {
  let stat
  try {
    stat = await fs.lstat(lockPath)
  } catch (error) {
    if (error.code === 'ENOENT') return 'lock disappeared'
    throw error
  }
  if (!stat.isDirectory()) {
    const error = new Error(`Lock path must be a real directory: ${lockPath}`)
    error.code = 'LOCK_INVALID'
    throw error
  }
  let names
  try {
    names = await fs.readdir(lockPath)
  } catch (error) {
    if (error.code === 'ENOENT') return 'lock disappeared'
    throw error
  }
  if (names.length === 0) {
    // A previous owner has finished its operation and removed its owner file.
    return (await removeEmptyDirectory(lockPath, retry))
      ? 'removed a stale empty lock directory'
      : 'stale empty lock directory already taken'
  }
  const match = names.length === 1 ? OWNER_FILE.exec(names[0]) : null
  if (match === null) return 'unrecognized lock contents; automatic recovery refused'
  let owner
  try {
    owner = JSON.parse(await fs.readFile(`${lockPath}/${names[0]}`, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return 'owner changed'
    if (error instanceof SyntaxError) return 'invalid lock metadata; automatic recovery refused'
    throw error
  }
  const pid = Number(match[1])
  if (owner?.pid !== pid || owner?.token !== match[2] || owner?.hostname !== hostname()) {
    return 'unverified lock owner; automatic recovery refused'
  }
  try {
    process.kill(pid, 0)
    return `owner process ${pid} is alive`
  } catch (error) {
    // EPERM and all other unknown results are not evidence that an owner died.
    if (error.code !== 'ESRCH') return `owner process ${pid} cannot be proven dead`
  }
  await removeOwner(lockPath, names[0], retry)
  return `recovered exited owner process ${pid}`
}

/**
 * Run operation while holding one local filesystem lock.
 *
 * A timeout never steals a live lock. PID reuse and foreign-host/invalid owner
 * metadata conservatively block recovery rather than risk overlapping writers.
 * A rename that is denied while the path is being released is retried within
 * the same deadline as ordinary contention, because Windows can report EPERM
 * before and after the owning directory disappears.
 * All writers must use the same lock path on a local filesystem.
 *
 * @param {string} path
 * @param {() => Promise<any> | any} operation
 * @param {{ timeoutMs?: number, retryDelayMs?: number, signal?: AbortSignal }} [options]
 */
export async function withFileLock(path, operation, options = {}) {
  const { timeoutMs = 10_000, retryDelayMs = 25, signal } = options
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) throw new RangeError('timeoutMs must be a finite nonnegative number.')
  if (!Number.isFinite(retryDelayMs) || retryDelayMs <= 0) throw new RangeError('retryDelayMs must be a finite positive number.')
  if (typeof operation !== 'function') throw new TypeError('operation must be a function.')
  checkSignal(signal)
  const lockPath = resolve(path)
  const token = randomUUID()
  const ownerFile = `owner-${process.pid}-${token}.json`
  const candidate = `${lockPath}.candidate-${process.pid}-${token}`
  let acquired = false
  const deadline = performance.now() + timeoutMs
  let lastState = 'lock is occupied'
  let lastFsError
  let contended = false
  let failed = false
  let originalError
  const timeoutError = () => {
    const error = new Error(`Timed out after ${timeoutMs} ms waiting for knowledge storage lock ${lockPath}: ${lastState}.`, { cause: lastFsError })
    error.code = 'LOCK_TIMEOUT'
    return error
  }
  try {
    await fs.mkdir(dirname(lockPath), { recursive: true })
    await fs.mkdir(candidate, { mode: 0o700 })
    await fs.writeFile(`${candidate}/${ownerFile}`, JSON.stringify({
      pid: process.pid, token, hostname: hostname(), createdAt: Date.now(),
    }), { flag: 'wx', mode: 0o600 })
    while (!acquired) {
      checkSignal(signal)
      if (contended && performance.now() >= deadline) throw timeoutError()
      try {
        await fs.rename(candidate, lockPath)
        acquired = true
      } catch (error) {
        if (!CONTENTION_CODES.has(error.code)) throw error
        contended = true
        lastFsError = error
        // The owner can release its directory between rename and inspection.
        // EPERM followed by ENOENT is therefore retriable within the deadline.
        try {
          lastState = await inspectAndRecover(lockPath, { deadline, signal })
        } catch (inspectionError) {
          if (!TRANSIENT_CODES.has(inspectionError.code)) throw inspectionError
          lastFsError = inspectionError
          lastState = `filesystem temporarily unavailable (${inspectionError.code})`
        }
        const remaining = deadline - performance.now()
        if (remaining <= 0) {
          throw timeoutError()
        }
        await delay(Math.min(retryDelayMs, remaining), signal)
      }
    }
    checkSignal(signal)
    // An in-flight rename cannot be canceled, but a late success must not enter
    // the critical section. A zero budget still permits one immediate attempt.
    if ((timeoutMs > 0 || contended) && performance.now() >= deadline) throw timeoutError()
    return await operation()
  } catch (error) {
    failed = true
    originalError = error
    throw error
  } finally {
    const cleanupErrors = []
    if (acquired) {
      try { await removeOwner(lockPath, ownerFile) } catch (error) { cleanupErrors.push(error) }
    }
    // The candidate path is unique to this invocation and is absent after a
    // successful rename. It is never the shared, possibly newly owned lock.
    try {
      await fs.rm(candidate, { recursive: true, force: true, maxRetries: 5, retryDelay: CLEANUP_RETRY_MS })
    } catch (error) {
      cleanupErrors.push(error)
    }
    if (cleanupErrors.length > 0) {
      if (failed) {
        // Keep the original failure as the primary diagnostic, even if cleanup
        // also fails. Frozen errors and primitive thrown values need a wrapper.
        if (originalError instanceof Error && Object.isExtensible(originalError)
          && !Object.hasOwn(originalError, 'cleanupErrors')) {
          Object.defineProperty(originalError, 'cleanupErrors', { value: cleanupErrors })
        } else {
          throw new AggregateError([originalError, ...cleanupErrors], 'Lock operation and cleanup failed.', { cause: originalError })
        }
      } else if (cleanupErrors.length === 1) throw cleanupErrors[0]
      else throw new AggregateError(cleanupErrors, 'Lock cleanup failed.', { cause: cleanupErrors[0] })
    }
  }
}
