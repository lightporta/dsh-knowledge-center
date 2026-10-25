import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
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
    assert.deepEqual(ui.value.results, agent.results)
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
