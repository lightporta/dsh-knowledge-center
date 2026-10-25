/**
 * Cross-platform path helper tests.
 *
 * Every case passes an explicit platform so the Windows and POSIX rules are
 * verified from any development host (macOS, Linux or Windows).
 *
 * Run with: node --test
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  canonicalPath,
  comparisonKey,
  isSameOrInside,
  normalizeSourcePath,
  pathApi,
  resolveDshHome,
  sourceKey,
} from '../lib/paths.js'

test('selects the path implementation per platform', () => {
  assert.equal(pathApi('win32').sep, '\\')
  assert.equal(pathApi('darwin').sep, '/')
  assert.equal(pathApi('linux').sep, '/')
})

test('posix: keeps roots and strips trailing separators', () => {
  assert.equal(canonicalPath('/', 'linux'), '/')
  assert.equal(canonicalPath('/home/user', 'linux'), '/home/user')
  assert.equal(canonicalPath('/home/user/', 'linux'), '/home/user')
  assert.equal(canonicalPath('/home//user///', 'linux'), '/home/user')
})

test('posix: containment is case-sensitive', () => {
  assert.equal(isSameOrInside('/work', '/work', 'linux'), true)
  assert.equal(isSameOrInside('/work', '/work/docs', 'linux'), true)
  assert.equal(isSameOrInside('/work', '/workspace', 'linux'), false)
  assert.equal(isSameOrInside('/Work', '/work/docs', 'linux'), false)
  assert.equal(isSameOrInside('/work/', '/work/docs/a.md', 'linux'), true)
})

test('win32: keeps drive and UNC roots', () => {
  assert.equal(canonicalPath('C:\\', 'win32'), 'C:\\')
  assert.equal(canonicalPath('C:\\Work\\', 'win32'), 'C:\\Work')
  assert.equal(canonicalPath('\\\\server\\share\\', 'win32'), '\\\\server\\share\\')
  assert.equal(canonicalPath('\\\\server\\share\\docs\\', 'win32'), '\\\\server\\share\\docs')
})

test('win32: containment is case-insensitive and separator-aware', () => {
  assert.equal(isSameOrInside('C:\\Work', 'c:\\work', 'win32'), true)
  assert.equal(isSameOrInside('C:\\Work', 'c:\\work\\docs\\a.md', 'win32'), true)
  assert.equal(isSameOrInside('C:\\Work', 'C:\\Workspace', 'win32'), false)
  assert.equal(isSameOrInside('C:\\Work', 'D:\\Work', 'win32'), false)
  assert.equal(isSameOrInside('\\\\server\\share', '\\\\server\\share\\docs', 'win32'), true)
})

test('comparison keys normalize only where the platform does', () => {
  assert.equal(comparisonKey('/Work/Docs', 'linux'), '/Work/Docs')
  assert.equal(comparisonKey('C:\\Work\\Docs', 'win32'), 'c:\\work\\docs')
})

test('empty input never matches anything', () => {
  assert.equal(canonicalPath('', 'linux'), '')
  assert.equal(canonicalPath('   ', 'win32'), '')
  assert.equal(isSameOrInside('', '/work', 'linux'), false)
  assert.equal(isSameOrInside('/work', '', 'linux'), false)
})

test('DSH home honors DSH_HOME and falls back to the home directory', () => {
  assert.equal(resolveDshHome('linux', { DSH_HOME: '/custom/dsh' }, '/home/user'), '/custom/dsh')
  assert.equal(resolveDshHome('linux', {}, '/home/user'), '/home/user/.dsh')
  assert.equal(resolveDshHome('win32', { DSH_HOME: 'C:\\custom\\dsh\\' }, 'C:\\Users\\user'), 'C:\\custom\\dsh')
  assert.equal(resolveDshHome('win32', {}, 'C:\\Users\\user'), 'C:\\Users\\user\\.dsh')
})

test('source paths are normalized to portable forward-slash form', () => {
  assert.equal(normalizeSourcePath('docs\\a.md'), 'docs/a.md')
  assert.equal(normalizeSourcePath('./docs//a.md'), 'docs/a.md')
  assert.equal(normalizeSourcePath('docs/a.md'), 'docs/a.md')
  assert.equal(normalizeSourcePath('   '), '')
  assert.equal(normalizeSourcePath(undefined), '')
})

test('source identity follows platform case rules', () => {
  assert.equal(sourceKey('docs\\A.md', 'win32'), 'docs/a.md')
  assert.equal(sourceKey('docs\\A.md', 'darwin'), 'docs/a.md')
  assert.equal(sourceKey('docs/A.md', 'linux'), 'docs/A.md')
  assert.notEqual(sourceKey('docs/A.md', 'linux'), sourceKey('docs/a.md', 'linux'))
  assert.equal(sourceKey('docs/A.md', 'darwin'), sourceKey('docs/a.md', 'darwin'))
  assert.equal(sourceKey('', 'linux'), '')
})
