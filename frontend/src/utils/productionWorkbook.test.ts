import { readFile } from 'node:fs/promises'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ExcelJS from 'exceljs'
import { strFromU8, unzipSync } from 'fflate'
import { createProductionWorkbook, productionTemplates } from './productionWorkbook'
import definitions from '../config/productionTemplates.json'
import type { ProcessingRecord } from '../types/materialProcessing'

type Inspection = NonNullable<ProcessingRecord['report_inspections']>[number]
const check = (overrides: Partial<Inspection> = {}): Inspection => ({
  id: 71,
  source_transfer_id: 10,
  checked_at: '2026-11-13T01:30:00Z',
  inspector_name: '检验员甲',
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
async function exported(key: string, row: Record<string, string | number | null>) {
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
    for (const text of ['000123-1', '张三', '李四', '王五', '=1+1']) expect(strings).toContain(text)
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

it('keeps original primary/secondary operator columns and records unclassified crew in remarks', async () => {
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
  expect(sheet.getCell('S4').text).toContain('加工人员：张三、李四')
  expect(sheet.getCell('S4').text).toContain('M-03')
  expect(sheet.getCell('T2').value).toBeNull()
})

it.each([0, 925.5])(
  'keeps temperature %s in the original annealing column and extra parameters in remarks',
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
    expect(sheet.getCell('R3').text).toContain('保温：60 分钟')
    expect(sheet.getCell('R3').text).toContain('900–950 °C')
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
  expect(sheet.pageSetup.printArea).toBe('A1:Z4')
})

it('offers one inspection template and rejects removed standalone categories', async () => {
  expect(productionTemplates('FACTORY-QC')).toEqual([{ key: 'FACTORY-QC', label: '检验产量表' }])
  expect(productionTemplates('FACTORY-WAREHOUSE')).toEqual([])
  for (const key of ['unknown', 'QC-SANDBLAST', 'QC-DEBURR']) {
    expect(productionTemplates(key)).toEqual([])
    await expect(createProductionWorkbook(key, [])).rejects.toThrow('尚未配置')
  }
})

it('reports template loading errors', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: false })),
  )
  await expect(createProductionWorkbook('FACTORY-ROLL', [])).rejects.toThrow('读取失败')
})

it('keeps all inspection categories in one original sheet with their own quantities, crew and hours', async () => {
  const tasks = ['检验', '喷砂', '去毛刺', '显微镜修毛刺']
  const blob = await createProductionWorkbook(
    'FACTORY-QC',
    tasks.map((processing_task_name, index) => ({
      serial_no: '691236-50',
      processing_date: '2026-11-13',
      processing_task_name,
      completed_quantity: 123 + index,
      processing_minutes: 60 + index * 30,
      processor_name: `人员${index + 1}、共同加工人`,
      reason: `任务备注${index + 1}`,
      report_inspections: JSON.stringify(index === 0 ? [check({ disposition: 'scrap' })] : []),
    })),
  )
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await blob.arrayBuffer())
  expect(workbook.worksheets).toHaveLength(1)
  const sheet = workbook.worksheets[0]!
  expect(sheet.getCell('AP2').text.trim()).toBe('加工类别')
  expect(sheet.rowCount).toBe(7)
  for (const [index, task] of tasks.entries()) {
    const row = index + 4
    expect(sheet.getCell(`B${row}`).text).toBe('691236-50')
    expect(sheet.getCell(`AP${row}`).text).toBe(task)
    expect(sheet.getCell(`G${row}`).value).toBe(123 + index)
    expect(sheet.getCell(`AQ${row}`).value).toBe(1 + index * 0.5)
    expect(sheet.getCell(`AR${row}`).text).toBe(`人员${index + 1}、共同加工人`)
    expect(sheet.getCell(`AS${row}`).text).toContain(`任务备注${index + 1}`)
    expect(sheet.getCell(`H${row}`).value).toBe(index === 0 ? 12 : null)
    expect(sheet.getCell(`I${row}`).value).toBe(index === 0 ? 10 : null)
    expect(sheet.getCell(`K${row}`).value).toBe(index === 0 ? 2 : null)
  }
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
    expect(sheet.getCell('AS4').text).toContain('未登记检验结果')
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
  expect(sheet.getCell('AS4').text).toContain('抽检 12 件，不合格 2 件')
  expect(sheet.getCell('AS4').text).toContain('待处理')
  expect(sheet.getCell('AS4').text).toContain('划伤、磕伤（未登记分类数量）')
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
    expect(sheet.getCell('AS5').text).toContain('复检 #72（原检查 #71）')
    expect(sheet.getCell('AS5').text).toContain('2026-11-13 09:30，检验员甲')
    expect(sheet.getCell('AS5').text).not.toContain('本次加工完成')
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
