import { readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const directory = new URL('../test/', import.meta.url)
const files = (await readdir(directory)).filter((file) => file.endsWith('.test.mjs')).sort()
const result = spawnSync(process.execPath, ['--test', ...files.map((file) => fileURLToPath(new URL(file, directory)))], { stdio: 'inherit' })
if (result.error) throw result.error
process.exit(result.status ?? 1)