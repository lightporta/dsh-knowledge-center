/**
 * Knowledge Center (知识中心) — Host half.
 *
 * Turns workspace documents into curated Markdown knowledge notes, keeps them
 * in a user-level library under `$DSH_HOME`, exposes the library to permitted
 * workspaces through agent tools, and serves the Settings UI over a
 * package-private Runtime RPC route (`/knowledge-center/<method>`).
 *
 * The client half lives in `client.js` and is declared through `dsh.client`.
 *
 * Storage layout (under `$DSH_HOME/knowledge-center/`):
 *   index.json            library metadata, collections, entries, permissions
 *   entries/<id>.md       one knowledge note, YAML front matter + Markdown body
 */
import { promises as fsp } from 'node:fs'
import { join, basename, dirname, extname } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  canonicalPath,
  comparisonKey,
  isSameOrInside,
  normalizeSourcePath,
  resolveDshHome,
  sourceKey,
  workspaceSourcePath,
} from './lib/paths.js'
import { chunkText } from './lib/text.js'
import { withFileLock } from './lib/lock.js'
import {
  DOCUMENT_EXTENSIONS,
  LEGACY_OFFICE_EXTENSIONS,
  PDF_EXTENSIONS,
  TEXT_EXTENSIONS,
  extractHtmlText,
  extractPdfText,
  extractStructuredDocumentText,
} from './lib/extract.js'

export const name = 'knowledge-center'
export const inject = [
  'tools',
  'connection',
  'webServer',
  'fs',
  'workspaceRegistry',
  'workingDirectory',
  'agents',
  'systemPrompt',
]

/** Package-private Runtime RPC route prefix (browser half calls it via context.connection.rpc.call). */
const CHANNEL = '/knowledge-center'
const INDEX_VERSION = 3
const DEFAULT_COLLECTION_ID = 'shared'
const DEFAULT_COLLECTION_NAME = '全局知识库'
/** Text-like and binary limits; extracted text is later bounded by the 72k distillation budget. */
const MAX_TEXT_BYTES = 10 * 1024 * 1024
const MAX_BINARY_BYTES = 25 * 1024 * 1024
const IGNORED_DIRS = new Set([
  '.git', '.hg', '.svn', 'node_modules', 'dist', 'build', 'out', '.next', '.nuxt',
  'coverage', '.cache', '.dsh', '.qoder', '.idea', '.vscode', '__pycache__',
  '.venv', 'venv', 'target', '.turbo', 'tmp', '.tmp',
])
const MAX_SCAN_DEPTH = 6
const MAX_SCAN_FILES = 400
const MAX_CHUNK_CHARS = 12_000
const MAX_CHUNKS = 16
const KNOWLEDGE_TIMEOUT_MS = 300_000
// One structured note plus the reasoning tokens a model spends inside the same
// max_tokens budget. A top-effort model can still exhaust one budget, so a
// truncated call is retried with more room and only then with a bounded effort.
const KNOWLEDGE_MAX_TOKENS = 32_000
const KNOWLEDGE_RETRY_TOKENS = 64_000
const TOOL_LIMIT_DEFAULT = 8

// ────────────────────────────────────────────────────────────────────────────
// Small utilities
// ────────────────────────────────────────────────────────────────────────────

function isoTime(value) {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? new Date(number).toISOString() : ''
}

function asString(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Parameter \`${field}\` must be a non-empty string.`)
  }
  return value
}

function asOptionalString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function asRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function deriveTitle(text, relPath) {
  const heading = /^#\s+(.+)$/m.exec(text)
  if (heading !== null) return heading[1].trim().slice(0, 160)
  const stem = basename(relPath, extname(relPath)).replace(/[-_]+/g, ' ').trim()
  return (stem.length > 0 ? stem : relPath).slice(0, 160)
}

/** Drop a leading YAML front-matter block so the model distills content only. */
function stripFrontmatter(text) {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(text)
  return match === null ? text : text.slice(match[0].length)
}

function countOccurrences(haystack, needle) {
  if (needle.length === 0) return 0
  let count = 0
  let index = haystack.indexOf(needle)
  while (index !== -1) {
    count++
    if (count >= 50) break
    index = haystack.indexOf(needle, index + needle.length)
  }
  return count
}

function plainText(markdown) {
  return String(markdown)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/[#>*_~\-\[\]()!|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function deriveSummary(markdown) {
  const quote = /^>\s*(.+)$/m.exec(markdown)
  if (quote !== null) return plainText(quote[1]).slice(0, 280)
  const lines = markdown.split(/\r?\n/)
  const paragraph = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.length === 0) {
      if (paragraph.length > 0) break
      continue
    }
    if (/^#{1,6}\s/.test(trimmed) || /^([-*+]|\d+[.)])\s/.test(trimmed) || trimmed.startsWith('```')) {
      if (paragraph.length > 0) break
      continue
    }
    paragraph.push(trimmed)
    if (paragraph.length >= 3) break
  }
  return plainText(paragraph.join(' ')).slice(0, 280)
}

function makeSnippet(body, tokens) {
  const lower = body.toLowerCase()
  let index = -1
  for (const token of tokens) {
    if (token.length === 0) continue
    index = lower.indexOf(token)
    if (index !== -1) break
  }
  if (index === -1) return plainText(body).slice(0, 220)
  const start = Math.max(0, index - 80)
  return plainText(body.slice(start, start + 260))
}

function searchTokens(query) {
  const tokens = new Set(query.split(/\s+/).filter(Boolean))
  if (/\p{Script=Han}/u.test(query)) {
    const segmenter = new Intl.Segmenter('zh', { granularity: 'word' })
    for (const { segment, isWordLike } of segmenter.segment(query)) {
      if (isWordLike && segment.length > 1) tokens.add(segment)
    }
  }
  return [...tokens]
}

// ────────────────────────────────────────────────────────────────────────────
// Front matter (flat YAML subset, JSON-compatible scalars/arrays)
// ────────────────────────────────────────────────────────────────────────────

function parseFrontmatter(markdown) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown)
  if (match === null) return { data: {}, body: markdown }
  const data = {}
  for (const line of match[1].split(/\r?\n/)) {
    const entry = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line)
    if (entry === null) continue
    const key = entry[1]
    let raw = entry[2].trim()
    if (raw.length === 0) {
      data[key] = ''
      continue
    }
    if (raw.startsWith('[') || raw.startsWith('{') || raw.startsWith('"') || raw.startsWith('null') || raw === 'true' || raw === 'false' || /^-?\d+(\.\d+)?$/.test(raw)) {
      try {
        data[key] = JSON.parse(raw)
        continue
      } catch {
        // fall through to plain string
      }
    }
    data[key] = raw
  }
  return { data, body: markdown.slice(match[0].length) }
}

function serializeFrontmatter(data) {
  const lines = ['---']
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue
    lines.push(`${key}: ${JSON.stringify(value)}`)
  }
  lines.push('---')
  return lines.join('\n')
}

// ────────────────────────────────────────────────────────────────────────────
// Library store
// ────────────────────────────────────────────────────────────────────────────

function createEmptyIndex() {
  return {
    version: INDEX_VERSION,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    collections: [],
    entries: [],
    permissions: {},
    settings: { outputLanguage: 'zh' },
  }
}

/** An index written by a newer plugin must never be silently rewritten by this build. */
function indexTooNew(version) {
  const error = new Error(
    `Knowledge index version ${version} was written by a newer Knowledge Center build (this build supports ${INDEX_VERSION}). `
    + 'Upgrade the plugin before using this profile, or restore an index backup; writes are refused to protect your data.',
  )
  error.code = 'KNOWLEDGE_INDEX_TOO_NEW'
  return error
}

