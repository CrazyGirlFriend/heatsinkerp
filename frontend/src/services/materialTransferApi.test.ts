// @vitest-environment jsdom
import { AxiosError, AxiosHeaders, type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { httpClient } from './httpClient'
import { materialTransferApi, normalizeMaterialTransfer } from './materialTransferApi'
import {
  canConfirmMaterialTransfer,
  canEditMaterialTransfer,
  canVoidMaterialTransfer,
  materialDocumentTextFields,
  materialTypeOptions,
} from '@/types/materialTransfer'

const configs: InternalAxiosRequestConfig[] = []
let responder: (config: InternalAxiosRequestConfig) => { status?: number; data?: unknown }
const adapter: AxiosAdapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
  configs.push(config)
  const result = responder(config)
  const response: AxiosResponse = {
    data: result.data,
    status: result.status ?? 200,
    statusText: (result.status ?? 200) >= 400 ? 'Error' : 'OK',
    headers: new AxiosHeaders({ 'Content-Type': 'application/json' }),
    config,
  }
  if (response.status >= 400) throw new AxiosError('request failed', AxiosError.ERR_BAD_REQUEST, config, undefined, response)
  return response
})
const originalAdapter = httpClient.defaults.adapter

function rawTransfer(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    batch_no: 'TL20260906000007',
    barcode_payload: 'TL20260906000007',
    barcode_type: 'CODE128',
    serial_no: 'LS-2026-007',
    source_team_id: 2,
    source_team: { id: 2, code: 'ZB', name: '扎板' },
    next_team_id: 3,
    next_team: { id: 3, code: 'TH', name: '退火' },
    quantity: 120,
    quantity_unit: '件',
    weight: 18.75,
    weight_unit: 'kg',
    status: 'pending',
    notes: '当班转料',
    created_by: '扎板班组长',
    created_by_user_id: 12,
    created_at: '2026-09-06T01:20:00Z',
    updated_at: '2026-09-06T01:20:00Z',
    received_by: null,
    received_by_user_id: null,
    received_at: null,
    locked: false,
    locked_at: null,
    allowed_actions: ['edit', 'void'],
    ...overrides,
  }
}

beforeEach(() => {
  configs.length = 0
  httpClient.defaults.adapter = adapter
  responder = () => ({ data: rawTransfer() })
  vi.mocked(adapter).mockClear()
})

afterEach(() => { httpClient.defaults.adapter = originalAdapter })

