import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it('keeps the shared type and control scale available to pages and teleported dialogs alike', () => {
  const src = fileURLToPath(new URL('../', import.meta.url))
  const baseFile = join('styles', 'base.css')
  const base = readFileSync(join(src, baseFile), 'utf8')
  const root = base.match(/:root\s*\{([^}]+)\}/)?.[1] ?? ''
  const tokens = [
    '--workspace-heading-size',
    '--dialog-title-size',
    '--font-size-section',
    '--font-size-body',
    '--font-size-label',
    '--font-size-meta',
    '--font-weight-regular',
    '--font-weight-medium',
    '--font-weight-semibold',
    '--workspace-control-height',
    '--control-height-small',
    '--radius-control',
    '--radius-compact',
  ]
  const declaration = new RegExp('(' + tokens.join('|') + ')\\s*:', 'g')
  expect([...root.matchAll(declaration)].map((match) => match[1]).sort()).toEqual(tokens.sort())

  const overrides = []
  for (const file of readdirSync(src, { recursive: true, encoding: 'utf8' })) {
    if (!/\.(css|vue)$/.test(file)) continue
    const source = readFileSync(join(src, file), 'utf8')
    const scoped = file === baseFile ? source.replace(root, '') : source
    for (const match of scoped.matchAll(declaration)) overrides.push(`${file}: ${match[1]}`)
  }
  expect(overrides).toEqual([])
})
