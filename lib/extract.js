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
import { join, posix } from 'node:path'
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
const MAX_DECOMPRESSED_ENTRY_BYTES = 16 * 1024 * 1024
const MAX_DECOMPRESSED_TOTAL_BYTES = 64 * 1024 * 1024

function extractionLimit(message) {
  const error = new Error(message)
  error.code = 'DOCUMENT_EXTRACTION_LIMIT'
  return error
}

function extractionBudgets(options = {}) {
  const bounded = (value, fallback) => Number.isSafeInteger(value) && value > 0 ? Math.min(value, fallback) : fallback
  return {
    perEntry: bounded(options.maxEntryBytes, MAX_DECOMPRESSED_ENTRY_BYTES),
    total: bounded(options.maxTotalBytes, MAX_DECOMPRESSED_TOTAL_BYTES),
  }
}

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

function collectTagText(xml, tag) {
  const parts = []
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g')
  for (const match of xml.matchAll(pattern)) parts.push(decodeXmlEntities(match[1].replace(/<[^>]+>/g, '')))
  return parts.join('')
}

function xmlAttribute(tag, name) {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`).exec(tag)
  return match === null ? undefined : decodeXmlEntities(match[2])
}

function relationshipTargets(xml, directory) {
  const targets = new Map()
  for (const match of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = xmlAttribute(match[0], 'Id')
    const target = xmlAttribute(match[0], 'Target')
    if (id === undefined || target === undefined || xmlAttribute(match[0], 'TargetMode') === 'External') continue
    const path = target.startsWith('/') ? target.slice(1) : posix.join(directory, target)
    targets.set(id, posix.normalize(path))
  }
  return targets
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
 * Read selected file entries from a ZIP container with bounded decompression.
 * @param {Uint8Array} bytes - complete archive bytes.
 * @param {{filter?: (name: string) => boolean, maxEntryBytes?: number, maxTotalBytes?: number}} options
 * @returns {Map<string, Buffer>} entry name → uncompressed bytes.
 */
export function readZipEntries(bytes, options = {}) {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const budgets = extractionBudgets(options)
  const requireRange = (offset, length, label) => {
    if (offset < 0 || length < 0 || offset + length > buffer.length) throw new Error(`Corrupt ZIP ${label}.`)
  }
  const eocd = findEndOfCentralDirectory(buffer)
  const count = buffer.readUInt16LE(eocd + 10)
  const directorySize = buffer.readUInt32LE(eocd + 12)
  const directoryOffset = buffer.readUInt32LE(eocd + 16)
  if (count === 0xffff || directoryOffset === 0xffffffff) {
    throw new Error('ZIP64 containers are not supported for document extraction.')
  }
  requireRange(directoryOffset, directorySize, 'central directory')
  if (directoryOffset + directorySize > eocd) throw new Error('Corrupt ZIP central directory.')
  const entries = new Map()
  let offset = directoryOffset
  let totalBytes = 0
  for (let index = 0; index < count; index++) {
    requireRange(offset, 46, 'central directory header')
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('Corrupt ZIP central directory.')
    const flags = buffer.readUInt16LE(offset + 8)
    const method = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const uncompressedSize = buffer.readUInt32LE(offset + 24)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localOffset = buffer.readUInt32LE(offset + 42)
    requireRange(offset + 46, nameLength + extraLength + commentLength, 'central directory entry')
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength)
    offset += 46 + nameLength + extraLength + commentLength
    if (offset > directoryOffset + directorySize) throw new Error('Corrupt ZIP central directory size.')
    if (name.endsWith('/') || (options.filter !== undefined && !options.filter(name))) continue
    if (flags & 1) throw new Error(`Encrypted ZIP entry is not supported: ${name}.`)
    if (uncompressedSize === 0xffffffff) throw new Error('ZIP64 containers are not supported for document extraction.')
    const remaining = Math.min(budgets.perEntry, budgets.total - totalBytes)
    if (uncompressedSize > remaining) throw extractionLimit(`ZIP decompression budget exceeded for ${name}.`)
    requireRange(localOffset, 30, 'local header')
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`Corrupt ZIP local header for ${name}.`)
    const localNameLength = buffer.readUInt16LE(localOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    requireRange(dataStart, compressedSize, `data for ${name}`)
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize)
    let content
    if (method === 0) content = compressed
    else if (method === 8) {
      try {
        content = inflateRawSync(compressed, { maxOutputLength: Math.max(1, remaining) })
      } catch (error) {
        if (error.code === 'ERR_BUFFER_TOO_LARGE') throw extractionLimit(`ZIP decompression budget exceeded for ${name}.`)
        throw error
      }
    }
    else throw new Error(`Unsupported ZIP compression method ${method} for ${name}.`)
    if (content.length > remaining) throw extractionLimit(`ZIP decompression budget exceeded for ${name}.`)
    if (content.length !== uncompressedSize) throw new Error(`Corrupt ZIP uncompressed size for ${name}.`)
    totalBytes += content.length
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
  const entries = readZipEntries(bytes, { filter: (name) => name === 'word/document.xml' })
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
  const targets = relationshipTargets(relationships, 'xl')
  const sheets = []
  for (const match of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const name = xmlAttribute(match[0], 'name')
    const relationshipId = xmlAttribute(match[0], 'r:id')
    const target = relationshipId === undefined ? undefined : targets.get(relationshipId)
    if (name === undefined || target === undefined) continue
    sheets.push({ name, path: target })
  }
  return sheets
}

function sheetRows(xml, shared) {
  const rows = []
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = []
    let nextColumn = 0
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributes = cellMatch[1]
      const inner = cellMatch[2] ?? ''
      const reference = xmlAttribute(attributes, 'r')
      let column = nextColumn
      if (reference !== undefined) {
        const letters = /^([A-Z]+)[1-9]\d*$/i.exec(reference)?.[1]
        if (letters === undefined) throw new Error(`Invalid XLSX cell reference: ${reference}.`)
        column = 0
        for (const letter of letters.toUpperCase()) column = column * 26 + letter.charCodeAt(0) - 64
        column--
      }
      if (column >= 16_384) throw new Error(`XLSX column exceeds the XFD limit: ${reference ?? column + 1}.`)
      nextColumn = column + 1
      const type = xmlAttribute(attributes, 't')
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
      cells[column] = value.replace(/\s+/g, ' ').trim()
    }
    const line = cells.join('\t').replace(/\t+$/, '')
    if (line.trim().length > 0) rows.push(line)
  }
  return rows
}

/** Extract text from an XLSX (SpreadsheetML) container, one line per row. */
export function extractXlsxText(bytes) {
  const entries = readZipEntries(bytes, {
    filter: (name) => name === 'xl/sharedStrings.xml' || name === 'xl/workbook.xml'
      || name === 'xl/_rels/workbook.xml.rels' || /^xl\/worksheets\/[^/]+\.xml$/.test(name),
  })
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

function presentationSlides(entries) {
  const presentation = entryText(entries, 'ppt/presentation.xml')
  if (presentation === undefined) {
    return [...entries.keys()]
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((left, right) => slideNumber(left) - slideNumber(right))
  }
  const targets = relationshipTargets(entryText(entries, 'ppt/_rels/presentation.xml.rels') ?? '', 'ppt')
  const slides = []
  for (const match of presentation.matchAll(/<p:sldId\b[^>]*>/g)) {
    const relationshipId = xmlAttribute(match[0], 'r:id')
    const target = targets.get(relationshipId)
    if (target === undefined || !/^ppt\/slides\/[^/]+\.xml$/.test(target) || !entries.has(target)) {
      throw new Error(`PPTX presentation references a missing or unsupported slide: ${relationshipId ?? '(no relationship)'}.`)
    }
    slides.push(target)
  }
  return slides
}

/** Extract text from a PPTX (PresentationML) container, one section per slide. */
export function extractPptxText(bytes) {
  const entries = readZipEntries(bytes, {
    filter: (name) => name === 'ppt/presentation.xml' || name === 'ppt/_rels/presentation.xml.rels'
      || /^ppt\/slides\/[^/]+\.xml$/.test(name),
  })
  const slides = presentationSlides(entries)
  if (slides.length === 0) throw new Error('PPTX container has no slides.')
  const sections = []
  for (const [index, name] of slides.entries()) {
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
    if (text.length > 0) sections.push(`## Slide ${index + 1}\n${text}`)
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
    } else if (escaped === '\r') {
      if (body[index + 1] === '\n') index++
    } else {
      result += escaped
    }
  }
  return result
}