function ensureShape(index) {
  const safe = index !== null && typeof index === 'object' ? index : createEmptyIndex()
  if (!Array.isArray(safe.collections)) safe.collections = []
  if (!Array.isArray(safe.entries)) safe.entries = []
  if (safe.permissions === null || typeof safe.permissions !== 'object' || Array.isArray(safe.permissions)) safe.permissions = {}
  if (!Array.isArray(safe.shares)) safe.shares = []
  if (safe.settings === null || typeof safe.settings !== 'object' || Array.isArray(safe.settings)) safe.settings = { outputLanguage: 'zh' }
  if (typeof safe.settings.outputLanguage !== 'string') safe.settings.outputLanguage = 'zh'
  const hasUserCollection = safe.collections.some((collection) => collection.scope === 'user')
  if (!hasUserCollection) {
    safe.collections.unshift({
      id: DEFAULT_COLLECTION_ID,
      name: DEFAULT_COLLECTION_NAME,
      scope: 'user',
      workspacePath: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
  }
  return safe
}

class KnowledgeStore {
  constructor() {
    this.root = join(resolveDshHome(), 'knowledge-center')
    this.entriesDir = join(this.root, 'entries')
    this.indexPath = join(this.root, 'index.json')
    this.backupPath = join(this.root, 'index.json.bak')
    this.lockPath = join(this.root, 'index.lock')
    this.queue = Promise.resolve()
    this.ready = this.#initialize()
  }

  #initialize() {
    return (async () => {
      await fsp.mkdir(this.entriesDir, { recursive: true })
      await withFileLock(this.lockPath, () => this.#readIndex())
    })()
  }

  /** Only missing files and invalid JSON/schema are recoverable read results. */
  async #readCandidate(path) {
    let raw
    try {
      raw = await fsp.readFile(path, 'utf8')
    } catch (error) {
      if (error.code === 'ENOENT') return { kind: 'missing' }
      // Permission, directory and other I/O failures must not change any data.
      throw error
    }
    try {
      const parsed = JSON.parse(raw)
      const records = (value) => Array.isArray(value) && value.every((record) => record !== null && typeof record === 'object' && !Array.isArray(record))
      if (parsed === null || typeof parsed !== 'object' || !records(parsed.collections) || !records(parsed.entries)) {
        return { kind: 'invalid' }
      }
      return { kind: 'valid', raw, index: ensureShape(parsed) }
    } catch (error) {
      if (error instanceof SyntaxError) return { kind: 'invalid' }
      throw error
    }
  }

  /** In-memory upgrade; persisting the result is the caller's job. */
  #upgradeIndex(index) {
    if (index.version === undefined) index.version = 1
    if (index.version > INDEX_VERSION) throw indexTooNew(index.version)
    if (index.version < INDEX_VERSION) {
      index.migration = { ...(index.migration ?? {}), from: index.version, to: INDEX_VERSION, at: Date.now() }
      index.version = INDEX_VERSION
    }
    return index
  }

  /** Upgrade a valid primary index, keeping a one-off copy and a receipt. */
  async #migrate(index) {
    const from = index.version ?? 1
    if (from > INDEX_VERSION) throw indexTooNew(from)
    if (from === INDEX_VERSION) return index
    const at = Date.now()
    const copy = `index.v${from}-${at}.json`
    await fsp.copyFile(this.indexPath, join(this.root, copy))
    const upgraded = this.#upgradeIndex(index)
    await this.#writeAtomic(this.indexPath, `${JSON.stringify(upgraded, null, 2)}\n`)
    const receipt = { from, to: INDEX_VERSION, at, collections: upgraded.collections.length, entries: upgraded.entries.length, backup: copy }
    await this.#writeAtomic(join(this.root, `migration-${at}.json`), `${JSON.stringify(receipt, null, 2)}\n`)
    return upgraded
  }

  async #readIndex() {
    const primary = await this.#readCandidate(this.indexPath)
    if (primary.kind === 'valid') return await this.#migrate(primary.index)
    const backup = await this.#readCandidate(this.backupPath)
    if (backup.kind === 'valid') {
      const recovered = this.#upgradeIndex(backup.index)
      // An older backup may predate a permission revocation. Never restore its
      // grants; preserving notes does not authorize the model to access them.
      recovered.permissions = {}
      recovered.recovery = {
        recoveredAt: Date.now(),
        source: 'backup',
        reason: primary.kind === 'missing' ? 'missing-primary' : 'invalid-primary',
        permissionsReset: true,
      }
      if (primary.kind === 'invalid') {
        const corrupt = `${this.indexPath}.corrupt-${Date.now()}-${randomUUID()}`
        await fsp.rename(this.indexPath, corrupt)
        recovered.recovery.corruptFile = basename(corrupt)
      }
      recovered.updatedAt = Date.now()
      // Restore directly: rotating the damaged primary into the backup here
      // would destroy the only verified good copy.
      await this.#writeAtomic(this.indexPath, `${JSON.stringify(recovered, null, 2)}\n`)
      return recovered
    }
    const notes = await fsp.readdir(this.entriesDir)
    const files = await fsp.readdir(this.root)
    const newStorage = notes.length === 0 && files.every((file) => file === 'entries' || file === 'index.lock' || file.startsWith('index.lock.candidate-'))
    if (primary.kind === 'missing' && backup.kind === 'missing' && newStorage) {
      const fresh = ensureShape(createEmptyIndex())
      await this.#writeAtomic(this.indexPath, `${JSON.stringify(fresh, null, 2)}\n`)
      return fresh
    }
    const error = new Error(`Knowledge index cannot be recovered (${primary.kind} primary, ${backup.kind} backup). Existing index and knowledge files were preserved in ${this.root}. Restore a valid index backup before retrying; if initialization failed, restart Harness after repair.`)
    error.code = 'KNOWLEDGE_INDEX_UNRECOVERABLE'
    throw error
  }

  async #writeAtomic(path, raw) {
    const temporary = `${path}.tmp-${randomUUID()}`
    try {
      await fsp.writeFile(temporary, raw, 'utf8')
      await fsp.rename(temporary, path)
    } finally {
      await fsp.rm(temporary, { force: true })
    }
  }

  async #writeIndex(index) {
    const previous = await this.#readCandidate(this.indexPath)
    if (previous.kind !== 'valid') throw new Error('Knowledge index changed before commit; no index files were replaced.')
    // Preserve the exact verified previous version before publishing an update.
    await this.#writeAtomic(this.backupPath, previous.raw)
    index.updatedAt = Date.now()
    await this.#writeAtomic(this.indexPath, `${JSON.stringify(index, null, 2)}\n`)
  }

  async readIndex() {
    await this.ready
    return withFileLock(this.lockPath, () => this.#readIndex())
  }

  async mutate(operation) {
    await this.ready
    const run = this.queue.then(() => withFileLock(this.lockPath, async () => {
      const index = await this.#readIndex()
      const result = await operation(index)
      await this.#writeIndex(index)
      return result
    }))
    this.queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  entryPath(id) {
    return join(this.entriesDir, `${id}.md`)
  }

  async readEntryFile(id) {
    return fsp.readFile(this.entryPath(id), 'utf8')
  }

  async writeEntryFile(id, content) {
    const target = this.entryPath(id)
    const temporary = `${target}.tmp-${randomUUID()}`
    await fsp.writeFile(temporary, content, 'utf8')
    await fsp.rename(temporary, target)
  }

  async removeEntryFile(id) {
    try {
      await fsp.unlink(this.entryPath(id))
    } catch (error) {
      if (error === null || typeof error !== 'object' || error.code !== 'ENOENT') throw error
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Prompting + model access
// ────────────────────────────────────────────────────────────────────────────

function pickModel(ctx) {
  const service = ctx.get('agentDefaultModel')
  if (service !== undefined && service !== null && typeof service.currentSelection === 'function') {
    try {
      const selection = service.currentSelection()
      if (selection !== undefined && typeof selection.provider === 'string' && typeof selection.model === 'string') {
        return {
          provider: selection.provider,
          model: selection.model,
          ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }),
        }
      }
    } catch {
      // fall through
    }
  }
  return undefined
}

function modelLabel(ctx) {
  const selection = pickModel(ctx)
  if (selection === undefined) return 'unavailable'
  return `${selection.provider}/${selection.model}`
}

async function completeOnce(llm, { selection, system, prompt, maxTokens, signal }) {
  const timeout = AbortSignal.timeout(KNOWLEDGE_TIMEOUT_MS)
  const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
  const call = await llm.prepareCall({ ...selection, maxTokens }, combined)
  const options = {
    ...call.config,
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    system,
    signal: combined,
  }
  let text = ''
  let failure
  let finishReason
  for await (const chunk of call.stream(options)) {
    if (chunk.type === 'text-delta') text += chunk.text
    else if (chunk.type === 'finish') {
      finishReason = chunk.reason.kind
      if (finishReason === 'error' || finishReason === 'aborted') failure = chunk.reason.failure
    }
  }
  combined.throwIfAborted()
  if (failure !== undefined) throw new Error(`Model call failed: ${failure.message}`)
  if (finishReason !== 'stop') {
    const error = new Error(`Model did not complete the knowledge note (${finishReason ?? 'missing finish reason'}). Existing knowledge was not replaced.`)
    // Only a token limit is worth retrying; a broken or missing finish reason is
    // reported at once.
    error.code = finishReason === 'max-tokens' ? 'KNOWLEDGE_TRUNCATED' : 'KNOWLEDGE_INCOMPLETE'
    throw error
  }
  if (text.trim().length === 0) throw new Error('The model returned an empty distillation result.')
  return { text, effort: selection.reasoningEffort ?? 'default', maxTokens, finishReason }
}

/**
 * Distillation shares one max_tokens budget between the reasoning tokens and
 * the note itself. A model configured with the top reasoning effort can spend
 * the whole budget before the note is finished, so a truncated attempt is
 * retried with a larger budget; only if that also truncates does the call fall
 * back to a bounded effort. The agent itself keeps the configured effort.
 */
async function generateText(ctx, { system, prompt, signal, selection = pickModel(ctx) }) {
  const llm = ctx.get('llm')
  if (llm === undefined || llm === null) {
    throw new Error('Knowledge Center needs the LLM service to distill documents, but it is unavailable in this profile.')
  }
  if (selection === undefined) {
    throw new Error('Knowledge Center needs a default model. Configure one in Settings → Models first.')
  }
  const attempts = [
    { selection, maxTokens: KNOWLEDGE_MAX_TOKENS },
    { selection, maxTokens: KNOWLEDGE_RETRY_TOKENS },
  ]
  if (selection.reasoningEffort === 'max') {
    attempts.push({ selection: { ...selection, reasoningEffort: 'high' }, maxTokens: KNOWLEDGE_MAX_TOKENS })
  }
  let lastError
  for (const [index, attempt] of attempts.entries()) {
    try {
      const result = await completeOnce(llm, { ...attempt, system, prompt, signal })
      return {
        ...result,
        model: selection,
        attempt: {
          index: index + 1,
          attempts: index + 1,
          maxAttempts: attempts.length,
          effort: result.effort,
          maxTokens: result.maxTokens,
          finishReason: result.finishReason,
        },
      }
    } catch (error) {
      if (signal?.aborted) throw error
      // A truncated note is always worth retrying. An error raised by the
      // enlarged attempt (for example a provider that rejects 64000 max tokens)
      // also falls through to the more conservative attempt instead of failing
      // the whole document; an error on the base attempt is reported at once.
      if (error.code !== 'KNOWLEDGE_TRUNCATED' && index === 0) throw error
      lastError = error
    }
  }
  throw lastError
}

function curatorSystem(language) {
  const outputLanguage = language === 'en' ? 'English' : '简体中文'
  return [
    'You are a meticulous knowledge-base curator.',
    'Convert source documents into a single self-contained, reusable Markdown knowledge note.',
    `Write the note in ${outputLanguage}. Respond with Markdown only; never wrap the whole answer in a code fence.`,
    'Preserve concrete facts: commands, APIs, file paths, versions, numbers, names, conventions and edge cases.',
    'Do not invent information that is absent from the source. If the source is partial, say so briefly in the note.',
  ].join(' ')
}

function directPrompt({ language, title, relPath, content }) {
  const outputLanguage = language === 'en' ? 'English' : '简体中文'
  const structure = language === 'en'
    ? ['## Key points', '## Details', '## When to use it', '## Sources']
    : ['## 核心要点', '## 详细内容', '## 适用场景', '## 来源']
  return [
    `Distill the workspace document below into one knowledge note in ${outputLanguage}.`,
    '',
    `Document relative path: ${relPath}`,
    `Suggested title: ${title}`,
    '',
    'Required structure:',
    `# <title>`,
    `> <one-sentence summary>`,
    '',
    structure[0],
    '- ...',
    structure[1],
    '<organized subsections>',
    structure[2],
    '- ...',
    structure[3],
    `- \`${relPath}\``,
    '',
    'Source document (between <<< and >>>):',
    '<<<',
    content,
    '>>>',
  ].join('\n')
}

function extractPrompt({ language, relPath, index, total, content }) {
  const outputLanguage = language === 'en' ? 'English' : '简体中文'
  return [
    `Extract dense factual notes in ${outputLanguage} from part ${index} of ${total} of a workspace document.`,
    'Output Markdown bullet points only. Keep commands, APIs, paths, versions, numbers, constraints and terminology verbatim.',
    'Do not add commentary about the task itself.',
    '',
    `Document relative path: ${relPath}`,
    '<<<',
    content,
    '>>>',
  ].join('\n')
}

function mergePrompt({ language, title, relPath, notes }) {
  const outputLanguage = language === 'en' ? 'English' : '简体中文'
  const structure = language === 'en'
    ? ['## Key points', '## Details', '## When to use it', '## Sources']
    : ['## 核心要点', '## 详细内容', '## 适用场景', '## 来源']
  return [
    `Merge the section notes below into one coherent knowledge note in ${outputLanguage}.`,
    `Title: ${title}`,
    `Source relative path: ${relPath}`,
    '',
    'Required structure:',
    '# <title>',
    '> <one-sentence summary>',
    '',
    structure[0],
    '- ...',
    structure[1],
    '<organized subsections>',
    structure[2],
    '- ...',
    structure[3],
    `- \`${relPath}\``,
    '',
    'Section notes:',
    '<<<',
    notes.join('\n\n---\n\n'),
    '>>>',
  ].join('\n')
}

function normalizeKnowledgeMarkdown(raw, fallbackTitle, relPath, language) {
  let markdown = String(raw).trim()
  const fenced = /^```[A-Za-z]*\r?\n([\s\S]*?)\r?\n```$/.exec(markdown)
  if (fenced !== null) markdown = fenced[1].trim()
  if (!/^#\s+/.test(markdown)) markdown = `# ${fallbackTitle}\n\n${markdown}`
  const titleMatch = /^#\s+(.+)$/m.exec(markdown)
  const title = (titleMatch === null ? fallbackTitle : titleMatch[1]).trim().slice(0, 160)
  const sourcesHeading = language === 'en' ? '## Sources' : '## 来源'
  if (!/^##\s*(来源|Sources)/m.test(markdown)) {
    markdown = `${markdown}\n\n${sourcesHeading}\n\n- \`${relPath}\``
  }
  return { title, markdown: `${markdown.trim()}\n` }
}

async function distillDocument(ctx, { text, relPath, language, signal }) {
  const selection = pickModel(ctx)
  const cleaned = stripFrontmatter(text)
  const title = deriveTitle(cleaned, relPath)
  const { chunks, truncated } = chunkText(cleaned, MAX_CHUNK_CHARS, MAX_CHUNKS)
  let result
  if (chunks.length === 1) {
    result = await generateText(ctx, {
      system: curatorSystem(language),
      prompt: directPrompt({ language, title, relPath, content: chunks[0] }),
      signal,
      selection,
    })
  } else {
    const notes = []
    for (let index = 0; index < chunks.length; index++) {
      const extraction = await generateText(ctx, {
        system: curatorSystem(language),
        prompt: extractPrompt({ language, relPath, index: index + 1, total: chunks.length, content: chunks[index] }),
        signal,
        selection,
      })
      notes.push(extraction.text.trim())
      result = extraction
    }
    result = await generateText(ctx, {
      system: curatorSystem(language),
      prompt: mergePrompt({ language, title, relPath, notes }),
      signal,
      selection,
    })
  }
  const normalized = normalizeKnowledgeMarkdown(result.text, title, relPath, language)
  return {
    title: normalized.title,
    markdown: normalized.markdown,
    summary: deriveSummary(normalized.markdown),
    model: result.model,
    truncated,
    sourceChars: cleaned.length,
    distill: result.attempt,
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Workspace access through the composed filesystem
// ────────────────────────────────────────────────────────────────────────────

function findWorkspace(ctx, pathOrId) {
  const registry = ctx.workspaceRegistry
  const workspaces = registry.list()
  const targetKey = comparisonKey(pathOrId)
  return workspaces.find(
    (workspace) => comparisonKey(workspace.path) === targetKey || String(workspace.id) === String(pathOrId),
  )
}

/** Resolve subdirectory sessions to their most specific registered workspace. */
function findSessionWorkspace(ctx, cwd) {
  return ctx.workspaceRegistry.list()
    .filter((workspace) => isSameOrInside(workspace.path, cwd))
    .sort((left, right) => canonicalPath(right.path).length - canonicalPath(left.path).length)[0]
}

async function requireWorkspace(ctx, pathOrId) {
  const workspace = findWorkspace(ctx, pathOrId)
  if (workspace === undefined) {
    throw new Error(`Unknown workspace: ${pathOrId}. Open or create the workspace in the sidebar first.`)
  }
  return workspace
}

async function scanWorkspaceDocuments(ctx, workspacePath) {
  const root = await ctx.fs.resolve(workspacePath)
  const info = await ctx.fs.stat(root)
  if (info === undefined || info.type !== 'directory') {
    throw new Error(`Workspace directory is unavailable: ${workspacePath}`)
  }
  const files = []
  const walk = async (directory, relativeDir, depth) => {
    if (files.length >= MAX_SCAN_FILES || depth > MAX_SCAN_DEPTH) return
    const entries = await ctx.fs.listDir(directory)
    for (const entry of entries) {
      if (files.length >= MAX_SCAN_FILES) return
      const relativePath = relativeDir.length === 0 ? entry.name : `${relativeDir}/${entry.name}`
      if (entry.type === 'directory') {
        if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
        await walk(entry.target, relativePath, depth + 1)
        continue
      }
      if (entry.type !== 'file') continue
      if (entry.name.startsWith('.')) continue
      const extension = extname(entry.name).toLowerCase()
      if (!DOCUMENT_EXTENSIONS.has(extension)) continue
      const size = typeof entry.size === 'number' ? entry.size : 0
      const limit = TEXT_EXTENSIONS.has(extension) ? MAX_TEXT_BYTES : MAX_BINARY_BYTES
      if (size > limit) continue
      files.push({ path: relativePath, name: entry.name, bytes: size, format: extension.slice(1) })
    }
  }
  await walk(root, '', 0)
  files.sort((left, right) => left.path.localeCompare(right.path))
  return { workspacePath: canonicalPath(workspacePath), files, truncated: files.length >= MAX_SCAN_FILES }
}

/**
 * Resolve an optional native helper (currently `pdftotext`) through the
 * Harness subprocess environment; an unresolvable helper falls back to the
 * built-in PDF parser. Windows installs that are not on PATH (winget Poppler,
 * Git's mingw tools) are detected by their well-known locations.
 */
function createExecutableResolver(ctx) {
  return async (command) => {
    const override = command === 'pdftotext' ? process.env.PDFTOTEXT_PATH : undefined
    if (typeof override === 'string' && override.length > 0) return override
    const subprocess = ctx.get('subprocess')
    if (subprocess !== undefined && typeof subprocess.resolveExecutable === 'function') {
      const resolved = await subprocess.resolveExecutable(command)
      if (typeof resolved === 'string' && resolved.length > 0) return resolved
    }
    if (command === 'pdftotext') return await findPdfToTextBinary()
    return command
  }
}

/** Search one directory tree for an exact file name, bounded by `depth`. */
async function findNestedFile(directory, name, depth) {
  if (depth < 0) return undefined
  let entries
  try {
    entries = await fsp.readdir(directory, { withFileTypes: true })
  } catch {
    return undefined
  }
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isFile() && entry.name === name) return path
    if (entry.isDirectory()) {
      const nested = await findNestedFile(path, name, depth - 1)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

/** Well-known Windows locations for `pdftotext`, used when it is not on PATH. */
async function findPdfToTextBinary() {
  if (process.platform !== 'win32') return undefined
  const local = process.env.LOCALAPPDATA
  if (typeof local === 'string' && local.length > 0) {
    const packages = join(local, 'Microsoft', 'WinGet', 'Packages')
    let entries = []
    try {
      entries = await fsp.readdir(packages)
    } catch {
      entries = []
    }
    for (const entry of entries.filter((name) => name.startsWith('oschwartz10612.Poppler'))) {
      const found = await findNestedFile(join(packages, entry), 'pdftotext.exe', 6)
      if (found !== undefined) return found
    }
  }
  const gitGuess = 'C:\\Program Files\\Git\\mingw64\\bin\\pdftotext.exe'
  try {
    await fsp.stat(gitGuess)
    return gitGuess
  } catch {
    return undefined
  }
}

/**
 * Read and reduce one workspace document to plain text. Binary formats are
 * extracted by `lib/extract.js`; legacy Office formats are converted to PDF by
 * the Harness LibreOffice service first.
 */
async function readWorkspaceSource(ctx, workspacePath, relativePath, { signal, resolveExecutable, officeToPdf } = {}) {
  const extension = extname(relativePath).toLowerCase()
  if (!DOCUMENT_EXTENSIONS.has(extension)) {
    throw new Error(`Unsupported document type "${extension}": ${relativePath}`)
  }
  const root = await ctx.fs.resolve(workspacePath)
  const target = await ctx.fs.resolve(relativePath, { cwd: workspacePath })
  if (!ctx.fs.contains(root, target)) {
    throw new Error(`\`${relativePath}\` is outside the selected workspace.`)
  }
  const info = await ctx.fs.stat(target)
  if (info === undefined || info.type !== 'file') throw new Error(`Document not found: ${relativePath}`)
  const size = typeof info.size === 'number' ? info.size : 0
  if (TEXT_EXTENSIONS.has(extension)) {
    if (size > MAX_TEXT_BYTES) {
      throw new Error(`Text document is larger than ${Math.round(MAX_TEXT_BYTES / 1024)} KiB: ${relativePath}`)
    }
    const raw = await ctx.fs.readText(target)
    const text = extension === '.html' || extension === '.htm' ? extractHtmlText(raw) : raw
    return { text, bytes: size, format: extension.slice(1) }
  }
  if (size > MAX_BINARY_BYTES) {
    throw new Error(`Document is larger than ${Math.round(MAX_BINARY_BYTES / (1024 * 1024))} MiB: ${relativePath}`)
  }
  const bytes = await ctx.fs.readBytes(target, signal, MAX_BINARY_BYTES)
  if (PDF_EXTENSIONS.has(extension)) {
    const text = await extractPdfText(bytes, { signal, resolveExecutable })
    return { text, bytes: size, format: 'pdf' }
  }
  if (LEGACY_OFFICE_EXTENSIONS.has(extension)) {
    if (officeToPdf === undefined || officeToPdf === null) {
      throw new Error(`Legacy Office format "${extension}" requires the Harness office-to-PDF service (LibreOffice).`)
    }
    const version = String(info.version)
    const conversion = await officeToPdf.convert({
      extension: extension.slice(1),
      priority: 'foreground',
      source: {
        key: `${workspacePath}::${relativePath}`,
        version,
        bytes: size,
        read: async (readSignal, maxBytes) => {
          const current = await ctx.fs.readBytes(target, readSignal, maxBytes)
          return { bytes: current, version }
        },
      },
    }, signal)
    const text = await extractPdfText(conversion.pdf, { signal, resolveExecutable })
    return { text, bytes: size, format: `${extension.slice(1)} via PDF` }
  }
  const text = extractStructuredDocumentText({ extension, bytes })
  return { text, bytes: size, format: extension.slice(1) }
}

// ────────────────────────────────────────────────────────────────────────────
// Library operations shared by RPC and tools
// ────────────────────────────────────────────────────────────────────────────

function collectionName(index, collectionId) {
  return index.collections.find((collection) => collection.id === collectionId)?.name ?? '未知知识库'
}

function accessibleCollectionIds(index, cwd) {
  const ids = new Set()
  const target = comparisonKey(cwd)
  for (const collection of index.collections) {
    if (collection.scope === 'user') ids.add(collection.id)
    else if (collection.scope === 'workspace' && comparisonKey(collection.workspacePath) === target) {
      ids.add(collection.id)
    } else if (collection.scope === 'shared' && Array.isArray(collection.readers) && collection.readers.some((reader) => comparisonKey(reader) === target || isSameOrInside(canonicalPath(reader), cwd))) {
      ids.add(collection.id)
    }
  }
  return ids
}

function allowedWorkspaceEntries(index) {
  return Object.entries(index.permissions ?? {})
    .filter(([, allowed]) => allowed === true)
    .map(([path]) => canonicalPath(path))
}

function isWorkspaceGranted(index, cwd) {
  const target = comparisonKey(cwd)
  return target !== '' && allowedWorkspaceEntries(index).some((allowed) => comparisonKey(allowed) === target)
}

function entryMetadata(index, entry) {
  return {
    id: entry.id,
    title: entry.title,
    collectionId: entry.collectionId,
    collectionName: collectionName(index, entry.collectionId),
    workspacePath: entry.workspacePath ?? null,
    sources: Array.isArray(entry.sources) ? entry.sources : [],
    summary: entry.summary ?? '',
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    language: entry.language ?? 'zh',
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    size: entry.size ?? 0,
    generator: entry.generator ?? '',
    truncated: entry.truncated === true,
    sourceChars: entry.sourceChars ?? 0,
    distillEffort: entry.distill?.effort ?? '',
  }
}

/**
 * Resolve the library an ingest writes into.
 *
 * `actor === 'tool'` is the model-facing path: it may only write the current
 * workspace's own library, so a prompt-injected session cannot publish into the
 * global or another workspace's library. Only the owner UI may target `user`
 * libraries.
 */
async function resolveCollectionForIngest(store, workspace, collectionId, actor = 'owner') {
  if (collectionId !== undefined) {
    const index = await store.readIndex()
    const collection = index.collections.find((candidate) => candidate.id === collectionId)
    if (collection === undefined) throw new Error(`Unknown knowledge base: ${collectionId}`)
    if (actor === 'tool' && collection.scope !== 'workspace') {
      throw new Error(
        `The model tool can only write to the current workspace's knowledge base. `
        + `Ask the user to move this note into "${collection.name}" from Settings → 知识中心 (Knowledge Center).`,
      )
    }
    if (collection.scope === 'workspace' && comparisonKey(collection.workspacePath) !== comparisonKey(workspace.path)) {
      throw new Error(`Knowledge base "${collection.name}" belongs to another workspace.`)
    }
    return collection
  }
  return store.mutate((index) => {
    let collection = index.collections.find(
      (candidate) => candidate.scope === 'workspace' && comparisonKey(candidate.workspacePath) === comparisonKey(workspace.path),
    )
    if (collection !== undefined) return collection
    const now = Date.now()
    collection = {
      id: randomUUID(),
      name: `${workspace.title || basename(workspace.path)} 知识库`,
      scope: 'workspace',
      workspacePath: canonicalPath(workspace.path),
      createdAt: now,
      updatedAt: now,
    }
    index.collections.push(collection)
    return collection
  })
}

/**
 * Distill one workspace document and persist it as a knowledge entry.
 * Re-running the same source updates the existing entry (Repo-Wiki style).
 */
/**
 * Collect file blocks referenced by the current session. The walk is tolerant
 * to the event envelope: any object shaped like a file block is collected once.
 */
function sessionFileAttachments(ctx, agentId) {
  const live = typeof agentId === 'string' ? ctx.agents.get(agentId) : undefined
  const session = live?.session
  if (session === undefined || session === null || typeof session.snapshotEvents !== 'function') return []
  const refs = []
  const seen = new Set()
  const visit = (value, depth) => {
    if (depth > 10 || refs.length >= 32 || value === null || typeof value !== 'object') return
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 200)) visit(item, depth + 1)
      return
    }
    if (value.type === 'file' && typeof value.attachment?.attachmentId === 'string') {
      const ref = value.attachment
      if (!seen.has(ref.attachmentId)) {
        seen.add(ref.attachmentId)
        refs.push(ref)
      }
      return
    }
    for (const key of Object.keys(value)) visit(value[key], depth + 1)
  }
  visit(session.snapshotEvents(), 0)
  return refs
}

/** Content-addressed host path used when the attachment service cannot resolve one. */
function attachmentHostPath(ref, root) {
  const raw = ref.attachmentId.startsWith('sha256:') ? ref.attachmentId.slice(7) : ref.attachmentId
  return join(root, 'v1', 'files', raw.slice(0, 2), raw, ref.name)
}

/**
 * Read one attachment and reduce it to text with the same extractors used for
 * workspace files. The resolved path must stay inside the attachment store.
 */
async function readAttachmentSource(ctx, ref, { signal, resolveExecutable, attachmentsRoot, path } = {}) {
  const service = ctx.get('attachments')
  let hostPath = typeof path === 'string' && path.length > 0 ? path : undefined
  if (hostPath === undefined && service !== undefined && service !== null && typeof service.fileHostPath === 'function') {
    try {
      hostPath = service.fileHostPath(ref)
    } catch {
      hostPath = undefined
    }
  }
  const rootDir = attachmentsRoot ?? join(resolveDshHome(), 'attachments')
  if (typeof hostPath !== 'string' || hostPath.length === 0) hostPath = attachmentHostPath(ref, rootDir)
  const real = await fsp.realpath(hostPath)
  const root = await fsp.realpath(rootDir)
  if (!isSameOrInside(root, real)) throw new Error('Attachment path is outside the attachment store.')
  const extension = extname(real).toLowerCase()
  if (!DOCUMENT_EXTENSIONS.has(extension)) throw new Error(`Unsupported attachment type "${extension}": ${ref.name}`)
  const info = await fsp.stat(real)
  const limit = TEXT_EXTENSIONS.has(extension) ? MAX_TEXT_BYTES : MAX_BINARY_BYTES
  if (info.size > limit) throw new Error(`Attachment is larger than ${Math.round(limit / (1024 * 1024))} MiB: ${ref.name}`)
  const bytes = await fsp.readFile(real)
  if (TEXT_EXTENSIONS.has(extension)) {
    const raw = bytes.toString('utf8')
    return { text: extension === '.html' || extension === '.htm' ? extractHtmlText(raw) : raw }
  }
  if (PDF_EXTENSIONS.has(extension)) return { text: await extractPdfText(bytes, { signal, resolveExecutable }) }
  if (LEGACY_OFFICE_EXTENSIONS.has(extension)) {
    throw new Error(`Legacy Office attachments need the office-to-PDF service: ${ref.name}`)
  }
  return { text: extractStructuredDocumentText({ extension, bytes }) }
}

async function ingestDocument(ctx, store, { workspace, collection, relativePath, language, signal, text: preExtracted }) {
  const sourcePath = workspaceSourcePath(workspace.path, relativePath)
  if (sourcePath.length === 0) throw new Error('Source path must point to a workspace document.')
  const source = preExtracted === undefined
    ? await readWorkspaceSource(ctx, workspace.path, sourcePath, {
      signal,
      resolveExecutable: createExecutableResolver(ctx),
      officeToPdf: ctx.get('officeToPdf'),
    })
    : { text: preExtracted }
  const distilled = await distillDocument(ctx, {
    text: source.text,
    relPath: sourcePath,
    language,
    signal,
  })
  const generator = distilled.model === undefined ? '' : `${distilled.model.provider}/${distilled.model.model}`
  return store.mutate(async (index) => {
    signal?.throwIfAborted()
    const target = index.collections.find((candidate) => candidate.id === collection.id)
    if (target === undefined) throw new Error('The target knowledge base was deleted during generation.')
    if (target.scope === 'workspace' && comparisonKey(target.workspacePath) !== comparisonKey(workspace.path)) {
      throw new Error('The target knowledge base is no longer available in this workspace.')
    }
    const now = Date.now()
    const workspacePath = canonicalPath(workspace.path)
    const existing = index.entries.find(
      (entry) =>
        entry.collectionId === collection.id
        && comparisonKey(entry.workspacePath ?? '') === comparisonKey(workspacePath)
        && Array.isArray(entry.sources)
        && entry.sources.length === 1
        && sourceKey(entry.sources[0]) === sourceKey(sourcePath),
    )
    const id = existing === undefined ? randomUUID() : existing.id
    const createdAt = existing === undefined ? now : existing.createdAt
    const summary = distilled.summary.length > 0 ? distilled.summary : deriveSummary(distilled.markdown)
    const record = {
      id,
      title: distilled.title,
      collectionId: collection.id,
      workspacePath,
      sources: [sourcePath],
      tags: [],
      summary,
      language,
      createdAt,
      updatedAt: now,
      generator,
      truncated: distilled.truncated === true,
      sourceChars: distilled.sourceChars ?? 0,
      distill: distilled.distill,
    }
    // The shareable Markdown note deliberately omits the machine-absolute
    // workspace path; provenance stays in the local index.json only.
    const frontmatter = {
      id,
      title: record.title,
      collectionId: collection.id,
      collection: collection.name,
      sources: record.sources,
      tags: [],
      summary,
      language,
      createdAt,
      updatedAt: now,
      generator,
      ...(distilled.truncated ? { truncated: true } : {}),
      ...(distilled.sourceChars === undefined ? {} : { sourceChars: distilled.sourceChars }),
      ...(distilled.distill?.effort === undefined ? {} : { distillEffort: distilled.distill.effort }),
    }
    const fileContent = `${serializeFrontmatter(frontmatter)}\n\n${distilled.markdown}`
    record.size = Buffer.byteLength(fileContent)
    await store.writeEntryFile(id, fileContent)
    if (existing === undefined) index.entries.unshift(record)
    else index.entries[index.entries.indexOf(existing)] = record
    target.updatedAt = now
    return {
      entry: entryMetadata(index, record),
      replaced: existing !== undefined,
      truncated: distilled.truncated,
    }
  })
}

async function searchLibrary(store, { cwd, query, collectionId, limit }, snapshot) {
  const index = snapshot ?? await store.readIndex()
  const accessible = cwd === undefined ? undefined : accessibleCollectionIds(index, cwd)
  let candidates = index.entries.filter((entry) => accessible === undefined || accessible.has(entry.collectionId))
  if (collectionId !== undefined) candidates = candidates.filter((entry) => entry.collectionId === collectionId)
  const cappedLimit = Math.max(1, Math.min(50, limit ?? TOOL_LIMIT_DEFAULT))
  const normalized = (query ?? '').trim().toLowerCase()
  if (normalized.length === 0) {
    return {
      query: '',
      total: candidates.length,
      results: candidates
        .slice()
        .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
        .slice(0, cappedLimit)
        .map((entry) => ({ ...entryMetadata(index, entry), updatedAt: isoTime(entry.updatedAt), score: 0, snippet: entry.summary ?? '' })),
    }
  }
  const tokens = searchTokens(normalized)
  const scored = []
  for (const entry of candidates) {
    let body = ''
    try {
      body = parseFrontmatter(await store.readEntryFile(entry.id)).body
    } catch {
      continue
    }
    const lowerBody = body.toLowerCase()
    const title = String(entry.title ?? '').toLowerCase()
    const summary = String(entry.summary ?? '').toLowerCase()
    const sources = (Array.isArray(entry.sources) ? entry.sources : []).join(' ').toLowerCase()
    let score = 0
    for (const token of tokens) {
      if (title.includes(token)) score += 8
      if (summary.includes(token)) score += 4
      if (sources.includes(token)) score += 2
      const occurrences = countOccurrences(lowerBody, token)
      if (occurrences > 0) score += Math.min(5, occurrences)
    }
    if (score > 0) scored.push({ entry, score, snippet: makeSnippet(body, tokens) })
  }
  scored.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score
    return (right.entry.updatedAt ?? 0) - (left.entry.updatedAt ?? 0)
  })
  return {
    query: query ?? '',
    total: scored.length,
    results: scored.slice(0, cappedLimit).map((item) => ({
      ...entryMetadata(index, item.entry),
      updatedAt: isoTime(item.entry.updatedAt),
      score: item.score,
      snippet: item.snippet,
    })),
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Tool definitions
// ────────────────────────────────────────────────────────────────────────────

const SEARCH_PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    query: {
      type: 'string',
      description: 'Keywords or a phrase to search for (case-insensitive). Empty returns the most recently updated notes.',
    },
    limit: {
      type: 'number',
      description: 'Maximum number of notes to return (1-50, default 8).',
    },
    collectionId: {
      type: 'string',
      description: 'Optional knowledge base id to search inside one library only.',
    },
  },
}

const SEARCH_OUTPUT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    query: { type: 'string' },
    workspace: { type: 'string' },
    total: { type: 'number' },
    results: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: true,
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          collectionName: { type: 'string' },
          summary: { type: 'string' },
          sources: { type: 'array', items: { type: 'string' } },
          updatedAt: { type: 'string' },
          score: { type: 'number' },
          snippet: { type: 'string' },
        },
        required: ['id', 'title'],
      },
    },
    availableCollections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { id: { type: 'string' }, name: { type: 'string' } },
        required: ['id', 'name'],
      },
    },
  },
  required: ['total', 'results'],
}

