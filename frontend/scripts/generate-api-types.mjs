import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import openapiTS, { astToString } from 'openapi-typescript'
import { format, resolveConfig } from 'prettier'

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(frontend, 'src/types/generated/api.d.ts')
const python = process.env.PYTHON?.includes('/')
  ? resolve(process.cwd(), process.env.PYTHON)
  : process.env.PYTHON || 'python3'
const schema = JSON.parse(
  execFileSync(python, ['scripts/export_openapi.py'], {
    cwd: resolve(frontend, '..'),
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  }),
)
const source = await format(
  '/** Generated from backend OpenAPI. Run npm run api:generate; do not edit. */\n' +
    astToString(await openapiTS(schema, { alphabetize: true })),
  { ...(await resolveConfig(output)), parser: 'typescript' },
)
if (process.argv.includes('--check')) {
  if ((await readFile(output, 'utf8')) !== source) {
    console.error('API types are out of date. Run npm run api:generate.')
    process.exitCode = 1
  }
} else {
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, source)
}
