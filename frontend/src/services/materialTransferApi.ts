import { httpRequest, HttpRequestError, type HttpRequestOptions } from '@/services/httpClient'
import type {
  ConfirmMaterialTransferPayload,
  CreateMaterialTransferPayload,
  MaterialTransfer,
  MaterialTransferListParams,
  MaterialTransferFilterParams,
  MaterialTransferListResponse,
  MaterialTransferStatus,
  MaterialTransferStatusCounts,
  MaterialTransferTeam,
  MaterialTransferDocumentFields,
  MaterialTransferHistoryEntry,
  UpdateMaterialTransferPayload,
} from '@/types/materialTransfer'
import { isExternalEntryKind, materialDocumentTextFields, materialTypeOptions } from '@/types/materialTransfer'
import type { MaterialTrace } from '@/types/materialTrace'

type UnknownRecord = Record<string, unknown>

export class MaterialTransferApiError extends Error {
  constructor(
    message: string,
    readonly status = 0,
    readonly code?: string,
  ) {
    super(message)
    this.name = 'MaterialTransferApiError'
  }
}

function objectValue(value: unknown): UnknownRecord {
  return value && typeof value === 'object' ? value as UnknownRecord : {}
}

function textValue(...values: unknown[]): string {
  const value = values.find((item) => (typeof item === 'string' || typeof item === 'number') && String(item).trim())
  return value === undefined ? '' : String(value)
}

function numberValue(...values: unknown[]): number {
  const value = values.find((item) => item !== undefined && item !== null && item !== '')
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeTeam(value: unknown, prefix: 'source' | 'next', raw: UnknownRecord): MaterialTransferTeam {
  const team = objectValue(value)
  return {
    id: (team.id ?? raw[`${prefix}_team_id`] ?? '') as string | number,
    code: textValue(team.code, raw[`${prefix}_team_code`]),
    name: textValue(team.name, raw[`${prefix}_team_name`], '未配置班组'),
    ...(['production', 'warehouse', 'scrap'].includes(String(team.kind)) ? { kind: team.kind as MaterialTransferTeam['kind'] } : {}),
  }
}

function normalizeStatus(value: unknown): MaterialTransferStatus {
  const status = textValue(value).toLowerCase()
  if (status === 'received' || status === 'voided' || status === 'dispatched') return status
  return 'pending'
}

function optionalInteger(value: unknown, min = 0): number | null {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') return null
  const number = Number(value)
  return Number.isSafeInteger(number) && number >= min ? number : null
}

function normalizeHistory(value: unknown): MaterialTransferHistoryEntry[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    const event = objectValue(item)
    const id = optionalInteger(event.id, 1)
    if (id === null || !['created', 'updated', 'received', 'voided', 'stocked', 'dispatched', 'rejected'].includes(String(event.action))) return []
    const changes: MaterialTransferHistoryEntry['changes'] = {}
    Object.entries(objectValue(event.changes)).forEach(([field, change]) => {
      const values = objectValue(change)
      if ('before' in values && 'after' in values) changes[field] = { before: values.before, after: values.after }
    })
    return [{ id, action: event.action as MaterialTransferHistoryEntry['action'], actor: textValue(event.actor), occurred_at: textValue(event.occurred_at), changes }]
  })
}

