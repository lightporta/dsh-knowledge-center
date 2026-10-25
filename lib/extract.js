/**
 * Document text extraction for the Knowledge Center Host half.
 *
 * Distillation consumes plain text, so binary workspace documents are reduced
 * to text before they enter the LLM pipeline:
 *
 * - Markdown / TXT / RST / CSV / JSON / HTML are read as UTF-8 text.
 * - DOCX / XLSX / PPTX are OOXML ZIP containers: entries are inflated with
 *   Node's built-in zlib and the XML text runs are decoded (no dependency).
 * - PDF text is extracted by an optional `pdftotext` binary when one is
 *   resolvable (best quality, cross-platform when poppler is installed) and by
 *   a small built-in fallback parser otherwise.
 * - Legacy DOC / XLS / PPT are converted to PDF by the Harness LibreOffice
 *   service and then go through the PDF pipeline.
 *
 * Every function returns plain text and never writes to the workspace.
 */
import { promises as fsp } from 'node:fs'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { inflateRawSync, inflateSync } from 'node:zlib'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.mdx', '.txt', '.rst', '.csv', '.json', '.html', '.htm', '.xml', '.log'])
export const OOXML_EXTENSIONS = new Set(['.docx', '.xlsx', '.pptx'])
export const PDF_EXTENSIONS = new Set(['.pdf'])
export const LEGACY_OFFICE_EXTENSIONS = new Set(['.doc', '.xls', '.ppt'])
export const DOCUMENT_EXTENSIONS = new Set([
  ...TEXT_EXTENSIONS,
  ...OOXML_EXTENSIONS,
  ...PDF_EXTENSIONS,
  ...LEGACY_OFFICE_EXTENSIONS,
])

/** Maximum extracted characters handed to the distillation pipeline. */
export const MAX_EXTRACTED_CHARS = 400_000

// ────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ────────────────────────────────────────────────────────────────────────────

function ensureText(text, sourceLabel) {
  const cleaned = String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\u0000/g, '')
    .trim()
  if (cleaned.length === 0) {
    throw new Error(`No extractable text found in ${sourceLabel}.`)
  }
  return cleaned.length > MAX_EXTRACTED_CHARS ? cleaned.slice(0, MAX_EXTRACTED_CHARS) : cleaned
}

function decodeXmlEntities(text) {
  return String(text).replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (match, code) => {
    if (code === 'amp') return '&'
    if (code === 'lt') return '<'
    if (code === 'gt') return '>'
    if (code === 'quot') return '"'
    if (code === 'apos') return "'"
    try {
      if (code[1] === 'x' || code[1] === 'X') return String.fromCodePoint(Number.parseInt(code.slice(2), 16))
      return String.fromCodePoint(Number.parseInt(code.slice(1), 10))
    } catch {
      return match
    }
  })
}

function xmlToText(xml) {
  return ensureText(decodeXmlEntities(String(xml).replace(/<[^>]+>/g, '')), 'document XML')
}

function collectTagText(xml, tag) {
  const parts = []
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g')
  for (const match of xml.matchAll(pattern)) parts.push(decodeXmlEntities(match[1].replace(/<[^>]+>/g, '')))
  return parts.join('')
}

// ────────────────────────────────────────────────────────────────────────────
// ZIP / OOXML
// ────────────────────────────────────────────────────────────────────────────

function findEndOfCentralDirectory(buffer) {
  const minimum = Math.max(0, buffer.length - 65_557)
  for (let offset = buffer.length - 22; offset >= minimum; offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset
  }
  throw new Error('Not a ZIP container (missing end-of-central-directory record).')
}

/**
 * Read every file entry from a ZIP container.
 * @param {Uint8Array} bytes - complete archive bytes.
 * @returns {Map<string, Buffer>} entry name → uncompressed bytes.
 */
