import { expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { createProductionWorkbook, productionTemplates } from './productionWorkbook'

it.each([
  'FACTORY-ROLL',
  'FACTORY-ANNEAL',
  'FACTORY-GRIND',
  'FACTORY-WIRE',
  'FACTORY-ENGRAVE',
  'FACTORY-QC',
  'QC-SANDBLAST',
  'QC-DEBURR',
])(
  'exports %s with merged headers, literal identifiers, all participants and one production row',
  async (key) => {
    const blob = await createProductionWorkbook(key, [
      {
        serial_no: '000123-1',
        processing_date: '2026-11-12',
        material_name: 'W80',
        processor_name: '张三、李四、王五',
        processing_minutes: 95,
        completed_quantity: 10,
        completed_weight: 1.25,
        reason: '=1+1',
      },
    ])
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()))
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml']!)
    const strings = Object.entries(files)
      .filter(([path]) => /sheet1.xml|sharedStrings.xml/.test(path))
      .map(([, bytes]) => strFromU8(bytes))
      .join('')
    expect(sheet).toContain('<mergeCells')
    expect(sheet).not.toContain('<f>')
    expect(strings).toContain('000123-1')
    for (const name of ['张三', '李四', '王五']) expect(strings).toContain(name)
    expect(strings).toContain('=1+1')
    expect(sheet).toContain('<v>1.5833</v>')
    expect(sheet).not.toContain('2025')
    // Exactly one body row; the crew does not duplicate quantity.
    const rows = [...sheet.matchAll(/<row\s/g)]
    expect(rows.length).toBe(['FACTORY-ANNEAL', 'FACTORY-WIRE'].includes(key) ? 3 : 4)
  },
)

it('offers all three inspection sub-process templates and none for a warehouse', () => {
  expect(productionTemplates('FACTORY-QC').map((t) => t.key)).toEqual([
    'FACTORY-QC',
    'QC-SANDBLAST',
    'QC-DEBURR',
  ])
  expect(productionTemplates('FACTORY-WAREHOUSE')).toEqual([])
})

it.each([0, 925.5])(
  'exports actual temperature %s separately from requirement and holding time',
  async (temperature) => {
    const blob = await createProductionWorkbook('FACTORY-ANNEAL', [
      {
        actual_temperature_c: temperature,
        furnace_no: '02炉',
        temperature_requirement: '900–950 °C',
        holding_minutes: 60,
        processing_minutes: 95,
      },
    ])
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()))
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml']!)
    expect(sheet).toMatch(new RegExp(`<c r="L3"[^>]*><v>${temperature}</v>`))
    expect(sheet).toMatch(/<c r="M3"[^>]*><v>1\.5833<\/v>/)
    expect(sheet).toMatch(/<c r="T3"[^>]*><v>1<\/v>/)
    const text = Object.values(files)
      .map((bytes) => strFromU8(bytes))
      .join('')
    expect(text).toContain('02炉')
    expect(text).toContain('900–950 °C')
  },
)

it.each(['FACTORY-ROLL', 'FACTORY-GRIND', 'FACTORY-WIRE', 'FACTORY-ENGRAVE'])(
  'exports recorded machine number for %s',
  async (key) => {
    const blob = await createProductionWorkbook(key, [{ machine_no: 'M-03' }])
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()))
    expect(
      Object.values(files)
        .map((bytes) => strFromU8(bytes))
        .join(''),
    ).toContain('M-03')
  },
)
