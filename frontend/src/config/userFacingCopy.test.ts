import { describe, expect, it } from 'vitest'

// Guard current UI copy without changing API keys or archived documents.
const sources = import.meta.glob('../{components,pages,config,types,utils,services}/**/*.{vue,ts}', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>

describe('plain business wording', () => {
  it('keeps confusing stock terms out of current screens and display helpers', () => {
    const retired = /结存|来源余量|库存余额|可用余量|未核平|演示快照|多值|统计口径|库存台账/
    const matches = Object.entries(sources)
      .filter(([file]) => !file.endsWith('.test.ts'))
      .flatMap(([file, source]) => source.split('\n').flatMap((line, index) =>
        retired.test(line) ? [`${file}:${index + 1} ${line.trim()}`] : []))
    expect(matches).toEqual([])
  })
})