export function readZipEntries(bytes) {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const eocd = findEndOfCentralDirectory(buffer)
  const count = buffer.readUInt16LE(eocd + 10)
  const directoryOffset = buffer.readUInt32LE(eocd + 16)
  if (count === 0xffff || directoryOffset === 0xffffffff) {
    throw new Error('ZIP64 containers are not supported for document extraction.')
  }
  const entries = new Map()
  let offset = directoryOffset
  for (let index = 0; index < count; index++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('Corrupt ZIP central directory.')
    const method = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localOffset = buffer.readUInt32LE(offset + 42)
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength)
    offset += 46 + nameLength + extraLength + commentLength
    if (name.endsWith('/')) continue
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`Corrupt ZIP local header for ${name}.`)
    const localNameLength = buffer.readUInt16LE(localOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize)
    let content
    if (method === 0) content = compressed
    else if (method === 8) content = inflateRawSync(compressed)
    else throw new Error(`Unsupported ZIP compression method ${method} for ${name}.`)
    entries.set(name, content)
  }
  return entries
}

function entryText(entries, name) {
  const content = entries.get(name)
  return content === undefined ? undefined : content.toString('utf8')
}

/** Extract text from a DOCX (WordprocessingML) container. */
export function extractDocxText(bytes) {
  const entries = readZipEntries(bytes)
  const xml = entryText(entries, 'word/document.xml')
  if (xml === undefined) throw new Error('DOCX container is missing word/document.xml.')
  const withBreaks = xml
    .replace(/<w:tab\b[^>]*\/>/g, '\t')
    .replace(/<w:br\b[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<\/w:tr>/g, '\n')
    .replace(/<\/w:tc>/g, '\t')
  return ensureText(decodeXmlEntities(withBreaks.replace(/<[^>]+>/g, '')), 'DOCX document')
}

function sharedStrings(entries) {
  const xml = entryText(entries, 'xl/sharedStrings.xml')
  if (xml === undefined) return []
  const values = []
  for (const match of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) values.push(collectTagText(match[1], 't'))
  return values
}

function workbookSheets(entries) {
  const workbook = entryText(entries, 'xl/workbook.xml') ?? ''
  const relationships = entryText(entries, 'xl/_rels/workbook.xml.rels') ?? ''
  const targets = new Map()
  for (const match of relationships.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(match[0])?.[1]
    const target = /\bTarget="([^"]+)"/.exec(match[0])?.[1]
    if (id !== undefined && target !== undefined) targets.set(id, target)
  }
  const sheets = []
  for (const match of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const name = /\bname="([^"]*)"/.exec(match[0])?.[1]
    const relationshipId = /\br:id="([^"]+)"/.exec(match[0])?.[1]
    const target = relationshipId === undefined ? undefined : targets.get(relationshipId)
    if (name === undefined || target === undefined) continue
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`
    sheets.push({ name: decodeXmlEntities(name), path: path.replace(/\/{2,}/g, '/') })
  }
  return sheets
}

function sheetRows(xml, shared) {
  const rows = []
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = []
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attributes = cellMatch[1]
      const inner = cellMatch[2]
      const type = /\bt="([^"]+)"/.exec(attributes)?.[1]
      const rawValue = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1]
      let value = ''
      if (type === 's') {
        const position = Number(rawValue)
        value = Number.isInteger(position) ? shared[position] ?? '' : ''
      } else if (type === 'inlineStr') {
        value = collectTagText(inner, 't')
      } else if (type === 'b') {
        value = rawValue === '1' ? 'TRUE' : 'FALSE'
      } else if (type === 'e') {
        value = decodeXmlEntities(rawValue ?? '')
      } else if (rawValue !== undefined) {
        value = decodeXmlEntities(rawValue)
      }
      cells.push(value.replace(/\s+/g, ' ').trim())
    }
    const line = cells.join('\t').replace(/\t+$/, '')
    if (line.trim().length > 0) rows.push(line)
  }
  return rows
}

/** Extract text from an XLSX (SpreadsheetML) container, one line per row. */
export function extractXlsxText(bytes) {
  const entries = readZipEntries(bytes)
  const shared = sharedStrings(entries)
  const sheets = workbookSheets(entries)
  const fallbackSheets = [...entries.keys()]
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort()
  const selected = sheets.length > 0 ? sheets : fallbackSheets.map((path) => ({ name: path, path }))
  const sections = []
  for (const sheet of selected) {
    const xml = entryText(entries, sheet.path)
    if (xml === undefined) continue
    const rows = sheetRows(xml, shared)
    if (rows.length === 0) continue
    sections.push(`## Sheet: ${sheet.name}\n${rows.join('\n')}`)
  }
  return ensureText(sections.join('\n\n'), 'XLSX workbook')
}

