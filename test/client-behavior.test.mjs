import test from 'node:test'
import assert from 'node:assert/strict'
import { deferred, mountClient, textContent } from './helpers/client-harness.mjs'

const entry = (id) => ({
  id, title: `Note ${id}`, collectionId: 'shared', collectionName: 'Shared',
  sources: [`${id}.md`], summary: '', updatedAt: 1, size: 20,
})
const document = (id) => ({ meta: entry(id), source: `# Note ${id}`, markdown: `# Note ${id}` })
const state = {
  entries: [entry('A'), entry('B')],
  collections: [{ id: 'shared', name: 'Shared', scope: 'user', entryCount: 2 }],
  workspaces: [], permissions: [], settings: { outputLanguage: 'en' },
  totals: { entries: 2, collections: 1 }, model: 'test/model', dataDir: '/test', tools: [],
}

async function setup() {
  const reads = new Map()
  const saves = []
  const deletes = []
  const harness = mountClient({
    state,
    rpc(method, params) {
      if (method === 'read') {
        const request = deferred()
        reads.set(params.id, [...(reads.get(params.id) ?? []), request])
        return request.promise
      }
      if (method === 'saveEntry') {
        const request = deferred()
        saves.push({ ...request, params })
        return request.promise
      }
      if (method === 'deleteEntry') {
        deletes.push(params.id)
        return { deleted: true }
      }
      throw new Error(`unexpected RPC: ${method}`)
    },
  })
  await harness.flush()
  return { harness, reads, saves, deletes }
}

function title(harness) {
  return harness.nodes((node) => node.type === 'h2' && node.props.className === 'kc-detail-title')
    .map(textContent).join('')
}

async function openBWhileAIsPending(harness) {
  harness.click(harness.entry('Note A'))
  await harness.flush()
  harness.click(harness.button('← Back to list'))
  await harness.flush()
  harness.click(harness.entry('Note B'))
  await harness.flush()
}

test('a late read cannot replace the current note or change the delete target', async (t) => {
  const { harness, reads, deletes } = await setup()
  t.after(() => harness.unmount())
  await openBWhileAIsPending(harness)
  reads.get('B')[0].resolve(document('B'))
  await harness.flush()
  assert.equal(title(harness), 'Note B')
  reads.get('A')[0].resolve(document('A'))
  await harness.flush()
  assert.equal(title(harness), 'Note B', 'late A must not replace the visible B')
  harness.click(harness.button('Delete'))
  await harness.flush()
  await harness.click(harness.button('Confirm delete'))
  await harness.flush()
  assert.deepEqual(deletes, ['B'])
})

test('a stale failed read cannot stop the current loading state or show its error', async (t) => {
  const { harness, reads } = await setup()
  t.after(() => harness.unmount())
  await openBWhileAIsPending(harness)
  reads.get('A')[0].reject(new Error('stale A read failed'))
  await harness.flush()
  assert.ok(textContent(harness.tree).includes('Loading note…'), 'B remains loading')
  assert.ok(!textContent(harness.tree).includes('stale A read failed'))
  reads.get('B')[0].resolve(document('B'))
  await harness.flush()
  assert.equal(title(harness), 'Note B')
})

test('a stale failed read cannot overwrite the current note error', async (t) => {
  const { harness, reads } = await setup()
  t.after(() => harness.unmount())
  await openBWhileAIsPending(harness)
  reads.get('B')[0].reject(new Error('current B read failed'))
  await harness.flush()
  reads.get('A')[0].reject(new Error('stale A read failed'))
  await harness.flush()
  assert.ok(textContent(harness.tree).includes('current B read failed'))
  assert.ok(!textContent(harness.tree).includes('stale A read failed'))
})

