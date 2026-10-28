import type { ProcessRoute, RouteOrderDocument } from '@/types/processRoute'

export function mergeRouteMaterials(
  data: ProcessRoute['source_data'],
  order?: RouteOrderDocument,
): ProcessRoute['source_data'] {
  const word = data.word_fields || data.receipt_fields || {}
  const document = order || data.order_document
  const wordSerial = word.serial_no?.value
  if (wordSerial && document && String(wordSerial) !== document.serial_no)
    throw new Error('订单表与工艺单流水号不一致')
  const excel = document?.receipt_fields || {}
  const fields = JSON.parse(JSON.stringify(excel)) as typeof excel
  for (const [key, field] of Object.entries(word)) {
    fields[key] = { ...field }
    if (excel[key] && String(excel[key].value) !== String(field.value))
      fields[key]!.alternative = { ...excel[key] }
  }
  return {
    ...data,
    word_fields: word,
    order_document: document,
    receipt_fields: fields,
    review_required: true,
    material_confirmation: undefined,
  }
}
