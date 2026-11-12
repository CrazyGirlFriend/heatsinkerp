import type { CellObject, SheetData } from 'write-excel-file/universal'
import type { ExportValue } from './tableExport'

type ExportRow = Record<string, ExportValue>
const templates = import.meta.glob('../config/productionTemplates/*.json', { import: 'default' })
export function productionTemplates(code?: string) {
  if (code === 'FACTORY-QC')
    return [
      { key: code, label: '检验产量表' },
      { key: 'QC-SANDBLAST', label: '喷砂产量表' },
      { key: 'QC-DEBURR', label: '去毛刺产量表' },
    ]
  const label: Record<string, string> = {
    'FACTORY-ROLL': '轧制产量表',
    'FACTORY-ANNEAL': '退火模压产量表',
    'FACTORY-GRIND': '研磨产量表',
    'FACTORY-WIRE': '线切割产量表',
    'FACTORY-ENGRAVE': '雕刻产量表',
  }
  return code && label[code] ? [{ key: code, label: label[code] }] : []
}

function values(key: string, r: ExportRow): Record<string, ExportValue> {
  const hours =
    typeof r.processing_minutes === 'number' ? Number((r.processing_minutes / 60).toFixed(4)) : null
  const people = String(r.processor_name || '').split('、')
  const note = [r.work_kind === '返工' ? `返工第 ${r.rework_round} 次` : '', r.reason]
    .filter(Boolean)
    .join('；')
  const remaining = r.remaining_weight
  // Blank cells represent fields that were not recorded. Do not infer quality results,
  // machine use, upstream/downstream dispatches or operator roles from production counts.
  if (key === 'FACTORY-ROLL')
    return {
      A: r.processing_date,
      B: r.serial_no,
      D: r.material_name,
      F: r.processing_task_name,
      H: r.after_specification,
      I: r.completed_quantity,
      J: r.completed_weight,
      K: remaining,
      L: r.scrap_weight,
      M: hours,
      N: r.processor_name,
      S: note,
      T: r.machine_no,
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
      S: r.temperature_requirement,
      T: typeof r.holding_minutes === 'number' ? Number((r.holding_minutes / 60).toFixed(4)) : null,
    }
  if (key === 'FACTORY-GRIND')
    return {
      A: String(r.processing_date || '').slice(0, 7),
      B: r.processing_date,
      C: r.serial_no,
      D: r.material_name,
      J: r.processing_task_name,
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
      I: r.completed_quantity,
      J: r.completed_weight,
      M: remaining,
      N: r.scrap_weight,
      P: r.processing_task_name,
      S: r.machine_no,
      T: hours,
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
  if (key === 'QC-SANDBLAST' || key === 'QC-DEBURR')
    return {
      A: r.processing_date,
      B: r.serial_no,
      C: r.material_name,
      I: hours,
      J: r.processing_task_name,
      K: r.processor_name,
      [key === 'QC-SANDBLAST' ? 'P' : 'N']: note,
    }
  return {
    A: r.processing_date,
    B: r.serial_no,
    C: r.material_name,
    AP: r.processing_task_name,
    AQ: hours,
    AR: r.processor_name,
    AS: note,
  }
}

function columnIndex(column: string) {
  return [...column].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1
}

export async function createProductionWorkbook(key: string, rows: ExportRow[]) {
  const load = templates[`../config/productionTemplates/${key}.json`]
  if (!load) throw new Error('本班组尚未配置产量表样式')
  const template = (await load()) as {
    title: string
    headers: SheetData
    widths: number[]
    bodyStyle: CellObject
  }
  const data: SheetData = template.headers.map((row) =>
    row.map((cell) => (cell ? { ...(cell as CellObject), type: String } : null)),
  )
  for (const r of [...rows].sort((a, b) =>
    String(a.processing_date || '').localeCompare(String(b.processing_date || '')),
  )) {
    const row: (CellObject | null)[] = template.widths.map(() => ({
      ...template.bodyStyle,
      value: '',
      type: String,
      height: 28,
    }))
    for (const [column, value] of Object.entries(values(key, r)))
      row[columnIndex(column)] = {
        ...row[columnIndex(column)],
        value: value ?? '',
        type: typeof value === 'number' ? Number : String,
        ...(typeof value === 'number' ? { format: '#,##0.######' } : {}),
      }
    if (key === 'FACTORY-ROLL') {
      row[13]!.columnSpan = 2
      row[14] = null
    }
    data.push(row)
  }
  const { default: writeExcelFile } = await import('write-excel-file/universal')
  return writeExcelFile(data, {
    sheet: template.title,
    columns: template.widths.map((width) => ({ width })),
    stickyRowsCount: template.headers.length,
  }).toBlob()
}
