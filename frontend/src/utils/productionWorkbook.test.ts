import { readFile } from 'node:fs/promises'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ExcelJS from 'exceljs'
import { strFromU8, unzipSync } from 'fflate'
import {
  createProductionWorkbook,
  productionTemplates,
  productionRecordData,
  productionReportRows,
} from './productionWorkbook'
import definitions from '../config/productionTemplates.json'
import reportColumns from '../config/productionTemplateColumns.json'
import type { ProcessingRecord } from '../types/materialProcessing'

type Inspection = NonNullable<ProcessingRecord['report_inspections']>[number]
const check = (overrides: Partial<Inspection> = {}): Inspection => ({
  id: 71,
  source_transfer_id: 10,
  checked_at: '2026-11-13T01:30:00Z',
  inspector_name: '检验员甲',
  failure_lines: [],
  batch_quantity: 123,
  sample_quantity: 12,
  passed_quantity: 10,
  failed_quantity: 2,
  kind: 'inspection',
  scope: 'sample',
  parent_id: null,
  disposition: 'pending',
  problem_names: ['划伤', '磕伤'],
  notes: '',
  ...overrides,
})
async function exported(key: string, row: Parameters<typeof createProductionWorkbook>[1][number]) {
  const blob = await createProductionWorkbook(key, [row])
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await blob.arrayBuffer())
  return workbook.worksheets[0]!
}

async function original(key: string) {
  return readFile(new URL(`../assets/productionTemplates/${key}.xlsx`, import.meta.url))
}
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const filename = url.split('/').at(-1)!
      const buffer = await original(filename.replace(/\.xlsx$/, ''))
      return { ok: true, arrayBuffer: async () => buffer }
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

it.each([
  ['FACTORY-ENGRAVE', 'H', 'I', 'J', 'K', 'L'],
  ['FACTORY-ANNEAL', 'F', 'G', 'H', 'I', 'J'],
  ['FACTORY-GRIND', 'L', 'M', 'N', 'O', 'P'],
  ['FACTORY-WIRE', 'I', 'J', 'K', 'L', 'Y'],
] as const)(
  'shows operator quality in the original %s columns on screen and in Excel',
  async (key, ...columns) => {
    const record = {
      serial_no: 'Q-001',
      reason: '无',
      completed_quantity: 99,
      completed_weight: 9.75,
      scrap_weight: 0.25,
      failed_quantity: 2,
      failed_weight: 0.5,
      failure_reason: '划伤',
      outputs: [{ role: 'scrap', material_type: 'defective', quantity: 1, weight: 0.25 }],
    } as ProcessingRecord
    const data = productionRecordData(record)
    const [row] = productionReportRows(key, [data])
    const sheet = await exported(key, data)
    const at = definitions[key].firstDataRow
    const expected = [98, 9.5, 2, 0.5, '划伤']
    expect(columns.map((c) => row![c])).toEqual(expected)
    expect(columns.map((c) => sheet.getCell(c + at).value)).toEqual(expected)
    const passed = productionRecordData({
      ...record,
      outputs: [],
      failed_quantity: 0,
      failed_weight: 0,
      failure_reason: '',
    })
    expect(productionReportRows(key, [passed])[0]![columns[0]]).toBe(99)
    expect(productionReportRows(key, [passed])[0]![columns[2]]).toBe(0)
  },
)
it.each(Object.keys(definitions))(
  'fills the original %s workbook without changing its header or layout',
  async (key) => {
    const template = new ExcelJS.Workbook()
    await template.xlsx.load(await original(key))
    const before = template.worksheets[0]!
    const definition = definitions[key as keyof typeof definitions]
    const blob = await createProductionWorkbook(key, [
      {
        serial_no: '000123-1',
        processing_date: '2026-11-12',
        material_name: 'W80',
        processor_name: '张三、李四、王五',
        processing_minutes: 95,
        completed_quantity: 123,
        completed_weight: 1.25,
        reason: '=1+1',
      },
    ])
    const result = new ExcelJS.Workbook()
    await result.xlsx.load(await blob.arrayBuffer())
    const after = result.worksheets[0]!
    expect(after.name).toBe(before.name)
    expect(after.model.merges).toEqual(before.model.merges)
    expect(after.pageSetup.orientation).toEqual(before.pageSetup.orientation)
    expect(after.pageSetup.margins).toEqual(before.pageSetup.margins)
    expect(after.properties.defaultColWidth).toBe(before.properties.defaultColWidth)
    expect(after.columns.map((column) => column.width)).toEqual(
      before.columns.map((column) => column.width),
    )
    for (let row = 1; row < definition.firstDataRow; row++) {
      expect(after.getRow(row).values).toEqual(before.getRow(row).values)
      expect(after.getRow(row).height).toBe(before.getRow(row).height)
      before.getRow(row).eachCell((cell, column) => {
        expect(after.getCell(row, column).style).toEqual(cell.style)
      })
    }
    expect(after.rowCount).toBe(definition.firstDataRow)
    expect(after.getRow(definition.firstDataRow).height).toBe(
      before.getRow(definition.firstDataRow).height,
    )
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()))
    const strings = Object.entries(files)
      .filter(([name]) => /sheet1.xml|sharedStrings.xml/.test(name))
      .map(([, bytes]) => strFromU8(bytes))
      .join('')
    for (const text of ['000123-1', '=1+1']) expect(strings).toContain(text)
    if (!['FACTORY-ROLL', 'FACTORY-QC', 'QC-SANDBLAST', 'QC-DEBURR'].includes(key)) {
      for (const text of ['张三', '李四', '王五']) expect(strings).toContain(text)
    }
    expect(strings).not.toContain('<f>')
  },
)

