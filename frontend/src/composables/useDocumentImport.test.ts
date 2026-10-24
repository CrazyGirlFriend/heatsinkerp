import { describe, expect, it } from 'vitest'
import { useDocumentImport } from './useDocumentImport'

const field = (value: string | number) => ({
  value,
  label: '材质',
  source_row: '1:2',
  source_label: '原文材质',
})

describe('工艺单导入来源追踪', () => {
  it('tracks imported and edited values without changing the source fields', () => {
    const imported = { material_name: field('铜钼') }
    const document = useDocumentImport()
    document.record(imported)
    expect(document.state('material_name', '铜钼')).toBe('imported')
    expect(document.state('material_name', '钼铜')).toBe('edited')
    expect(document.original('material_name')).toBe('铜钼')
    imported.material_name.value = '外部修改'
    expect(document.original('material_name')).toBe('铜钼')
  })

  it('accepts number inputs as strings while distinguishing zero from missing values', () => {
    const document = useDocumentImport()
    document.record({ pieces: field(0), weight: field(171.6) })
    expect(document.state('pieces', '0')).toBe('imported')
    expect(document.state('pieces', '')).toBe('edited')
    expect(document.state('pieces', null)).toBe('edited')
    expect(document.state('weight', '171.6')).toBe('imported')
    expect(document.state('weight', undefined)).toBe('edited')
    expect(document.state('unknown', '')).toBe('')
    expect(document.original('unknown')).toBeUndefined()
  })

  it('replaces the previous import and clears tracking on reset', () => {
    const document = useDocumentImport()
    document.record({ material_name: field('铜钼') })
    document.record({ pieces: field(41) })
    expect(document.state('material_name', '铜钼')).toBe('')
    expect(document.original('pieces')).toBe(41)
    document.reset()
    expect(document.state('pieces', 41)).toBe('')
    expect(document.original('pieces')).toBeUndefined()
  })
})
