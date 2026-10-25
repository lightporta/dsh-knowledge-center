import { mkdtemp, mkdir, readFile, writeFile, stat, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, relative, isAbsolute } from 'node:path'
import { Readable } from 'node:stream'
import { EventEmitter } from 'node:events'
import { apply } from '../../index.js'

/** Exercise the plugin's public RPC route and registered tools with isolated data. */
export async function createHostHarness(t, { stream, workspaces, dataHome, selection } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'knowledge-host-test-'))
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  await writeFile(join(workspace, 'source.md'), '# Source\n\nFacts from a document.\n')
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = dataHome ?? join(root, 'data')
  let route
  const tools = new Map()
  const disposers = []
  const signals = []
  /** Every selection handed to the LLM adapter, so tests can assert budgets. */
  const calls = []
  let cwd = workspace
  const context = {
    effect(callback) {
      const disposer = callback()
      if (typeof disposer === 'function') disposers.push(disposer)
      return disposer
    },
    logger: { warn() {} },
    webServer: { register(definition) { route = definition.handler; return () => {} } },
    connection: { admit() { return { peer: { principal: { kind: 'owner' } } } } },
    tools: { register(definition) { tools.set(definition.name, definition); return () => {} } },
    systemPrompt: { section() { return () => {} } },
    workspaceRegistry: { list: () => workspaces ?? [{ id: 'repo', title: 'Repo', path: workspace }] },
    agents: { get: () => ({ session: { header: { cwd } } }) },
    workingDirectory: { get: () => cwd },
    fs: {
      resolve: async (path, options) => resolve(options?.cwd ?? '/', path),
      contains(parent, child) {
        const rel = relative(parent, child)
        return rel === '' || (rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(rel))
      },
      async stat(path) {
        const info = await stat(path)
        return { type: info.isDirectory() ? 'directory' : 'file', size: info.size }
      },
      readText: (path) => readFile(path, 'utf8'),
      readBytes: (path) => readFile(path),
      async listDir(path) {
        return (await readdir(path, { withFileTypes: true })).map((entry) => ({ name: entry.name, type: entry.isDirectory() ? 'directory' : 'file' }))
      },
    },
    get(name) {
      if (name === 'agentDefaultModel') return { currentSelection: () => selection ?? { provider: 'test', model: 'model' } }
      if (name === 'llm') return {
        async prepareCall(callSelection, signal) {
          calls.push({ ...callSelection })
          signals.push(signal)
          signal.throwIfAborted()
          return {
            config: {},
            stream: stream ?? (async function* (options) {
              options.signal.throwIfAborted()
              yield { type: 'text-delta', text: '# Knowledge\n\n> Summary\n\nVerified facts.\n' }
              yield { type: 'finish', reason: { kind: 'stop' } }
            }),
          }
        },
      }
      return undefined
    },
  }
  apply(context)
  // The store captures its root during activation; tests may reset the env now.
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  t.after(async () => {
    for (const dispose of disposers.reverse()) dispose()
    await rm(root, { recursive: true, force: true })
  })

  function request(method, payload = {}, { complete = true } = {}) {
    const req = Readable.from([Buffer.from(JSON.stringify({ rpcId: 'test', method, payload }))])
    req.method = 'POST'
    req.url = `/knowledge-center/${method}`
    req.complete = complete
    const res = new EventEmitter()
    res.writableEnded = false
    res.writeHead = (status) => { res.status = status }
    res.end = (body) => { res.body = body; res.writableEnded = true }
    const done = route(req, res).then(() => JSON.parse(res.body).result)
    return { req, res, done }
  }
  return {
    root, workspace, tools, signals, calls, context, request,
    rpc: (method, payload, options) => request(method, payload, options).done,
    setCwd(value) { cwd = value },
    execute: (name, args) => tools.get(name).execute(args, { agent: { id: 'agent' }, signal: new AbortController().signal }),
  }
}
