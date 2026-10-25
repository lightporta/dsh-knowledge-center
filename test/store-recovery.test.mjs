import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHostHarness } from './helpers/host-harness.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'knowledge-recovery-test-'))
  const dataHome = join(root, 'data')
  const storage = join(dataHome, 'knowledge-center')
  const entries = join(storage, 'entries')
  await mkdir(entries, { recursive: true })
  t.after(() => rm(root, { recursive: true, force: true }))
  return {
    root, dataHome, storage, entries,
    primary: join(storage, 'index.json'),
    backup: join(storage, 'index.json.bak'),
    note: join(entries, 'note-id.md'),
  }
}

function indexFixture() {
  return {
    version: 1, createdAt: 1, updatedAt: 2,
    collections: [{ id: 'shared', name: 'Shared', scope: 'user', workspacePath: null, createdAt: 1, updatedAt: 2 }],
    entries: [{ id: 'note-id', title: 'Preserved note', collectionId: 'shared', workspacePath: '/previous/workspace', sources: ['note.md'], summary: 'Important facts', createdAt: 1, updatedAt: 2 }],
    permissions: { '/previous/workspace': true },
    settings: { outputLanguage: 'zh' },
  }
}

test('first initialization creates an index only for genuinely new storage', async (t) => {
  const data = await fixture(t)
  const host = await createHostHarness(t, { dataHome: data.dataHome })
  const state = await host.rpc('state')
  assert.equal(state.ok, true)
  assert.equal(state.value.entries.length, 0)
  assert.equal(state.value.storageRecovery, null)
  assert.deepEqual(await readdir(data.storage), ['entries', 'index.json'])
})

test('each index mutation atomically preserves the exact previous valid index', async (t) => {
  const data = await fixture(t)
  const host = await createHostHarness(t, { dataHome: data.dataHome })
  await host.rpc('state')
  const original = await readFile(data.primary, 'utf8')
  assert.equal((await host.rpc('setSetting', { outputLanguage: 'en' })).ok, true)
  assert.equal(await readFile(data.backup, 'utf8'), original)
  const changed = await readFile(data.primary, 'utf8')
  assert.equal(JSON.parse(changed).settings.outputLanguage, 'en')
  await host.rpc('setSetting', { outputLanguage: 'zh' })
  assert.equal(await readFile(data.backup, 'utf8'), changed)
})

test('a damaged index without a valid backup preserves every original file', async (t) => {
  const data = await fixture(t)
  await writeFile(data.primary, '{ damaged JSON')
  await writeFile(data.note, '# Original knowledge\n\nDo not erase.\n')
  const host = await createHostHarness(t, { dataHome: data.dataHome })
  const state = await host.rpc('state')
  assert.equal(state.ok, false)
  assert.match(state.error.message, /cannot be recovered.*preserved/)
  assert.equal(await readFile(data.primary, 'utf8'), '{ damaged JSON')
  assert.equal(await readFile(data.note, 'utf8'), '# Original knowledge\n\nDo not erase.\n')
  assert.deepEqual(await readdir(data.storage), ['entries', 'index.json'])
})

test('a valid backup restores damaged primary data while keeping all grants disabled', async (t) => {
  const data = await fixture(t)
  const backupRaw = JSON.stringify(indexFixture())
  await writeFile(data.primary, '{ corrupt primary')
  await writeFile(data.backup, backupRaw)
  await writeFile(data.note, '# Preserved note\n\nImportant facts.\n')
  const workspaces = [{ id: 'old', path: '/previous/workspace' }]
  const host = await createHostHarness(t, { dataHome: data.dataHome, workspaces })
  const state = await host.rpc('state')
  assert.equal(state.ok, true, JSON.stringify(state))
  assert.equal(state.value.entries[0].id, 'note-id')
  assert.deepEqual(state.value.permissions, [])
  assert.equal(state.value.workspaces[0].allowed, false)
  assert.equal(state.value.storageRecovery.reason, 'invalid-primary')
  assert.equal(state.value.storageRecovery.permissionsReset, true)
  assert.equal(state.value.storageRecovery.source, 'backup')
  assert.equal(await readFile(data.backup, 'utf8'), backupRaw)
  assert.equal(await readFile(join(data.storage, state.value.storageRecovery.corruptFile), 'utf8'), '{ corrupt primary')
  assert.deepEqual(JSON.parse(await readFile(data.primary, 'utf8')).permissions, {})
  host.setCwd('/previous/workspace')
  await assert.rejects(host.execute('knowledge_search', {}), /not enabled/)
  assert.equal((await host.rpc('read', { id: 'note-id' })).value.markdown, '# Preserved note\n\nImportant facts.\n')
  const restarted = await createHostHarness(t, { dataHome: data.dataHome, workspaces })
  assert.deepEqual((await restarted.rpc('state')).value.storageRecovery, state.value.storageRecovery)
})

