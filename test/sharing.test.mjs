import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { createHostHarness } from './helpers/host-harness.mjs'
import { withFileLock } from '../lib/lock.js'

function metadata(source) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source)
  assert.ok(match, 'the note has front matter')
  return Object.fromEntries(match[1].split(/\r?\n/).map((line) => {
    const separator = line.indexOf(':')
    return [line.slice(0, separator), JSON.parse(line.slice(separator + 1))]
  }))
}

async function seed(host) {
  const generated = await host.rpc('ingest', { workspacePath: host.workspace, relPath: 'source.md', collectionId: 'shared' })
  assert.equal(generated.ok, true, JSON.stringify(generated))
  const library = await host.rpc('createCollection', { name: 'Team library', scope: 'shared' })
  assert.equal(library.ok, true)
  const id = generated.value.entry.id
  return {
    id, collectionId: library.value.id,
    path: join(host.root, 'data', 'knowledge-center', 'entries', `${id}.md`),
    lock: join(host.root, 'data', 'knowledge-center', 'index.lock'),
  }
}

test('moving preserves all front matter and body, and updates sizes and library timestamps', async (t) => {
  const host = await createHostHarness(t)
  const note = await seed(host)
  const original = (await host.rpc('read', { id: note.id })).value.source
  const edited = original.replace('tags: []', 'tags: ["keep","shared"]\nquality: {"reviewed":true,"version":2}')
  assert.equal((await host.rpc('saveEntry', { id: note.id, markdown: edited })).ok, true)
  const before = (await host.rpc('read', { id: note.id })).value
  const beforeMeta = metadata(before.source)
  const movedAt = Date.now() + 10_000
  const clock = t.mock.method(Date, 'now', () => movedAt)
  let moved
  try {
    moved = await host.rpc('moveEntry', { id: note.id, collectionId: note.collectionId })
  } finally { clock.mock.restore() }
  assert.equal(moved.ok, true, JSON.stringify(moved))
  const after = (await host.rpc('read', { id: note.id })).value
  const afterMeta = metadata(after.source)
  for (const [key, value] of Object.entries(beforeMeta)) {
    if (!['collectionId', 'collection', 'updatedAt'].includes(key)) assert.deepEqual(afterMeta[key], value, key)
  }
  assert.equal(afterMeta.collectionId, note.collectionId)
  assert.equal(afterMeta.collection, 'Team library')
  assert.equal(afterMeta.updatedAt, movedAt)
  assert.equal(after.markdown, before.markdown)
  assert.equal(moved.value.size, Buffer.byteLength(after.source))
  const state = (await host.rpc('state')).value
  assert.equal(state.collections.find((entry) => entry.id === 'shared').updatedAt, movedAt)
  assert.equal(state.collections.find((entry) => entry.id === note.collectionId).updatedAt, movedAt)
})

test('a move holds the storage lock while reading the note, so a concurrent edit remains intact', async (t) => {
  const host = await createHostHarness(t)
  const note = await seed(host)
  const readFile = fs.readFile
  let release
  let entered
  const gate = new Promise((resolve) => { release = resolve })
  const ready = new Promise((resolve) => { entered = resolve })
  let block = true
  fs.readFile = async (path, ...args) => {
    const content = await readFile(path, ...args)
    if (path === note.path && block) { block = false; entered(); await gate }
    return content
  }
  let moving
  let saving
  try {
    moving = host.rpc('moveEntry', { id: note.id, collectionId: note.collectionId })
    await ready
    await assert.rejects(withFileLock(note.lock, () => assert.fail('move released its lock before rewriting the note'), { timeoutMs: 0 }), { code: 'LOCK_TIMEOUT' })
    saving = host.rpc('saveEntry', { id: note.id, markdown: '# Manual update\n\nNEW_VALUE_123\n' })
    release()
    const [move, save] = await Promise.all([moving, saving])
    assert.equal(move.ok, true, JSON.stringify(move))
    assert.equal(save.ok, true, JSON.stringify(save))
    const after = (await host.rpc('read', { id: note.id })).value
    assert.match(after.markdown, /NEW_VALUE_123/)
    assert.equal(after.meta.collectionId, note.collectionId)
    assert.equal(metadata(after.source).collectionId, note.collectionId)
  } finally {
    release()
    fs.readFile = readFile
    await Promise.allSettled([moving, saving].filter(Boolean))
  }
})