function pdfHexBytes(hexText) {
  const cleaned = hexText.replace(/\s+/g, '')
  return Buffer.from(cleaned.length % 2 === 0 ? cleaned : cleaned + '0', 'hex')
}

function decodePdfBytes(bytes, cmap) {
  if (cmap !== undefined && cmap.mappings.size > 0) {
    let result = ''
    for (let position = 0; position < bytes.length;) {
      let matched = false
      for (const width of cmap.widths) {
        if (position + width > bytes.length) continue
        const mapped = cmap.mappings.get(bytes.subarray(position, position + width).toString('hex'))
        if (mapped === undefined) continue
        result += mapped
        position += width
        matched = true
        break
      }
      if (!matched) result += String.fromCharCode(bytes[position++])
      if (result.length >= MAX_EXTRACTED_CHARS) return result.slice(0, MAX_EXTRACTED_CHARS)
    }
    return result
  }
  // A hex operand is encoded text for its font, not implicitly UTF-16.
  // Only an explicit Unicode BOM permits decoding without a ToUnicode map.
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes)
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes)
  return bytes.toString('latin1')
}

function addCmapMapping(cmap, source, destination) {
  const key = pdfHexBytes(source).toString('hex')
  if (key.length > 8) throw new Error('PDF fallback supports character codes of at most four bytes.')
  const value = new TextDecoder('utf-16be', { fatal: true }).decode(pdfHexBytes(destination))
  const existing = cmap.mappings.get(key)
  if (existing !== undefined && existing !== value) {
    throw new Error('PDF fallback cannot decode conflicting font character maps; use pdftotext.')
  }
  if (existing === undefined && cmap.mappings.size >= 65_536) throw extractionLimit('PDF character-map budget exceeded.')
  cmap.mappings.set(key, value)
  const width = key.length / 2
  if (!cmap.widths.includes(width)) cmap.widths.push(width)
  cmap.widths.sort((left, right) => right - left)
}

