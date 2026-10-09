import { API_BASE, authorizationValue, httpRequest, HttpRequestError } from './httpClient'

export type WarehouseLocation = {
  id: number; team_id: number; name: string; active: boolean; version: number
  status: 'available' | 'locked' | 'occupied' | 'disabled'; has_stock: boolean
  draft_locked?: boolean
  batches: { id: number; batch_no: string; serial_no: string; material_name?: string; material_type?: string; quantity: number; weight: number; status: string; created_at?: string; received_at?: string | null; available_quantity?: number; available_weight?: number }[]
}
export type WarehouseLocationFilter = 'occupied' | 'available' | 'pending' | 'draft' | 'disabled'
export type WarehouseMaterial = { serial_no: string; material_name: string; material_type: string }
export type WarehouseLeaseGroup = Map<number, { key: string; material: string; owners: Set<symbol>; slot: WarehouseLocation }>
export type WarehouseLease = { id: number; name: string; key: string; expires_at: string; hold_until: string }
export const locationState = { available: '空闲', locked: '已锁定', occupied: '有料', disabled: '停用' }

async function request<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  try { return await httpRequest<T>(url, { method, body, noCache: true }) }
  catch (error) {
    const detail = error instanceof HttpRequestError && error.body && typeof error.body === 'object' ? (error.body as { detail?: unknown }).detail : null
    throw new Error(typeof detail === 'string' ? detail : '仓位操作失败，请重试', { cause: error })
  }
}

export const warehouseLocationApi = {
  list(query = '', page = 1, pageSize = 20, state?: WarehouseLocationFilter) {
    const params = new URLSearchParams({ query, page: String(page), page_size: String(pageSize) })
    if (state) params.set('state', state)
    return request<{ items: WarehouseLocation[]; total: number; team_id: number }>(`/warehouse-locations?${params}`)
  },
  save(payload: { name: string; active: boolean; expected_version?: number }, id?: number) {
    return request<WarehouseLocation>(`/warehouse-locations${id ? `/${id}` : ''}`, id ? 'PATCH' : 'POST', payload)
  },
  place(id: number, payload: { expected_version: number; source_transfer_id: number; quantity: number; weight: number }) {
    return request<WarehouseLocation>(`/warehouse-locations/${id}/placement`, 'POST', payload)
  },
  reserve(id: number, key: string, material?: WarehouseMaterial) { return request<WarehouseLease>(`/warehouse-locations/${id}/reservation`, 'POST', { key, ...material }) },
  async release(id: number, key: string, keepalive = false) {
    const path = `/warehouse-locations/${id}/reservation`
    if (!keepalive) return request<void>(path, 'DELETE', { key })
    // pagehide/unmount must outlive navigation; the server lease expires if
    // the browser is killed before this authenticated cleanup can arrive.
    const authorization = authorizationValue()
    await fetch(`${API_BASE}${path}`, { method: 'DELETE', credentials: 'include', keepalive: true,
      headers: { 'Content-Type': 'application/json', ...(authorization ? { Authorization: authorization } : {}) }, body: JSON.stringify({ key }) })
  },
}