function slideNumber(name) {
  return Number(/(\d+)\.xml$/.exec(name)?.[1] ?? 0)
}

/** Extract text from a PPTX (PresentationML) container, one section per slide. */
export function extractPptxText(bytes) {
  const entries = readZipEntries(bytes)
  const slides = [...entries.keys()]
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((left, right) => slideNumber(left) - slideNumber(right))
  if (slides.length === 0) throw new Error('PPTX container has no slides.')
  const sections = []
  for (const name of slides) {
    const xml = entryText(entries, name) ?? ''
    const withBreaks = xml
      .replace(/<a:br\b[^>]*\/>/g, '\n')
      .replace(/<\/a:p>/g, '\n')
      .replace(/<\/a:t>/g, '')
    const text = decodeXmlEntities(withBreaks.replace(/<[^>]+>/g, ' '))
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter((line) => line.length > 0)
      .join('\n')
    if (text.length > 0) sections.push(`## Slide ${slideNumber(name)}\n${text}`)
  }
  return ensureText(sections.join('\n\n'), 'PPTX presentation')
}

// ────────────────────────────────────────────────────────────────────────────
// HTML / markup
// ────────────────────────────────────────────────────────────────────────────

/** Reduce an HTML document to readable text. */
export function extractHtmlText(html) {
  const text = String(html)
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<head\b[\s\S]*?<\/head>/gi, ' ')
    .replace(/<\/(p|div|section|article|li|tr|h[1-6]|table|pre|blockquote)>/gi, '\n')
    .replace(/<(br|hr)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
  return ensureText(decodeXmlEntities(text), 'HTML document')
}

// ────────────────────────────────────────────────────────────────────────────
// PDF
// ────────────────────────────────────────────────────────────────────────────

/** Decode one PDF literal string body (without surrounding parentheses). */
function decodePdfLiteral(body) {
  let result = ''
  for (let index = 0; index < body.length; index++) {
    const character = body[index]
    if (character !== '\\') {
      result += character
      continue
    }
    index++
    const escaped = body[index]
    if (escaped === undefined) break
    if (escaped === 'n') result += '\n'
    else if (escaped === 'r') result += '\r'
    else if (escaped === 't') result += '\t'
    else if (escaped === 'b') result += '\b'
    else if (escaped === 'f') result += '\f'
    else if (escaped === '(' || escaped === ')' || escaped === '\\') result += escaped
    else if (escaped >= '0' && escaped <= '7') {
      let octal = escaped
      for (let extra = 0; extra < 2; extra++) {
        const next = body[index + 1]
        if (next === undefined || next < '0' || next > '7') break
        octal += next
        index++
      }
      result += String.fromCharCode(Number.parseInt(octal, 8))
    } else if (escaped === '\n') {
      // line continuation
    } else {
      result += escaped
    }
  }
  return result
}

function decodePdfHex(hexText, cmap) {
  const cleaned = hexText.replace(/\s+/g, '')
  const even = cleaned.length % 2 === 0 ? cleaned : `${cleaned}0`
  const bytes = Buffer.from(even, 'hex')
  if (cmap !== undefined && cmap.size > 0) {
    const codes = []
    let position = 0
    while (position < bytes.length) {
      const twoByte = position + 1 < bytes.length ? bytes.readUInt16BE(position) : undefined
      const oneByte = bytes[position]
      if (twoByte !== undefined && cmap.has(twoByte)) {
        codes.push(cmap.get(twoByte))
        position += 2
      } else if (cmap.has(oneByte)) {
        codes.push(cmap.get(oneByte))
        position += 1
      } else {
        position += 1
      }
    }
    if (codes.length > 0) return codes.join('')
  }
  // Heuristic: a UTF-16BE hex string usually has non-zero high bytes.
  if (bytes.length >= 2 && bytes.length % 2 === 0 && (bytes[0] !== 0 || bytes[1] === 0)) {
    try {
      return new TextDecoder('utf-16be').decode(bytes)
    } catch {
      return bytes.toString('latin1')
    }
  }
  return bytes.toString('latin1')
}

