import { readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = fileURLToPath(new URL('../', import.meta.url))
const files = ['index.js', 'client.js']
async function collect(directory) {
  for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await collect(path)
    else if (/\.(?:js|mjs)$/.test(entry.name)) files.push(path)
  }
}
for (const directory of ['lib', 'test', 'scripts']) await collect(directory)
for (const file of files.sort()) {
  const result = spawnSync(process.execPath, ['--check', join(root, file)], { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
console.log(`Syntax checked ${files.length} files in ${relative(process.cwd(), root) || '.'}`)
