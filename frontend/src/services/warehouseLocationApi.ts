import { API_BASE, authorizationValue, httpRequest, HttpRequestError } from './httpClient'

export type WarehouseLocation = {
  id: number; team_id: number; name: string; active: boolean; version: number
  status: 'available' | 'locked' | 'occupied' | 'disabled'; has_stock: boolean
  batches: { id: number; batch_no: string; serial_no: string; quantity: number; weight: number; status: string }[]
}
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
  list(query = '', page = 1) { return request<{ items: WarehouseLocation[]; total: number; team_id: number }>(`/warehouse-locations?${new URLSearchParams({ query, page: String(page), page_size: '20' })}`) },
  save(payload: { name: string; active: boolean; expected_version?: number }, id?: number) {
    return request<WarehouseLocation>(`/warehouse-locations${id ? `/${id}` : ''}`, id ? 'PATCH' : 'POST', payload)
  },
  reserve(id: number, key: string) { return request<WarehouseLease>(`/warehouse-locations/${id}/reservation`, 'POST', { key }) },
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