export function normalizeMaterialTransfer(value: unknown): MaterialTransfer {
  const envelope = objectValue(value)
  const raw = objectValue(envelope.material_transfer ?? envelope.transfer ?? value)
  const batchNo = textValue(raw.batch_no, raw.code)
  const transferredBy = objectValue(raw.transferred_by_user ?? raw.created_by_user)
  const receivedBy = objectValue(raw.received_by_user)
  const receivedAt = textValue(raw.received_at, raw.confirmed_at)
  const documentText = Object.fromEntries(materialDocumentTextFields.map(field => [field.key, textValue(raw[field.key]) || null])) as Pick<MaterialTransferDocumentFields, typeof materialDocumentTextFields[number]['key']>
  return {
    ...documentText,
    entry_kind: raw.entry_kind === 'opening_stock' || raw.entry_kind === 'warehouse_receipt' || isExternalEntryKind(String(raw.entry_kind)) ? raw.entry_kind as MaterialTransfer['entry_kind'] : 'transfer',
    purpose_id: optionalInteger(raw.purpose_id, 1),
    purpose_name: textValue(raw.purpose_name) || null,
    external_destination: textValue(raw.external_destination) || null,
    receipt_kind: raw.receipt_kind === 'external' || raw.receipt_kind === 'return' ? raw.receipt_kind : null,
    external_source: textValue(raw.external_source) || null,
    return_dispatch_no: textValue(raw.return_dispatch_no) || null,
    rejection_reason: textValue(raw.rejection_reason) || null,
    dispatched_by: textValue(raw.dispatched_by_name, raw.dispatched_by, objectValue(raw.dispatched_by_user).display_name) || null,
    dispatched_by_user_id: optionalInteger(raw.dispatched_by_user_id, 1),
    dispatched_at: textValue(raw.dispatched_at) || null,
    material_type: materialTypeOptions.find(option => option.value === raw.material_type)?.value ?? null,
    finished_quantity: optionalInteger(raw.finished_quantity),
    version: optionalInteger(raw.version, 1),
    history: normalizeHistory(raw.history),
    source_transfer_id: optionalInteger(raw.source_transfer_id, 1),
    source_transfer_batch_no: textValue(raw.source_transfer_batch_no) || null,
    dispatch_no: textValue(raw.dispatch_no) || null,
    stock_tracked: raw.stock_tracked === true,
    loss_records: Array.isArray(raw.loss_records) ? raw.loss_records.map(item => { const loss = objectValue(item); return { ...loss, quantity: numberValue(loss.quantity), weight: numberValue(loss.weight) } as NonNullable<MaterialTransfer['loss_records']>[number] }) : [],
    id: (raw.id ?? batchNo) as string | number,
    batch_no: batchNo,
    barcode_payload: textValue(raw.barcode_payload, batchNo),
    barcode_type: textValue(raw.barcode_type, 'CODE128'),
    serial_no: textValue(raw.serial_no),
    urgency: raw.urgency as MaterialTransfer['urgency'],
    // An intake has no upstream team. This is a display label, never a directory identity.
    source_team: raw.entry_kind === 'opening_stock' ? { id: '', code: '', name: '期初库存' } : raw.entry_kind === 'warehouse_receipt'
      ? { id: '', code: '', name: '库房手工入库' }
      : normalizeTeam(raw.source_team, 'source', raw),
    next_team: isExternalEntryKind(String(raw.entry_kind)) ? { id: '', code: '', name: textValue(raw.external_destination) || '未填写外部去向' } : normalizeTeam(raw.next_team ?? raw.destination_team, 'next', {
      ...raw,
      next_team_id: raw.next_team_id ?? raw.destination_team_id,
      next_team_code: raw.next_team_code ?? raw.destination_team_code,
      next_team_name: raw.next_team_name ?? raw.destination_team_name,
    }),
    quantity: numberValue(raw.quantity, raw.total_quantity),
    quantity_unit: textValue(raw.quantity_unit, '件'),
    weight: numberValue(raw.weight, raw.total_weight),
    weight_unit: textValue(raw.weight_unit, 'kg'),
    status: normalizeStatus(raw.status),
    notes: textValue(raw.notes) || null,
    transferred_by: textValue(
      raw.transferred_by_name,
      raw.created_by_name,
      raw.transferred_by,
      raw.created_by,
      transferredBy.display_name,
      transferredBy.username,
    ) || null,
    transferred_at: textValue(raw.transferred_at, raw.created_at),
    received_by: textValue(
      raw.received_by_name,
      raw.confirmed_by_name,
      raw.received_by,
      receivedBy.display_name,
      receivedBy.username,
    ) || null,
    received_at: receivedAt || null,
    voided_by: textValue(raw.voided_by_name, raw.voided_by) || null,
    voided_at: textValue(raw.voided_at) || null,
    updated_at: textValue(raw.updated_at, receivedAt, raw.created_at),
    locked: Boolean(raw.locked ?? normalizeStatus(raw.status) !== 'pending'),
    locked_at: textValue(raw.locked_at, raw.received_at, raw.voided_at) || null,
    allowed_actions: Array.isArray(raw.allowed_actions) ? raw.allowed_actions.map(String) : [],
  }
}

function localizeError(error: unknown): MaterialTransferApiError {
  const failure = error instanceof HttpRequestError
    ? error
    : new HttpRequestError(error instanceof Error ? error.message : '无法连接服务器')
  const body = objectValue(failure.body)
  const detail = body.detail
  const detailRecord = objectValue(detail)
  const sourceMessage = typeof detail === 'string'
    ? detail
    : textValue(detailRecord.message, detailRecord.detail, body.message, failure.message)
  const normalized = sourceMessage.toLowerCase()
  let message = sourceMessage
  if (failure.status === 404) message = '未找到该转料单'
  else if (failure.status === 403) message = '当前账号无权执行此操作'
  else if (failure.status === 409 || normalized.includes('idempotency')) message = '转料单已更新，请重新核对最新内容'
  else if (failure.status === 422) message = sourceMessage || '转料信息不符合要求，请核对后提交'
  else if (!failure.status) message = '网络连接失败，请稍后重试'
  return new MaterialTransferApiError(
    message || `请求失败（${failure.status}）`,
    failure.status,
    textValue(body.code, detailRecord.code) || undefined,
  )
}

