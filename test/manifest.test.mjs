/**
 * Repository manifest consistency tests.
 *
 * These guard the published bundle shape that DeepSeek Harness' Plugin Manager
 * reads: package identity, bundle patch, client loader id, locales and
 * license. Run with: node --test
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const readJson = (relative) => JSON.parse(readFileSync(resolve(root, relative), 'utf8'))
const pkg = readJson('package.json')

test('package identity is the published plugin name', () => {
  assert.equal(pkg.name, 'dsh-knowledge-center')
  assert.match(pkg.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/)
  assert.equal(pkg.license, 'MIT')
  assert.equal(pkg.type, 'module')
  assert.equal(pkg.private, undefined)
  assert.equal(pkg.engines.node, '>=20.3.0')
  assert.equal(pkg.engines.dsh, '>=0.2.1-rc.3')
})

test('exports and files cover every runtime artifact', () => {
  assert.equal(pkg.exports['.'], './index.js')
  assert.equal(pkg.exports['./client'], './client.js')
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh.client.platform, 'web')
  for (const file of ['index.js', 'client.js', 'cordis.patch.yml', 'LICENSE', 'README.md']) {
    assert.ok(existsSync(resolve(root, file)), `${file} must exist`)
  }
  for (const file of ['lib/paths.js', 'lib/text.js']) {
    assert.ok(pkg.files.includes('lib/*.js'), 'lib files must be packaged')
    assert.ok(existsSync(resolve(root, file)), `${file} must exist`)
  }
})

test('bundle patch inserts the package row', () => {
  const patch = readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8')
  assert.match(patch, /id:\s*knowledge-center/)
  assert.match(patch, /name:\s*['"]?dsh-knowledge-center['"]?/)
})

test('client loader id matches the package name', () => {
  const client = readFileSync(resolve(root, 'client.js'), 'utf8')
  const match = /__ModuleLoader__\.load\(\{\s*id:\s*'([^']+)'/.exec(client)
  assert.ok(match, 'client.js must register through window.__ModuleLoader__')
  assert.equal(match[1], pkg.name)
})

test('locale resources carry the plugin inventory metadata', () => {
  for (const locale of ['en', 'zh']) {
    const data = readJson(`locale/${locale}.json`)
    assert.equal(typeof data.meta?.title, 'string', `${locale} title`)
    assert.ok(data.meta.title.length > 0)
    assert.equal(typeof data.meta?.description, 'string', `${locale} description`)
    assert.ok(data.meta.description.length > 0)
  }
})

test('license matches the package license', () => {
  const license = readFileSync(resolve(root, 'LICENSE'), 'utf8')
  assert.match(license, /^MIT License/)
  assert.match(license, /Copyright \(c\) 2026/)
})
