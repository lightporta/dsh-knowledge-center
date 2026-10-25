import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHostHarness } from './helpers/host-harness.mjs'

test('normal request completion does not cancel document generation', async (t) => {
  const host = await createHostHarness(t)
  const result = await host.rpc('ingest', { workspacePath: host.workspace, relPath: 'source.md', collectionId: 'shared' })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(host.signals.length, 1)
  assert.equal(host.signals[0].aborted, false)
  const state = await host.rpc('state')
  assert.equal(state.value.entries.length, 1)
})

test('an incomplete closed request cancels generation', async (t) => {
  const host = await createHostHarness(t)
  const result = await host.rpc('ingest', { workspacePath: host.workspace, relPath: 'source.md', collectionId: 'shared' }, { complete: false })
  assert.equal(result.ok, false)
  assert.equal(host.signals[0].aborted, true)
  assert.equal((await host.rpc('state')).value.entries.length, 0)
})

test('disconnecting before a generation response cancels the model call', async (t) => {
  let started
  const modelStarted = new Promise((resolve) => { started = resolve })
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const host = await createHostHarness(t, {
    async *stream(options) {
      started()
      await gate
      options.signal.throwIfAborted()
      yield { type: 'text-delta', text: '# Should not be saved' }
    },
  })
  const { req, res, done } = host.request('ingest', { workspacePath: host.workspace, relPath: 'source.md', collectionId: 'shared' })
  await modelStarted
  res.emit('close')
  release()
  const result = await done
  assert.equal(result.ok, false)
  assert.equal(host.signals[0].aborted, true)
  assert.equal(req.listenerCount('close'), 0)
  assert.equal(res.listenerCount('close'), 0)
})

test('empty and keyword tool searches both return ISO timestamps', async (t) => {
  const host = await createHostHarness(t)
  await host.rpc('ingest', { workspacePath: host.workspace, relPath: 'source.md', collectionId: 'shared' })
  await host.rpc('setPermission', { workspacePath: host.workspace, allowed: true })
  for (const args of [{}, { query: '' }, { query: 'facts' }]) {
    const result = await host.execute('knowledge_search', args)
    assert.equal(result.results.length, 1)
    assert.equal(typeof result.results[0].updatedAt, 'string')
    assert.equal(new Date(result.results[0].updatedAt).toISOString(), result.results[0].updatedAt)
  }
})

test('nested registered workspaces require their own grants and cannot read parent libraries', async (t) => {
  const workspaces = []
  const host = await createHostHarness(t, { workspaces })
  const child = join(host.workspace, 'private')
  await mkdir(child)
  workspaces.push({ id: 'parent', path: host.workspace }, { id: 'child', path: child })
  await host.rpc('setPermission', { workspacePath: host.workspace, allowed: true })
  const library = await host.rpc('createCollection', { name: 'Parent', scope: 'workspace', workspacePath: host.workspace })
  const ingested = await host.rpc('ingest', { workspacePath: host.workspace, relPath: 'source.md', collectionId: library.value.id })
  host.setCwd(child)
  await assert.rejects(host.execute('knowledge_search', {}), /not enabled/)
  assert.equal((await host.rpc('state')).value.workspaces.find((item) => item.id === 'child').allowed, false)
  await host.rpc('setPermission', { workspacePath: child, allowed: true })
  const search = await host.execute('knowledge_search', {})
  assert.equal(search.results.length, 0)
  assert.ok(!search.availableCollections.some((item) => item.id === library.value.id))
  await assert.rejects(host.execute('knowledge_read', { id: ingested.value.entry.id }), /not found or not available/)
  await host.rpc('setPermission', { workspacePath: child, allowed: false })
  await assert.rejects(host.execute('knowledge_search', {}), /not enabled/)
})

test('ordinary subdirectory sessions retain access to their registered workspace', async (t) => {
  const host = await createHostHarness(t)
  await host.rpc('setPermission', { workspacePath: host.workspace, allowed: true })
  await host.rpc('ingest', { workspacePath: host.workspace, relPath: 'source.md', collectionId: 'shared' })
  host.setCwd(join(host.workspace, 'src', 'nested'))
  const search = await host.execute('knowledge_search', {})
  assert.equal(search.results.length, 1)
  assert.equal(search.workspace, host.workspace)
  const ingest = await host.execute('knowledge_ingest', { paths: ['source.md'] })
  assert.equal(ingest.failed.length, 0)
  assert.equal(ingest.entries.length, 1)
})