test('note actions are disabled until the selected note has loaded', async (t) => {
  const { harness, reads } = await setup()
  t.after(() => harness.unmount())
  harness.click(harness.entry('Note A'))
  await harness.flush()
  for (const label of ['Edit', 'Delete', 'Copy', 'Download']) {
    assert.equal(harness.button(label).props.disabled, true, `${label} is disabled while loading`)
  }
  reads.get('A')[0].resolve(document('A'))
  await harness.flush()
  for (const label of ['Edit', 'Delete', 'Copy', 'Download']) {
    assert.notEqual(harness.button(label).props.disabled, true, `${label} is enabled after loading`)
  }
})

test('a late read after closing cannot restore the old detail', async (t) => {
  const { harness, reads } = await setup()
  t.after(() => harness.unmount())
  harness.click(harness.entry('Note A'))
  await harness.flush()
  harness.click(harness.button('← Back to list'))
  await harness.flush()
  reads.get('A')[0].resolve(document('A'))
  await harness.flush()
  assert.equal(title(harness), '')
  assert.ok(harness.entry('Note A'))
  harness.click(harness.entry('Note B'))
  await harness.flush()
  assert.ok(textContent(harness.tree).includes('Loading note…'))
  assert.equal(title(harness), '')
  reads.get('B')[0].resolve(document('B'))
  await harness.flush()
  assert.equal(title(harness), 'Note B')
})

test('navigation remains disabled for the complete save and reload operation', async (t) => {
  const { harness, reads, saves } = await setup()
  t.after(() => harness.unmount())
  harness.click(harness.entry('Note A'))
  await harness.flush()
  reads.get('A')[0].resolve(document('A'))
  await harness.flush()
  harness.click(harness.button('Edit'))
  await harness.flush()
  const editor = harness.nodes((node) => node.type === 'textarea')[0]
  editor.props.onChange({ target: { value: '# Edited A' } })
  await harness.flush()
  const saving = harness.click(harness.button('Save'))
  await harness.flush()
  assert.equal(harness.button('← Back to list').props.disabled, true, 'save RPC blocks navigation')
  saves[0].resolve({ entry: entry('A') })
  await harness.flush()
  assert.equal(harness.button('← Back to list').props.disabled, true, 'read-after-save blocks navigation')
  reads.get('A')[1].resolve({ ...document('A'), source: '# Edited A', markdown: '# Edited A' })
  await saving
  await harness.flush()
  assert.notEqual(harness.button('← Back to list').props.disabled, true)
  assert.equal(title(harness), 'Note A')
  assert.equal(saves[0].params.id, 'A')
  assert.equal(saves[0].params.markdown, '# Edited A')
})

async function editA(harness, reads, draft = '# Edited A') {
  harness.click(harness.entry('Note A'))
  await harness.flush()
  reads.get('A')[0].resolve(document('A'))
  await harness.flush()
  harness.click(harness.button('Edit'))
  await harness.flush()
  harness.nodes((node) => node.type === 'textarea')[0].props.onChange({ target: { value: draft } })
  await harness.flush()
}

test('rendered draft preview preserves editing and source when switching modes', async (t) => {
  const { harness, reads } = await setup()
  t.after(() => harness.unmount())
  const draft = '---\ntitle: "Draft metadata"\n---\n# Revised A\n\nUnsaved body.'
  await editA(harness, reads, draft)
  harness.click(harness.button('Rendered'))
  await harness.flush()
  assert.ok(textContent(harness.tree).includes('Preview of the unsaved draft'))
  assert.ok(textContent(harness.tree).includes('Revised A'))
  assert.ok(!textContent(harness.tree).includes('Draft metadata'), 'front matter is not preview body')
  assert.ok(harness.button('Save'), 'preview remains in an editable draft session')
  harness.click(harness.button('Markdown source'))
  await harness.flush()
  assert.equal(harness.nodes((node) => node.type === 'textarea')[0].props.value, draft)
})

