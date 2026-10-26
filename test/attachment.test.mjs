import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHostHarness } from './helpers/host-harness.mjs'

const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Length 55 >>\nstream\nBT (Converted legacy attachment facts.) Tj ET\nendstream\nendobj\n%%EOF', 'latin1')

async function attachment(host, name, bytes) {
  const directory = join(host.root, 'data', 'attachments', 'v1', 'files', 'ab', 'fixture')
  await mkdir(directory, { recursive: true })
  const path = join(directory, name)
  await writeFile(path, bytes)
  return path
}

test('legacy Office attachments use the available converter before distillation', async (t) => {
  const prompts = []
  const host = await createHostHarness(t, {
    async *stream(options) {
      prompts.push(options.messages[0].content[0].text)
      yield { type: 'text-delta', text: '# Imported\n\n> Summary\n\nLegacy document facts.' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  })
  await host.rpc('setPermission', { workspacePath: host.workspace, allowed: true })
  const get = host.context.get
  const converted = []
  host.context.get = (name) => name === 'officeToPdf' ? {
    async convert(request, signal) {
      converted.push(request.extension)
      signal.throwIfAborted()
      const read = await request.source.read(signal, 1024)
      assert.equal(read.bytes.toString(), `legacy-${request.extension}`)
      assert.equal(read.version, request.source.version)
      assert.equal(request.source.bytes, read.bytes.length)
      await assert.rejects(request.source.read(signal, 1), /larger|limit|budget/i)
      return { pdf }
    },
  } : get(name)
  for (const extension of ['doc', 'xls', 'ppt']) {
    const path = await attachment(host, `legacy.${extension}`, Buffer.from(`legacy-${extension}`))
    const result = await host.execute('knowledge_ingest_attachment', { path })
    assert.equal(result.failed.length, 0, JSON.stringify(result.failed))
    assert.equal(result.entries.length, 1)
  }
  assert.deepEqual(converted, ['doc', 'xls', 'ppt'])
  assert.ok(prompts.every((prompt) => prompt.includes('Converted legacy attachment facts.')))
})

test('a legacy attachment without a converter fails before calling the model', async (t) => {
  const host = await createHostHarness(t)
  await host.rpc('setPermission', { workspacePath: host.workspace, allowed: true })
  const path = await attachment(host, 'legacy.doc', Buffer.from('legacy-doc'))
  const result = await host.execute('knowledge_ingest_attachment', { path })
  assert.equal(result.entries.length, 0)
  assert.match(result.failed[0].reason, /office-to-PDF|office-to-pdf|LibreOffice/i)
  assert.equal(host.calls.length, 0)
})

test('attachment ingestion rejects files outside the attachment store', async (t) => {
  const host = await createHostHarness(t)
  await host.rpc('setPermission', { workspacePath: host.workspace, allowed: true })
  // Ensure the authorized root exists so failure verifies the containment check.
  await attachment(host, 'inside.md', Buffer.from('# Inside'))
  const result = await host.execute('knowledge_ingest_attachment', { path: join(host.workspace, 'source.md') })
  assert.equal(result.entries.length, 0)
  assert.match(result.failed[0].reason, /outside the attachment store/)
  assert.equal(host.calls.length, 0)
})