test('a missing primary is restored from a verified backup without granting access', async (t) => {
  const data = await fixture(t)
  await writeFile(data.backup, JSON.stringify(indexFixture()))
  await writeFile(data.note, '# Preserved note\n')
  const host = await createHostHarness(t, { dataHome: data.dataHome })
  const state = await host.rpc('state')
  assert.equal(state.ok, true)
  assert.equal(state.value.entries.length, 1)
  assert.equal(state.value.storageRecovery.reason, 'missing-primary')
  assert.deepEqual(JSON.parse(await readFile(data.primary, 'utf8')).permissions, {})
})

test('missing index files with existing notes cannot silently create an empty index', async (t) => {
  const data = await fixture(t)
  await writeFile(data.note, '# Orphaned but preserved\n')
  const host = await createHostHarness(t, { dataHome: data.dataHome })
  const state = await host.rpc('state')
  assert.equal(state.ok, false)
  assert.match(state.error.message, /cannot be recovered/)
  await assert.rejects(readFile(data.primary), { code: 'ENOENT' })
  assert.equal(await readFile(data.note, 'utf8'), '# Orphaned but preserved\n')
  assert.deepEqual(await readdir(data.storage), ['entries'])
})

test('ordinary index I/O errors do not reset or quarantine primary or backup data', async (t) => {
  const data = await fixture(t)
  // EISDIR is a deterministic read failure on supported desktop platforms;
  // chmod-based EACCES tests would vary with elevation and Windows permissions.
  await mkdir(data.primary)
  const backupRaw = JSON.stringify(indexFixture())
  await writeFile(data.backup, backupRaw)
  await writeFile(data.note, '# Keep this note\n')
  const host = await createHostHarness(t, { dataHome: data.dataHome })
  const state = await host.rpc('state')
  assert.equal(state.ok, false)
  assert.match(state.error.message, /EISDIR|illegal operation on a directory/i)
  assert.equal((await stat(data.primary)).isDirectory(), true)
  assert.equal(await readFile(data.backup, 'utf8'), backupRaw)
  assert.equal(await readFile(data.note, 'utf8'), '# Keep this note\n')
  assert.deepEqual(await readdir(data.storage), ['entries', 'index.json', 'index.json.bak'])
})

test('an invalid backup alone is evidence of existing storage, not a fresh directory', async (t) => {
  const data = await fixture(t)
  await writeFile(data.backup, '{ invalid backup')
  const host = await createHostHarness(t, { dataHome: data.dataHome })
  assert.equal((await host.rpc('state')).ok, false)
  assert.equal(await readFile(data.backup, 'utf8'), '{ invalid backup')
  await assert.rejects(readFile(data.primary), { code: 'ENOENT' })
})

test('old index artifacts cannot be mistaken for a genuinely new storage directory', async (t) => {
  const data = await fixture(t)
  const archived = join(data.storage, 'index.json.corrupt-previous')
  await writeFile(archived, '{ archived data')
  const host = await createHostHarness(t, { dataHome: data.dataHome })
  assert.equal((await host.rpc('state')).ok, false)
  await assert.rejects(readFile(data.primary), { code: 'ENOENT' })
  assert.equal(await readFile(archived, 'utf8'), '{ archived data')
})

test('a backup write failure leaves the current valid index intact', async (t) => {
  const data = await fixture(t)
  const host = await createHostHarness(t, { dataHome: data.dataHome })
  assert.equal((await host.rpc('state')).ok, true)
  const original = await readFile(data.primary, 'utf8')
  await mkdir(data.backup)
  assert.equal((await host.rpc('setSetting', { outputLanguage: 'en' })).ok, false)
  assert.equal(await readFile(data.primary, 'utf8'), original)
  assert.equal((await stat(data.backup)).isDirectory(), true)
  assert.deepEqual(await readdir(data.storage), ['entries', 'index.json', 'index.json.bak'])
})

test('backup recovery clears shared readers and the share audit', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'knowledge-recovery-share-'))
  const dataHome = join(root, 'data')
  t.after(() => rm(root, { recursive: true, force: true }))
  const first = await createHostHarness(t, { dataHome })
  const library = await first.rpc('createCollection', { name: 'Shared', scope: 'shared' })
  assert.equal(library.ok, true, JSON.stringify(library))
  await first.rpc('setCollectionShare', { collectionId: library.value.id, workspacePath: first.workspace, allowed: true })
  await first.rpc('setPermission', { workspacePath: first.workspace, allowed: true })
  // A later mutation rotates the granted index into index.json.bak.
  await first.rpc('setSetting', { outputLanguage: 'en' })
  await writeFile(join(dataHome, 'knowledge-center', 'index.json'), '{ broken')
  const second = await createHostHarness(t, { dataHome })
  const state = await second.rpc('state')
  assert.equal(state.ok, true, JSON.stringify(state))
  const recovered = JSON.parse(await readFile(join(dataHome, 'knowledge-center', 'index.json'), 'utf8'))
  const shared = recovered.collections.find((collection) => collection.id === library.value.id)
  assert.deepEqual(shared.readers, [])
  assert.deepEqual(recovered.shares, [])
  assert.equal(recovered.recovery.readersReset, true)
})