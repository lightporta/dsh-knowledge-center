/**
 * Document extraction tests.
 *
 * OOXML fixtures are built in memory as minimal ZIP containers so the tests
 * need no external files or dependencies. The PDF fallback test uses a tiny
 * hand-written PDF with an uncompressed and a deflated content stream.
 *
 * Run with: node --test
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { deflateRawSync, deflateSync } from 'node:zlib'
import {
  DOCUMENT_EXTENSIONS,
  extractDocxText,
  extractHtmlText,
  extractPdfText,
  extractPdfTextFallback,
  extractPptxText,
  extractStructuredDocumentText,
  extractXlsxText,
  readZipEntries,
} from '../lib/extract.js'

/** Build stored or DEFLATE ZIP fixtures, including forged size metadata. */
function buildZip(files, { compressed = false, declaredSize } = {}) {
  const localParts = []
  const centralParts = []
  let offset = 0
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content)
    const payload = compressed ? deflateRawSync(data) : data
    const nameBytes = Buffer.from(name, 'utf8')
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(compressed ? 8 : 0, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt32LE(payload.length, 18)
    local.writeUInt32LE(declaredSize ?? data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    localParts.push(local, nameBytes, payload)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(compressed ? 8 : 0, 10)
    central.writeUInt32LE(payload.length, 20)
    central.writeUInt32LE(declaredSize ?? data.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE(offset, 42)
    centralParts.push(central, nameBytes)
    offset += local.length + nameBytes.length + payload.length
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(Object.keys(files).length, 8)
  eocd.writeUInt16LE(Object.keys(files).length, 10)
  eocd.writeUInt32LE(centralSize, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...localParts, ...centralParts, eocd])
}

const docxFixture = () => buildZip({
  'word/document.xml': '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Knowledge Center DOCX</w:t></w:r></w:p><w:p><w:r><w:t>Second paragraph</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Cell B</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>',
})

const xlsxFixture = () => buildZip({
  'xl/sharedStrings.xml': '<sst><si><t>Name</t></si><si><t>Alice</t></si><si><t>Role</t></si></sst>',
  'xl/workbook.xml': '<workbook><sheets><sheet name="People" sheetId="1" r:id="rId1"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
  'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>42</v></c></row></sheetData></worksheet>',
})

const pptxFixture = () => buildZip({
  'ppt/slides/slide1.xml': '<p:sld><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Slide one title</a:t></a:r></a:p><a:p><a:r><a:t>Bullet A</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
  'ppt/slides/slide2.xml': '<p:sld><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Slide two title</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
})

function pdfFixture(content, compressed = false) {
  const stream = Buffer.isBuffer(content) ? content : Buffer.from(content, 'latin1')
  const body = compressed ? deflateSync(stream) : stream
  const head = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n3 0 obj\n<< /Length ' + body.length + ' >>\nstream\n', 'latin1')
  const tail = Buffer.from('\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n', 'latin1')
  return Buffer.concat([head, body, tail])
}

function pdfStreamsFixture(streams) {
  return Buffer.from('%PDF-1.4\n' + streams.map((text, index) => `${index + 1} 0 obj\n<< /Length ${text.length} >>\nstream\n${text}\nendstream\nendobj`).join('\n') + '\n%%EOF', 'latin1')
}

test('document extension registry covers the supported formats', () => {
  for (const extension of ['.md', '.txt', '.csv', '.html', '.docx', '.xlsx', '.pptx', '.pdf', '.doc', '.xls', '.ppt']) {
    assert.equal(DOCUMENT_EXTENSIONS.has(extension), true, extension)
  }
})

test('ZIP reader reads stored OOXML entries', () => {
  const entries = readZipEntries(docxFixture())
  assert.ok(entries.has('word/document.xml'))
  assert.match(entries.get('word/document.xml').toString('utf8'), /Knowledge Center DOCX/)
})

test('ZIP reader inflates DEFLATE entries and skips unselected media', () => {
  const bytes = buildZip({ 'word/document.xml': '<w:p>Useful text</w:p>', 'word/media/image.bin': Buffer.alloc(1024) }, { compressed: true })
  const entries = readZipEntries(bytes, { filter: (name) => name === 'word/document.xml', maxEntryBytes: 64, maxTotalBytes: 64 })
  assert.equal(entries.size, 1)
  assert.equal(entries.get('word/document.xml').toString(), '<w:p>Useful text</w:p>')
  assert.equal(extractDocxText(bytes), 'Useful text')
})

test('ZIP decompression enforces individual and aggregate budgets', () => {
  assert.throws(() => readZipEntries(buildZip({ a: '123456789' }, { compressed: true }), { maxEntryBytes: 8 }), { code: 'DOCUMENT_EXTRACTION_LIMIT' })
  assert.throws(() => readZipEntries(buildZip({ a: '123456', b: '123456' }), { maxTotalBytes: 10 }), { code: 'DOCUMENT_EXTRACTION_LIMIT' })
})

test('ZIP inflation budget cannot be bypassed by forged uncompressed sizes', () => {
  const bytes = buildZip({ a: '123456789' }, { compressed: true, declaredSize: 1 })
  assert.throws(() => readZipEntries(bytes, { maxEntryBytes: 8 }), { code: 'DOCUMENT_EXTRACTION_LIMIT' })
})

test('ZIP reader rejects data extending past the archive', () => {
  const bytes = buildZip({ a: 'data' })
  const directoryOffset = bytes.readUInt32LE(bytes.length - 22 + 16)
  bytes.writeUInt32LE(bytes.length, directoryOffset + 20)
  assert.throws(() => readZipEntries(bytes), /Corrupt ZIP data/)
})

test('DOCX extraction keeps paragraphs and table cells', () => {
  const text = extractDocxText(docxFixture())
  assert.match(text, /Knowledge Center DOCX/)
  assert.match(text, /Second paragraph/)
  assert.match(text, /Cell A/)
  assert.match(text, /Cell B/)
})

test('XLSX extraction renders sheet rows with shared strings and numbers', () => {
  const text = extractXlsxText(xlsxFixture())
  assert.match(text, /## Sheet: People/)
  assert.match(text, /Name\tAlice/)
  assert.match(text, /Role\t42/)
})

test('XLSX extraction preserves omitted columns and multi-letter coordinates', () => {
  const bytes = buildZip({ 'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>商品</t></is></c><c r="B1" t="inlineStr"><is><t>预算</t></is></c><c r="C1" t="inlineStr"><is><t>实际</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>台灯</t></is></c><c r="C2"><v>100</v></c></row><row r="3"><c r="AA3"><v>27</v></c></row></sheetData></worksheet>' })
  const text = extractXlsxText(bytes)
  assert.match(text, /商品\t预算\t实际\n台灯\t\t100\n/)
  assert.equal(text.split('\n').at(-1), `${'\t'.repeat(26)}27`)
})

test('XLSX extraction counts self-closing cells and supports absent coordinates', () => {
  const bytes = buildZip({ 'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row><c t="inlineStr"><is><t>A</t></is></c><c/><c><v>3</v></c></row></sheetData></worksheet>' })
  assert.match(extractXlsxText(bytes), /A\t\t3$/)
})

test('XLSX rejects invalid or oversized cell coordinates before allocating columns', () => {
  for (const reference of ['XFE1', 'ZZZZZZZZZZZZZZZZZZZZ1', 'A0']) {
    const bytes = buildZip({ 'xl/worksheets/sheet1.xml': `<worksheet><sheetData><row><c r="${reference}"><v>1</v></c></row></sheetData></worksheet>` })
    assert.throws(() => extractXlsxText(bytes), /XLSX (cell reference|column)/)
  }
})

test('PPTX extraction emits one section per slide in order', () => {
  const text = extractPptxText(pptxFixture())
  assert.match(text, /## Slide 1[\s\S]*Slide one title[\s\S]*Bullet A/)
  assert.match(text, /## Slide 2[\s\S]*Slide two title/)
  assert.ok(text.indexOf('Slide one title') < text.indexOf('Slide two title'))
})

test('PPTX follows presentation order, numbers display positions and omits orphan slides', () => {
  const bytes = buildZip({
    'ppt/presentation.xml': '<p:presentation><p:sldIdLst><p:sldId id="2" r:id="second"/><p:sldId id="1" r:id="first"/></p:sldIdLst></p:presentation>',
    'ppt/_rels/presentation.xml.rels': '<Relationships><Relationship Id="first" Target="/ppt/slides/slide1.xml"/><Relationship Id="second" Target="slides/../slides/slide2.xml"/></Relationships>',
    'ppt/slides/slide1.xml': '<p:sld><a:p><a:r><a:t>Now second</a:t></a:r></a:p></p:sld>',
    'ppt/slides/slide2.xml': '<p:sld><a:p><a:r><a:t>Now first</a:t></a:r></a:p></p:sld>',
    'ppt/slides/slide3.xml': '<p:sld><a:p><a:r><a:t>Orphaned content</a:t></a:r></a:p></p:sld>',
  })
  const text = extractPptxText(bytes)
  assert.equal(text, '## Slide 1\nNow first\n\n## Slide 2\nNow second')
  assert.doesNotMatch(text, /Orphaned/)
})

test('PPTX does not silently guess the order when a declared slide is missing', () => {
  const bytes = buildZip({
    'ppt/presentation.xml': '<p:presentation><p:sldIdLst><p:sldId r:id="missing"/></p:sldIdLst></p:presentation>',
    'ppt/slides/slide1.xml': '<a:p><a:t>Unreferenced</a:t></a:p>',
  })
  assert.throws(() => extractPptxText(bytes), /references a missing or unsupported slide/)
})

test('HTML extraction drops scripts and styles and decodes entities', () => {
  const text = extractHtmlText('<html><head><style>.a{color:red}</style></head><body><h1>Release notes</h1><p>Hello &amp; welcome</p><script>bad()</script></body></html>')
  assert.match(text, /Release notes/)
  assert.match(text, /Hello & welcome/)
  assert.doesNotMatch(text, /bad\(\)/)
  assert.doesNotMatch(text, /color:red/)
})

test('structured extractor dispatches by extension', () => {
  assert.match(extractStructuredDocumentText({ extension: '.docx', bytes: docxFixture() }), /Knowledge Center DOCX/)
  assert.match(extractStructuredDocumentText({ extension: '.xlsx', bytes: xlsxFixture() }), /Alice/)
  assert.match(extractStructuredDocumentText({ extension: '.pptx', bytes: pptxFixture() }), /Slide one title/)
  assert.throws(() => extractStructuredDocumentText({ extension: '.zip', bytes: Buffer.alloc(0) }), /Unsupported/)
})

test('PDF fallback extracts text from an uncompressed content stream', () => {
  const pdf = pdfFixture('BT /F1 12 Tf 72 720 Td (Hello PDF knowledge) Tj ET')
  assert.match(extractPdfTextFallback(pdf), /Hello PDF knowledge/)
})

test('PDF fallback inflates Flate-compressed content streams', () => {
  const pdf = pdfFixture('BT /F1 12 Tf (Compressed knowledge text) Tj ET', true)
  assert.match(extractPdfTextFallback(pdf), /Compressed knowledge text/)
})

test('PDF fallback decodes UTF-16BE bfchar targets including surrogate pairs and literal CID codes', () => {
  const cmap = '2 beginbfchar\n<0001> <4E2D>\n<0002> <D83DDE00>\nendbfchar'
  assert.equal(extractPdfTextFallback(pdfStreamsFixture([cmap, 'BT /F1 12 Tf <00010002> Tj ET'])), '中😀')
  assert.equal(extractPdfTextFallback(pdfStreamsFixture([cmap, String.raw`BT /F1 12 Tf (\000\001\000\002) Tj ET`])), '中😀')
})

test('PDF fallback decodes scalar and array bfrange targets', () => {
  const cmap = '2 beginbfrange\n<01> <03> <4E2D>\n<04> <05> [<6587> <5B57>]\nendbfrange'
  assert.equal(extractPdfTextFallback(pdfStreamsFixture([cmap, 'BT /F1 12 Tf <0102030405> Tj ET'])), '中丮丯文字')
})

test('PDF fallback keeps ASCII hex text and decodes only explicit Unicode BOMs without a CMap', () => {
  const bytes = pdfFixture('BT /F1 12 Tf <48656C6C6F21> Tj <FEFF4E2D6587> Tj <FFFE2D4E8765> Tj ET')
  assert.equal(extractPdfTextFallback(bytes), 'Hello!中文中文')
})

test('PDF TJ arrays decode mixed hex and balanced literal strings without treating brackets as array ends', () => {
  const bytes = pdfFixture(String.raw`BT /F1 12 Tf [(Hello ) -30 <776F726C64> 10 ( \(nested (text)\) [ok])] TJ ET`)
  assert.equal(extractPdfTextFallback(bytes), 'Hello world (nested (text)) [ok]')
  assert.equal(extractPdfTextFallback(pdfFixture('BT /F1 12 Tf [<48656C6C6F>] TJ ET')), 'Hello')
})

test('PDF fallback recognizes double-quote text operators and CRLF continuations', () => {
  assert.equal(extractPdfTextFallback(pdfFixture('BT /F1 12 Tf 0 0 (Only double quote) " ET')), 'Only double quote')
  assert.equal(extractPdfTextFallback(pdfFixture('BT /F1 12 Tf (Hello\\\r\nWorld) Tj ET')), 'HelloWorld')
})

test('PDF fallback reports conflicting font mappings instead of silently substituting characters', () => {
  const bytes = pdfStreamsFixture(['1 beginbfchar\n<01> <4E2D>\nendbfchar', '1 beginbfchar\n<01> <6587>\nendbfchar', 'BT /F1 12 Tf <01> Tj ET'])
  assert.throws(() => extractPdfTextFallback(bytes), /conflicting font character maps/)
})

test('PDF stream inflation and raw streams enforce individual and aggregate budgets', () => {
  const content = 'BT /F1 12 Tf (Some text for the extraction budget) Tj ET'
  assert.throws(() => extractPdfTextFallback(pdfFixture(content, true), { maxEntryBytes: 20 }), { code: 'DOCUMENT_EXTRACTION_LIMIT' })
  assert.throws(() => extractPdfTextFallback(pdfFixture(content), { maxEntryBytes: 20 }), { code: 'DOCUMENT_EXTRACTION_LIMIT' })
  assert.throws(() => extractPdfTextFallback(pdfStreamsFixture([content, content]), { maxTotalBytes: 80 }), { code: 'DOCUMENT_EXTRACTION_LIMIT' })
})

test('PDF extraction preserves cancellation and does not run fallback after an aborted resolver', async () => {
  const bytes = pdfFixture('BT (Fallback must not succeed) Tj ET')
  const controller = new AbortController()
  controller.abort(new Error('Cancelled by user'))
  assert.throws(() => extractPdfTextFallback(bytes, { signal: controller.signal }), /Cancelled by user/)
  await assert.rejects(extractPdfText(bytes, { signal: controller.signal }), /Cancelled by user/)
  const abortError = new DOMException('Resolver cancelled', 'AbortError')
  await assert.rejects(extractPdfText(bytes, { resolveExecutable: async () => { throw abortError } }), (error) => error === abortError)
  const limitError = Object.assign(new Error('Resolver resource limit'), { code: 'DOCUMENT_EXTRACTION_LIMIT' })
  await assert.rejects(extractPdfText(bytes, { resolveExecutable: async () => { throw limitError } }), (error) => error === limitError)
})

test('PDF fallback rejects oversized character-map ranges before expanding them', () => {
  const bytes = pdfStreamsFixture(['1 beginbfrange\n<00000000> <FFFFFFFF> <0000>\nendbfrange', 'BT <01> Tj ET'])
  assert.throws(() => extractPdfTextFallback(bytes), { code: 'DOCUMENT_EXTRACTION_LIMIT' })
})