function decodePdfLiteralWithCmap(literal, cmap) {
  if (cmap === undefined || cmap.size === 0) return literal
  // Literal strings are usually single-byte codes; map each byte when present.
  let result = ''
  let found = false
  for (const character of literal) {
    const code = character.charCodeAt(0)
    if (cmap.has(code)) {
      result += cmap.get(code)
      found = true
    } else {
      result += character
    }
  }
  return found ? result : literal
}

function parseToUnicodeCMap(text, map) {
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      const code = Number.parseInt(pair[1], 16)
      const bytes = Buffer.from(pair[2].length % 2 === 0 ? pair[2] : `${pair[2]}0`, 'hex')
      map.set(code, bytes.toString('utf16le').replace(/\u0000/g, '') || new TextDecoder('utf-16be').decode(bytes))
    }
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const range of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      const from = Number.parseInt(range[1], 16)
      const to = Number.parseInt(range[2], 16)
      const base = Buffer.from(range[3].length % 2 === 0 ? range[3] : `${range[3]}0`, 'hex')
      for (let code = from; code <= to && code - from < 4096; code++) {
        const value = Buffer.from(base)
        value.writeUInt16BE(value.readUInt16BE(0) + (code - from), 0)
        map.set(code, value.toString('utf16le').replace(/\u0000/g, ''))
      }
    }
  }
}

/** Extract text from a PDF content stream with only text-showing operators. */
function contentStreamText(content, cmap) {
  let output = ''
  let operands = []
  let index = 0
  const whitespace = /\s/
  const delimiters = '()<>[]{}/%'
  while (index < content.length) {
    const character = content[index]
    if (whitespace.test(character)) {
      index++
      continue
    }
    if (character === '%') {
      while (index < content.length && content[index] !== '\n') index++
      continue
    }
    if (character === '(') {
      let depth = 1
      let body = ''
      index++
      while (index < content.length && depth > 0) {
        const current = content[index]
        if (current === '\\') {
          body += current + (content[index + 1] ?? '')
          index += 2
          continue
        }
        if (current === '(') depth++
        if (current === ')') {
          depth--
          if (depth === 0) break
        }
        body += current
        index++
      }
      index++
      operands.push(decodePdfLiteralWithCmap(decodePdfLiteral(body), cmap))
      continue
    }
    if (character === '<' && content[index + 1] !== '<') {
      const end = content.indexOf('>', index + 1)
      if (end === -1) break
      operands.push(decodePdfHex(content.slice(index + 1, end), cmap))
      index = end + 1
      continue
    }
    if (character === '<' && content[index + 1] === '<') {
      // Dictionary: skip balanced << >> pairs.
      let depth = 0
      while (index < content.length) {
        if (content[index] === '<' && content[index + 1] === '<') {
          depth++
          index += 2
          continue
        }
        if (content[index] === '>' && content[index + 1] === '>') {
          depth--
          index += 2
          if (depth <= 0) break
          continue
        }
        index++
      }
      continue
    }
    if (character === '[') {
      // Array operand: collect string members only.
      let depth = 1
      let body = ''
      index++
      while (index < content.length && depth > 0) {
        const current = content[index]
        if (current === '\\') {
          body += current + (content[index + 1] ?? '')
          index += 2
          continue
        }
        if (current === '[') depth++
        if (current === ']') {
          depth--
          if (depth === 0) break
        }
        body += current
        index++
      }
      index++
      operands.push(body)
      continue
    }
    if (delimiters.includes(character)) {
      index++
      continue
    }
    let token = ''
    while (index < content.length && !whitespace.test(content[index]) && !delimiters.includes(content[index])) {
      token += content[index]
      index++
    }
    if (token.length === 0) {
      index++
      continue
    }
    if (token === 'Tj' || token === 'TJ' || token === "'" || token === '"') {
      const operand = operands.length > 0 ? operands[operands.length - 1] : ''
      if (token === 'TJ' && typeof operand === 'string' && operand.includes('(')) {
        // Array body: decode its literal strings.
        const parts = []
        for (const match of operand.matchAll(/\(((?:\\.|[^\\()])*)\)/g)) parts.push(decodePdfLiteralWithCmap(decodePdfLiteral(match[1]), cmap))
        output += parts.join('')
      } else {
        output += String(operand ?? '')
      }
      if (token === "'" || token === '"') output += '\n'
      operands = []
      continue
    }
    if (token === 'Td' || token === 'TD' || token === 'T*' || token === 'ET' || token === 'BT') {
      output += token === 'BT' ? '\n' : ' '
      operands = []
      continue
    }
    if (/^[-+]?\d*\.?\d+$/.test(token)) operands.push(token)
    else operands = []
  }
  return output
}