test('deleting the target library during a move cannot recreate a deleted note', async (t) => {
  const host = await createHostHarness(t)
  const note = await seed(host)
  const readFile = fs.readFile
  let release
  let entered
  const gate = new Promise((resolve) => { release = resolve })
  const ready = new Promise((resolve) => { entered = resolve })
  let block = true
  fs.readFile = async (path, ...args) => {
    const content = await readFile(path, ...args)
    if (path === note.path && block) { block = false; entered(); await gate }
    return content
  }
  let moving
  let deleting
  try {
    moving = host.rpc('moveEntry', { id: note.id, collectionId: note.collectionId })
    await ready
    deleting = host.rpc('deleteCollection', { id: note.collectionId })
    release()
    const [move, deletion] = await Promise.all([moving, deleting])
    assert.equal(move.ok, true)
    assert.equal(deletion.ok, true)
    assert.equal((await host.rpc('state')).value.entries.length, 0)
    await assert.rejects(fs.stat(note.path), { code: 'ENOENT' })
  } finally {
    release()
    fs.readFile = readFile
    await Promise.allSettled([moving, deleting].filter(Boolean))
  }
})

test('a failed note-file update does not commit a move to the index', async (t) => {
  const host = await createHostHarness(t)
  const note = await seed(host)
  const before = (await host.rpc('read', { id: note.id })).value
  const rename = fs.rename
  fs.rename = async (from, to) => {
    if (to === note.path) throw Object.assign(new Error('injected note rename EACCES'), { code: 'EACCES' })
    return rename(from, to)
  }
  let moved
  try { moved = await host.rpc('moveEntry', { id: note.id, collectionId: note.collectionId }) }
  finally { fs.rename = rename }
  assert.equal(moved.ok, false)
  assert.match(moved.error.message, /EACCES/)
  const after = (await host.rpc('read', { id: note.id })).value
  assert.equal(after.meta.collectionId, before.meta.collectionId)
  assert.equal(after.meta.updatedAt, before.meta.updatedAt)
  assert.equal(after.source, before.source)
})

test('a missing note file fails before changing the collection', async (t) => {
  const host = await createHostHarness(t)
  const note = await seed(host)
  await fs.unlink(note.path)
  const moved = await host.rpc('moveEntry', { id: note.id, collectionId: note.collectionId })
  assert.equal(moved.ok, false)
  assert.match(moved.error.message, /ENOENT/)
  assert.equal((await host.rpc('state')).value.entries.find((entry) => entry.id === note.id).collectionId, 'shared')
  await assert.rejects(fs.stat(note.path), { code: 'ENOENT' })
})

test('owner state exposes shared-reader counts while agent search keeps publishing metadata private', async (t) => {
  const workspaces = []
  const host = await createHostHarness(t, { workspaces })
  const reader = join(host.root, 'reader-workspace')
  await fs.mkdir(reader)
  workspaces.push({ id: 'owner', path: host.workspace }, { id: 'reader', path: reader })
  const note = await seed(host)
  assert.equal((await host.rpc('moveEntry', { id: note.id, collectionId: note.collectionId })).ok, true)
  await host.rpc('setCollectionShare', { collectionId: note.collectionId, workspacePath: reader, allowed: true })
  await host.rpc('setPermission', { workspacePath: reader, allowed: true })
  const state = (await host.rpc('state')).value
  assert.deepEqual(state.collections.find((entry) => entry.id === note.collectionId).readers, [reader])
  assert.deepEqual(state.collections.find((entry) => entry.id === note.collectionId).readerWorkspaceIds, ['reader'])
  host.setCwd(reader)
  const search = await host.execute('knowledge_search', {})
  assert.equal(search.total, 1)
  assert.equal(Object.hasOwn(search.results[0], 'workspacePath'), false)
  assert.equal(Object.hasOwn(search.results[0], 'readers'), false)
  assert.ok(!JSON.stringify(search).includes(host.workspace))
  await host.rpc('setCollectionShare', { collectionId: note.collectionId, workspacePath: reader, allowed: false })
  assert.deepEqual((await host.rpc('state')).value.collections.find((entry) => entry.id === note.collectionId).readers, [])
  assert.equal((await host.execute('knowledge_search', {})).total, 0)
})

