/** Empty bounds are unrestricted; weights use the API's six-decimal precision. */
export function invalidNumberRange(min: string, max: string, integer = false): boolean {
  const invalid = (value: string) => {
    const text = value.trim()
    if (!text) return false
    if (integer) return !/^\d+$/.test(text) || Number(text) > 2147483647
    return !/^\d+(?:\.\d{1,6})?$/.test(text) || text.split('.')[0]!.replace(/^0+/, '').length > 11
  }
  return (
    invalid(min) || invalid(max) || Boolean(min.trim() && max.trim() && Number(min) > Number(max))
  )
}
