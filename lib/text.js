/**
 * Text helpers shared by the Host half.
 *
 * Distillation is a character-budgeted pipeline: each model call receives at
 * most `size` characters, and one document may use at most `maxChunks` calls.
 * Documents longer than that budget are deliberately truncated (the knowledge
 * entry records `truncated: true`) instead of silently sending an unbounded
 * prompt to the model.
 */

/**
 * Split one document into distillation chunks.
 * @param {string} text - document body (already stripped of front matter).
 * @param {number} size - maximum characters per chunk.
 * @param {number} maxChunks - maximum number of chunks for one document.
 * @returns {{ chunks: string[], truncated: boolean }} chunks covering at most
 *   `size * maxChunks` characters, and whether the input was longer.
 */
export function chunkText(text, size, maxChunks) {
  const source = typeof text === 'string' ? text : String(text ?? '')
  const perChunk = Math.max(1, Math.trunc(size))
  const chunkLimit = Math.max(1, Math.trunc(maxChunks))
  const budget = perChunk * chunkLimit
  const truncated = source.length > budget
  const limited = truncated ? source.slice(0, budget) : source
  if (limited.length <= perChunk) return { chunks: [limited], truncated }
  const chunks = []
  for (let offset = 0; offset < limited.length; offset += perChunk) {
    chunks.push(limited.slice(offset, offset + perChunk))
  }
  return { chunks, truncated }
}