const READ_PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', description: 'Knowledge note id returned by knowledge_search or knowledge_ingest.' },
  },
  required: ['id'],
}

const READ_OUTPUT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    collectionName: { type: 'string' },
    sources: { type: 'array', items: { type: 'string' } },
    updatedAt: { type: 'string' },
    markdown: { type: 'string' },
    truncated: { type: 'boolean' },
    sourceChars: { type: 'number' },
    distillEffort: { type: 'string' },
  },
  required: ['id', 'title', 'markdown'],
}

const ATTACHMENT_INGEST_PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string', description: 'Absolute path of the saved attachment shown in the attachment prompt. Preferred over name.' },
    name: { type: 'string', description: 'Attachment file name to distill when the path is unknown. Omit to distill every file attached to this conversation.' },
    collectionId: { type: 'string', description: 'Target knowledge base id. Defaults to the current workspace library.' },
    language: { type: 'string', enum: ['zh', 'en'] },
  },
}
const INGEST_PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    paths: {
      type: 'array',
      items: { type: 'string' },
      description: 'Workspace-relative document paths to distill (max 3 per call). Only when the user asks to add knowledge.',
    },
    collectionId: {
      type: 'string',
      description: 'Optional target knowledge base id; defaults to the workspace library.',
    },
    language: {
      type: 'string',
      enum: ['zh', 'en'],
      description: 'Language of the generated knowledge note. Defaults to the Knowledge Center setting.',
    },
  },
  required: ['paths'],
}

