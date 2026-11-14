// Read column labels from the supplied headers, including merged group headings.
export function productionTemplateColumns(sheet, definition) {
  const last = sheet.getColumn(definition.lastColumn).number
  const firstHeader = definition.firstDataRow === 3 ? 1 : 2
  return Array.from({ length: last }, (_, index) => {
    const labels = []
    for (let row = firstHeader; row < definition.firstDataRow; row++) {
      const value = sheet.getCell(row, index + 1).master.value
      const text =
        typeof value === 'string' ? value : value?.richText?.map((part) => part.text).join('') || ''
      const label = text.trim().replace(/\s+/g, ' ')
      if (label && !labels.includes(label)) labels.push(label)
    }
    return { key: sheet.getColumn(index + 1).letter, label: labels.join(' / ') }
  }).filter((column) => column.label)
}