async function request<T>(path: string, options: HttpRequestOptions = {}): Promise<T> {
  try {
    return await httpRequest<T>(path, { noCache: true, ...options })
  } catch (error) {
    throw localizeError(error)
  }
}

function queryString(params: MaterialTransferListParams): string {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '' && !(key === 'status' && value === 'all')) {
      search.set(key, String(value))
    }
  })
  return search.size ? `?${search.toString()}` : ''
}

export const materialTransferApi = {
  async trace(serialNo: string): Promise<MaterialTrace> {
    const result = await request<MaterialTrace>(`/material-trace?${new URLSearchParams({ serial_no: serialNo.trim() })}`)
    return { ...result, items: result.items.map(item => ({ ...normalizeMaterialTransfer(item), on_hand_quantity: item.on_hand_quantity, on_hand_weight: item.on_hand_weight })) }
  },
  async counts(params: MaterialTransferFilterParams = {}): Promise<MaterialTransferStatusCounts> {
    const statuses = ['pending', 'received', 'voided', 'dispatched'] as const
    const totals = await Promise.all(statuses.map(async (status) => {
      const result = objectValue(await request<unknown>(`/material-transfers${queryString({ ...params, status, page: 1, page_size: 1 })}`))
      const total = Number(result.total)
      if (result.total == null || result.total === '' || !Number.isInteger(total) || total < 0) throw new MaterialTransferApiError('暂时无法获取状态数量')
      return total
    }))
    const [pending = 0, received = 0, voided = 0, dispatched = 0] = totals
    return { all: pending + received + voided + dispatched, pending, received, voided, dispatched }
  },

  async list(params: MaterialTransferListParams = {}): Promise<MaterialTransferListResponse> {
    const result = await request<unknown>(`/material-transfers${queryString(params)}`)
    const raw = objectValue(result)
    const rawItems = Array.isArray(result)
      ? result
      : Array.isArray(raw.items) ? raw.items : []
    return {
      items: rawItems.map(normalizeMaterialTransfer),
      total: Number(raw.total ?? rawItems.length),
      page: Number(raw.page ?? params.page ?? 1),
      page_size: Number(raw.page_size ?? params.page_size ?? 20),
    }
  },

  async get(batchNo: string): Promise<MaterialTransfer> {
    return normalizeMaterialTransfer(
      await request<unknown>(`/material-transfers/${encodeURIComponent(batchNo.trim())}`),
    )
  },

  async create(payload: CreateMaterialTransferPayload): Promise<MaterialTransfer> {
    return normalizeMaterialTransfer(await request<unknown>('/material-transfers', {
      method: 'POST',
      body: JSON.stringify(payload),
    }))
  },

  async update(batchNo: string, payload: UpdateMaterialTransferPayload): Promise<MaterialTransfer> {
    return normalizeMaterialTransfer(await request<unknown>(
      `/material-transfers/${encodeURIComponent(batchNo)}`,
      { method: 'PATCH', body: JSON.stringify(payload) },
    ))
  },

  async void(batchNo: string): Promise<MaterialTransfer> {
    const result = await request<unknown>(`/material-transfers/${encodeURIComponent(batchNo)}`, { method: 'DELETE' })
    if (result) return normalizeMaterialTransfer(result)
    return materialTransferApi.get(batchNo)
  },

  async confirm(batchNo: string, payload: ConfirmMaterialTransferPayload): Promise<MaterialTransfer> {
    return normalizeMaterialTransfer(await request<unknown>(
      `/material-transfers/${encodeURIComponent(batchNo)}/confirm`,
      { method: 'POST', body: JSON.stringify(payload) },
    ))
  },

  async reject(batchNo: string, reason: string, expectedVersion: number): Promise<MaterialTransfer> {
    return normalizeMaterialTransfer(await request<unknown>(`/material-transfers/${encodeURIComponent(batchNo)}/reject`, {
      method: 'POST', body: JSON.stringify({ reason, expected_version: expectedVersion }),
    }))
  },
  async confirmOutbound(batchNo: string, payload: ConfirmMaterialTransferPayload): Promise<MaterialTransfer> {
    return normalizeMaterialTransfer(await request<unknown>(
      `/material-transfers/${encodeURIComponent(batchNo)}/confirm-outbound`,
      { method: 'POST', body: JSON.stringify(payload) },
    ))
  },
}