const INGEST_OUTPUT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    workspace: { type: 'string' },
    entries: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: true,
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          collectionName: { type: 'string' },
          sources: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'title'],
      },
    },
    failed: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { path: { type: 'string' }, reason: { type: 'string' } },
        required: ['path', 'reason'],
      },
    },
  },
  required: ['entries', 'failed'],
}

function textBlock(text) {
  return [{ type: 'text', text }]
}

/** Endpoint segment of `<channel>/<endpoint>`, or undefined for another path. */
function channelEndpoint(channel, pathname) {
  if (typeof pathname !== 'string' || !pathname.startsWith(`${channel}/`)) return undefined
  const endpoint = pathname.slice(channel.length + 1)
  if (endpoint.length === 0 || endpoint.includes('/')) return undefined
  if (!/^[A-Za-z0-9_$.-]+$/.test(endpoint)) return undefined
  return endpoint
}

function writeJsonResponse(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

/** Read one bounded JSON request body from a raw `node:http` request. */
function readJsonRequest(req, limitBytes) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let settled = false
    const fail = (error) => {
      if (settled) return
      settled = true
      reject(error)
    }
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limitBytes) {
        fail(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (settled) return
      settled = true
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('body is not JSON'))
      }
    })
    req.on('error', (error) => fail(error))
    req.on('aborted', () => fail(new Error('request aborted')))
  })
}

