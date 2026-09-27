export function deliveryError(date: string, quantity: number | undefined): string {
  if (Boolean(date) !== (quantity != null)) return '请同时填写要求发货日期和应发成品件数'
  if (
    quantity != null &&
    (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 2147483647)
  )
    return '应发成品件数须为正整数'
  if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < '2000-01-01' || date > '2100-12-31'))
    return '请输入有效的要求发货日期'
  return ''
}