it.each(Object.keys(definitions))('ships %s with no historical production records', async (key) => {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await original(key))
  const sheet = workbook.worksheets[0]!
  const first = definitions[key as keyof typeof definitions].firstDataRow
  expect(workbook.worksheets).toHaveLength(1)
  sheet.eachRow((row, index) => {
    if (index >= first) {
      row.eachCell((cell) => expect(cell.value).toBeNull())
    }
  })
})

it('keeps unknown operator roles blank without putting extra fields in remarks', async () => {
  const blob = await createProductionWorkbook('FACTORY-ROLL', [
    { processor_name: '张三、李四', machine_no: 'M-03' },
  ])
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await blob.arrayBuffer())
  const sheet = workbook.worksheets[0]!
  expect(sheet.getCell('N2').text.trim()).toBe('主操')
  expect(sheet.getCell('O2').text.trim()).toBe('副操')
  expect(sheet.getCell('N4').value).toBeNull()
  expect(sheet.getCell('O4').value).toBeNull()
  expect(sheet.getCell('S4').value).toBeNull()
  expect(sheet.getCell('T2').value).toBeNull()
})

it.each([0, 925.5])(
  'keeps temperature %s in the original annealing column without adding extra parameters to remarks',
  async (actual_temperature_c) => {
    const blob = await createProductionWorkbook('FACTORY-ANNEAL', [
      {
        actual_temperature_c,
        furnace_no: '02炉',
        temperature_requirement: '900–950 °C',
        holding_minutes: 60,
        processing_minutes: 95,
      },
    ])
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(await blob.arrayBuffer())
    const sheet = workbook.worksheets[0]!
    expect(sheet.getCell('L3').value).toBe(actual_temperature_c)
    expect(sheet.getCell('N3').text).toBe('02炉')
    expect(sheet.getCell('M3').value).toBe(1.5833)
    expect(sheet.getCell('M3').numFmt).toContain('小时')
    expect(sheet.getCell('R3').value).toBeNull()
    expect(sheet.getCell('T3').value).toBeNull()
  },
)

it('extends the original data row without duplicating crew output or retaining historical merges', async () => {
  const blob = await createProductionWorkbook('FACTORY-WIRE', [
    {
      serial_no: '0002',
      processing_date: '2026-11-13',
      completed_quantity: 23,
      processor_name: '甲、乙',
      processing_minutes: 60,
    },
    {
      serial_no: '0001',
      processing_date: '2026-11-12',
      completed_quantity: 123,
      processor_name: '甲、乙',
      processing_minutes: 95,
    },
  ])
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await blob.arrayBuffer())
  const sheet = workbook.worksheets[0]!
  expect(sheet.rowCount).toBe(4)
  expect(sheet.getCell('B3').value).toBe('0001')
  expect(sheet.getCell('B4').value).toBe('0002')
  expect(sheet.getCell('I3').value).toBe(123)
  expect(sheet.getCell('I4').value).toBe(23)
  expect(sheet.getCell('T3').value).toBe(95)
  expect(sheet.getCell('T3').numFmt).toContain('分钟')
  expect(sheet.getCell('I4').style).toEqual(sheet.getCell('I3').style)
  expect(sheet.model.merges).not.toContain('B3:B4')
  expect(sheet.pageSetup.printArea).toBe('A1:AA4')
})