async function resolveToolWorkspace(ctx, store, exec) {
  const agent = exec.agent
  if (agent === undefined || agent === null) {
    throw new Error('Knowledge tools require an agent session; none is attached to this call.')
  }
  const live = ctx.agents.get(agent.id)
  if (live === undefined) throw new Error('The current agent is no longer live, so its workspace cannot be resolved.')
  let cwd
  try {
    cwd = ctx.workingDirectory.get(live.session)
  } catch {
    cwd = live.session?.header?.cwd
  }
  if (typeof cwd !== 'string' || cwd.length === 0) {
    throw new Error('Could not resolve the current workspace directory for knowledge access.')
  }
  const index = await store.readIndex()
  const workspace = findSessionWorkspace(ctx, cwd)
  if (workspace === undefined || !isWorkspaceGranted(index, workspace.path)) {
    throw new Error(
      `Knowledge Center is not enabled for workspace ${cwd}. `
      + 'Ask the user to turn on this workspace in Settings → 知识中心 (Knowledge Center) → 权限与设置, then retry.',
    )
  }
  return { cwd: canonicalPath(workspace.path), index }
}

function knowledgeLanguage(index, requested) {
  if (requested === 'zh' || requested === 'en') return requested
  const setting = index.settings?.outputLanguage
  return setting === 'en' ? 'en' : 'zh'
}

