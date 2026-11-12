import type { components } from '@/types/generated/api'
import { formatProcessingMinutes, validProcessingMinutes } from '@/utils/processingDuration'

export type ProcessingParameterKey =
  | 'furnace_no'
  | 'temperature_requirement'
  | 'actual_temperature_c'
  | 'holding_minutes'
  | 'machine_no'
export type ProcessingParameters = Partial<
  Pick<components['schemas']['QuantityAdjustmentResponse'], ProcessingParameterKey>
>

// The server supplies the applicable keys. Forms, record columns and exports share labels.
const definitions: {
  key: ProcessingParameterKey
  label: string
  kind: 'text' | 'temperature' | 'duration'
  column?: boolean
  maxLength?: number
}[] = [
  { key: 'furnace_no', label: '炉号', kind: 'text', column: true, maxLength: 80 },
  { key: 'temperature_requirement', label: '工艺温度要求', kind: 'text', maxLength: 160 },
  { key: 'actual_temperature_c', label: '实际温度（°C）', kind: 'temperature', column: true },
  { key: 'holding_minutes', label: '保温时长', kind: 'duration' },
  { key: 'machine_no', label: '机台号', kind: 'text', column: true, maxLength: 80 },
]
export function processingParameterFields(keys: readonly string[] = []) {
  return definitions.filter((field) => keys.includes(field.key))
}
export function processingParameterPayload(
  values: ProcessingParameters,
  keys: readonly string[] = [],
) {
  return Object.fromEntries(
    processingParameterFields(keys).map(({ key }) => {
      const value = values[key]
      return [key, typeof value === 'string' ? value.trim() || null : (value ?? null)]
    }),
  ) as ProcessingParameters
}
export function processingParameterErrors(
  values: ProcessingParameters,
  keys: readonly string[],
  totalMinutes?: number | null,
) {
  const errors: Record<string, string> = {}
  for (const field of processingParameterFields(keys)) {
    const value = values[field.key]
    if (value == null || value === '') continue
    if (
      field.kind === 'text' &&
      (typeof value !== 'string' || value.trim().length > field.maxLength!)
    )
      errors[field.key] = `${field.label}最多 ${field.maxLength} 字`
    if (
      field.kind === 'temperature' &&
      (typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value < -273.15 ||
        value > 99999.99 ||
        Math.abs(value * 100 - Math.round(value * 100)) > 0.000001)
    )
      errors[field.key] = '请填写有效温度，最多两位小数'
    if (field.kind === 'duration') {
      if (typeof value !== 'number' || !validProcessingMinutes(value))
        errors[field.key] = '请填写大于零的保温时长'
      else if (totalMinutes != null && value > totalMinutes)
        errors[field.key] = '保温时长不能超过本次加工时长'
    }
  }
  return errors
}
export function formatProcessingParameter(key: ProcessingParameterKey, row: ProcessingParameters) {
  const value = row[key]
  if (value == null || value === '') return '—'
  return key === 'holding_minutes' ? formatProcessingMinutes(Number(value)) : String(value)
}
