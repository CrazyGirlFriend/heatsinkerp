// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { httpRequest, HttpRequestError } from './httpClient'
import { materialDispatchApi } from './materialDispatchApi'
import { dispatchFixture } from '@/testFixtures/materialDispatch'
vi.mock('./httpClient', async original => ({ ...await original<typeof import('./httpClient')>(), httpRequest: vi.fn() }))
beforeEach(() => { vi.mocked(httpRequest).mockReset().mockResolvedValue(dispatchFixture(25)) })
describe('complete dispatch API', () => {
  it('reads all group lines and history from the dedicated endpoint without pagination', async () => {
    const result = await materialDispatchApi.get('ck-group')
    expect(httpRequest).toHaveBeenCalledWith('/material-dispatches/CK-GROUP', { noCache: true })
    expect(result.items).toHaveLength(25); expect(result.items[24]!.history).toHaveLength(1)
  })
  it.each([false, true])('sends required group revision and idempotency on outbound=%s', async outbound => {
    const body = { expected_revision: 'a'.repeat(64), idempotency_key: 'retry-key' }
    await materialDispatchApi.confirm('CK-GROUP', body, outbound)
    expect(httpRequest).toHaveBeenCalledWith(`/material-dispatches/CK-GROUP/${outbound ? 'confirm-outbound' : 'confirm'}`, { method: 'POST', body })
  })
  it.each([{ line_count: 26 }, { revision: '' }, { pending_line_count: 0 }, { barcode_payload: 'TL-WRONG' }])('rejects incomplete or inconsistent group data %s', async invalid => {
    vi.mocked(httpRequest).mockResolvedValue(dispatchFixture(25, 'transfer', invalid))
    await expect(materialDispatchApi.get('CK-GROUP')).rejects.toThrow('整批明细不完整')
  })
  it('localizes a changed group revision as a conflict for deliberate review', async () => {
    vi.mocked(httpRequest).mockRejectedValue(new HttpRequestError('failed', 409, { detail: 'dispatch revision mismatch' }))
    await expect(materialDispatchApi.get('CK-GROUP')).rejects.toMatchObject({ status: 409, message: '整批内容已变化，请刷新并重新核对' })
  })
})