it('offers the three original QC reports and rejects unknown templates', async () => {
  expect(productionTemplates('FACTORY-QC').map((t) => t.key)).toEqual([
    'FACTORY-QC',
    'QC-SANDBLAST',
    'QC-DEBURR',
  ])
  expect(productionTemplates('FACTORY-WAREHOUSE')).toEqual([])
  await expect(createProductionWorkbook('unknown', [])).rejects.toThrow('尚未配置')
})

it('reports template loading errors', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: false })),
  )
  await expect(createProductionWorkbook('FACTORY-ROLL', [])).rejects.toThrow('读取失败')
})

it.each([
  ['QC-SANDBLAST', '喷砂', 'P'],
  ['QC-DEBURR', '去毛刺', 'N'],
])('writes the %s original columns', async (key, task, note) => {
  const sheet = await exported(key, {
    serial_no: '691236-50',
    processing_task_name: task,
    completed_quantity: 12,
    processing_minutes: 90,
    reason: '核对',
    report_inspections: JSON.stringify([check()]),
  })
  expect(sheet.getCell('B4').text).toBe('691236-50')
  expect(sheet.getCell('G4').value).toBe(12)
  expect(sheet.getCell('H4').value).toBe(10)
  expect(sheet.getCell('I4').value).toBe(1.5)
  expect(sheet.getCell('J4').text).toBe(task)
  expect(sheet.getCell('K4').text).toBe('检验员甲')
  expect(sheet.getCell(note + '4').text).toBe('核对')
})
it('splits a single defect between scrap and the assigned repair team', async () => {
  const sheet = await exported('FACTORY-QC', {
    report_inspections: JSON.stringify([
      check({
        failed_quantity: 5,
        disposition: 'rework',
        failure_lines: [
          { category: '划伤', disposition: 'scrap', quantity: 2 },
          {
            category: '划伤',
            disposition: 'rework',
            quantity: 3,
            repair_team_id: 3,
            repair_column: '研磨',
          },
        ],
      }),
    ]),
  })
  expect(['K4', 'M4', 'AF4', 'AG4'].map((c) => sheet.getCell(c).value)).toEqual([2, 2, 3, 3])
})

it('updates the report month without retaining the original November heading', async () => {
  const blob = await createProductionWorkbook('FACTORY-QC', [{ processing_date: '2026-12-01' }])
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await blob.arrayBuffer())
  expect(workbook.worksheets[0]!.getCell('A1').text).toBe('检验12月产量')
})

it.each(['检验', '喷砂', '去毛刺'])(
  '%s exports the actual batch quantity without inventing a quality result',
  async (processing_task_name) => {
    const sheet = await exported('FACTORY-QC', {
      processing_task_name,
      completed_quantity: 123,
      finished_quantity: 4008,
    })
    expect(sheet.getCell('G4').value).toBe(123)
    expect(sheet.getCell('H4').value).toBeNull()
    expect(sheet.getCell('AS4').text).toBe('')
    expect(sheet.getCell('I4').value).toBeNull()
    expect(sheet.getCell('K4').value).toBeNull()
    expect(sheet.getCell('AP4').text).toBe(processing_task_name)
  },
)

it('fills only checked and passed pieces, keeping unresolved failures out of scrap and rework counts', async () => {
  const sheet = await exported('FACTORY-QC', {
    completed_quantity: 123,
    completed_weight: 8,
    report_inspections: JSON.stringify([check()]),
  })
  expect(sheet.getCell('G4').value).toBe(123)
  expect(sheet.getCell('H4').value).toBe(12)
  expect(sheet.getCell('I4').value).toBe(10)
  for (const cell of ['J4', 'K4', 'AF4', 'M4', 'N4']) expect(sheet.getCell(cell).value).toBeNull()
  expect(sheet.getCell('AS4').text).toBe('')
})

