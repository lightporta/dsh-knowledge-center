import { readdir, readFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = fileURLToPath(new URL('../', import.meta.url))
const sources = ['index.js', 'client.js']

async function collect(directory) {
  let entries
  try {
    entries = await readdir(join(root, directory), { withFileTypes: true })
  } catch (error) {
    // v1.2.0 no longer ships test files; a missing optional directory is not a failure.
    if (error.code === 'ENOENT') return
    throw error
  }
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await collect(path)
    else if (/\.(?:js|mjs)$/.test(entry.name)) sources.push(path)
  }
}

for (const directory of ['lib', 'scripts']) await collect(directory)
for (const file of sources.sort()) {
  const result = spawnSync(process.execPath, ['--check', join(root, file)], { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
console.log(`Syntax checked ${sources.length} files in ${relative(process.cwd(), root) || '.'}`)

// Release guard that replaced test/manifest.test.mjs in v1.2.0: the package
// contract stays checked even though the regression suite is no longer shipped.
const readJson = async (name) => JSON.parse(await readFile(join(root, name), 'utf8'))
const exists = async (name) => {
  try {
    await stat(join(root, name))
    return true
  } catch {
    return false
  }
}
const fail = (message) => {
  console.error(`manifest: ${message}`)
  process.exit(1)
}

const manifest = await readJson('package.json')
if (manifest.name !== 'dsh-knowledge-center') fail(`unexpected package name ${manifest.name}`)
if (!/^\d+\.\d+\.\d+$/.test(manifest.version ?? '')) fail(`version is not semver: ${manifest.version}`)
if (manifest.type !== 'module') fail('type must be module')
if (manifest.exports?.['.'] !== './index.js') fail('exports["."] must point at ./index.js')
if (manifest.dsh?.bundle?.patch !== './cordis.patch.yml') fail('dsh.bundle.patch must be ./cordis.patch.yml')
for (const required of ['index.js', 'client.js', 'LICENSE', 'README.md', 'cordis.patch.yml']) {
  if (!(await exists(required))) fail(`${required} is missing`)
}
for (const locale of ['locale/en.json', 'locale/zh.json']) {
  const value = await readJson(locale)
  if (typeof value !== 'object' || value === null) fail(`${locale} is not an object`)
}
const patch = await readFile(join(root, 'cordis.patch.yml'), 'utf8')
if (!/-\s*insert:/.test(patch)) fail('cordis.patch.yml has no insert block')
if (!patch.includes('dsh-knowledge-center')) fail('cordis.patch.yml does not reference the package name')
const shipped = manifest.files ?? []
for (const required of ['index.js', 'lib/*.js', 'client.js', 'cordis.patch.yml', 'locale/*.json']) {
  if (!shipped.includes(required)) fail(`files is missing ${required}`)
}
console.log(`Manifest OK ${manifest.name}@${manifest.version}`)

// The published repository must not leak a contributor's machine paths.
const leakScan = async (name) => {
  if (!(await exists(name))) return
  const text = await readFile(join(root, name), 'utf8')
  if (/[A-Za-z]:\\\\Users\\\\/i.test(text) || /[D-Z]:\\\\/i.test(text) || /\/Users\/[A-Za-z0-9._-]+\//.test(text) || /\/home\/[A-Za-z0-9._-]+\//.test(text)) {
    fail(`${name} contains a local absolute path`)
  }
}
for (const name of ['README.md', 'test.md', 'docs/VERIFICATION.md', 'docs/EXTRACTION.md', 'docs/fixes-2026-10-25.md']) await leakScan(name)
console.log('Path scan OK')