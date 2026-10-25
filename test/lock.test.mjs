import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { mkdtemp, readdir, readFile, rm, rmdir, unlink, utimes, writeFile } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { withFileLock } from '../lib/lock.js'

const moduleUrl = new URL('../lib/lock.js', import.meta.url).href

async function temporary(run) {
  const root = await mkdtemp(join(tmpdir(), 'knowledge-lock-test-'))
  try { await run(root) } finally { await rm(root, { recursive: true, force: true }) }
}

/**
 * Nonrecursive test setup: the directory is empty here, but Windows can still
 * report a temporary sharing conflict for a directory another handle has used.
 */
async function rmdirWhenEmpty(path) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rmdir(path)
      return
    } catch (error) {
      if (!['EACCES', 'EPERM', 'EBUSY'].includes(error.code) || attempt >= 20) throw error
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
}

function child(code, args = []) {
  const process = spawn(globalThis.process.execPath, ['--input-type=module', '-e', code, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  process.stdout.on('data', (chunk) => { stdout += chunk })
  process.stderr.on('data', (chunk) => { stderr += chunk })
  const exited = once(process, 'close').then(([code, signal]) => ({ code, signal, stdout, stderr }))
  return { process, exited }
}

test('serializes concurrent operations using the same lock path', async () => temporary(async (root) => {
  const path = join(root, 'index.lock')
  let active = 0
  let maximum = 0
  let count = 0
  await Promise.all(Array.from({ length: 12 }, () => withFileLock(path, async () => {
    maximum = Math.max(maximum, ++active)
    const before = count
    await new Promise((resolve) => setImmediate(resolve))
    count = before + 1
    active--
  }, { retryDelayMs: 2 })))
  assert.equal(maximum, 1)
  assert.equal(count, 12)
  assert.deepEqual(await readdir(root), [])
}))

test('releases the lock when an operation throws', async () => temporary(async (root) => {
  const path = join(root, 'index.lock')
  const failure = new Error('operation failed')
  await assert.rejects(withFileLock(path, () => { throw failure }), (error) => error === failure)
  assert.equal(await withFileLock(path, () => 42), 42)
  assert.deepEqual(await readdir(root), [])
}))

test('times out without stealing an active owner or leaking candidates', async () => temporary(async (root) => {
  const path = join(root, 'index.lock')
  let release
  let entered
  const ready = new Promise((resolve) => { entered = resolve })
  const held = withFileLock(path, async () => {
    entered()
    await new Promise((resolve) => { release = resolve })
  })
  await ready
  try {
    const owner = await readdir(path)
    const metadataPath = join(path, owner[0])
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8'))
    await writeFile(metadataPath, JSON.stringify({ ...metadata, createdAt: 0 }))
    await utimes(path, 0, 0)
    await assert.rejects(withFileLock(path, () => assert.fail('entered active lock'), {
      timeoutMs: 30, retryDelayMs: 2,
    }), (error) => error.code === 'LOCK_TIMEOUT' && /alive/.test(error.message))
    assert.deepEqual(await readdir(path), owner)
    assert.deepEqual(await readdir(root), ['index.lock'])
  } finally { release(); await held }
}))

test('a late old-owner release cannot remove a newer owner generation', async () => temporary(async (root) => {
  const path = join(root, 'index.lock')
  let releaseOld
  let oldEntered
  const oldReady = new Promise((resolve) => { oldEntered = resolve })
  const oldOperation = withFileLock(path, async () => {
    oldEntered()
    await new Promise((resolve) => { releaseOld = resolve })
  })
  await oldReady
  // Recreate the state after the old owner's file/directory has gone away but
  // before its delayed finally runs. The shared path now belongs to a new call.
  const [oldOwner] = await readdir(path)
  await unlink(join(path, oldOwner))
  await rmdirWhenEmpty(path)
  let releaseNew
  let newEntered
  const newReady = new Promise((resolve) => { newEntered = resolve })
  const newOperation = withFileLock(path, async () => {
    newEntered()
    await new Promise((resolve) => { releaseNew = resolve })
  })
  await newReady
  try {
    const newOwner = await readdir(path)
    assert.notDeepEqual(newOwner, [oldOwner])
    releaseOld()
    await oldOperation
    assert.deepEqual(await readdir(path), newOwner)
  } finally { releaseNew(); await newOperation }
  assert.deepEqual(await readdir(root), [])
}))

test('coordinates actual child-process writers without lost updates', async () => temporary(async (root) => {
  const path = join(root, 'index.lock')
  const counter = join(root, 'counter.json')
  await writeFile(counter, '0')
  const code = `
    import {readFile,writeFile} from 'node:fs/promises';
    import {withFileLock} from ${JSON.stringify(moduleUrl)};
    const [path,counter]=process.argv.slice(1);
    for(let i=0;i<8;i++) await withFileLock(path,async()=>{
      const n=JSON.parse(await readFile(counter,'utf8'));
      await new Promise(resolve=>setTimeout(resolve,2));
      await writeFile(counter,JSON.stringify(n+1));
    },{retryDelayMs:2});
  `
  const children = Array.from({ length: 3 }, () => child(code, [path, counter]))
  for (const result of await Promise.all(children.map((entry) => entry.exited))) {
    assert.equal(result.code, 0, result.stderr)
  }
  assert.equal(JSON.parse(await readFile(counter, 'utf8')), 24)
  assert.deepEqual(await readdir(root), ['counter.json'])
}))

test('recovers a lock after its owning child process exits without releasing it', async () => temporary(async (root) => {
  const path = join(root, 'index.lock')
  const code = `
    import {withFileLock} from ${JSON.stringify(moduleUrl)};
    await withFileLock(process.argv[1],()=>process.exit(0));
  `
  const worker = child(code, [path])
  const result = await worker.exited
  assert.equal(result.code, 0, result.stderr)
  assert.equal((await readdir(path)).length, 1)
  await Promise.all(Array.from({ length: 6 }, () => withFileLock(path, async () => {
    const owners = await readdir(path)
    assert.equal(owners.length, 1)
    assert.ok(owners[0].startsWith(`owner-${process.pid}-`))
  }, { retryDelayMs: 2 })))
  assert.deepEqual(await readdir(root), [])
}))

test('aborted acquisition preserves a live owner and cleans its own candidate', async () => temporary(async (root) => {
  const path = join(root, 'index.lock')
  let release
  let entered
  const ready = new Promise((resolve) => { entered = resolve })
  const held = withFileLock(path, async () => {
    entered()
    await new Promise((resolve) => { release = resolve })
  })
  await ready
  const controller = new AbortController()
  const reason = new Error('cancel wait')
  try {
    const pending = withFileLock(path, () => assert.fail('entered active lock'), {
      signal: controller.signal, retryDelayMs: 2,
    })
    controller.abort(reason)
    await assert.rejects(pending, (error) => error === reason)
    assert.deepEqual(await readdir(root), ['index.lock'])
  } finally { release(); await held }
}))

// The tests below inject Windows access errors at real system calls. The
// library and these tests share one promises object, so a mock is scoped to
// this test's lock path and delegated to the real method everywhere else.

function accessError(code, operation) {
  const error = new Error(`${code}: operation not permitted, ${operation}`)
  error.code = code
  return error
}

test('keeps competing when a rename is denied as the active owner releases', async (t) => temporary(async (root) => {
  const path = join(root, 'index.lock')
  let releaseOld
  let oldEntered
  const oldReady = new Promise((resolve) => { oldEntered = resolve })
  const oldOperation = withFileLock(path, async () => {
    oldEntered()
    await new Promise((resolve) => { releaseOld = resolve })
  }, { retryDelayMs: 2 })
  await oldReady
  const realRename = fs.rename.bind(fs)
  let injected = false
  t.mock.method(fs, 'rename', async (source, target) => {
    if (!injected && target === path) {
      injected = true
      // The lock is released while this caller's rename is already in flight,
      // so Windows denies it and the path is gone by the next inspection.
      releaseOld()
      await oldOperation
      throw accessError('EPERM', 'rename')
    }
    return realRename(source, target)
  })
  let entries = 0
  await withFileLock(path, () => { entries += 1 }, { retryDelayMs: 2 })
  assert.equal(injected, true)
  assert.equal(entries, 1)
  assert.deepEqual(await fs.readdir(root), [])
}))

test('retries a transient sharing violation while releasing the lock', async (t) => temporary(async (root) => {
  const path = join(root, 'index.lock')
  const realRmdir = fs.rmdir.bind(fs)
  let failures = 1
  t.mock.method(fs, 'rmdir', async (target) => {
    if (target === path && failures > 0) {
      failures -= 1
      throw accessError('EPERM', 'rmdir')
    }
    return realRmdir(target)
  })
  assert.equal(await withFileLock(path, () => 42, { retryDelayMs: 2 }), 42)
  assert.equal(failures, 0)
  assert.deepEqual(await fs.readdir(root), [])
  t.mock.restoreAll()
  assert.equal(await withFileLock(path, () => 7, { retryDelayMs: 2 }), 7)
  assert.deepEqual(await fs.readdir(root), [])
}))

test('recovers a stale empty lock directory after transient access errors', async (t) => temporary(async (root) => {
  const path = join(root, 'index.lock')
  await fs.mkdir(path)
  const realRename = fs.rename.bind(fs)
  const realRmdir = fs.rmdir.bind(fs)
  let deniedRename = 1
  let deniedRmdir = 1
  t.mock.method(fs, 'rename', async (source, target) => {
    if (target === path && deniedRename > 0) {
      deniedRename -= 1
      throw accessError('EPERM', 'rename')
    }
    return realRename(source, target)
  })
  t.mock.method(fs, 'rmdir', async (target) => {
    if (target === path && deniedRmdir > 0) {
      deniedRmdir -= 1
      throw accessError('EPERM', 'rmdir')
    }
    return realRmdir(target)
  })
  let entries = 0
  assert.equal(await withFileLock(path, () => { entries += 1; return 'done' }, { retryDelayMs: 2 }), 'done')
  assert.equal(entries, 1)
  assert.equal(deniedRename, 0)
  assert.equal(deniedRmdir, 0)
  assert.deepEqual(await fs.readdir(root), [])
}))

test('bounds a persistent rename denial without entering the operation', async (t) => temporary(async (root) => {
  const path = join(root, 'index.lock')
  const realRename = fs.rename.bind(fs)
  t.mock.method(fs, 'rename', async (source, target) => {
    if (target === path) throw accessError('EPERM', 'rename')
    return realRename(source, target)
  })
  let entered = false
  const started = Date.now()
  await assert.rejects(withFileLock(path, () => { entered = true }, { timeoutMs: 120, retryDelayMs: 2 }), (error) => {
    assert.equal(error.code, 'LOCK_TIMEOUT')
    assert.equal(error.cause?.code, 'EPERM')
    assert.match(error.message, /lock disappeared/)
    return true
  })
  const elapsed = Date.now() - started
  assert.equal(entered, false)
  assert.ok(elapsed >= 100, `waited only ${elapsed} ms`)
  assert.ok(elapsed < 2_000, `waited ${elapsed} ms for a 120 ms deadline`)
  assert.deepEqual(await fs.readdir(root), [])
}))

test('a delayed old-owner cleanup leaves a newer owner untouched', async (t) => temporary(async (root) => {
  const path = join(root, 'index.lock')
  let releaseOld
  let oldEntered
  const oldReady = new Promise((resolve) => { oldEntered = resolve })
  const oldOperation = withFileLock(path, async () => {
    oldEntered()
    await new Promise((resolve) => { releaseOld = resolve })
  }, { retryDelayMs: 2 })
  await oldReady
  const [oldOwner] = await fs.readdir(path)
  await fs.unlink(join(path, oldOwner))
  await rmdirWhenEmpty(path)
  let releaseNew
  let newEntered
  const newReady = new Promise((resolve) => { newEntered = resolve })
  const newOperation = withFileLock(path, async () => {
    newEntered()
    await new Promise((resolve) => { releaseNew = resolve })
  }, { retryDelayMs: 2 })
  await newReady
  const realRmdir = fs.rmdir.bind(fs)
  let injected = false
  t.mock.method(fs, 'rmdir', async (target) => {
    if (target === path && !injected) {
      injected = true
      throw accessError('EPERM', 'rmdir')
    }
    return realRmdir(target)
  })
  const newOwners = await fs.readdir(path)
  assert.equal(newOwners.length, 1)
  const newMetadata = await fs.readFile(join(path, newOwners[0]), 'utf8')
  releaseOld()
  await oldOperation
  assert.equal(injected, true)
  assert.deepEqual(await fs.readdir(path), newOwners)
  assert.equal(await fs.readFile(join(path, newOwners[0]), 'utf8'), newMetadata)
  try {
    await assert.rejects(withFileLock(path, () => assert.fail('entered a newer owner'), {
      timeoutMs: 60, retryDelayMs: 2,
    }), (error) => error.code === 'LOCK_TIMEOUT' && /alive|cannot be proven dead/.test(error.message))
  } finally { releaseNew(); await newOperation }
  assert.deepEqual(await fs.readdir(root), [])
}))

test('a denied process probe cannot be treated as a dead owner', async (t) => temporary(async (root) => {
  const path = join(root, 'index.lock')
  await fs.mkdir(path)
  const token = randomUUID()
  const ownerFile = `owner-${process.pid}-${token}.json`
  const metadata = JSON.stringify({ pid: process.pid, token, hostname: hostname(), createdAt: Date.now() })
  await fs.writeFile(join(path, ownerFile), metadata)
  t.mock.method(process, 'kill', () => { throw accessError('EPERM', 'kill') })
  await assert.rejects(withFileLock(path, () => assert.fail('entered a live owner'), {
    timeoutMs: 60, retryDelayMs: 2,
  }), (error) => error.code === 'LOCK_TIMEOUT' && /cannot be proven dead/.test(error.message))
  assert.equal(await fs.readFile(join(path, ownerFile), 'utf8'), metadata)
  t.mock.restoreAll()
  await fs.rm(path, { recursive: true, force: true })
  assert.deepEqual(await fs.readdir(root), [])
}))

test('a cleanup failure preserves the original operation error', async (t) => temporary(async (root) => {
  const path = join(root, 'index.lock')
  const realRmdir = fs.rmdir.bind(fs)
  t.mock.method(fs, 'rmdir', async (target) => {
    if (target === path) throw accessError('EPERM', 'rmdir')
    return realRmdir(target)
  })
  const failure = new Error('operation failed after acquiring')
  await assert.rejects(withFileLock(path, () => { throw failure }), (error) => {
    assert.equal(error, failure)
    assert.equal(error.cleanupErrors?.length, 1)
    assert.equal(error.cleanupErrors[0].code, 'EPERM')
    return true
  })
  // Only the empty directory could not be deleted; the marker is gone, so the
  // next writer still recovers the path instead of inheriting a live owner.
  assert.deepEqual(await fs.readdir(path), [])
  t.mock.restoreAll()
  assert.equal(await withFileLock(path, () => 'recovered', { retryDelayMs: 2 }), 'recovered')
  assert.deepEqual(await fs.readdir(root), [])
}))

test('cancellation keeps its reason when candidate cleanup also fails', async (t) => temporary(async (root) => {
  const path = join(root, 'index.lock')
  let release
  let entered
  const ready = new Promise((resolve) => { entered = resolve })
  const held = withFileLock(path, async () => {
    entered()
    await new Promise((resolve) => { release = resolve })
  }, { retryDelayMs: 2 })
  await ready
  const owners = await fs.readdir(path)
  const realRm = fs.rm.bind(fs)
  t.mock.method(fs, 'rm', async (target, options) => {
    if (typeof target === 'string' && target.startsWith(`${path}.candidate-`)) {
      throw accessError('EPERM', 'rm')
    }
    return realRm(target, options)
  })
  const controller = new AbortController()
  const reason = new Error('cancel wait')
  try {
    const pending = withFileLock(path, () => assert.fail('entered active lock'), {
      signal: controller.signal, retryDelayMs: 2,
    })
    const abort = setTimeout(() => controller.abort(reason), 20)
    await assert.rejects(pending, (error) => {
      assert.equal(error, reason)
      assert.equal(error.cleanupErrors?.length, 1)
      return true
    }).finally(() => clearTimeout(abort))
    assert.deepEqual(await fs.readdir(path), owners)
    const leftovers = (await fs.readdir(root)).filter((name) => name !== 'index.lock')
    assert.equal(leftovers.length, 1)
    assert.ok(leftovers[0].startsWith('index.lock.candidate-'), leftovers[0])
  } finally {
    t.mock.restoreAll()
    release()
    await held
  }
}))
