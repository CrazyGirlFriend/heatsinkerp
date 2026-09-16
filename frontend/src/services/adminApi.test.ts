// @vitest-environment jsdom
import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { adminApi, AUTH_SESSION_STORAGE_KEY } from './adminApi'
import { httpClient } from './httpClient'

const originalAdapter = httpClient.defaults.adapter
const requests: InternalAxiosRequestConfig[] = []
let data: unknown
let status = 200
beforeEach(() => {
  localStorage.clear(); requests.length = 0; status = 200; data = {}
  httpClient.defaults.adapter = async config => {
    requests.push(config)
    const response = { data, status, statusText: '', headers: new AxiosHeaders(), config }
    if (status >= 400) throw new AxiosError('request failed', AxiosError.ERR_BAD_REQUEST, config, undefined, response)
    return response
  }
})
afterEach(() => { httpClient.defaults.adapter = originalAdapter; localStorage.clear() })

describe('current authentication and team administration API', () => {
  it('logs in through the server and propagates service failure without creating a demo session', async () => {
    data = { access_token: 'server-token', token_type: 'Bearer', user: { id: 1, username: 'admin', role: 'ADMIN', active: true } }
    const session = await adminApi.login({ username: 'admin', password: 'test-password' })
    expect(session).toMatchObject({ access_token: 'server-token', user: { role: 'ADMIN', team_id: null } })
    expect(requests[0]).toMatchObject({ url: '/auth/login', method: 'post' })
    expect(JSON.parse(requests[0]!.data)).toEqual({ username: 'admin', password: 'test-password' })
    status = 503; data = { detail: 'service unavailable' }
    await expect(adminApi.login({ username: 'admin', password: 'test-password' })).rejects.toMatchObject({ status: 503 })
    expect(localStorage.getItem(AUTH_SESSION_STORAGE_KEY)).toBeNull()
  })

  it('reads the authenticated current-user endpoint and does not probe obsolete aliases on 404', async () => {
    localStorage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify({ access_token: 'account-token' }))
    data = { id: 2, username: 'leader', role: 'TEAM', team_id: 914, team: { id: 914, code: 'FACTORY-ROLL', name: '轧制' }, active: true }
    expect(await adminApi.currentUser()).toMatchObject({ role: 'TEAM', team_id: 914 })
    expect(requests[0]!.url).toBe('/auth/me')
    expect(requests[0]!.headers.get('Authorization')).toBe('Bearer account-token')
    status = 404
    await expect(adminApi.currentUser()).rejects.toMatchObject({ status: 404 })
    expect(requests.map(request => request.url)).toEqual(['/auth/me', '/auth/me'])
  })

  it('preserves account binding validation and uses current create, patch and delete endpoints', async () => {
    await expect(adminApi.createAccount({ username: 'leader', display_name: '班组长', password: 'test-password', role: 'TEAM', team_id: null })).rejects.toMatchObject({ status: 422 })
    expect(requests).toHaveLength(0)
    data = { id: 7, username: 'admin2', role: 'ADMIN', team_id: null }
    await adminApi.createAccount({ username: 'admin2', display_name: '管理员', password: 'test-password', role: 'ADMIN', team_id: 914 })
    expect(JSON.parse(requests[0]!.data).team_id).toBeNull()
    await adminApi.updateAccount(7, { display_name: '新名称', active: false })
    status = 204; await adminApi.deleteAccount(7)
    expect(requests.map(request => [request.url, request.method])).toEqual([['/accounts', 'post'], ['/accounts/7', 'patch'], ['/accounts/7', 'delete']])
  })

  it('retains team list filters, warehouse kind, create, edit and delete behavior', async () => {
    data = [{ id: 900, code: 'FACTORY-WAREHOUSE', name: '库房', kind: 'warehouse', active: true }]
    expect(await adminApi.listTeams({ query: '库房', active: true })).toMatchObject([{ id: 900, kind: 'warehouse' }])
    expect(requests[0]!.url).toBe('/teams?query=%E5%BA%93%E6%88%BF&active=true')
    data = { id: 900, code: 'FACTORY-WAREHOUSE', name: '库房', kind: 'warehouse', active: true }
    await adminApi.createTeam({ code: 'FACTORY-WAREHOUSE', name: '库房', kind: 'warehouse' })
    await adminApi.updateTeam(900, { description: '调整说明' })
    status = 204; await adminApi.deleteTeam(900)
    expect(requests.slice(1).map(request => [request.url, request.method])).toEqual([['/teams', 'post'], ['/teams/900', 'patch'], ['/teams/900', 'delete']])
  })
})
