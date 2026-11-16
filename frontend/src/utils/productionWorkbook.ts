import { assertExportSize, type ExportValue } from './tableExport'
import { sharedSerialLabel } from '../types/sharedMaterial'
import type { ProcessingRecord } from '../types/materialProcessing'
import definitions from '../config/productionTemplates.json'

type ExportRow = Record<string, ExportValue>
type Inspection = NonNullable<ProcessingRecord['report_inspections']>[number]
const templates = import.meta.glob('../assets/productionTemplates/*.xlsx', {
  query: '?url',
  import: 'default',
})
export function productionTemplates(code?: string) {
  const definition = definitions[code as keyof typeof definitions]
  return definition ? [{ key: code!, label: definition.label }] : []
}

function values(
  key: string,
  r: ExportRow,
  inspection?: Inspection,
  continuation = false,
): Record<string, ExportValue> {
  const hours =
    !continuation && typeof r.processing_minutes === 'number'
      ? Number((r.processing_minutes / 60).toFixed(4))
      : null
  const people = String(r.processor_name || '').split('、')
  const note = r.reason
  const remaining = r.remaining_weight
  // Blank cells represent fields that were not recorded. Do not infer quality results,
  // machine use, upstream/downstream dispatches or operator roles from production counts.
  if (key === 'FACTORY-ROLL')
    return {
      A: r.processing_date,
      B: r.serial_no,
      D: r.material_name,
      E: r.finished_quantity,
      F: r.processing_task_name,
      H: r.after_specification,
      I: r.completed_quantity,
      J: r.completed_weight,
      K: remaining,
      L: r.scrap_weight,
      M: hours,
      // The original columns distinguish primary/secondary roles, which we do not record.
      S: note,
    }
  if (key === 'FACTORY-ANNEAL')
    return {
      A: r.processing_date,
      B: r.serial_no,
      C: r.material_name,
      D: r.after_specification,
      E: r.processing_task_name,
      F: r.completed_quantity,
      G: r.completed_weight,
      K: r.processor_name,
      L: r.actual_temperature_c,
      M: hours,
      N: r.furnace_no,
      R: note,
    }
  if (key === 'FACTORY-GRIND')
    return {
      A: String(r.processing_date || '').slice(0, 7),
      B: r.processing_date,
      C: r.serial_no,
      D: r.material_name,
      J: r.processing_task_name,
      K: r.finished_quantity,
      L: r.completed_quantity,
      M: r.completed_weight,
      Q: hours,
      R: r.processor_name,
      S: r.machine_no,
      W: note,
      X: r.batch_no,
    }
  if (key === 'FACTORY-WIRE')
    return {
      A: r.processing_date,
      B: r.serial_no,
      C: r.material_name,
      H: r.finished_quantity,
      I: r.completed_quantity,
      J: r.completed_weight,
      M: remaining,
      N: r.scrap_weight,
      P: r.processing_task_name,
      S: r.machine_no,
      T: r.processing_minutes,
      U: people[0],
      V: people[1],
      W: people.slice(2).join('、'),
      Y: note,
    }
  if (key === 'FACTORY-ENGRAVE')
    return {
      A: r.processing_date,
      B: r.serial_no,
      C: r.material_name,
      D: r.after_specification,
      E: r.finished_quantity,
      H: r.completed_quantity,
      I: r.completed_weight,
      J: r.scrap_quantity,
      K: r.scrap_weight,
      M: r.remaining_quantity,
      N: remaining,
      P: r.processing_task_name,
      Q: r.processor_name,
      R: r.machine_no,
      W: note,
      X: hours,
    }
  const qualityNote = [note, inspection?.notes].filter(Boolean).join('；')
  return {
    A: r.processing_date,
    B: r.serial_no,
    C: r.material_name,
    G: continuation ? null : r.completed_quantity,
    H: inspection?.sample_quantity,
    I: inspection?.passed_quantity,
    K:
      inspection?.disposition === 'scrap'
        ? inspection.failed_quantity
        : inspection?.failed_quantity === 0
          ? 0
          : null,
    AF:
      inspection?.disposition === 'rework'
        ? inspection.failed_quantity
        : inspection?.failed_quantity === 0
          ? 0
          : null,
    AP: r.processing_task_name,
    AQ: hours,
    AS: qualityNote,
  }
}

