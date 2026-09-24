// @vitest-environment jsdom
import { AxiosError, AxiosHeaders, type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { teamDirectoryApi } from './teamDirectoryApi'
import { AUTH_SESSION_STORAGE_KEY, normalizeTeam } from './adminApi'
import { httpClient } from './httpClient'
import { SITE_ACCESS_REQUIRED_EVENT } from '@/stores/access'

let responseBody: unknown
let responseStatus = 200
const adapter = vi.fn<AxiosAdapter>(async (config: InternalAxiosRequestConfig) => {
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
  adapter.mockClear()
  httpClient.defaults.adapter = adapter
})
afterEach(() => { httpClient.defaults.adapter = originalAdapter })

describe('team directory API', () => {
  it('normalizes kind and display order while remaining compatible with existing teams', () => {
    expect(normalizeTeam({ id: 1, code: 'A', name: 'A', active: true, kind: 'warehouse', sort_order: 90 })).toMatchObject({ kind: 'warehouse', sort_order: 90 })
    expect(normalizeTeam({ id: 2, code: 'B', name: 'B' })).toMatchObject({ kind: 'production', sort_order: 0 })
  })

  it('reads the login-readable endpoint and sorts active groups without hardcoded names', async () => {
    responseBody = [
      { id: 9, code: 'CUSTOM', name: '新增自定义班组', active: true, sort_order: 20, kind: 'production' },
      { id: 4, code: 'OLD', name: '停用组', active: false, sort_order: 0 },
      { id: 3, code: 'FIRST', name: '自定义首组', active: true, sort_order: 10 },
    ]
    const teams = await teamDirectoryApi.listTeamDirectory()
    expect(teams.map((team) => team.name)).toEqual(['自定义首组', '新增自定义班组'])
    expect(adapter).toHaveBeenCalledOnce()
    expect(adapter.mock.calls[0]![0]).toMatchObject({ url: '/team-directory', baseURL: '/api', withCredentials: true })
  })

  it('closes the site gate on 423 without deleting account authentication', async () => {
    localStorage.setItem(AUTH_SESSION_STORAGE_KEY, 'existing-session')
    responseBody = { detail: '请先输入访问口令' }
    responseStatus = 423
    const listener = vi.fn()
    window.addEventListener(SITE_ACCESS_REQUIRED_EVENT, listener)
    await expect(teamDirectoryApi.listTeamDirectory()).rejects.toMatchObject({ status: 423 })
    expect(listener).toHaveBeenCalledOnce()
    expect(localStorage.getItem(AUTH_SESSION_STORAGE_KEY)).toBe('existing-session')
    window.removeEventListener(SITE_ACCESS_REQUIRED_EVENT, listener)
  })

  it('invalidates account authentication on 401', async () => {
    localStorage.setItem(AUTH_SESSION_STORAGE_KEY, 'expired-session')
    responseBody = { detail: '登录已过期' }
    responseStatus = 401
    await expect(teamDirectoryApi.listTeamDirectory()).rejects.toMatchObject({ status: 401 })
    expect(localStorage.getItem(AUTH_SESSION_STORAGE_KEY)).toBeNull()
  })

  it('fails explicitly on a malformed directory rather than rendering invented groups', async () => {
    responseBody = { error: 'not a list' }
    await expect(teamDirectoryApi.listTeamDirectory()).rejects.toThrow('班组目录数据格式无效')
  })
})
