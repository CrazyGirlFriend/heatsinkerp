import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const scope = JSON.parse(readFileSync(new URL('../../scripts/quality-scope.json', import.meta.url)))
const result = spawnSync(
  process.execPath,
  [
    fileURLToPath(new URL('../node_modules/prettier/bin/prettier.cjs', import.meta.url)),
    process.argv.includes('--write') ? '--write' : '--check',
    ...scope.frontend,
  ],
  { cwd: root, stdio: 'inherit' },
)
if (result.error) throw result.error
process.exit(result.status ?? 1)