test('dirty return offers keep editing or explicit discard without losing the draft', async (t) => {
  const { harness, reads } = await setup()
  t.after(() => harness.unmount())
  await editA(harness, reads)
  harness.click(harness.button('← Back to list'))
  await harness.flush()
  assert.equal(title(harness), 'Note A')
  assert.ok(textContent(harness.tree).includes('This note has unsaved changes.'))
  harness.click(harness.button('Keep editing'))
  await harness.flush()
  assert.equal(harness.nodes((node) => node.type === 'textarea')[0].props.value, '# Edited A')
  harness.click(harness.button('← Back to list'))
  await harness.flush()
  harness.click(harness.button('Discard changes'))
  await harness.flush()
  assert.equal(title(harness), '')
  assert.ok(harness.entry('Note A'))
  assert.equal(harness.calls.filter(({ method }) => method === 'saveEntry').length, 0)
})

test('save and return waits for persistence before leaving the dirty note', async (t) => {
  const { harness, reads, saves } = await setup()
  t.after(() => harness.unmount())
  await editA(harness, reads)
  harness.click(harness.button('← Back to list'))
  await harness.flush()
  const saving = harness.click(harness.button('Save and return'))
  await harness.flush()
  assert.equal(title(harness), 'Note A')
  assert.equal(harness.button('Discard changes').props.disabled, true)
  saves[0].resolve({ entry: entry('A') })
  await harness.flush()
  assert.equal(title(harness), 'Note A', 'read-after-save completes before navigation')
  reads.get('A')[1].resolve({ ...document('A'), source: '# Edited A', markdown: '# Edited A' })
  await saving
  await harness.flush()
  assert.equal(title(harness), '')
  assert.ok(harness.entry('Note A'))
  assert.equal(saves[0].params.markdown, '# Edited A')
})

test('a failed save and return leaves both the note and the draft available', async (t) => {
  const { harness, reads, saves } = await setup()
  t.after(() => harness.unmount())
  await editA(harness, reads)
  harness.click(harness.button('← Back to list'))
  await harness.flush()
  const saving = harness.click(harness.button('Save and return'))
  saves[0].reject(new Error('disk is full'))
  await saving
  await harness.flush()
  assert.equal(title(harness), 'Note A')
  assert.equal(harness.nodes((node) => node.type === 'textarea')[0].props.value, '# Edited A')
  assert.ok(textContent(harness.tree).includes('disk is full'))
  assert.notEqual(harness.button('Save and return').props.disabled, true)
})

test('cancelling a dirty edit requires explicit discard and stays on the note', async (t) => {
  const { harness, reads } = await setup()
  t.after(() => harness.unmount())
  await editA(harness, reads)
  harness.click(harness.button('Cancel'))
  await harness.flush()
  assert.equal(harness.nodes((node) => node.type === 'textarea')[0].props.value, '# Edited A')
  harness.click(harness.button('Discard changes'))
  await harness.flush()
  assert.equal(title(harness), 'Note A')
  assert.equal(harness.nodes((node) => node.type === 'textarea').length, 0)
  assert.ok(harness.button('Edit'))
})

const workspaceState = {
  ...state,
  workspaces: [
    { id: 'workspace-a', path: '/A', title: 'Workspace A', allowed: false },
    { id: 'workspace-b', path: '/B', title: 'Workspace B', allowed: false },
  ],
}

async function setupGeneration() {
  const scans = []
  const ingests = []
  const harness = mountClient({
    state: workspaceState,
    rpc(method, params, signal) {
      if (method === 'scan') {
        const request = deferred()
        scans.push({ ...request, params, signal })
        return request.promise
      }
      if (method === 'ingest') {
        ingests.push(params)
        return { entry: entry(params.relPath), replaced: false, truncated: false }
      }
      throw new Error(`unexpected RPC: ${method}`)
    },
  })
  await harness.flush()
  harness.click(harness.button('Generate'))
  await harness.flush()
  return { harness, scans, ingests }
}

function workspaceSelect(harness) {
  return harness.nodes((node) => node.type === 'select' && node.props['aria-label'] === 'Workspace')[0]
}

