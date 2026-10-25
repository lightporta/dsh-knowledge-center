import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm, rmdir, unlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { withFileLock } from '../lib/lock.js'

const moduleUrl = new URL('../lib/lock.js', import.meta.url).href

async function temporary(run) {
  const root = await mkdtemp(join(tmpdir(), 'knowledge-lock-test-'))
  try { await run(root) } finally { await rm(root, { recursive: true, force: true }) }
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
  await rmdir(path)
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
