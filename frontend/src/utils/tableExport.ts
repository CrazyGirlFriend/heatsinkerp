import type { MaterialPage } from '@/types/teamMaterials'

export type ExportValue = string | number | null | undefined
export interface ExportField {
  key: string
  label: string
  selected?: boolean
}
export interface TableExportSource {
  title: string
  total: number
  fields: ExportField[]
  load: (
    signal: AbortSignal,
    progress: (loaded: number, total: number) => void,
  ) => Promise<Record<string, ExportValue>[]>
}
export interface TableExportField<T> extends ExportField {
  value: (row: T) => ExportValue
}

export function tableExportSource<T>(
  title: string,
  total: number,
  fields: TableExportField<T>[],
  load: (signal: AbortSignal, progress: (loaded: number, total: number) => void) => Promise<T[]>,
): TableExportSource {
  return {
    title,
    total,
    fields,
    load: async (signal, progress) =>
      (await load(signal, progress)).map((row) =>
        Object.fromEntries(fields.map((field) => [field.key, field.value(row)])),
      ),
  }
}

/** Read every filtered page through the same permission-checked list API. */
export async function loadExportPages<T>(
  fetchPage: (page: number, pageSize: number) => Promise<Pick<MaterialPage<T>, 'items' | 'total'>>,
  signal: AbortSignal,
  progress: (loaded: number, total: number) => void,
): Promise<T[]> {
  const rows: T[] = []
  let total: number | undefined
  for (let page = 1; ; ++page) {
    signal.throwIfAborted()
    const result = await fetchPage(page, 100)
    signal.throwIfAborted()
    if (total !== undefined && result.total !== total)
      throw new Error('筛选结果已变化，请刷新后重新导出。')
    total = result.total
    rows.push(...result.items)
    if (rows.length > total || (rows.length < total && !result.items.length))
      throw new Error('导出记录不完整，请刷新后重试。')
    progress(rows.length, total)
    if (rows.length === total) return rows
  }
}

export async function createExportWorkbook(
  fields: ExportField[],
  rows: Record<string, ExportValue>[],
): Promise<Blob> {
  const { default: writeExcelFile } = await import('write-excel-file/universal')
  const data = [
    fields.map((field) => ({
      value: field.label,
      type: String,
      fontWeight: 'bold' as const,
      backgroundColor: '#EAF2EC',
    })),
    ...rows.map((row) =>
      fields.map((field) => {
        const value = row[field.key] ?? ''
        // Identifiers and user text stay text, including leading zeros and '='.
        return typeof value === 'number'
          ? { value, type: Number, format: '#,##0.######' }
          : { value, type: String }
      }),
    ),
  ]
  return writeExcelFile(data, {
    sheet: '数据',
    columns: fields.map((field) => ({
      width: Math.max(16, Math.min(36, field.label.length * 2 + 6)),
    })),
    stickyRowsCount: 1,
  }).toBlob()
}

export function downloadExportWorkbook(blob: Blob, title: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${title.replace(/[\\/:*?"<>|]/g, '_')}-${new Date().toISOString().slice(0, 10)}.xlsx`
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