// ────────────────────────────────────────────────────────────────────────────
// RPC API (Client ↔ Host)
// ────────────────────────────────────────────────────────────────────────────

function createApi(ctx, store) {
  const workspaceList = () => ctx.workspaceRegistry.list().map((workspace) => ({
    id: String(workspace.id),
    title: workspace.title,
    path: workspace.path,
  }))

  return {
    async ping() {
      return { ok: true, time: new Date().toISOString() }
    },

    async state() {
      const index = await store.readIndex()
      const workspaces = workspaceList()
      return {
        version: INDEX_VERSION,
        dataDir: store.root,
        storageRecovery: index.recovery ?? null,
        model: modelLabel(ctx),
        tools: ['knowledge_search', 'knowledge_read', 'knowledge_ingest'],
        settings: index.settings,
        collections: index.collections.map((collection) => ({
          id: collection.id,
          name: collection.name,
          scope: collection.scope,
          workspacePath: collection.workspacePath ?? null,
          createdAt: collection.createdAt,
          updatedAt: collection.updatedAt,
          entryCount: index.entries.filter((entry) => entry.collectionId === collection.id).length,
        })),
        entries: index.entries.map((entry) => entryMetadata(index, entry)),
        permissions: allowedWorkspaceEntries(index),
        workspaces: workspaces.map((workspace) => ({
          ...workspace,
          allowed: isWorkspaceGranted(index, workspace.path),
        })),
        totals: {
          entries: index.entries.length,
          collections: index.collections.length,
        },
      }
    },

    async search(payload) {
      const data = asRecord(payload)
      const index = await store.readIndex()
      const query = typeof data.query === 'string' ? data.query : ''
      // The owner UI searches across every collection, including workspace-scoped ones.
      return searchLibrary(store, { query, collectionId: asOptionalString(data.collectionId), limit: 30 }, index)
    },

    async read(payload) {
      const data = asRecord(payload)
      const id = asString(data.id, 'id')
      const index = await store.readIndex()
      const entry = index.entries.find((candidate) => candidate.id === id)
      if (entry === undefined) throw new Error(`Knowledge note not found: ${id}`)
      let file = ''
      try {
        file = await store.readEntryFile(id)
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
        await store.mutate((current) => {
          current.entries = current.entries.filter((candidate) => candidate.id !== id)
        })
        throw new Error(`Knowledge note file is missing and was removed from the index: ${id}`)
      }
      const parsed = parseFrontmatter(file)
      return {
        meta: entryMetadata(index, entry),
        markdown: parsed.body,
        source: file,
      }
    },

    async scan(payload) {
      const data = asRecord(payload)
      const workspace = await requireWorkspace(ctx, asString(data.workspacePath, 'workspacePath'))
      return scanWorkspaceDocuments(ctx, workspace.path)
    },

    async ingest(payload, signal) {
      const data = asRecord(payload)
      const workspace = await requireWorkspace(ctx, asString(data.workspacePath, 'workspacePath'))
      const index = await store.readIndex()
      const collection = await resolveCollectionForIngest(store, workspace, asOptionalString(data.collectionId))
      const language = knowledgeLanguage(index, data.language === 'en' || data.language === 'zh' ? data.language : undefined)
      const relativePath = normalizeSourcePath(asString(data.relPath, 'relPath'))
      if (relativePath.length === 0) throw new Error('`relPath` must point to a workspace document.')
      const result = await ingestDocument(ctx, store, {
        workspace,
        collection,
        relativePath,
        language,
        signal,
      })
      return {
        ...result,
        collection: { id: collection.id, name: collection.name, scope: collection.scope },
        model: result.entry.generator,
      }
    },

    async createCollection(payload) {
      const data = asRecord(payload)
      const collectionNameInput = asString(data.name, 'name').trim().slice(0, 80)
      const scope = data.scope === 'workspace' ? 'workspace' : data.scope === 'shared' ? 'shared' : 'user'
      let workspacePath = null
      if (scope === 'workspace') {
        const workspace = await requireWorkspace(ctx, asString(data.workspacePath, 'workspacePath'))
        workspacePath = canonicalPath(workspace.path)
      }
      return store.mutate((index) => {
        const now = Date.now()
        const collection = {
          id: randomUUID(),
          name: collectionNameInput,
          scope,
          workspacePath,
          readers: [],
          createdAt: now,
          updatedAt: now,
        }
        index.collections.push(collection)
        return {
          id: collection.id,
          name: collection.name,
          scope: collection.scope,
          workspacePath: collection.workspacePath,
          readers: collection.readers ?? [],
          createdAt: collection.createdAt,
          updatedAt: collection.updatedAt,
          entryCount: 0,
        }
      })
    },

    async deleteCollection(payload) {
      const data = asRecord(payload)
      const id = asString(data.id, 'id')
      if (id === DEFAULT_COLLECTION_ID) throw new Error('The default knowledge base cannot be deleted.')
      const removed = await store.mutate((index) => {
        const collection = index.collections.find((candidate) => candidate.id === id)
        if (collection === undefined) throw new Error(`Unknown knowledge base: ${id}`)
        const entries = index.entries.filter((entry) => entry.collectionId === id)
        index.collections = index.collections.filter((candidate) => candidate.id !== id)
        index.entries = index.entries.filter((entry) => entry.collectionId !== id)
        return entries.map((entry) => entry.id)
      })
      for (const entryId of removed) await store.removeEntryFile(entryId)
      return { deleted: removed.length }
    },

    async setCollectionShare(payload) {
      const data = asRecord(payload)
      const collectionId = asString(data.collectionId, 'collectionId')
      const workspace = await requireWorkspace(ctx, asString(data.workspacePath, 'workspacePath'))
      const workspacePath = canonicalPath(workspace.path)
      const allowed = data.allowed !== false
      const now = Date.now()
      return store.mutate((index) => {
        const collection = index.collections.find((candidate) => candidate.id === collectionId)
        if (collection === undefined) throw new Error(`Unknown knowledge base: ${collectionId}`)
        if (collection.scope !== 'shared') throw new Error('Only a shared knowledge base can be granted to other workspaces.')
        if (!Array.isArray(index.shares)) index.shares = []
        const key = comparisonKey(workspacePath)
        const readers = (collection.readers ?? []).filter((reader) => comparisonKey(reader) !== key)
        if (allowed) readers.push(workspacePath)
        collection.readers = readers
        collection.updatedAt = now
        index.shares.push({
          id: randomUUID(),
          collectionId,
          workspacePath,
          action: allowed ? 'grant' : 'revoke',
          at: now,
          by: 'owner',
        })
        return {
          id: collection.id,
          name: collection.name,
          scope: collection.scope,
          readers: collection.readers,
          updatedAt: collection.updatedAt,
        }
      })
    },

    async listShares() {
      const index = await store.readIndex()
      return {
        collections: index.collections.map((collection) => ({
          id: collection.id,
          name: collection.name,
          scope: collection.scope,
          workspacePath: collection.workspacePath ?? null,
          readers: Array.isArray(collection.readers) ? collection.readers : [],
        })),
        shares: Array.isArray(index.shares) ? index.shares : [],
      }
    },
    async deleteEntry(payload) {
      const data = asRecord(payload)
      const id = asString(data.id, 'id')
      await store.mutate((index) => {
        const before = index.entries.length
        index.entries = index.entries.filter((entry) => entry.id !== id)
        if (index.entries.length === before) throw new Error(`Knowledge note not found: ${id}`)
      })
      await store.removeEntryFile(id)
      return { deleted: true }
    },

    async saveEntry(payload) {
      const data = asRecord(payload)
      const id = asString(data.id, 'id')
      const markdown = asString(data.markdown, 'markdown')
      const parsed = parseFrontmatter(markdown)
      const body = parsed.body.trim()
      if (body.length === 0) throw new Error('The knowledge note body cannot be empty.')
      return store.mutate(async (index) => {
        const entry = index.entries.find((candidate) => candidate.id === id)
        if (entry === undefined) throw new Error(`Knowledge note not found: ${id}`)
        const now = Date.now()
        const merged = {
          ...parsed.data,
          id,
          title: typeof parsed.data.title === 'string' && parsed.data.title.trim().length > 0
            ? parsed.data.title.trim().slice(0, 160)
            : entry.title,
          collectionId: entry.collectionId,
          collection: collectionName(index, entry.collectionId),
          // Strip the machine-absolute workspace path and normalize sources so
          // an edited note stays portable and shareable.
          workspace: undefined,
          sources: (Array.isArray(parsed.data.sources) && parsed.data.sources.length > 0
            ? parsed.data.sources.map(String)
            : entry.sources).map((value) => workspaceSourcePath(entry.workspacePath, value)),
          updatedAt: now,
          createdAt: entry.createdAt,
        }
        merged.summary = typeof parsed.data.summary === 'string' && parsed.data.summary.trim().length > 0
          ? parsed.data.summary.trim().slice(0, 280)
          : deriveSummary(body)
        const fileContent = `${serializeFrontmatter(merged)}\n\n${body}\n`
        await store.writeEntryFile(id, fileContent)
        entry.title = String(merged.title)
        entry.summary = String(merged.summary)
        entry.sources = merged.sources
        entry.updatedAt = now
        entry.size = Buffer.byteLength(fileContent)
        const target = index.collections.find((candidate) => candidate.id === entry.collectionId)
        if (target !== undefined) target.updatedAt = now
        return { entry: entryMetadata(index, entry) }
      })
    },

    async setPermission(payload) {
      const data = asRecord(payload)
      const workspace = await requireWorkspace(ctx, asString(data.workspacePath, 'workspacePath'))
      const allowed = data.allowed === true
      const key = canonicalPath(workspace.path)
      return store.mutate((index) => {
        if (allowed) index.permissions[key] = true
        else delete index.permissions[key]
        return { workspacePath: key, allowed }
      })
    },

    async setSetting(payload) {
      const data = asRecord(payload)
      return store.mutate((index) => {
        if (data.outputLanguage === 'zh' || data.outputLanguage === 'en') {
          index.settings.outputLanguage = data.outputLanguage
        }
        return index.settings
      })
    },
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Plugin activation
// ────────────────────────────────────────────────────────────────────────────

export function apply(ctx) {
  const store = new KnowledgeStore()
  store.ready.catch((error) => {
    try {
      ctx.logger?.warn?.(`knowledge-center: failed to initialize storage: ${String(error?.message ?? error)}`)
    } catch {
      // logging is best effort
    }
  })
  const api = createApi(ctx, store)

  // ── Settings UI ↔ Host RPC channel ───────────────────────────────────────
  // The browser half calls `ctx.connection.rpc.call('/knowledge-center', ...)`,
  // which POSTs a `client-request` envelope to `<channel>/<endpoint>`. The
  // generic channel registry cannot serve this from a third-party plugin (it
  // reads `webServer` through the provider context), so the plugin registers
  // its own prefix route and speaks the same tiny wire protocol.
  const routeHandler = async (endpoint, payload, signal, peer) => {
    try {
      const principal = peer?.principal
      if (principal === undefined || principal === null || principal.kind !== 'owner') {
        return { ok: false, error: { code: 'knowledge-center/denied', message: 'Only the local owner may use Knowledge Center.', details: {} } }
      }
      const handlers = api
      if (typeof handlers[endpoint] !== 'function') {
        return { ok: false, error: { code: 'knowledge-center/unknown-method', message: `Unknown method: ${endpoint}`, details: {} } }
      }
      const value = await handlers[endpoint](payload ?? {}, signal)
      return { ok: true, value }
    } catch (error) {
      const message = error !== null && typeof error === 'object' && typeof error.message === 'string'
        ? error.message
        : String(error)
      return { ok: false, error: { code: 'knowledge-center/failed', message, details: {} } }
    }
  }
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: CHANNEL,
    handler: async (req, res) => {
      const abort = new AbortController()
      const onRequestClose = () => {
        if (!req.complete) abort.abort()
      }
      const onResponseClose = () => {
        if (!res.writableEnded) abort.abort()
      }
      req.on('close', onRequestClose)
      res.on('close', onResponseClose)
      try {
        const admission = ctx.connection.admit(req)
        if ('rejection' in admission) {
          res.writeHead(admission.rejection)
          res.end(admission.rejection === 401 ? 'unauthorized' : 'forbidden')
          return
        }
        if (admission.peer.principal?.kind !== 'owner') {
          res.writeHead(403)
          res.end('forbidden')
          return
        }
        if (req.method !== 'POST') {
          res.writeHead(404)
          res.end('not found')
          return
        }
        const endpoint = channelEndpoint(CHANNEL, new URL(req.url ?? '/', 'http://knowledge-center.local').pathname)
        if (endpoint === undefined) {
          res.writeHead(404)
          res.end('not found')
          return
        }
        let message
        try {
          message = await readJsonRequest(req, 2 * 1024 * 1024)
        } catch (error) {
          res.writeHead(400)
          res.end(String(error?.message ?? error))
          return
        }
        if (message === null || typeof message !== 'object' || typeof message.rpcId !== 'string' || typeof message.method !== 'string') {
          res.writeHead(400)
          res.end('invalid client-request message')
          return
        }
        if (message.method !== endpoint) {
          writeJsonResponse(res, 200, {
            type: 'server-response',
            rpcId: message.rpcId,
            result: {
              ok: false,
              error: {
                code: 'knowledge-center/bad-request',
                message: `method ${JSON.stringify(message.method)} does not match endpoint ${JSON.stringify(endpoint)}`,
                details: {},
              },
            },
          })
          return
        }
        const result = await routeHandler(endpoint, message.payload, abort.signal, admission.peer)
        writeJsonResponse(res, 200, { type: 'server-response', rpcId: message.rpcId, result })
      } catch (error) {
        try {
          writeJsonResponse(res, 200, {
            type: 'server-response',
            rpcId: typeof error?.rpcId === 'string' ? error.rpcId : 'invalid-request',
            result: {
              ok: false,
              error: { code: 'knowledge-center/failed', message: String(error?.message ?? error), details: {} },
            },
          })
        } catch {
          res.writeHead(400)
          res.end('bad request')
        }
      } finally {
        req.off('close', onRequestClose)
        res.off('close', onResponseClose)
      }
    },
  }), 'knowledge-center: rpc channel')

  // ── Agent tools ──────────────────────────────────────────────────────────
  ctx.effect(() => ctx.tools.register({
    name: 'knowledge_search',
    description:
      'Search the Knowledge Center — curated Markdown knowledge notes distilled from workspace documents. '
      + 'Only works in workspaces the user has permitted in Settings → 知识中心 → 权限与设置; elsewhere it reports missing access. '
      + 'Call it before re-reading many source documents when the user refers to project knowledge, conventions, designs, APIs, or procedures. '
      + 'Returns ids, titles, collections, summaries and snippets; use knowledge_read for the full note.',
    parameters: SEARCH_PARAMETERS,
    output: {
      schema: SEARCH_OUTPUT,
      render: (args, value) => textBlock(JSON.stringify(value, null, 2)),
    },
    presentCall: (args) => ({
      card: 'generic',
      title: 'Search Knowledge Center',
      kind: 'search',
      rawInput: args,
    }),
    async execute(args, exec) {
      const input = asRecord(args)
      const { cwd, index } = await resolveToolWorkspace(ctx, store, exec)
      const query = typeof input.query === 'string' ? input.query : ''
      const limit = typeof input.limit === 'number' ? input.limit : TOOL_LIMIT_DEFAULT
      const result = await searchLibrary(store, {
        cwd,
        query,
        collectionId: asOptionalString(input.collectionId),
        limit,
      })
      return {
        query: result.query,
        workspace: cwd,
        total: result.total,
        results: result.results,
        availableCollections: index.collections
          .filter((collection) => accessibleCollectionIds(index, cwd).has(collection.id))
          .map((collection) => ({ id: collection.id, name: collection.name })),
      }
    },
    isConcurrencySafe: () => true,
  }))

  ctx.effect(() => ctx.tools.register({
    name: 'knowledge_ingest_attachment',
    description:
      'Distill files the user attached to this conversation into the current workspace knowledge base. '
      + 'Pass the saved attachment path from the attachment prompt as `path`, or a file name as `name` to match the current session. '
      + 'Only use this when the user explicitly asks to turn an attachment into knowledge. '
      + 'It writes to the current workspace library; global or shared libraries stay owner-only.',
    parameters: ATTACHMENT_INGEST_PARAMETERS,
    output: {
      schema: INGEST_OUTPUT,
      render: (args, value) => textBlock(JSON.stringify(value, null, 2)),
    },
    presentCall: (args) => ({
      card: 'generic',
      title: 'Distill an attachment into Knowledge Center',
      kind: 'other',
      rawInput: args,
    }),
    timeoutMs: 600_000,
    async execute(args, exec) {
      const input = asRecord(args)
      const { cwd, index } = await resolveToolWorkspace(ctx, store, exec)
      const workspace = findWorkspace(ctx, cwd)
      if (workspace === undefined) throw new Error(`The current directory is not a registered workspace: ${cwd}`)
      const language = knowledgeLanguage(index, input.language === 'en' || input.language === 'zh' ? input.language : undefined)
      const collection = await resolveCollectionForIngest(store, workspace, asOptionalString(input.collectionId), 'tool')
      const explicitPath = asOptionalString(input.path)
      const wanted = asOptionalString(input.name)
      const refs = explicitPath === undefined ? sessionFileAttachments(ctx, exec.agent?.id) : []
      const selected = explicitPath !== undefined
        ? [{ name: basename(explicitPath), path: explicitPath }]
        : wanted === undefined ? refs : refs.filter((ref) => ref.name === wanted)
      if (selected.length === 0) {
        throw new Error(wanted === undefined
          ? 'No file attachments were found in this conversation. Pass the saved attachment path as `path`.'
          : `No attachment named ${wanted} was found. Pass the saved attachment path as \`path\` instead.`)
      }
      const entries = []
      const failed = []
      for (const ref of selected.slice(0, 3)) {
        try {
          const source = await readAttachmentSource(ctx, ref, { signal: exec.signal, resolveExecutable: createExecutableResolver(ctx), attachmentsRoot: join(dirname(store.root), 'attachments'), path: ref.path })
          const result = await ingestDocument(ctx, store, {
            workspace,
            collection,
            language,
            signal: exec.signal,
            relativePath: `附件/${ref.name}`,
            text: source.text,
          })
          entries.push(result.entry)
        } catch (error) {
          failed.push({ path: ref.name, reason: error instanceof Error ? error.message : String(error) })
        }
      }
      return { workspace: canonicalPath(workspace.path), entries, failed }
    },
  }))
  ctx.effect(() => ctx.tools.register({
    name: 'knowledge_read',
    description:
      'Read one full Knowledge Center note by id (from knowledge_search or knowledge_ingest). '
      + 'Only works in workspaces the user has permitted in Settings → 知识中心 → 权限与设置. '
      + 'The result is the complete Markdown knowledge note plus its source paths and collection.',
    parameters: READ_PARAMETERS,
    output: {
      schema: READ_OUTPUT,
      render: (args, value) => textBlock(String(value?.markdown ?? '')),
    },
    presentCall: (args) => ({
      card: 'generic',
      title: 'Read knowledge note',
      kind: 'read',
      rawInput: args,
    }),
    async execute(args, exec) {
      const input = asRecord(args)
      const id = asString(input.id, 'id')
      const { cwd, index } = await resolveToolWorkspace(ctx, store, exec)
      const accessible = accessibleCollectionIds(index, cwd)
      const entry = index.entries.find((candidate) => candidate.id === id && accessible.has(candidate.collectionId))
      if (entry === undefined) {
        throw new Error(`Knowledge note not found or not available in this workspace: ${id}`)
      }
      const file = await store.readEntryFile(id)
      const parsed = parseFrontmatter(file)
      return {
        id,
        title: entry.title,
        collectionName: collectionName(index, entry.collectionId),
        sources: entry.sources,
        updatedAt: isoTime(entry.updatedAt),
        markdown: parsed.body,
        truncated: entry.truncated === true,
        sourceChars: entry.sourceChars ?? 0,
        distillEffort: entry.distill?.effort ?? '',
      }
    },
    isConcurrencySafe: () => true,
  }))

  ctx.effect(() => ctx.tools.register({
    name: 'knowledge_ingest',
    description:
      'Distill workspace documents into new Knowledge Center notes. Only use this when the user explicitly asks to add documents to the knowledge base; '
      + 'it runs the configured default model per document and can take a while. '
      + `Accepts up to 3 workspace-relative document paths per call (Markdown, TXT, PDF, Word, Excel, PowerPoint, HTML, CSV; legacy Office via LibreOffice), and only in workspaces the user has permitted in Settings → 知识中心 → 权限与设置.`,
    parameters: INGEST_PARAMETERS,
    output: {
      schema: INGEST_OUTPUT,
      render: (args, value) => textBlock(JSON.stringify(value, null, 2)),
    },
    presentCall: (args) => ({
      card: 'generic',
      title: 'Distill documents into Knowledge Center',
      kind: 'other',
      rawInput: args,
    }),
    timeoutMs: 600_000,
    async execute(args, exec) {
      const input = asRecord(args)
      if (!Array.isArray(input.paths) || input.paths.length === 0) throw new Error('`paths` must be a non-empty array.')
      const requestedPaths = input.paths.slice(0, 3).map((item) => normalizeSourcePath(asString(item, 'paths item')))
      const paths = [...new Set(requestedPaths.filter((value) => value.length > 0))]
      if (paths.length === 0) throw new Error('`paths` must contain at least one workspace-relative document path.')
      const { cwd, index } = await resolveToolWorkspace(ctx, store, exec)
      const workspace = findWorkspace(ctx, cwd)
      if (workspace === undefined) {
        throw new Error(`The current directory is not a registered workspace: ${cwd}`)
      }
      const language = knowledgeLanguage(index, input.language === 'en' || input.language === 'zh' ? input.language : undefined)
      const collection = await resolveCollectionForIngest(store, workspace, asOptionalString(input.collectionId), 'tool')
      const entries = []
      const failed = []
      for (const relativePath of paths) {
        try {
          const result = await ingestDocument(ctx, store, {
            workspace,
            collection,
            relativePath,
            language,
            signal: exec.signal,
          })
          entries.push(result.entry)
        } catch (error) {
          failed.push({ path: relativePath, reason: error instanceof Error ? error.message : String(error) })
        }
      }
      return {
        workspace: canonicalPath(workspace.path),
        entries,
        failed,
      }
    },
    isConcurrencySafe: () => false,
  }))

  // ── Model-facing capability description ─────────────────────────────────
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'knowledge-center',
    order: 900,
    text: [
      '## Knowledge Center (知识中心)',
      'The user installed the Knowledge Center plugin. In workspaces where access is granted (Settings → 知识中心 → 权限与设置) you can use:',
      '- `knowledge_search` — search curated knowledge notes distilled from workspace documents; call it before re-reading many source files when the user refers to project knowledge, conventions, designs, APIs, or procedures.',
      '- `knowledge_read` — read the complete Markdown knowledge note for an id returned by search or ingest.',
      '- `knowledge_ingest` — only when the user explicitly asks to add workspace documents to the knowledge base.',
      'These tools refuse to run in workspaces without a grant. If they report missing access, do not retry or try to bypass it; tell the user to enable the workspace in Settings.',
    ].join('\n'),
  }))
}
