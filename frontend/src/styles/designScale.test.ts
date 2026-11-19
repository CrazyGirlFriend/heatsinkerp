import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { compileStyle, parse } from 'vue/compiler-sfc'

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

it('uses shared typography and button radii in team workspace views and dialogs', () => {
  const src = fileURLToPath(new URL('../', import.meta.url))
  const page = 'pages/TeamWorkspacePage.vue'
  const entry = readFileSync(join(src, page), 'utf8')
  const imports = [...entry.matchAll(/from ['"]@\/(components\/[^'"]+\.vue)['"]/g)]
  const files = new Set([page, 'styles/team-workspace.css', ...imports.map((match) => match[1]!)])
  const violations: string[] = []
  for (const filename of files) {
    const source = readFileSync(join(src, filename), 'utf8')
    const styles = filename.endsWith('.vue')
      ? parse(source, { filename }).descriptor.styles.map((style) => style.content)
      : [source]
    for (const style of styles) {
      const { rawResult, errors } = compileStyle({ filename, source: style, id: 'team-scale' })
      expect(errors).toEqual([])
      const root = rawResult!.root
      root.walkAtRules('media', (rule) => {
        if (/\bprint\b/.test(rule.params)) rule.remove()
      })
      root.walkDecls((decl) => {
        const rule = decl.parent
        if (rule?.type !== 'rule') return
        const literalType =
          /^(font-size|font-weight)$/.test(decl.prop) &&
          /^(?:\d|bold|normal|clamp\(\d)/.test(decl.value)
        const literalButtonRadius =
          decl.prop === 'border-radius' &&
          /(?:\.(?:app|el)-button\b|\bbutton\b)/.test(rule.selector) &&
          /\d(?:px|rem)/.test(decl.value)
        if (literalType || literalButtonRadius)
          violations.push(`${filename} · ${rule.selector} · ${decl.toString()}`)
      })
    }
  }
  expect(violations).toEqual([])
})