test('shared-reader workspace ids follow Host platform case rules', async (t) => {
  const workspaces = []
  const host = await createHostHarness(t, { workspaces })
  const lower = join(host.root, 'case-reader')
  const upper = lower.toUpperCase()
  workspaces.push({ id: 'lower', path: lower }, { id: 'upper', path: upper })
  const library = await host.rpc('createCollection', { name: 'Case-sensitive share', scope: 'shared' })
  assert.equal(library.ok, true)
  const grant = await host.rpc('setCollectionShare', { collectionId: library.value.id, workspacePath: lower, allowed: true })
  assert.equal(grant.ok, true)
  const state = (await host.rpc('state')).value
  const shared = state.collections.find((entry) => entry.id === library.value.id)
  assert.deepEqual(shared.readers, [lower])
  assert.deepEqual(shared.readerWorkspaceIds, process.platform === 'win32' ? ['lower', 'upper'] : ['lower'])
})

test('reported index commit failures restore the original note under the same lock', async (t) => {
  for (const filename of ['index.json.bak', 'index.json']) {
    await t.test(filename, async (t) => {
      const host = await createHostHarness(t)
      const note = await seed(host)
      const storage = join(host.root, 'data', 'knowledge-center')
      const originalIndex = await fs.readFile(join(storage, 'index.json'), 'utf8')
      const originalNote = await fs.readFile(note.path, 'utf8')
      const rename = fs.rename
      const initialCause = new Error('underlying storage fault')
      const commitError = Object.assign(new Error(`injected ${filename} EACCES`, { cause: initialCause }), { code: 'EACCES' })
      let noteWrites = 0
      let rollbackHeldLock = false
      fs.rename = async (from, to) => {
        if (to === join(storage, filename)) throw commitError
        if (to === note.path && ++noteWrites === 2) {
          await assert.rejects(withFileLock(note.lock, () => assert.fail('rollback must remain under the storage lock'), { timeoutMs: 0 }), { code: 'LOCK_TIMEOUT' })
          rollbackHeldLock = true
        }
        return rename(from, to)
      }
      let moved
      try { moved = await host.rpc('moveEntry', { id: note.id, collectionId: note.collectionId }) }
      finally { fs.rename = rename }
      assert.equal(moved.ok, false)
      assert.match(moved.error.message, /EACCES/)
      assert.equal(commitError.cause, initialCause)
      assert.equal(rollbackHeldLock, true)
      assert.equal(await fs.readFile(note.path, 'utf8'), originalNote)
      assert.equal(await fs.readFile(join(storage, 'index.json'), 'utf8'), originalIndex)
      const state = (await host.rpc('state')).value
      assert.equal(state.entries.find((entry) => entry.id === note.id).collectionId, 'shared')
      const saved = await host.rpc('saveEntry', { id: note.id, markdown: '# After failure\n\nStill editable.\n' })
      assert.equal(saved.ok, true, JSON.stringify(saved))
      assert.match((await host.rpc('read', { id: note.id })).value.markdown, /Still editable/)
    })
  }
})

test('a rollback failure retains both the commit error and the restore error', async (t) => {
  const host = await createHostHarness(t)
  const note = await seed(host)
  const backup = join(host.root, 'data', 'knowledge-center', 'index.json.bak')
  const rename = fs.rename
  const commitError = Object.assign(new Error('original commit EACCES'), { code: 'EACCES' })
  const restoreError = Object.assign(new Error('restore note EACCES'), { code: 'EACCES' })
  const NativeAggregateError = globalThis.AggregateError
  let aggregate
  const capture = t.mock.method(globalThis, 'AggregateError', function (errors, message, options) {
    aggregate = new NativeAggregateError(errors, message, options)
    return aggregate
  })
  let noteWrites = 0
  fs.rename = async (from, to) => {
    if (to === backup) throw commitError
    if (to === note.path && ++noteWrites === 2) throw restoreError
    return rename(from, to)
  }
  let moved
  try { moved = await host.rpc('moveEntry', { id: note.id, collectionId: note.collectionId }) }
  finally { fs.rename = rename; capture.mock.restore() }
  assert.equal(moved.ok, false)
  assert.match(moved.error.message, /original commit EACCES/)
  assert.match(moved.error.message, /rollback also failed.*restore note EACCES/)
  assert.equal(aggregate.cause, commitError)
  assert.deepEqual(aggregate.errors, [commitError, restoreError])
  assert.equal(aggregate.code, 'KNOWLEDGE_ROLLBACK_FAILED')
  assert.equal((await host.rpc('state')).value.entries.find((entry) => entry.id === note.id).collectionId, 'shared')
  assert.equal((await host.rpc('saveEntry', { id: note.id, markdown: '# Repair\n\nEditable after rollback failure.\n' })).ok, true)
})