function scanResult(workspacePath, ...paths) {
  return { workspacePath, files: paths.map((path) => ({ path, bytes: 12 })), truncated: false }
}

test('a late scan from A cannot populate B after the workspace changes', async (t) => {
  const { harness, scans, ingests } = await setupGeneration()
  t.after(() => harness.unmount())
  harness.click(harness.button('Scan documents'))
  await harness.flush()
  assert.equal(workspaceSelect(harness).props.disabled, true)
  // An already queued change callback must also be safe, beyond DOM disabling.
  workspaceSelect(harness).props.onChange({ target: { value: '/B' } })
  await harness.flush()
  assert.equal(scans[0].signal.aborted, true)
  harness.click(harness.button('Scan documents'))
  await harness.flush()
  scans[1].resolve(scanResult('/B', 'only-in-B.md'))
  await harness.flush()
  scans[0].resolve(scanResult('/A', 'only-in-A.md'))
  await harness.flush()
  assert.ok(textContent(harness.tree).includes('only-in-B.md'))
  assert.ok(!textContent(harness.tree).includes('only-in-A.md'))
  harness.click(harness.button('Select all'))
  await harness.flush()
  await harness.click(harness.button('Generate 1 notes'))
  await harness.flush()
  assert.equal(ingests.length, 1)
  assert.equal(ingests[0].workspacePath, '/B')
  assert.equal(ingests[0].relPath, 'only-in-B.md')
})

test('an old scan failure cannot end or replace the current scan', async (t) => {
  const { harness, scans } = await setupGeneration()
  t.after(() => harness.unmount())
  harness.click(harness.button('Scan documents'))
  await harness.flush()
  workspaceSelect(harness).props.onChange({ target: { value: '/B' } })
  await harness.flush()
  harness.click(harness.button('Scan documents'))
  await harness.flush()
  scans[0].reject(new Error('old A scan error'))
  await harness.flush()
  assert.ok(harness.button('Scanning…'))
  assert.equal(workspaceSelect(harness).props.disabled, true)
  assert.ok(!textContent(harness.tree).includes('old A scan error'))
  scans[1].resolve(scanResult('/B', 'B.md'))
  await harness.flush()
  assert.notEqual(workspaceSelect(harness).props.disabled, true)
})

test('a retained generate handler cannot ingest a scan belonging to the previous workspace', async (t) => {
  const { harness, scans, ingests } = await setupGeneration()
  t.after(() => harness.unmount())
  harness.click(harness.button('Scan documents'))
  scans[0].resolve(scanResult('/A', 'A.md'))
  await harness.flush()
  harness.click(harness.button('Select all'))
  await harness.flush()
  const oldGenerate = harness.button('Generate 1 notes').props.onClick
  workspaceSelect(harness).props.onChange({ target: { value: '/B' } })
  await harness.flush()
  await oldGenerate()
  await harness.flush()
  assert.equal(ingests.length, 0)
  assert.ok(textContent(harness.tree).includes('Scan again before generating.'))
})

test('all tabs share one initial state request and one refresh per batch', async (t) => {
  const { harness, scans, ingests } = await setupGeneration()
  t.after(() => harness.unmount())
  assert.equal(harness.calls.filter(({ method }) => method === 'state').length, 1)
  harness.emitLocaleChange()
  await harness.flush()
  assert.equal(harness.calls.filter(({ method }) => method === 'state').length, 1, 'locale does not reload data')
  harness.click(harness.button('Scan documents'))
  scans[0].resolve(scanResult('/A', 'first.md', 'second.md'))
  await harness.flush()
  harness.click(harness.button('Select all'))
  await harness.flush()
  const languageField = () => harness.nodes((node) => node.type === 'label'
    && textContent(node.children[0]) === 'Language')[0].children[1]
  languageField().props.onChange({ target: { value: 'zh' } })
  await harness.flush()
  await harness.click(harness.button('Generate 2 notes'))
  await harness.flush()
  assert.equal(ingests.length, 2)
  assert.ok(ingests.every((params) => params.language === 'zh'))
  assert.equal(languageField().props.value, 'zh', 'refresh preserves the batch language choice')
  assert.equal(harness.calls.filter(({ method }) => method === 'state').length, 2)
})

