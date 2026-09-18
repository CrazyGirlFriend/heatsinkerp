import { httpRequest, HttpRequestError, type HttpRequestOptions } from './httpClient'
import { normalizeMaterialTransfer } from './materialTransferApi'
import type { CreateWarehouseReceipt, WarehouseReceiptParams, CreatedMaterialBatches } from '@/types/teamMaterials'
import { isExternalEntryKind } from '@/types/materialTransfer'
import type { MaterialAnalytics, Metric, SerialParams, SerialSummary } from '@/types/materialAnalytics'
import type { WarehouseGroupParams, TeamInventoryParams, TeamInventoryRow } from '@/types/teamInventory'
import { balanceFields, type MaterialBalance, type TeamMaterialOverview, type StockBatch, type StockParams, type MaterialPage, type MaterialPageParams, type MaterialLoss, type MaterialDispatch, type DispatchParams, type CreateDispatch, type CreateLoss } from '@/types/teamMaterials'

type Raw = Record<string, unknown>
const record = (value: unknown): Raw => value && typeof value === 'object' ? value as Raw : {}
const numeric = (value: unknown): number | null => (typeof value === 'string' && value.trim() || typeof value === 'number') && Number.isFinite(Number(value)) ? Number(value) : null
function balance(value: unknown): MaterialBalance {
  const raw = record(value)
  return Object.fromEntries([...balanceFields, 'scrap', 'scrap_available'].flatMap(key => ['quantity', 'weight'].map(unit => [`${key}_${unit}`, numeric(raw[`${key}_${unit}`])]))) as MaterialBalance
}
function stock(value: unknown): StockBatch { return { ...balance(value), transfer: normalizeMaterialTransfer(record(value).transfer) } }
function loss(value: unknown): MaterialLoss {
  const raw = record(value)
  return { ...raw, quantity: Number(raw.quantity), weight: Number(raw.weight) } as unknown as MaterialLoss
}
export function normalizeMaterialDispatch(value: unknown): MaterialDispatch {
  const raw = record(value)
  const external = isExternalEntryKind(String(raw.entry_kind))
  return { ...raw, entry_kind: external ? raw.entry_kind : 'transfer', next_team: external ? { id: '', code: '', name: String(raw.external_destination || '未填写外部去向') } : raw.next_team, total_quantity: Number(raw.total_quantity), total_weight: Number(raw.total_weight), items: Array.isArray(raw.items) ? raw.items.map(normalizeMaterialTransfer) : [] } as unknown as MaterialDispatch
}
export class TeamMaterialApiError extends Error {
  constructor(message: string, readonly status = 0) { super(message); this.name = 'TeamMaterialApiError' }
}
async function request<T>(path: string, options?: HttpRequestOptions): Promise<T> {
  try { return await httpRequest<T>(path, { noCache: true, ...options }) }
  catch (error) {
    if (!(error instanceof HttpRequestError)) throw error
    const detail = record(error.body).detail
    const message = typeof detail === 'string' ? detail : typeof record(detail).message === 'string' ? String(record(detail).message) : ''
    const fallback: Record<number, string> = { 403: '当前账号不能操作此班组物料', 404: '未找到班组或来源批次', 409: '来源批次余额已变化，请核对最新余量', 422: '请检查数量、重量和必填内容' }
    const knownMessage = /insufficient.*(available|stock|balance)|exceed.*available/i.test(message) ? '来源批次余额不足，请核对最新可用余量' : /idempotency.*(different|mismatch|used)/i.test(message) ? '重复提交的内容已改变，请关闭后重新核对提交' : ''
    const localized = /[\u4e00-\u9fff]/.test(message) ? message : knownMessage || fallback[error.status] || '物料台账请求失败，请重试'
    throw new TeamMaterialApiError(localized, error.status)
  }
}
function path(teamId: number, resource: string, params: object = {}): string {
  if (!Number.isSafeInteger(teamId) || teamId < 1) throw new TeamMaterialApiError('无效的班组编号')
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => { if (value !== undefined && value !== null && value !== '') query.set(key, String(value)) })
  return `/team-materials/${teamId}/${resource}${query.size ? `?${query}` : ''}`
}
async function page<T>(url: string, normalize: (raw: unknown) => T): Promise<MaterialPage<T>> {
  const raw = record(await request(url))
  if (!Array.isArray(raw.items) || numeric(raw.total) === null) throw new TeamMaterialApiError('物料台账数据不完整，请重试')
  return { items: raw.items.map(normalize), total: Number(raw.total), page: Number(raw.page), page_size: Number(raw.page_size) }
}
export const teamMaterialApi = {
  teamInventory(teamId: number, params: TeamInventoryParams = {}) { return page(path(teamId, 'inventory', params), value => ({ ...record(value), ...balance(value) } as unknown as TeamInventoryRow)) },
  inventorySources(teamId: number, groupId: number, params: WarehouseGroupParams = {}) { return page(path(teamId, `inventory/${groupId}/sources`, params), stock) },
  analytics(teamId: number, params: { days?: 7 | 30; metric?: Metric } = {}) { return request<MaterialAnalytics>(path(teamId, 'analytics', params)) },
  serials(teamId: number, params: SerialParams = {}) { return request<MaterialPage<SerialSummary>>(path(teamId, 'serials', params)) },
  async overview(teamId: number): Promise<TeamMaterialOverview> {
    const raw = record(await request(path(teamId, 'overview')))
    const pending = record(raw.pending_incoming)
    return { team_id: teamId, totals: balance(raw.totals), materials: Array.isArray(raw.materials) ? raw.materials.map(item => ({ ...balance(item), material_name: typeof record(item).material_name === 'string' ? String(record(item).material_name) : null })) : [], material_types: Array.isArray(raw.material_types) ? raw.material_types.map(item => ({ ...balance(item), material_type: record(item).material_type as import('@/types/materialTransfer').MaterialType | null })) : [], pending_incoming: { quantity: numeric(pending.quantity), weight: numeric(pending.weight), count: numeric(pending.count), ...(numeric(pending.batch_count) !== null ? { batch_count: numeric(pending.batch_count) } : {}) }, legacy_received_count: Number(raw.legacy_received_count) || 0 }
  },
  stock(teamId: number, params: StockParams = {}) { return page(path(teamId, 'stock', params), stock) },
  receipts(teamId: number, params: WarehouseReceiptParams = {}) { return page(path(teamId, 'receipts', params), normalizeMaterialTransfer) },
  async createReceipt(teamId: number, payload: CreateWarehouseReceipt) { return normalizeMaterialTransfer(await request(path(teamId, 'receipts'), { method: 'POST', body: payload })) },
  losses(teamId: number, params: MaterialPageParams = {}) { return page(path(teamId, 'losses', params), loss) },
  dispatches(teamId: number, params: DispatchParams = {}) { return page(path(teamId, 'outbound-batches', params), normalizeMaterialTransfer) },
  async createLoss(teamId: number, payload: CreateLoss) { return loss(await request(path(teamId, 'losses'), { method: 'POST', body: payload })) },
  async createDispatch(teamId: number, payload: CreateDispatch): Promise<CreatedMaterialBatches> {
    const result = await request<CreatedMaterialBatches>(path(teamId, 'outbound-batches'), { method: 'POST', body: payload })
    return { items: result.items.map(normalizeMaterialTransfer) }
  },
  async refreshSource(teamId: number, source: StockBatch): Promise<StockBatch> {
    const result = await teamMaterialApi.stock(teamId, { query: source.transfer.batch_no, availability: 'all', page: 1, page_size: 100 })
    const latest = result.items.find(item => String(item.transfer.id) === String(source.transfer.id))
    if (!latest) throw new TeamMaterialApiError(`来源批次 ${source.transfer.batch_no} 已不可用`, 409)
    return latest
  },
}