function parseToUnicodeCMap(text, cmap) {
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      addCmapMapping(cmap, pair[1], pair[2])
    }
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const range of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<([0-9a-fA-F]+)>|\[([\s\S]*?)\])/g)) {
      const from = Number.parseInt(range[1], 16)
      const to = Number.parseInt(range[2], 16)
      if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || to < from) continue
      if (to - from >= 65_536) throw extractionLimit('PDF character-map range exceeds the extraction budget.')
      const destinations = range[5] === undefined ? undefined : [...range[5].matchAll(/<([0-9a-fA-F]+)>/g)].map((match) => match[1])
      const base = destinations === undefined ? pdfHexBytes(range[4]) : undefined
      for (let code = from; code <= to; code++) {
        const position = code - from
        let destination = destinations?.[position]
        if (destinations !== undefined && destination === undefined) break
        if (base !== undefined) {
          const value = Buffer.from(base)
          let carry = position
          for (let index = value.length - 1; index >= 0 && carry > 0; index--) {
            const sum = value[index] + (carry % 256)
            value[index] = sum % 256
            carry = Math.floor(carry / 256) + Math.floor(sum / 256)
          }
          if (carry > 0) throw new Error('Invalid PDF character-map range.')
          destination = value.toString('hex')
        }
        addCmapMapping(cmap, code.toString(16).padStart(range[1].length, '0'), destination)
      }
    }
  }
}

/** Read one balanced literal or hex operand without interpreting its contents as operators. */
function readPdfString(content, start, cmap) {
  if (content[start] === '(') {
    let depth = 1
    let body = ''
    let index = start + 1
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
    return { value: decodePdfBytes(Buffer.from(decodePdfLiteral(body), 'latin1'), cmap), end: index + 1 }
  }
  if (content[start] === '<' && content[start + 1] !== '<') {
    const end = content.indexOf('>', start + 1)
    if (end === -1) return undefined
    return { value: decodePdfBytes(pdfHexBytes(content.slice(start + 1, end)), cmap), end: end + 1 }
  }
  return undefined
}

