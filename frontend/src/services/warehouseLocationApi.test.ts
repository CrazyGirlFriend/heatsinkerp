// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AxiosHeaders, type InternalAxiosRequestConfig } from 'axios'
import { httpClient } from './httpClient'
import { warehouseLocationApi } from './warehouseLocationApi'

const requests: InternalAxiosRequestConfig[] = []
const originalAdapter = httpClient.defaults.adapter
beforeEach(() => {
  requests.length = 0
  httpClient.defaults.adapter = async config => {
    requests.push(config)
    return { data: { items: [], total: 0, team_id: 1 }, status: 200, statusText: '', headers: new AxiosHeaders(), config }
  }
})
afterEach(() => { httpClient.defaults.adapter = originalAdapter })

describe('warehouse catalog API', () => {
  it('sends server-side card pagination and filters while retaining the default for other callers', async () => {
    await warehouseLocationApi.list('材料1 & A-01', 2, 50, 'pending')
    await warehouseLocationApi.list()
    const filtered = new URL(requests[0]!.url!, 'http://localhost').searchParams
    expect(Object.fromEntries(filtered)).toEqual({ query: '材料1 & A-01', page: '2', page_size: '50', state: 'pending' })
    const defaults = new URL(requests[1]!.url!, 'http://localhost').searchParams
    expect(Object.fromEntries(defaults)).toEqual({ query: '', page: '1', page_size: '20' })
  })
})