test('independent plugin activations preserve every concurrent update to shared storage', async (t) => {
  const first = await createHostHarness(t)
  const second = await createHostHarness(t, { dataHome: join(first.root, 'data') })
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? first : second).rpc('createCollection', {
    name: `Library ${i}`, scope: 'user',
  })))
  assert.ok(results.every((result) => result.ok))
  const state = await first.rpc('state')
  assert.equal(state.value.collections.length, 13)
  assert.equal(new Set(state.value.collections.map((item) => item.name)).size, 13)
})

test('source aliases update one note while absolute and escaping paths are rejected', async (t) => {
  const host = await createHostHarness(t)
  const ingest = (relPath) => host.rpc('ingest', { workspacePath: host.workspace, relPath, collectionId: 'shared' })
  const first = await ingest('source.md')
  const alias = await ingest('docs/../source.md')
  assert.equal(alias.ok, true)
  assert.equal(alias.value.entry.id, first.value.entry.id)
  assert.equal(alias.value.replaced, true)
  assert.deepEqual(alias.value.entry.sources, ['source.md'])
  assert.equal((await ingest(join(host.workspace, 'source.md'))).ok, false)
  assert.equal((await ingest('../source.md')).ok, false)
  assert.equal((await host.rpc('state')).value.entries.length, 1)
  const file = await readFile(join(host.root, 'data', 'knowledge-center', 'entries', `${first.value.entry.id}.md`), 'utf8')
  assert.ok(!file.includes(host.workspace))
})

