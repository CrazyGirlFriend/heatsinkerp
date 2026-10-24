// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { productionScheduleApi } from './productionScheduleApi'
import { HttpRequestError } from './httpClient'
import * as http from './httpClient'
afterEach(() => {
  vi.restoreAllMocks()
})
describe('production schedule API errors', () => {
  it('keeps conflict status and request id while showing the actual server message', async () => {
    vi.spyOn(http, 'httpRequest').mockRejectedValue(
      new HttpRequestError(
        'Request failed with status code 409',
        409,
        { detail: '排期已被修改，请刷新后重试' },
        '0123456789abcdef0123456789abcdef',
      ),
    )
    await expect(productionScheduleApi.cancel(5, { expected_version: 2 })).rejects.toMatchObject({
      message: '排期已被修改，请刷新后重试',
      status: 409,
      requestId: '0123456789abcdef0123456789abcdef',
    })
  })
  it('shows field validation messages rather than a generic HTTP failure', async () => {
    vi.spyOn(http, 'httpRequest').mockRejectedValue(
      new HttpRequestError('Request failed with status code 422', 422, {
        detail: [{ msg: 'Value error, 交货时间请精确到整点小时' }],
      }),
    )
    await expect(productionScheduleApi.detail(1)).rejects.toMatchObject({
      message: '交货时间请精确到整点小时',
      status: 422,
    })
  })
  it('encodes date time zones and batch search text without dropping exact serial scope', async () => {
    const request = vi.spyOn(http, 'httpRequest').mockResolvedValue({ items: [], total: 0 })
    await productionScheduleApi.list({
      serial_no: '0805/5',
      query: '批次 A&B',
      due_from: '2026-10-22T00:00:00+08:00',
      team_id: 2,
    })
    const params = new URL(request.mock.calls[0]![0], 'http://localhost').searchParams
    expect(Object.fromEntries(params)).toEqual({
      serial_no: '0805/5',
      query: '批次 A&B',
      due_from: '2026-10-22T00:00:00+08:00',
      team_id: '2',
    })
  })
  it('preserves multiple exact serials, including commas, and business-person filters', async () => {
    const request = vi.spyOn(http, 'httpRequest').mockResolvedValue({ items: [], total: 0 })
    await productionScheduleApi.tasks({
      serial_nos: ['A,B', 'C&1'],
      business_person_ids: [1, 2],
      scope: 'attention',
    })
    const params = new URL(request.mock.calls[0]![0], 'http://localhost').searchParams
    expect(params.getAll('serial_nos')).toEqual(['A,B', 'C&1'])
    expect(params.getAll('business_person_ids')).toEqual(['1', '2'])
    expect(params.get('scope')).toBe('attention')
  })
})
