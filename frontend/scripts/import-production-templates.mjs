import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'

// Import the supplied workbooks, removing historical entries before shipping assets.
// Usage: node scripts/import-production-templates.mjs /path/to/产量表
const sourceDirectory = process.argv[2]
if (!sourceDirectory) throw new Error('请指定原始产量表目录')
const definitions = JSON.parse(
  await readFile(new URL('../src/config/productionTemplates.json', import.meta.url)),
)
const destination = new URL('../src/assets/productionTemplates/', import.meta.url)
await mkdir(destination, { recursive: true })
const provenance = {}
for (const [key, definition] of Object.entries(definitions)) {
  const original = await readFile(resolve(sourceDirectory, definition.source))
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(original)
  assert.equal(workbook.worksheets.length, 1, '新增工作表须先检查并清理历史数据')
  const sheet = workbook.worksheets[0]
  const header = () =>
    Array.from({ length: definition.firstDataRow - 1 }, (_, i) => sheet.getRow(i + 1).values)
  const originalHeader = structuredClone(header())
  // These merges span historical records; the header merges remain untouched.
  for (const range of [...sheet.model.merges]) {
    const rowNumbers = range.match(/\d+/g).map(Number)
    if (Math.max(...rowNumbers) >= definition.firstDataRow) sheet.unMergeCells(range)
  }
  sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    if (rowNumber < definition.firstDataRow) return
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.value = null
      cell.note = undefined
    })
  })
  for (let row = sheet.rowCount; row > definition.firstDataRow; row--) sheet.spliceRows(row, 1)
  assert.deepEqual(header(), originalHeader, '原表表头不得改动')
  workbook.creator = ''
  workbook.lastModifiedBy = ''
  workbook.created = new Date('2000-01-01T00:00:00Z')
  workbook.modified = workbook.created
  await workbook.xlsx.writeFile(new URL(`${key}.xlsx`, destination).pathname)
  provenance[key] = {
    source: definition.source,
    sha256: createHash('sha256').update(original).digest('hex'),
  }
  console.log(`${definition.source} → ${key}.xlsx`)
}
await writeFile(new URL('sources.json', destination), JSON.stringify(provenance, null, 2) + '\n')