test('changing the default language shows a translated saved message', async (t) => {
  const harness = mountClient({ state, rpc: (method) => {
    assert.equal(method, 'setSetting')
    return { outputLanguage: 'zh' }
  } })
  t.after(() => harness.unmount())
  await harness.flush()
  harness.click(harness.button('Access & Settings'))
  await harness.flush()
  // The settings select follows a dt; generation language is inside a label.
  const settingsLanguage = harness.nodes((node) => node.type === 'dd'
    && Array.isArray(node.children) && node.children.some((child) => child?.type === 'select'))[0].children[0]
  await settingsLanguage.props.onChange({ target: { value: 'zh' } })
  await harness.flush()
  assert.ok(textContent(harness.tree).includes('Settings saved'))
  assert.ok(!textContent(harness.tree).includes('settingSaved'))
})

async function setupSearch() {
  const searches = []
  const harness = mountClient({
    state: {
      ...state,
      collections: [...state.collections, { id: 'other', name: 'Other', scope: 'user', entryCount: 0 }],
    },
    rpc(method, params, signal) {
      assert.equal(method, 'search')
      const request = deferred()
      searches.push({ ...request, params, signal })
      return request.promise
    },
  })
  await harness.flush()
  return { harness, searches }
}

async function searchFor(harness, query) {
  harness.nodes((node) => node.type === 'input' && node.props.type === 'search')[0]
    .props.onChange({ target: { value: query } })
  await harness.flush()
}

test('nonempty UI searches use the host search after a 200 ms debounce', async (t) => {
  const { harness, searches } = await setupSearch()
  t.after(() => harness.unmount())
  assert.ok(harness.entry('Note A'))
  assert.equal(searches.length, 0, 'empty query uses the complete local list')
  await searchFor(harness, 'first phrase')
  harness.advanceTime(100)
  await searchFor(harness, '正文才有的知识')
  harness.advanceTime(199)
  await harness.flush()
  assert.equal(searches.length, 0)
  harness.advanceTime(1)
  await harness.flush()
  assert.equal(searches.length, 1)
  assert.equal(searches[0].params.query, '正文才有的知识')
  searches[0].resolve({
    total: 47,
    results: Array.from({ length: 30 }, (_, index) => ({
      ...entry(`match-${index}`), updatedAt: '2026-10-25T00:00:00.000Z',
      summary: 'Generic summary', snippet: `Body-only match excerpt ${index}`,
    })),
  })
  await harness.flush()
  assert.equal(harness.nodes((node) => node.type === 'button' && node.props.className === 'kc-entry').length, 30)
  assert.ok(textContent(harness.tree).includes('47 matches, showing 30.'))
  assert.ok(textContent(harness.tree).includes('Body-only match excerpt 0'))
  assert.ok(!textContent(harness.tree).includes('Generic summary'))
})

test('collection changes cancel old searches and pass the selected collection to the host', async (t) => {
  const { harness, searches } = await setupSearch()
  t.after(() => harness.unmount())
  await searchFor(harness, 'release')
  harness.advanceTime(200)
  await harness.flush()
  harness.nodes((node) => node.type === 'select' && node.props['aria-label'] === 'Knowledge base')[0]
    .props.onChange({ target: { value: 'other' } })
  await harness.flush()
  assert.equal(searches[0].signal.aborted, true)
  harness.advanceTime(200)
  await harness.flush()
  assert.equal(searches[1].params.collectionId, 'other')
  searches[1].resolve({ total: 1, results: [{ ...entry('Other'), collectionId: 'other', snippet: 'Current result' }] })
  await harness.flush()
  searches[0].resolve({ total: 1, results: [{ ...entry('Old'), snippet: 'Stale result' }] })
  await harness.flush()
  assert.ok(textContent(harness.tree).includes('Current result'))
  assert.ok(!textContent(harness.tree).includes('Stale result'))
})

