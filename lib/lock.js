/**
 * A local, cross-process directory lock with conservative crash recovery.
 *
 * Prepare the owner file before publishing the directory with rename(). An
 * active lock is therefore always nonempty and cannot be replaced by another
 * candidate directory. Cleanup removes only the observed owner's unique file,
 * then uses nonrecursive rmdir: a delayed cleanup cannot remove a new owner.
 */
import { promises as fs } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { hostname } from 'node:os'
import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'

const OWNER_FILE = /^owner-([1-9]\d*)-([a-f0-9-]+)\.json$/
const CONTENTION_CODES = new Set(['EEXIST', 'ENOTEMPTY', 'EACCES', 'EPERM'])

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

/** Remove a specific generation, never recursively remove the shared path. */
async function removeOwner(lockPath, ownerFile) {
  try {
    await fs.unlink(`${lockPath}/${ownerFile}`)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  try {
    await fs.rmdir(lockPath)
  } catch (error) {
    if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error
  }
}

async function inspectAndRecover(lockPath) {
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
    try {
      await fs.rmdir(lockPath)
    } catch (error) {
      if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error
    }
    return 'empty lock cleanup'
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
  await removeOwner(lockPath, names[0])
  return `recovered exited owner process ${pid}`
}

/**
 * Run operation while holding one local filesystem lock.
 *
 * A timeout never steals a live lock. PID reuse and foreign-host/invalid owner
 * metadata conservatively block recovery rather than risk overlapping writers.
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
  const started = performance.now()
  let lastState = 'lock is occupied'
  try {
    await fs.mkdir(dirname(lockPath), { recursive: true })
    await fs.mkdir(candidate, { mode: 0o700 })
    await fs.writeFile(`${candidate}/${ownerFile}`, JSON.stringify({
      pid: process.pid, token, hostname: hostname(), createdAt: Date.now(),
    }), { flag: 'wx', mode: 0o600 })
    while (!acquired) {
      checkSignal(signal)
      try {
        await fs.rename(candidate, lockPath)
        acquired = true
      } catch (error) {
        if (!CONTENTION_CODES.has(error.code)) throw error
        // Windows may report EPERM/EACCES for an occupied directory. Do not
        // mistake a genuine permission error with no existing lock for a wait.
        try {
          await fs.lstat(lockPath)
        } catch (statError) {
          if (statError.code === 'ENOENT' && ['EACCES', 'EPERM'].includes(error.code)) throw error
          if (statError.code !== 'ENOENT') throw statError
        }
        lastState = await inspectAndRecover(lockPath)
        const remaining = timeoutMs - (performance.now() - started)
        if (remaining <= 0) {
          const timeout = new Error(`Timed out after ${timeoutMs} ms waiting for knowledge storage lock ${lockPath}: ${lastState}.`)
          timeout.code = 'LOCK_TIMEOUT'
          throw timeout
        }
        await delay(Math.min(retryDelayMs, remaining), signal)
      }
    }
    checkSignal(signal)
    return await operation()
  } finally {
    if (acquired) await removeOwner(lockPath, ownerFile)
    // The candidate path is unique to this invocation and is absent after a
    // successful rename. It is never the shared, possibly newly owned lock.
    await fs.rm(candidate, { recursive: true, force: true })
  }
}
