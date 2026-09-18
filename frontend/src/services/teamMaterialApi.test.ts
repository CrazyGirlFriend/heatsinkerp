// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios'
import { httpClient } from './httpClient'
import { teamMaterialApi, TeamMaterialApiError } from './teamMaterialApi'
let data: unknown
let status = 200
const requests: InternalAxiosRequestConfig[] = []
const originalAdapter = httpClient.defaults.adapter
beforeEach(() => {
  requests.length = 0; status = 200
  httpClient.defaults.adapter = async config => {
    requests.push(config)
    const response = { data, status, statusText: '', headers: new AxiosHeaders(), config }
    if (status >= 400) throw new AxiosError('request failed', AxiosError.ERR_BAD_REQUEST, config, undefined, response)
    return response
  }
})
afterEach(() => { httpClient.defaults.adapter = originalAdapter })
describe('team material API contract', () => {
  it('posts an external group with no receiving team and preserves its filtered destination and completion state', async () => {
    const raw = { dispatch_no: 'CK-EXTERNAL', entry_kind: 'inspection_shipment', external_destination: '客户仓库', next_team: null, status: 'dispatched', total_quantity: 4, total_weight: '0.005', items: [{ batch_no: 'TL-EXTERNAL', entry_kind: 'inspection_shipment', external_destination: '客户仓库', next_team: null, status: 'dispatched', stock_tracked: false }] }
    data = raw
    const payload = { entry_kind: 'inspection_shipment' as const, external_destination: '客户仓库', idempotency_key: 'same-external-group', lines: [{ source_transfer_id: 9, quantity: 4, weight: 0.005 }] }
    const group = await teamMaterialApi.createDispatch(8, payload)
    expect(JSON.parse(requests[0]!.data)).toEqual(payload)
    expect(Object.keys(group)).toEqual(['items'])
    expect(requests[0]!.url).toBe('/team-materials/8/outbound-batches')
    expect(group.items[0]).toMatchObject({ status: 'dispatched', next_team: { id: '', name: '客户仓库' }, stock_tracked: false })
    data = { items: raw.items, total: 1, page: 1, page_size: 20 }
    await teamMaterialApi.dispatches(8, { entry_kind: 'inspection_shipment', status: 'dispatched', query: '客户' })
    expect(requests[1]!.url).toBe('/team-materials/8/outbound-batches?entry_kind=inspection_shipment&status=dispatched&query=%E5%AE%A2%E6%88%B7')
  })
  it('posts warehouse receipts without a source or destination and reads a filtered receipt page', async () => {
    const raw = { id: 50, batch_no: 'TL-ROOT', entry_kind: 'warehouse_receipt', source_team: null, source_team_id: null, next_team: { id: 901, name: '库房', kind: 'warehouse' }, status: 'received', stock_tracked: true, locked: true, history: [{ id: 10, action: 'stocked', actor: '库管', occurred_at: '2026-09-07T00:00:00Z', changes: {} }] }
    data = raw
    const body = { serial_no: 'QA-IN', material_name: '铜钼', material_type: 'semi_finished' as const, quantity: 0, weight: 0.005, notes: '到货入库', idempotency_key: 'one-root' }
    const saved = await teamMaterialApi.createReceipt(901, body)
    expect(requests[0]!.url).toBe('/team-materials/901/receipts')
    expect(JSON.parse(requests[0]!.data)).toEqual(body)
    expect(saved).toMatchObject({ entry_kind: 'warehouse_receipt', source_team: { id: '', code: '', name: '库房手工入库' }, locked: true, stock_tracked: true, history: [{ action: 'stocked' }] })
    data = { items: [raw], total: 1, page: 2, page_size: 10 }
    const page = await teamMaterialApi.receipts(901, { query: '铜 钼', material_type: 'semi_finished', page: 2, page_size: 10 })
    expect(requests[1]!.url).toBe('/team-materials/901/receipts?query=%E9%93%9C+%E9%92%BC&material_type=semi_finished&page=2&page_size=10')
    expect(page.items[0]).toEqual(saved)
  })
  it.each([[409, 'insufficient available stock for source transfer 12', '来源批次余额不足'], [403, 'only the owning team can write', '当前账号不能操作此班组物料']])('localizes English API error %s for the material workspace', async (code, detail, message) => {
    status = Number(code); data = { detail }
    await expect(teamMaterialApi.overview(2)).rejects.toMatchObject({ status: code, message: expect.stringContaining(String(message)) })
  })

  it('preserves unknown balances, numeric decimals, and empty material names without inventing zero', async () => {
    data = { totals: { available_quantity: 0, available_weight: '1.005' }, materials: [{ material_name: null, received_quantity: 0 }], pending_incoming: { count: 0, weight: '0.000' }, legacy_received_count: 2 }
    const result = await teamMaterialApi.overview(914)
    expect(requests[0]!.url).toBe('/team-materials/914/overview')
    expect(result.totals).toMatchObject({ available_quantity: 0, available_weight: 1.005, received_quantity: null })
    expect(result.materials[0]).toMatchObject({ material_name: null, received_quantity: 0 })
    expect(result.pending_incoming).toEqual({ count: 0, quantity: null, weight: 0 })
  })
  it('keeps stock filters and linked transfer identity, and rejects invalid team ids', async () => {
    data = { items: [{ transfer: { id: 19, batch_no: 'TL19', source_transfer_id: 8, source_transfer_batch_no: 'TL8', stock_tracked: true, dispatch_no: 'CK3' }, available_quantity: '8', available_weight: '0.333' }], total: 1, page: 2, page_size: 10 }
    const result = await teamMaterialApi.stock(914, { query: '铜 钼', material_type: 'sludge', availability: 'all', page: 2, page_size: 10 })
    expect(requests[0]!.url).toBe('/team-materials/914/stock?query=%E9%93%9C+%E9%92%BC&material_type=sludge&availability=all&page=2&page_size=10')
    expect(result.items[0]).toMatchObject({ available_quantity: 8, available_weight: 0.333, transfer: { source_transfer_id: 8, stock_tracked: true, dispatch_no: 'CK3' } })
    expect(() => teamMaterialApi.stock(0)).toThrow('无效的班组编号')
  })
  it('passes idempotency and untouched source lines atomically and retains conflict status', async () => {
    const payload = { next_team_id: 3, idempotency_key: 'unchanged-retry', lines: [{ source_transfer_id: 5, quantity: 0, weight: 1.005 }, { source_transfer_id: 8, quantity: 5, weight: 0 }] }
    status = 409; data = { detail: '余额不足' }
    await expect(teamMaterialApi.createDispatch(2, payload)).rejects.toMatchObject({ status: 409, message: '余额不足' } satisfies Partial<TeamMaterialApiError>)
    expect(requests[0]!.url).toBe('/team-materials/2/outbound-batches')
    expect(JSON.parse(requests[0]!.data)).toEqual(payload)
  })
})