test('old search failures do not replace a newer result and clearing restores the local list', async (t) => {
  const { harness, searches } = await setupSearch()
  t.after(() => harness.unmount())
  await searchFor(harness, 'old')
  harness.advanceTime(200)
  await harness.flush()
  await searchFor(harness, 'new')
  harness.advanceTime(200)
  await harness.flush()
  searches[1].resolve({ total: 1, results: [{ ...entry('Newest'), snippet: 'Current snippet' }] })
  await harness.flush()
  searches[0].reject(new Error('stale search failure'))
  await harness.flush()
  assert.ok(textContent(harness.tree).includes('Current snippet'))
  assert.ok(!textContent(harness.tree).includes('stale search failure'))
  await searchFor(harness, '   ')
  harness.advanceTime(200)
  await harness.flush()
  assert.equal(searches[1].signal.aborted, true)
  assert.equal(searches.length, 2)
  assert.ok(harness.entry('Note A'))
  assert.ok(harness.entry('Note B'))
  assert.ok(!textContent(harness.tree).includes('Current snippet'))
})

test('index recovery is announced and links directly to workspace reauthorization', async () => {
  for (const storageRecovery of [
    { recoveredAt: Date.now(), source: 'backup', reason: 'invalid JSON', permissionsReset: true },
    'index restored from a backup',
  ]) {
    const harness = mountClient({ state: { ...state, storageRecovery }, rpc() { throw new Error('unexpected RPC') } })
    try {
      await harness.flush()
      const alert = harness.nodes((node) => node.props.role === 'alert'
        && textContent(node).includes('restored from a backup'))[0]
      assert.ok(alert)
      assert.ok(textContent(alert).includes('Model access has been disabled for all workspaces.'))
      assert.ok(textContent(alert).includes('library contents may have reverted'))
      const card = harness.nodes((node) => node.props.className === 'kc-card'
        && textContent(node).includes('restored from a backup'))[0]
      const reauthorize = card.children.find((node) => node?.type === 'div'
        && node.children.some((child) => child?.type === 'button')).children[0]
      harness.click(reauthorize)
      await harness.flush()
      const selected = harness.nodes((node) => node.props.role === 'tab' && node.props['aria-selected'])[0]
      assert.equal(textContent(selected), 'Access & Settings')
    } finally {
      harness.unmount()
    }
  }
})

test('tabs connect to their panels and support arrow, Home and End navigation', async (t) => {
  const { harness } = await setup()
  t.after(() => harness.unmount())
  const tabs = () => harness.nodes((node) => node.props.role === 'tab')
  const selected = () => tabs().find((node) => node.props['aria-selected'])
  for (const tab of tabs()) {
    const panel = harness.nodes((node) => node.props.id === tab.props['aria-controls'])[0]
    assert.equal(panel.props.role, 'tabpanel')
    assert.equal(panel.props['aria-labelledby'], tab.props.id)
    assert.equal(panel.props.hidden, !tab.props['aria-selected'])
    assert.equal(tab.props.tabIndex, tab.props['aria-selected'] ? 0 : -1)
  }
  for (const [key, expected] of [
    ['ArrowRight', 'Generate'], ['End', 'Access & Settings'],
    ['Home', 'Knowledge Base'], ['ArrowLeft', 'Access & Settings'],
  ]) {
    let prevented = false
    let focused = false
    let selector
    selected().props.onKeyDown({
      key,
      preventDefault() { prevented = true },
      currentTarget: { parentElement: { querySelector(value) {
        selector = value
        return { focus() { focused = true } }
      } } },
    })
    await harness.flush()
    assert.equal(textContent(selected()), expected)
    assert.equal(selector, `#${selected().props.id}`)
    assert.equal(prevented, true)
    assert.equal(focused, true)
  }
})
