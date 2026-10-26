/** Detect contributor machine paths without rejecting common tool locations. */
export function containsLocalAbsolutePath(text) {
  // Markdown paths use one backslash, JSON/log excerpts may use two, and
  // Windows also accepts forward slashes. Normalize all three before matching.
  const normalized = String(text).replace(/\\+/g, '/')
  return /(?:^|[^A-Za-z0-9])[A-Za-z]:\/Users\//i.test(normalized)
    || /(?:^|[^A-Za-z0-9])[D-Z]:\//i.test(normalized)
    || /\/Users\/[A-Za-z0-9._-]+\//.test(normalized)
    || /\/home\/[A-Za-z0-9._-]+\//.test(normalized)
}