export function productionRecordData(record: ProcessingRecord): ExportRow {
  const { report_inspections, outputs, ...fields } = record
  return {
    ...(Object.fromEntries(
      Object.entries(fields).filter(
        ([, value]) => value == null || typeof value === 'string' || typeof value === 'number',
      ),
    ) as ExportRow),
    processing_minutes: record.labor_minutes,
    serial_no: sharedSerialLabel(record),
    report_inspections: JSON.stringify(report_inspections || []),
    remaining_quantity: outputs
      ?.filter((output) => output.role === 'remaining')
      .reduce((sum, output) => sum + output.quantity, 0),
    remaining_weight: outputs
      ?.filter((output) => output.role === 'remaining')
      .reduce((sum, output) => sum + output.weight, 0),
  }
}

export function productionReportRows(key: string, rows: ExportRow[]) {
  return rows.flatMap((record) => {
    const inspections: Inspection[] =
      key === 'FACTORY-QC' ? JSON.parse(String(record.report_inspections || '[]')) : []
    // Rechecks describe the same pieces; do not count them as new production.
    return inspections.length
      ? inspections.map((inspection, index) => values(key, record, inspection, index > 0))
      : [values(key, record)]
  })
}

export async function createProductionWorkbook(key: string, rows: ExportRow[]) {
  const load = templates[`../assets/productionTemplates/${key}.xlsx`]
  const definition = definitions[key as keyof typeof definitions]
  if (!load || !definition) throw new Error('本班组尚未配置产量表模板')
  assertExportSize(rows.length)
  const sorted = [...rows].sort((a, b) =>
    String(a.processing_date || '').localeCompare(String(b.processing_date || '')),
  )
  const data = productionReportRows(key, sorted)
  assertExportSize(data.length)
  const response = await fetch((await load()) as string)
  if (!response.ok) throw new Error('产量表模板读取失败，请重试')
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await response.arrayBuffer())
  const sheet = workbook.worksheets[0]!
  const first = definition.firstDataRow
  if (data.length > 1) sheet.duplicateRow(first, data.length - 1, true)
  // Month/year in the supplied report title are report values, not fixed labels.
  const months = [
    ...new Set(sorted.map((row) => String(row.processing_date || '').slice(0, 7))),
  ].filter((month) => /^\d{4}-\d{2}$/.test(month))
  const title = sheet.getCell('A1')
  if (months.length && typeof title.value === 'string') {
    const start = months[0]!,
      end = months.at(-1)!
    const period = start === end ? `${Number(start.slice(5))}月` : `${start} 至 ${end}`
    title.value = title.value.replace(/\d+月/, period)
    const year =
      start.slice(0, 4) === end.slice(0, 4)
        ? start.slice(0, 4)
        : `${start.slice(0, 4)}—${end.slice(0, 4)}`
    title.value = title.value.replace(/\d{4}(\s*年)/, `${year}$1`)
  }
  data.forEach((record, index) => {
    for (const [column, value] of Object.entries(record)) {
      const cell = sheet.getCell(`${column}${first + index}`)
      // Plain strings stay literal, including serials with leading zeros and '=' notes.
      cell.value = value ?? null
      if (typeof value === 'number') cell.style = { ...cell.style, numFmt: '#,##0.######' }
    }
    const durationColumn: Record<string, string> = {
      'FACTORY-ROLL': 'M',
      'FACTORY-ANNEAL': 'M',
      'FACTORY-GRIND': 'Q',
      'FACTORY-WIRE': 'T',
      'FACTORY-ENGRAVE': 'X',
      'FACTORY-QC': 'AQ',
    }
    const durationCell = sheet.getCell(`${durationColumn[key]}${first + index}`)
    durationCell.style = {
      ...durationCell.style,
      numFmt: key === 'FACTORY-WIRE' ? '0"分钟"' : '0.####"小时"',
    }
  })
  sheet.pageSetup.printArea = `A1:${definition.lastColumn}${first + Math.max(data.length, 1) - 1}`
  const buffer = await workbook.xlsx.writeBuffer()
  return new Blob([new Uint8Array(buffer)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}