/** Minimal PDF text extraction used when no pdftotext binary is available. */
export function extractPdfTextFallback(bytes) {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const latin = buffer.toString('latin1')
  const streams = []
  const streamPattern = /stream\r?\n/g
  let match
  while ((match = streamPattern.exec(latin)) !== null) {
    const start = match.index + match[0].length
    const end = latin.indexOf('endstream', start)
    if (end === -1) break
    streams.push(buffer.subarray(start, end))
    streamPattern.lastIndex = end + 'endstream'.length
  }
  const decoded = []
  for (const raw of streams) {
    try {
      decoded.push(inflateSync(raw))
    } catch {
      try {
        decoded.push(inflateRawSync(raw))
      } catch {
        decoded.push(raw)
      }
    }
  }
  const cmap = new Map()
  for (const data of decoded) {
    const text = data.toString('latin1')
    if (text.includes('beginbfchar') || text.includes('beginbfrange')) parseToUnicodeCMap(text, cmap)
  }
  const chunks = []
  for (const data of decoded) {
    const text = data.toString('latin1')
    if (!text.includes('BT')) continue
    if (!text.includes('Tj') && !text.includes('TJ') && !text.includes("'")) continue
    const extracted = contentStreamText(text, cmap)
    if (extracted.trim().length > 0) chunks.push(extracted)
  }
  const output = ensureText(chunks.join('\n'), 'PDF document')
  return output
}

/**
 * Extract PDF text, preferring `pdftotext` when the Host can resolve it.
 * @param {Uint8Array} bytes - complete PDF bytes.
 * @param {{signal?: AbortSignal, resolveExecutable?: (name: string) => Promise<string>}} options
 * @returns {Promise<string>} extracted text.
 */
export async function extractPdfText(bytes, options = {}) {
  const { signal, resolveExecutable } = options
  let executable
  if (typeof resolveExecutable === 'function') {
    try {
      executable = await resolveExecutable('pdftotext')
    } catch {
      executable = undefined
    }
  }
  if (executable !== undefined && executable !== '') {
    let directory
    try {
      directory = await fsp.mkdtemp(join(tmpdir(), 'dsh-knowledge-center-pdf-'))
      const file = join(directory, 'document.pdf')
      await fsp.writeFile(file, Buffer.from(bytes))
      const { stdout } = await execFileAsync(executable, ['-layout', '-enc', 'UTF-8', file, '-'], {
        maxBuffer: 32 * 1024 * 1024,
        signal,
      })
      const text = ensureText(stdout, 'PDF document')
      if (text.length > 0) return text
    } catch {
      // fall through to the built-in parser
    } finally {
      if (directory !== undefined && existsSync(directory)) {
        await fsp.rm(directory, { recursive: true, force: true }).catch(() => undefined)
      }
    }
  }
  return extractPdfTextFallback(bytes)
}

// ────────────────────────────────────────────────────────────────────────────
// Entry point
// ────────────────────────────────────────────────────────────────────────────

/**
 * Extract plain text from one supported binary/structured document.
 * PDF and legacy Office are handled by the Host integration, not here.
 * @param {{extension: string, bytes: Uint8Array}} input
 * @returns {string} extracted text.
 */
export function extractStructuredDocumentText({ extension, bytes }) {
  const ext = extension.toLowerCase()
  if (ext === '.docx') return extractDocxText(bytes)
  if (ext === '.xlsx') return extractXlsxText(bytes)
  if (ext === '.pptx') return extractPptxText(bytes)
  if (ext === '.html' || ext === '.htm') return extractHtmlText(Buffer.from(bytes).toString('utf8'))
  throw new Error(`Unsupported structured document extension: ${extension}`)
}