test('deleting a target library during generation prevents an orphaned note', async (t) => {
  let started
  const modelStarted = new Promise((resolve) => { started = resolve })
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const host = await createHostHarness(t, {
    async *stream() {
      started()
      await gate
      yield { type: 'text-delta', text: '# Knowledge\n\n> Summary\n\nFacts.' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  })
  const library = await host.rpc('createCollection', { name: 'Temporary', scope: 'user' })
  const pending = host.rpc('ingest', { workspacePath: host.workspace, relPath: 'source.md', collectionId: library.value.id })
  await modelStarted
  assert.equal((await host.rpc('deleteCollection', { id: library.value.id })).ok, true)
  release()
  const result = await pending
  assert.equal(result.ok, false)
  assert.match(result.error.message, /deleted during generation/)
  assert.equal((await host.rpc('state')).value.entries.length, 0)
})

test('token-limited and unfinished model responses cannot overwrite a complete note', async (t) => {
  let finishReason = 'stop'
  const host = await createHostHarness(t, {
    async *stream() {
      yield { type: 'text-delta', text: finishReason === 'stop' ? '# Complete\n\n> Original\n\nFull facts.' : '# Incomplete\n\nHalf a sentence' }
      if (finishReason !== undefined) yield { type: 'finish', reason: { kind: finishReason } }
    },
  })
  const input = { workspacePath: host.workspace, relPath: 'source.md', collectionId: 'shared' }
  const original = await host.rpc('ingest', input)
  const before = (await host.rpc('read', { id: original.value.entry.id })).value.source
  for (const reason of ['max-tokens', 'error', 'aborted', undefined]) {
    finishReason = reason
    const result = await host.rpc('ingest', input)
    assert.equal(result.ok, false, `finish reason ${reason} must fail`)
    assert.equal((await host.rpc('read', { id: original.value.entry.id })).value.source, before)
  }
})

test('a truncated model call is retried with a larger budget before failing', async (t) => {
  let calls = 0
  const host = await createHostHarness(t, {
    async *stream() {
      calls += 1
      if (calls === 1) {
        yield { type: 'text-delta', text: '# Partial' }
        yield { type: 'finish', reason: { kind: 'max-tokens' } }
        return
      }
      yield { type: 'text-delta', text: '# Retried\n\n> Complete after retry\n\nFull facts.' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  })
  const result = await host.rpc('ingest', { workspacePath: host.workspace, relPath: 'source.md', collectionId: 'shared' })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(calls, 2)
  assert.deepEqual(host.calls.map((call) => call.maxTokens), [32_000, 64_000])
})

test('the top reasoning effort falls back to a bounded effort only after bigger budgets fail', async (t) => {
  let calls = 0
  const host = await createHostHarness(t, {
    selection: { provider: 'test', model: 'model', reasoningEffort: 'max' },
    async *stream() {
      calls += 1
      if (calls < 3) {
        yield { type: 'finish', reason: { kind: 'max-tokens' } }
        return
      }
      yield { type: 'text-delta', text: '# Bounded\n\n> Complete at bounded effort\n\nFull facts.' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  })
  const result = await host.rpc('ingest', { workspacePath: host.workspace, relPath: 'source.md', collectionId: 'shared' })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(calls, 3)
  assert.equal(host.calls[0].reasoningEffort, 'max')
  assert.equal(host.calls[1].maxTokens, 64_000)
  assert.equal(host.calls[1].reasoningEffort, 'max')
  assert.equal(host.calls[2].reasoningEffort, 'high')
})

test('a text document above the previous one-megabyte limit is distilled with truncation marked', async (t) => {
  const host = await createHostHarness(t)
  const body = `# Large\n\n${'A fact about the project. '.repeat(60_000)}`
  await writeFile(join(host.workspace, 'large.md'), body)
  const result = await host.rpc('ingest', { workspacePath: host.workspace, relPath: 'large.md', collectionId: 'shared' })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.value.truncated, true)
  const note = (await host.rpc('read', { id: result.value.entry.id })).value.source
  assert.match(note, /truncated: true/)
})

test('owner UI and agent search share body ranking without matching hidden front matter', async (t) => {
  const host = await createHostHarness(t)
  await host.rpc('ingest', { workspacePath: host.workspace, relPath: 'source.md', collectionId: 'shared' })
  await host.rpc('setPermission', { workspacePath: host.workspace, allowed: true })
  for (const query of ['facts', 'source.md', 'zh']) {
    const ui = await host.rpc('search', { query })
    const agent = await host.execute('knowledge_search', { query })
    assert.equal(Object.hasOwn(ui.value, 'index'), false, 'owner search returns results without the internal index')
    const uiResults = ui.value.results.map(({ workspacePath, ...rest }) => rest)
    assert.deepEqual(uiResults, agent.results)
    assert.equal(agent.total, query === 'zh' ? 0 : 1)
    for (const result of agent.results) assert.ok(!result.snippet.includes('createdAt:'))
  }
})

test('Chinese natural-language search recalls component terms from the body', async (t) => {
  const host = await createHostHarness(t, {
    async *stream() {
      yield { type: 'text-delta', text: '# 约定\n\n> 工作流\n\n知识检索需要先确认来源版本。' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  })
  await host.rpc('ingest', { workspacePath: host.workspace, relPath: 'source.md', collectionId: 'shared' })
  const result = await host.rpc('search', { query: '如何进行知识检索' })
  assert.equal(result.value.total, 1)
  assert.match(result.value.results[0].snippet, /知识检索/)
})

test('one document keeps its complete model selection across map and merge calls', async (t) => {
  const host = await createHostHarness(t)
  const { writeFile } = await import('node:fs/promises')
  await writeFile(join(host.workspace, 'source.md'), '# Long source\n\n' + 'Fact. '.repeat(3000))
  const originalGet = host.context.get
  const selections = []
  let changed = false
  host.context.get = (name) => {
    if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'test', model: changed ? 'changed' : 'original', reasoningEffort: 'high' }) }
    if (name === 'llm') return { async prepareCall(selection) {
      selections.push(selection)
      changed = true
      return { config: {}, async *stream() {
        yield { type: 'text-delta', text: '# Knowledge\n\n> Summary\n\nFacts.' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      } }
    } }
    return originalGet(name)
  }
  const result = await host.rpc('ingest', { workspacePath: host.workspace, relPath: 'source.md', collectionId: 'shared' })
  assert.equal(result.ok, true)
  assert.ok(selections.length > 1)
  assert.ok(selections.every((selection) => selection.model === 'original' && selection.reasoningEffort === 'high'))
  assert.equal(result.value.model, 'test/original')
})

test('ordinary note read errors preserve metadata instead of treating the note as missing', async (t) => {
  const host = await createHostHarness(t)
  const result = await host.rpc('ingest', { workspacePath: host.workspace, relPath: 'source.md', collectionId: 'shared' })
  const path = join(host.root, 'data', 'knowledge-center', 'entries', `${result.value.entry.id}.md`)
  await rm(path)
  await mkdir(path)
  const read = await host.rpc('read', { id: result.value.entry.id })
  assert.equal(read.ok, false)
  assert.equal((await host.rpc('state')).value.entries.length, 1)
})

test('the model tool cannot publish into a global or foreign knowledge base', async (t) => {
  const host = await createHostHarness(t)
  await host.rpc('setPermission', { workspacePath: host.workspace, allowed: true })
  await assert.rejects(
    host.execute('knowledge_ingest', { paths: ['source.md'], collectionId: 'shared' }),
    /only write to the current workspace's knowledge base/,
  )
  const owner = await host.rpc('ingest', { workspacePath: host.workspace, relPath: 'source.md', collectionId: 'shared' })
  assert.equal(owner.ok, true, JSON.stringify(owner))
})

test('an index written by a newer plugin is refused instead of rewritten', async (t) => {
  const host = await createHostHarness(t)
  assert.equal((await host.rpc('state')).ok, true)
  const indexPath = join(host.root, 'data', 'knowledge-center', 'index.json')
  const current = JSON.parse(await readFile(indexPath, 'utf8'))
  const future = JSON.stringify({ ...current, version: 99 }, null, 2)
  await writeFile(indexPath, future)
  const state = await host.rpc('state')
  assert.equal(state.ok, false)
  assert.match(state.error.message, /newer Knowledge Center build/)
  assert.equal(await readFile(indexPath, 'utf8'), future)
})

test('a legacy index is upgraded in place with a copy and a migration receipt', async (t) => {
  const host = await createHostHarness(t)
  assert.equal((await host.rpc('state')).ok, true)
  const indexPath = join(host.root, 'data', 'knowledge-center', 'index.json')
  const current = JSON.parse(await readFile(indexPath, 'utf8'))
  await writeFile(indexPath, JSON.stringify({ ...current, version: 1 }, null, 2))
  assert.equal((await host.rpc('state')).ok, true)
  const upgraded = JSON.parse(await readFile(indexPath, 'utf8'))
  assert.equal(upgraded.version, 3)
  const files = await readdir(join(host.root, 'data', 'knowledge-center'))
  assert.ok(files.some((name) => name.startsWith('migration-')), files.join(','))
  assert.ok(files.some((name) => name.startsWith('index.v1-')), files.join(','))
})
test('a conversation attachment becomes a note in the current workspace library', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'knowledge-attachment-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dataHome = join(root, 'data')
  const hex = 'ab'.repeat(32)
  const name = 'note.md'
  const attachmentFile = join(dataHome, 'attachments', 'v1', 'files', hex.slice(0, 2), hex, name)
  await mkdir(dirname(attachmentFile), { recursive: true })
  await writeFile(attachmentFile, '# Attachment\n\nFacts from an attached file.\n')
  const host = await createHostHarness(t, { dataHome, attachmentPath: attachmentFile })
  await host.rpc('setPermission', { workspacePath: host.workspace, allowed: true })
  const result = await host.execute('knowledge_ingest_attachment', { path: attachmentFile })
  assert.equal(result.entries.length, 1, JSON.stringify(result))
  assert.match(result.entries[0].sources[0], /^附件\/[a-f0-9]{12}-note\.md$/)
  const read = await host.rpc('read', { id: result.entries[0].id })
  assert.match(read.value.source, /Verified facts/)
  assert.match(read.value.source, /sources: \["附件\/[a-f0-9]{12}-note\.md"\]/)
})
test('a shared library is visible only to the workspaces the owner granted', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'knowledge-share-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const wsA = join(root, 'ws-a')
  const wsB = join(root, 'ws-b')
  const wsC = join(root, 'ws-c')
  for (const ws of [wsA, wsB, wsC]) await mkdir(ws, { recursive: true })
  await writeFile(join(wsA, 'shared-source.md'), '# Shared\n\nSecret launch plan for the team.\n')
  const workspaces = [
    { id: 'a', title: 'A', path: wsA },
    { id: 'b', title: 'B', path: wsB },
    { id: 'c', title: 'C', path: wsC },
  ]
  const host = await createHostHarness(t, { workspaces, dataHome: join(root, 'data') })
  const library = await host.rpc('createCollection', { name: 'Team', scope: 'shared' })
  assert.equal(library.ok, true, JSON.stringify(library))
  const collectionId = library.value.id
  const ingest = await host.rpc('ingest', { workspacePath: wsA, relPath: 'shared-source.md', collectionId })
  assert.equal(ingest.ok, true, JSON.stringify(ingest))
  const entryId = ingest.value.entry.id
  const grant = await host.rpc('setCollectionShare', { collectionId, workspacePath: wsB, allowed: true })
  assert.equal(grant.ok, true, JSON.stringify(grant))
  assert.equal(grant.value.readers.length, 1)

  host.setCwd(wsB)
  await host.rpc('setPermission', { workspacePath: wsB, allowed: true })
  const asB = await host.execute('knowledge_search', { query: 'verified' })
  assert.equal(asB.total, 1)
  const readB = await host.execute('knowledge_read', { id: entryId })
  assert.equal(readB.id, entryId)

  host.setCwd(wsC)
  await host.rpc('setPermission', { workspacePath: wsC, allowed: true })
  assert.equal((await host.execute('knowledge_search', { query: 'verified' })).total, 0)
  await assert.rejects(host.execute('knowledge_read', { id: entryId }), /not available/)

  const revoke = await host.rpc('setCollectionShare', { collectionId, workspacePath: wsB, allowed: false })
  assert.equal(revoke.ok, true, JSON.stringify(revoke))
  host.setCwd(wsB)
  assert.equal((await host.execute('knowledge_search', { query: 'verified' })).total, 0)

  const audit = await host.rpc('listShares', {})
  assert.deepEqual(audit.value.shares.map((record) => record.action), ['grant', 'revoke'])
})
test('the owner can move a note into a shared library', async (t) => {
  const host = await createHostHarness(t)
  const ingest = await host.rpc('ingest', { workspacePath: host.workspace, relPath: 'source.md', collectionId: 'shared' })
  assert.equal(ingest.ok, true, JSON.stringify(ingest))
  const library = await host.rpc('createCollection', { name: 'Team move', scope: 'shared' })
  assert.equal(library.ok, true, JSON.stringify(library))
  const moved = await host.rpc('moveEntry', { id: ingest.value.entry.id, collectionId: library.value.id })
  assert.equal(moved.ok, true, JSON.stringify(moved))
  assert.equal(moved.value.collectionId, library.value.id)
  const read = await host.rpc('read', { id: ingest.value.entry.id })
  assert.equal(read.value.meta.collectionId, library.value.id)
})
test('moving a note rejects a same-source duplicate and aligns front matter', async (t) => {
  const host = await createHostHarness(t)
  const target = await host.rpc('createCollection', { name: 'Target', scope: 'shared' })
  const first = await host.rpc('ingest', { workspacePath: host.workspace, relPath: 'source.md', collectionId: 'shared' })
  assert.equal(first.ok, true, JSON.stringify(first))
  await host.rpc('ingest', { workspacePath: host.workspace, relPath: 'source.md', collectionId: target.value.id })
  const duplicate = await host.rpc('moveEntry', { id: first.value.entry.id, collectionId: target.value.id })
  assert.equal(duplicate.ok, false)
  assert.match(duplicate.error.message, /already holds a note/)
  const empty = await host.rpc('createCollection', { name: 'Empty shared', scope: 'shared' })
  const moved = await host.rpc('moveEntry', { id: first.value.entry.id, collectionId: empty.value.id })
  assert.equal(moved.ok, true, JSON.stringify(moved))
  const read = await host.rpc('read', { id: first.value.entry.id })
  assert.ok(read.value.source.includes(empty.value.id), 'front matter follows the index')
})

test('a shared library granted to a parent workspace is not inherited by a nested workspace', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'knowledge-nested-share-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const parent = join(root, 'parent')
  const child = join(parent, 'child')
  await mkdir(child, { recursive: true })
  await writeFile(join(parent, 'doc.md'), '# Parent\n\nParent facts.\n')
  const workspaces = [
    { id: 'parent', title: 'Parent', path: parent },
    { id: 'child', title: 'Child', path: child },
  ]
  const host = await createHostHarness(t, { workspaces, dataHome: join(root, 'data') })
  const library = await host.rpc('createCollection', { name: 'Shared', scope: 'shared' })
  const ingest = await host.rpc('ingest', { workspacePath: parent, relPath: 'doc.md', collectionId: library.value.id })
  assert.equal(ingest.ok, true, JSON.stringify(ingest))
  await host.rpc('setCollectionShare', { collectionId: library.value.id, workspacePath: parent, allowed: true })
  host.setCwd(child)
  await host.rpc('setPermission', { workspacePath: child, allowed: true })
  assert.equal((await host.execute('knowledge_search', { query: 'verified' })).total, 0)
  host.setCwd(parent)
  await host.rpc('setPermission', { workspacePath: parent, allowed: true })
  assert.equal((await host.execute('knowledge_search', { query: 'verified' })).total, 1)
})
test('agent search does not reveal the publishing workspace path', async (t) => {
  const host = await createHostHarness(t)
  await host.rpc('ingest', { workspacePath: host.workspace, relPath: 'source.md', collectionId: 'shared' })
  await host.rpc('setPermission', { workspacePath: host.workspace, allowed: true })
  const agent = await host.execute('knowledge_search', { query: 'verified' })
  assert.equal(agent.total, 1)
  assert.equal(Object.hasOwn(agent.results[0], 'workspacePath'), false)
  const owner = await host.rpc('search', { query: 'verified' })
  assert.equal(owner.value.results[0].workspacePath, host.workspace)
})