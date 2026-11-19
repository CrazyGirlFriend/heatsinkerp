// At 100% the supplied sheets' default width of 9.230769 characters measures 75 CSS pixels.
const pixelsPerWidthUnit = 75 / 9.23076923076923

export function productionTemplateColumns(sheet, definition) {
  const last = sheet.getColumn(definition.lastColumn).number
  const bottomRow = definition.firstDataRow - 1
  const columns = []
  for (let index = 1; index <= last; index++) {
    const column = sheet.getColumn(index)
    const upper = sheet.getCell(bottomRow - 1, index).master
    const lower = sheet.getCell(bottomRow, index).master
    const width = column.width ?? sheet.properties.defaultColWidth
    const leaf = {
      key: column.letter,
      label: lower.text.trim(),
      widthPx: Math.round(width * pixelsPerWidthUnit),
    }
    if (upper.address === lower.address) {
      columns.push(leaf)
    } else {
      if (columns.at(-1)?.key !== upper.address) {
        columns.push({ key: upper.address, label: upper.text.trim(), children: [] })
      }
      columns.at(-1).children.push(leaf)
    }
  }
  return { title: bottomRow > 2 ? sheet.getCell('A1').text.trim() : '', columns }
}
