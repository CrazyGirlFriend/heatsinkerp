// @vitest-environment jsdom
import { AxiosError, AxiosHeaders, type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTH_SESSION_STORAGE_KEY } from './adminApi'
import { httpClient, httpRequest } from './httpClient'
import { SITE_ACCESS_REQUIRED_EVENT } from '@/stores/access'

let responseBody: unknown
let responseStatus = 200
let networkFailure = false
const adapter = vi.fn<AxiosAdapter>(async (config: InternalAxiosRequestConfig) => {
  if (networkFailure) throw new AxiosError('Network Error', AxiosError.ERR_NETWORK, config)
  const response: AxiosResponse = {
    data: responseBody,
    status: responseStatus,
    statusText: responseStatus >= 400 ? 'Error' : 'OK',
    headers: new AxiosHeaders({ 'Content-Type': 'application/json' }),
    config,
  }
  if (responseStatus >= 400) {
    throw new AxiosError(`Request failed with status code ${responseStatus}`, AxiosError.ERR_BAD_REQUEST, config, undefined, response)
  }
  return response
})
const originalAdapter = httpClient.defaults.adapter

beforeEach(() => {
  localStorage.clear()
  responseBody = undefined
  responseStatus = 200
  networkFailure = false
  adapter.mockClear()
  httpClient.defaults.adapter = adapter
})

afterEach(() => { httpClient.defaults.adapter = originalAdapter })

describe('shared Axios client', () => {
  it('uses the shared base URL, credentials, JSON headers and current authorization', async () => {
    localStorage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify({ access_token: 'shared-token', token_type: 'Bearer' }))
    responseBody = { ok: true }
    await expect(httpRequest('/material-transfers', { method: 'POST', body: JSON.stringify({ serial_no: 'SERIAL-1' }) })).resolves.toEqual({ ok: true })

    const config = adapter.mock.calls[0]![0]
    expect(config).toMatchObject({ url: '/material-transfers', method: 'post', baseURL: '/api', withCredentials: true })
    expect(config.data).toBe(JSON.stringify({ serial_no: 'SERIAL-1' }))
    expect(config.headers.get('Accept')).toBe('application/json')
    expect(config.headers.get('Content-Type')).toBe('application/json')
    expect(config.headers.get('Authorization')).toBe('Bearer shared-token')
  })

  it('normalizes an empty 204 response to undefined', async () => {
    responseStatus = 204
    responseBody = ''
    await expect(httpRequest('/auth/logout', { method: 'POST' })).resolves.toBeUndefined()
  })

  it('locks site access on 423 while preserving account authentication', async () => {
    localStorage.setItem(AUTH_SESSION_STORAGE_KEY, 'account-session')
    responseStatus = 423
    responseBody = { detail: '请先输入访问口令' }
    const listener = vi.fn()
    window.addEventListener(SITE_ACCESS_REQUIRED_EVENT, listener)

    await expect(httpRequest('/material-transfers')).rejects.toMatchObject({ status: 423, body: responseBody })
    expect(listener).toHaveBeenCalledOnce()
    expect(localStorage.getItem(AUTH_SESSION_STORAGE_KEY)).toBe('account-session')
    window.removeEventListener(SITE_ACCESS_REQUIRED_EVENT, listener)
  })

  it('invalidates a stale session on 401 except for a rejected login request', async () => {
    responseStatus = 401
    responseBody = { detail: 'invalid credentials' }
    localStorage.setItem(AUTH_SESSION_STORAGE_KEY, 'stale-session')
    await expect(httpRequest('/material-transfers')).rejects.toMatchObject({ status: 401 })
    expect(localStorage.getItem(AUTH_SESSION_STORAGE_KEY)).toBeNull()

    localStorage.setItem(AUTH_SESSION_STORAGE_KEY, 'keep-during-login')
    await expect(httpRequest('/auth/login', { method: 'POST', skipAuthExpiry: true })).rejects.toMatchObject({ status: 401 })
    expect(localStorage.getItem(AUTH_SESSION_STORAGE_KEY)).toBe('keep-during-login')
  })

  it('converts Axios network failures to a status-zero transport error', async () => {
    networkFailure = true
    await expect(httpRequest('/material-transfers')).rejects.toMatchObject({ status: 0, message: 'Network Error' })
  })
})