function readPdfTextArray(content, start, cmap) {
  let text = ''
  let index = start + 1
  while (index < content.length) {
    if (content[index] === ']') return { value: text, end: index + 1 }
    if (content[index] === '%') {
      while (index < content.length && content[index] !== '\n') index++
      continue
    }
    const operand = readPdfString(content, index, cmap)
    if (operand !== undefined) {
      if (text.length < MAX_EXTRACTED_CHARS) text += operand.value.slice(0, MAX_EXTRACTED_CHARS - text.length)
      index = operand.end
    } else {
      // TJ numbers specify glyph positioning and are not part of the text.
      index++
    }
  }
  return { value: text, end: index }
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
    const string = readPdfString(content, index, cmap)
    if (string !== undefined) {
      operands.push(string.value)
      index = string.end
      continue
    }
    if (character === '<' && content[index + 1] === '<') {
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
      const array = readPdfTextArray(content, index, cmap)
      operands.push({ text: array.value })
      index = array.end
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
      const operand = operands.at(-1)
      if (token === "'" || token === '"') output += '\n'
      if (token === 'TJ' && typeof operand === 'object') output += operand.text
      else if (typeof operand === 'string') output += operand
      if (output.length >= MAX_EXTRACTED_CHARS) return output.slice(0, MAX_EXTRACTED_CHARS)
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
export function extractPdfTextFallback(bytes, options = {}) {
  options.signal?.throwIfAborted()
  const budgets = extractionBudgets(options)
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
  let totalBytes = 0
  for (const raw of streams) {
    options.signal?.throwIfAborted()
    const remaining = Math.min(budgets.perEntry, budgets.total - totalBytes)
    let data
    try {
      data = inflateSync(raw, { maxOutputLength: Math.max(1, remaining) })
    } catch (error) {
      if (error.code === 'ERR_BUFFER_TOO_LARGE') throw extractionLimit('PDF stream decompression budget exceeded.')
      try {
        data = inflateRawSync(raw, { maxOutputLength: Math.max(1, remaining) })
      } catch (rawError) {
        if (rawError.code === 'ERR_BUFFER_TOO_LARGE') throw extractionLimit('PDF stream decompression budget exceeded.')
        data = raw
      }
    }
    if (data.length > remaining) throw extractionLimit('PDF stream decompression budget exceeded.')
    totalBytes += data.length
    decoded.push(data)
  }
  const cmap = { mappings: new Map(), widths: [] }
  for (const data of decoded) {
    options.signal?.throwIfAborted()
    const text = data.toString('latin1')
    if (text.includes('beginbfchar') || text.includes('beginbfrange')) parseToUnicodeCMap(text, cmap)
  }
  const chunks = []
  for (const data of decoded) {
    options.signal?.throwIfAborted()
    const text = data.toString('latin1')
    if (!text.includes('BT')) continue
    if (!text.includes('Tj') && !text.includes('TJ') && !text.includes("'") && !text.includes('"')) continue
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
  signal?.throwIfAborted()
  let executable
  if (typeof resolveExecutable === 'function') {
    try {
      executable = await resolveExecutable('pdftotext')
    } catch (error) {
      signal?.throwIfAborted()
      if (error?.name === 'AbortError' || error?.code === 'ABORT_ERR' || error?.code === 'DOCUMENT_EXTRACTION_LIMIT') throw error
      executable = undefined
    }
  }
  signal?.throwIfAborted()
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
    } catch (error) {
      signal?.throwIfAborted()
      if (error?.name === 'AbortError' || error?.code === 'ABORT_ERR' || error?.code === 'DOCUMENT_EXTRACTION_LIMIT') throw error
      if (error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') throw extractionLimit('PDF text output budget exceeded.')
      // fall through to the built-in parser
    } finally {
      if (directory !== undefined && existsSync(directory)) {
        await fsp.rm(directory, { recursive: true, force: true }).catch(() => undefined)
      }
    }
  }
  return extractPdfTextFallback(bytes, options)
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
