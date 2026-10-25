/**
 * Cross-platform path helpers for the Knowledge Center.
 *
 * The plugin runs in the DeepSeek Harness Host process on macOS, Windows and
 * Linux. Workspace paths come from the Harness workspace registry (already
 * canonical) but permissions, knowledge collections and source documents are
 * compared against paths supplied by sessions, so every comparison must follow
 * the operating system's rules:
 *
 * - POSIX systems compare case-sensitively and use `/`.
 * - Windows compares case-insensitively, uses `\`, and has drive/UNC roots
 *   whose trailing separator must not be stripped.
 *
 * `platform` arguments exist so this logic is unit-testable for every target
 * from any host; production callers omit them.
 */
import { posix, win32 } from 'node:path'
import { homedir } from 'node:os'

/** Path implementation for one Node platform name. */
export function pathApi(platform = process.platform) {
  return platform === 'win32' ? win32 : posix
}

/**
 * Normalize a path for storage and display: absolute, without a trailing
 * separator except for filesystem roots. The original letter case is kept.
 * @param {string} input - absolute or resolve-able path.
 * @param {string} [platform] - Node platform name; defaults to the host.
 * @returns {string} canonical absolute path, or `''` for empty input.
 */
export function canonicalPath(input, platform = process.platform) {
  if (typeof input !== 'string' || input.trim().length === 0) return ''
  const api = pathApi(platform)
  const absolute = api.resolve(input.trim())
  if (platform === 'win32') {
    const normalized = absolute.replace(/\//g, '\\')
    if (/^[A-Za-z]:\\$/.test(normalized)) return normalized
    // UNC share root: \\server\share\; keep the trailing separator.
    if (/^\\\\[^\\]+\\[^\\]+\\$/.test(normalized)) return normalized
    const trimmed = normalized.replace(/\\+$/, '')
    return trimmed.length === 0 ? normalized : trimmed
  }
  if (absolute === '/') return absolute
  const trimmed = absolute.replace(/\/+$/, '')
  return trimmed.length === 0 ? '/' : trimmed
}

/**
 * Comparison key for one path: the canonical path, lowercased on Windows so
 * `C:\Work` and `c:\work` identify the same workspace.
 * @param {string} input - path to compare.
 * @param {string} [platform] - Node platform name; defaults to the host.
 * @returns {string} comparison key (`''` for empty input).
 */
export function comparisonKey(input, platform = process.platform) {
  const canonical = canonicalPath(input, platform)
  if (canonical === '') return ''
  return platform === 'win32' ? canonical.toLowerCase() : canonical
}

/**
 * Normalize a workspace-relative source path for storage and sharing: forward
 * slashes, no duplicated separators, no leading `./`. This keeps knowledge
 * front matter portable across operating systems.
 * @param {string} input - workspace-relative document path.
 * @returns {string} normalized relative path, or `''` for empty input.
 */
export function normalizeSourcePath(input) {
  if (typeof input !== 'string') return ''
  const trimmed = input.trim()
  if (trimmed.length === 0) return ''
  const slashed = trimmed.replace(/\\/g, '/')
  const withoutDot = slashed.replace(/^\.\/+/, '').replace(/\/{2,}/g, '/')
  const trimmedEnd = withoutDot.replace(/\/+$/, '')
  return trimmedEnd
}

/** Canonical identity for a source, while preserving workspace-relative paths. */
export function workspaceSourcePath(workspacePath, input, platform = process.platform) {
  const normalized = normalizeSourcePath(input)
  const api = pathApi(platform)
  if (normalized === '' || api.isAbsolute(normalized) || win32.isAbsolute(normalized) || /^[A-Za-z]:/.test(normalized)) {
    throw new Error('Source must be a workspace-relative document path.')
  }
  const root = canonicalPath(workspacePath, platform)
  const target = api.resolve(root, normalized)
  const rel = api.relative(root, target)
  if (root === '' || rel === '' || !isSameOrInside(root, target, platform)) {
    throw new Error('Source path is outside the selected workspace or does not point to a document.')
  }
  return normalizeSourcePath(rel)
}

/**
 * Identity key for a workspace-relative source path. Windows and macOS (APFS
 * default) are case-insensitive, Linux is case-sensitive; separators are
 * normalized first so `docs/a.md` and `docs\\a.md` identify one source.
 * @param {string} input - workspace-relative document path.
 * @param {string} [platform] - Node platform name; defaults to the host.
 * @returns {string} comparison key (`''` for empty input).
 */
export function sourceKey(input, platform = process.platform) {
  const normalized = normalizeSourcePath(input)
  if (normalized === '') return ''
  return platform === 'win32' || platform === 'darwin' ? normalized.toLowerCase() : normalized
}

/**
 * Whether `child` is `parent` itself or lives inside it, following the
 * platform's separator and case rules.
 * @param {string} parent - candidate containing directory.
 * @param {string} child - candidate contained path.
 * @param {string} [platform] - Node platform name; defaults to the host.
 * @returns {boolean} true when contained or equal.
 */
export function isSameOrInside(parent, child, platform = process.platform) {
  const parentKey = comparisonKey(parent, platform)
  const childKey = comparisonKey(child, platform)
  if (parentKey === '' || childKey === '') return false
  if (parentKey === childKey) return true
  const separator = platform === 'win32' ? '\\' : '/'
  const prefix = parentKey.endsWith(separator) ? parentKey : `${parentKey}${separator}`
  return childKey.startsWith(prefix)
}

/**
 * Resolve the DeepSeek Harness home directory for profile data:
 * `$DSH_HOME` when the Harness provides it, otherwise `~/.dsh`.
 * @param {string} [platform] - Node platform name; defaults to the host.
 * @param {Record<string, string | undefined>} [env] - environment map.
 * @param {string} [home] - home directory override for tests.
 * @returns {string} absolute home directory.
 */
export function resolveDshHome(platform = process.platform, env = process.env, home = undefined) {
  const api = pathApi(platform)
  const fromEnv = env?.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
    return canonicalPath(fromEnv, platform)
  }
  const homeDirectory = typeof home === 'string' && home.length > 0 ? home : homedir()
  return api.join(homeDirectory, '.dsh')
}