describe('material transfer API', () => {
  it('loads a complete exact-serial trace and keeps unaccounted balances null', async () => {
    responder = () => ({ data: { serial_no: '000012', items: [rawTransfer({ serial_no: '000012', source_transfer_id: 5, on_hand_quantity: null, on_hand_weight: null })], positions: [], untracked_count: 0, totals: {} } })
    const result = await materialTransferApi.trace(' 000012 ')
    expect(configs[0]).toMatchObject({ method: 'get', url: '/material-trace?serial_no=000012' })
    expect(result.items[0]).toMatchObject({ serial_no: '000012', source_transfer_id: 5, on_hand_quantity: null, on_hand_weight: null, next_team: { name: '退火' } })
  })
  it('uses confirm-outbound and preserves null destination, dispatched actor and audit', async () => {
    responder = () => ({ data: rawTransfer({ entry_kind: 'warehouse_outbound', external_destination: '外部去向', next_team: null, next_team_id: null, status: 'dispatched', locked: true, stock_tracked: false, dispatched_by: '库房确认人', dispatched_by_user_id: 12, dispatched_at: '2026-09-07T01:00:00Z', allowed_actions: [], history: [{ id: 17, action: 'dispatched', actor: '库房确认人', occurred_at: '2026-09-07T01:00:00Z', changes: {} }] }) })
    const result = await materialTransferApi.confirmOutbound('TL20260906000007', { idempotency_key: 'outbound-retry', expected_version: 4 })
    expect(configs[0]).toMatchObject({ method: 'post', url: '/material-transfers/TL20260906000007/confirm-outbound' })
    expect(JSON.parse(configs[0]!.data)).toEqual({ idempotency_key: 'outbound-retry', expected_version: 4 })
    expect(result).toMatchObject({ entry_kind: 'warehouse_outbound', next_team: { id: '', code: '', name: '外部去向' }, status: 'dispatched', stock_tracked: false, dispatched_by: '库房确认人', history: [{ action: 'dispatched' }] })
  })
  it('preserves the current directory kind and team/direction scope on list and all counts', async () => {
    expect(normalizeMaterialTransfer(rawTransfer({ next_team: { id: 1, name: '中央收发站', kind: 'warehouse' } })).next_team.kind).toBe('warehouse')
    expect(normalizeMaterialTransfer(rawTransfer()).source_team.kind).toBeUndefined()
    responder = () => ({ data: { items: [], total: 0 } })
    await materialTransferApi.list({ team_id: 3, direction: 'incoming', material_type: 'semi_finished', page: 2 })
    await materialTransferApi.counts({ team_id: 3, direction: 'incoming', material_type: 'semi_finished' })
    expect(configs).toHaveLength(5)
    configs.forEach(config => {
      const query = new URL(config.url!, 'https://test.invalid').searchParams
      expect(query.get('team_id')).toBe('3')
      expect(query.get('direction')).toBe('incoming')
      expect(query.get('material_type')).toBe('semi_finished')
    })
  })

  it.each(['contains', 'exact', 'prefix'] as const)('uses identical %s search semantics for the list and every status count', async search_mode => {
    responder = () => ({ data: { items: [], total: 0, page: 1, page_size: 20 } })
    const scope = { query: 'AL%_ 001', search_mode, search_field: 'material_name' as const, material_type: 'sludge' as const }
    await materialTransferApi.list({ ...scope, page: 2 })
    await materialTransferApi.counts(scope)
    expect(configs).toHaveLength(5)
    for (const config of configs) {
      const params = new URL(config.url!, 'https://test.invalid').searchParams
      for (const [key, value] of Object.entries(scope)) expect(params.get(key)).toBe(value)
    }
  })

  it('leaves historical document fields absent in the API as null, with no invented version or history', () => {
    const transfer = normalizeMaterialTransfer(rawTransfer())
    materialDocumentTextFields.forEach(field => expect(transfer[field.key]).toBeNull())
    expect(transfer).toMatchObject({ material_type: null, finished_quantity: null, version: null, history: [] })
  })

  it.each(materialTypeOptions)('retains $label, zero finished quantity and genuine audit changes', ({ value }) => {
    const history = [{ id: 21, action: 'updated', actor: '李师傅', occurred_at: '2026-09-06T03:15:00Z', changes: { quantity: { before: 120, after: 0 }, customer_code: { before: '001440', after: null } } }]
    expect(normalizeMaterialTransfer(rawTransfer({ material_type: value, source_batch_no: 'RAW-001', customer_code: '001440', finished_quantity: 0, quantity: 0, version: 3, history }))).toMatchObject({ material_type: value, source_batch_no: 'RAW-001', customer_code: '001440', finished_quantity: 0, quantity: 0, version: 3, history })
  })

  it('sends explicit clears and the reviewed version on edits and confirmations', async () => {
    await materialTransferApi.update('TL20260906000007', { material_name: null, finished_quantity: 0, expected_version: 4 })
    expect(JSON.parse(String(configs[0]!.data))).toEqual({ material_name: null, finished_quantity: 0, expected_version: 4 })
    await materialTransferApi.confirm('TL20260906000007', { idempotency_key: 'receipt-v4', expected_version: 4 })
    expect(JSON.parse(String(configs[1]!.data))).toEqual({ idempotency_key: 'receipt-v4', expected_version: 4 })
    responder = () => ({ status: 409, data: { detail: 'material transfer has changed; refresh and review before continuing' } })
    await expect(materialTransferApi.confirm('TL20260906000007', { idempotency_key: 'receipt-v4', expected_version: 4 })).rejects.toMatchObject({ status: 409, message: '转料单已更新，请重新核对最新内容' })
  })

  it('normalizes the pure handoff response without process or work-order data', () => {
    const transfer = normalizeMaterialTransfer(rawTransfer())
    expect(transfer).toMatchObject({
      batch_no: 'TL20260906000007',
      serial_no: 'LS-2026-007',
      source_team: { id: 2, code: 'ZB', name: '扎板' },
      next_team: { id: 3, code: 'TH', name: '退火' },
      quantity: 120,
      quantity_unit: '件',
      weight: 18.75,
      weight_unit: 'kg',
      transferred_by: '扎板班组长',
      transferred_at: '2026-09-06T01:20:00Z',
    })
    expect(transfer).not.toHaveProperty('work_order_id')
    expect(transfer).not.toHaveProperty('operation_report_id')
    expect(transfer).not.toHaveProperty('product_name')
  })

  it('lists by canonical filters and retrieves an exact scanned batch', async () => {
    responder = (config) => config.url?.startsWith('/material-transfers?')
      ? { data: { items: [rawTransfer()], total: 1, page: 1, page_size: 20 } }
      : { data: rawTransfer() }
    const list = await materialTransferApi.list({
      query: 'TL 007',
      status: 'pending',
      source_team_id: 2,
      next_team_id: 3,
      page: 1,
      page_size: 20,
    })
    const exact = await materialTransferApi.get('TL20260906000007')
    expect(list.items).toHaveLength(1)
    expect(configs[0]!.url).toBe('/material-transfers?query=TL+007&status=pending&source_team_id=2&next_team_id=3&page=1&page_size=20')
    expect(configs[1]!.url).toBe('/material-transfers/TL20260906000007')
    expect(exact.barcode_type).toBe('CODE128')
  })

  it('creates and edits only the material handoff fields', async () => {
    await materialTransferApi.create({
      serial_no: 'LS-2026-008',
      next_team_id: 3,
      quantity: 80,
      weight: 12.4,
      notes: '夜班交接',
      idempotency_key: 'create-transfer-8',
    })
    await materialTransferApi.update('TL20260906000007', {
      serial_no: 'LS-2026-008',
      next_team_id: 4,
      quantity: 78,
      weight: 12.1,
      notes: null,
    })
    expect(configs[0]).toMatchObject({ method: 'post', url: '/material-transfers' })
    expect(JSON.parse(String(configs[0]!.data))).toEqual({
      serial_no: 'LS-2026-008', next_team_id: 3, quantity: 80, weight: 12.4, notes: '夜班交接', idempotency_key: 'create-transfer-8',
    })
    expect(configs[1]).toMatchObject({ method: 'patch', url: '/material-transfers/TL20260906000007' })
    expect(JSON.parse(String(configs[1]!.data))).not.toHaveProperty('source_team_id')
  })

  it('uses server totals for every status with the same search and team scope', async () => {
    responder = (config) => {
      const params = new URL(config.url!, 'https://test.invalid').searchParams
      const totals: Record<string, number> = { pending: 112, received: 214, voided: 2, dispatched: 8 }
      return { data: { total: totals[params.get('status')!], items: [rawTransfer()] } }
    }
    expect(await materialTransferApi.counts({ query: 'HS 001', source_team_id: 2, next_team_id: 3 })).toEqual({ all: 336, pending: 112, received: 214, voided: 2, dispatched: 8 })
    expect(configs).toHaveLength(4)
    for (const config of configs) {
      const params = new URL(config.url!, 'https://test.invalid').searchParams
      expect(params.get('query')).toBe('HS 001')
      expect(params.get('source_team_id')).toBe('2')
      expect(params.get('next_team_id')).toBe('3')
      expect(params.get('page')).toBe('1')
      expect(params.get('page_size')).toBe('1')
    }
  })

  it('rejects missing totals instead of presenting a partial page length as a status count', async () => {
    responder = () => ({ data: { items: [rawTransfer()] } })
    await expect(materialTransferApi.counts()).rejects.toThrow('暂时无法获取状态数量')
  })

  it('confirms without quantity input and returns the permanently locked record', async () => {
    responder = () => ({ data: rawTransfer({
      status: 'received',
      received_by: '退火班组长',
      received_at: '2026-09-06T02:10:00Z',
      locked: true,
      allowed_actions: [],
    }) })
    const received = await materialTransferApi.confirm('TL20260906000007', { idempotency_key: 'confirm-transfer-7' })
    expect(configs[0]).toMatchObject({ method: 'post', url: '/material-transfers/TL20260906000007/confirm' })
    expect(JSON.parse(String(configs[0]!.data))).toEqual({ idempotency_key: 'confirm-transfer-7' })
    expect(received).toMatchObject({ status: 'received', received_by: '退火班组长', locked: true })
    expect(canEditMaterialTransfer(received)).toBe(false)
    expect(canVoidMaterialTransfer(received)).toBe(false)
    expect(canConfirmMaterialTransfer(received)).toBe(false)
  })

  it('derives each pending-role action solely from server permissions', () => {
    const sourceView = normalizeMaterialTransfer(rawTransfer({ allowed_actions: ['edit', 'void'] }))
    const targetView = normalizeMaterialTransfer(rawTransfer({ allowed_actions: ['confirm'] }))
    const adminView = normalizeMaterialTransfer(rawTransfer({ allowed_actions: [] }))
    expect([canEditMaterialTransfer(sourceView), canVoidMaterialTransfer(sourceView), canConfirmMaterialTransfer(sourceView)]).toEqual([true, true, false])
    expect([canEditMaterialTransfer(targetView), canVoidMaterialTransfer(targetView), canConfirmMaterialTransfer(targetView)]).toEqual([false, false, true])
    expect([canEditMaterialTransfer(adminView), canVoidMaterialTransfer(adminView), canConfirmMaterialTransfer(adminView)]).toEqual([false, false, false])
  })

  it('reloads the canonical record after a 204 void response and localizes a missing batch', async () => {
    responder = (config) => {
      if (config.method === 'delete') return { status: 204, data: undefined }
      if (config.url?.endsWith('/MISSING')) return { status: 404, data: { detail: 'not found' } }
      return { data: rawTransfer({ status: 'voided', locked: true, allowed_actions: [], voided_by: '扎板班组长', voided_at: '2026-09-06T03:00:00Z' }) }
    }
    const voided = await materialTransferApi.void('TL20260906000007')
    expect(configs[0]).toMatchObject({ method: 'delete', url: '/material-transfers/TL20260906000007' })
    expect(configs[1]).toMatchObject({ method: 'get', url: '/material-transfers/TL20260906000007' })
    expect(voided).toMatchObject({ status: 'voided', voided_by: '扎板班组长', locked: true })
    await expect(materialTransferApi.get('MISSING')).rejects.toMatchObject({ status: 404, message: '未找到该转料单' })
  })
})
