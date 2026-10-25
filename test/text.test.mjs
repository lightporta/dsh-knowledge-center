/**
 * Tests for the distillation chunking budget.
 *
 * Run with: node --test
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { chunkText } from '../lib/text.js'

test('short documents stay in one chunk', () => {
  const result = chunkText('hello world', 12_000, 6)
  assert.deepEqual(result, { chunks: ['hello world'], truncated: false })
})

test('empty input yields one empty chunk', () => {
  const result = chunkText('', 12_000, 6)
  assert.deepEqual(result, { chunks: [''], truncated: false })
})

test('chunks are bounded and cover the whole input', () => {
  const source = 'a'.repeat(30_001)
  const result = chunkText(source, 12_000, 6)
  assert.equal(result.truncated, false)
  assert.equal(result.chunks.length, 3)
  for (const chunk of result.chunks) assert.ok(chunk.length <= 12_000)
  assert.equal(result.chunks.join('').length, source.length)
})

test('long documents are truncated to the character budget', () => {
  const source = 'b'.repeat(100_000)
  const result = chunkText(source, 12_000, 6)
  assert.equal(result.truncated, true)
  assert.equal(result.chunks.length, 6)
  assert.equal(result.chunks.join('').length, 72_000)
})

test('exactly at the budget is not truncated', () => {
  const result = chunkText('c'.repeat(72_000), 12_000, 6)
  assert.equal(result.truncated, false)
  assert.equal(result.chunks.length, 6)
})

test('non-positive limits are normalized defensively', () => {
  const result = chunkText('abcdef', 0, 0)
  assert.deepEqual(result, { chunks: ['a'], truncated: true })
})
