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
import { deflateSync } from 'node:zlib'
import {
  DOCUMENT_EXTENSIONS,
  extractDocxText,
  extractHtmlText,
  extractPdfTextFallback,
  extractPptxText,
  extractStructuredDocumentText,
  extractXlsxText,
  readZipEntries,
} from '../lib/extract.js'

/** Build a minimal stored-entry ZIP archive (enough for our reader). */
function buildZip(files) {
  const localParts = []
  const centralParts = []
  let offset = 0
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content)
    const nameBytes = Buffer.from(name, 'utf8')
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 10)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    localParts.push(local, nameBytes, data)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 10)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE(offset, 42)
    centralParts.push(central, nameBytes)
    offset += local.length + nameBytes.length + data.length
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

test('document extension registry covers the supported formats', () => {
  for (const extension of ['.md', '.txt', '.csv', '.html', '.docx', '.xlsx', '.pptx', '.pdf', '.doc', '.xls', '.ppt']) {
    assert.equal(DOCUMENT_EXTENSIONS.has(extension), true, extension)
  }
})

test('ZIP reader inflates stored OOXML entries', () => {
  const entries = readZipEntries(docxFixture())
  assert.ok(entries.has('word/document.xml'))
  assert.match(entries.get('word/document.xml').toString('utf8'), /Knowledge Center DOCX/)
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

test('PPTX extraction emits one section per slide in order', () => {
  const text = extractPptxText(pptxFixture())
  assert.match(text, /## Slide 1[\s\S]*Slide one title[\s\S]*Bullet A/)
  assert.match(text, /## Slide 2[\s\S]*Slide two title/)
  assert.ok(text.indexOf('Slide one title') < text.indexOf('Slide two title'))
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