it.each(['scrap', 'rework'] as const)(
  'writes a confirmed %s count without allocating defect categories',
  async (disposition) => {
    const sheet = await exported('FACTORY-QC', {
      report_inspections: JSON.stringify([check({ disposition })]),
    })
    expect(sheet.getCell(disposition === 'scrap' ? 'K4' : 'AF4').value).toBe(2)
    expect(sheet.getCell(disposition === 'scrap' ? 'AF4' : 'K4').value).toBeNull()
    for (const cell of ['M4', 'N4', 'AG4']) expect(sheet.getCell(cell).value).toBeNull()
  },
)

it.each(['喷砂', '去毛刺'])(
  '%s uses passed pieces from the linked check and keeps a true zero',
  async (processing_task_name) => {
    const sheet = await exported('FACTORY-QC', {
      processing_task_name,
      completed_quantity: 123,
      report_inspections: JSON.stringify([check({ passed_quantity: 0, failed_quantity: 12 })]),
    })
    expect(sheet.getCell('G4').value).toBe(123)
    expect(sheet.getCell('H4').value).toBe(12)
    expect(sheet.getCell('I4').value).toBe(0)
  },
)

it.each(['检验', '喷砂', '去毛刺'])(
  '%s lists rechecks without counting production and duration twice',
  async (processing_task_name) => {
    const sheet = await exported('FACTORY-QC', {
      processing_task_name,
      processing_date: '2026-11-12',
      batch_no: 'LOT-71',
      completed_quantity: 123,
      processing_minutes: 90,
      report_inspections: JSON.stringify([
        check(),
        check({
          id: 72,
          parent_id: 71,
          failed_quantity: 0,
          passed_quantity: 12,
          problem_names: [],
        }),
      ]),
    })
    expect(sheet.getCell('A4').text).toBe('2026-11-12')
    expect(sheet.getCell('A5').text).toBe('2026-11-12')
    expect(sheet.getCell('G4').value).toBe(123)
    expect(sheet.getCell('G5').value).toBeNull()
    expect(sheet.getCell('AQ4').value).toBe(1.5)
    expect(sheet.getCell('AQ5').value).toBeNull()
    expect(sheet.getCell('AS5').text).toBe('')
    expect(sheet.getCell('AP5').text).toBe(processing_task_name)
    expect(sheet.rowCount).toBe(5)
    expect(sheet.getCell('I5').value).toBe(12)
    expect(sheet.getCell('K5').value).toBe(0)
    expect(sheet.getCell('AF5').value).toBe(0)
  },
)

it.each([
  ['FACTORY-ROLL', 'E4'],
  ['FACTORY-GRIND', 'K4'],
  ['FACTORY-WIRE', 'H3'],
  ['FACTORY-ENGRAVE', 'E4'],
])('%s keeps the order quantity distinct from this batch', async (key, cell) => {
  const sheet = await exported(key!, { finished_quantity: 4008, completed_quantity: 123 })
  expect(sheet.getCell(cell!).value).toBe(4008)
})

it('limits the number of exported rows after adding inspection rows', async () => {
  await expect(
    createProductionWorkbook('FACTORY-QC', [
      {
        report_inspections: JSON.stringify(Array.from({ length: 10001 }, () => check())),
      },
    ]),
  ).rejects.toThrow('10,000')
})

it.each(Object.keys(definitions))('matches the %s template headers and widths', async (key) => {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await original(key))
  const sheet = workbook.worksheets[0]!
  const definition = definitions[key as keyof typeof definitions]
  const layout = reportColumns[key as keyof typeof reportColumns]
  const bottom = definition.firstDataRow - 1
  expect(layout.title).toBe(bottom > 2 ? sheet.getCell('A1').text.trim() : '')
  let index = 0
  for (const header of layout.columns) {
    const upper = sheet.getCell(bottom - 1, index + 1).master
    expect(header.label).toBe(upper.text.trim())
    const grouped = 'children' in header
    if (grouped) expect(header.key).toBe(upper.address)
    for (const leaf of grouped && header.children ? header.children : [header]) {
      const source = sheet.getColumn(++index)
      const lower = sheet.getCell(bottom, index).master
      expect(sheet.getCell(bottom - 1, index).master.address).toBe(upper.address)
      expect(grouped).toBe(lower.address !== upper.address)
      expect(leaf.key).toBe(source.letter)
      expect(leaf.label).toBe(lower.text.trim())
      expect(source.width ?? sheet.properties.defaultColWidth).toBeCloseTo(9.230769)
      expect(leaf.widthPx).toBe(75)
    }
  }
  expect(index).toBe(sheet.getColumn(definition.lastColumn).number)
})
