// @vitest-environment jsdom
import { AxiosHeaders, type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Team } from '@/services/adminApi'

const mocks = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('@/services/teamDirectoryApi', () => ({ teamDirectoryApi: { listTeamDirectory: mocks.list } }))

import { authState, clearSession } from '@/stores/auth'
import { accessHttpClient, checkSiteAccess, notifySiteAccessRequired } from '@/stores/access'
import { teamDirectory, refreshTeamDirectory } from './teamDirectory'

const team: Team = { id: 7, code: 'CUSTOM', name: '自定义生产班组', active: true, sort_order: 10, kind: 'production' }
const originalAccessAdapter = accessHttpClient.defaults.adapter
const accessAdapter: AxiosAdapter = async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => ({
  data: { enabled: true, unlocked: true }, status: 200, statusText: 'OK', headers: new AxiosHeaders(), config,
})

function signIn(token: string): void {
  authState.session = { access_token: token, token_type: 'Bearer', user: { id: token, username: token, display_name: token, role: 'TEAM', team_id: 7, team, active: true } }
}

beforeEach(async () => {
  clearSession()
  mocks.list.mockReset().mockResolvedValue([team])
  accessHttpClient.defaults.adapter = accessAdapter
  await checkSiteAccess(true)
})

afterEach(() => { clearSession(); accessHttpClient.defaults.adapter = originalAccessAdapter; vi.unstubAllGlobals() })

describe('session-scoped dynamic team directory', () => {
  it('retains a verified directory during same-account background refresh', async () => {
    signIn('account-a')
    await flushPromises()
    let finish!: (teams: Team[]) => void
    mocks.list.mockReturnValueOnce(new Promise<Team[]>(resolve => { finish = resolve }))
    const pending = refreshTeamDirectory()
    expect(teamDirectory.loading).toBe(true)
    expect(teamDirectory.loaded).toBe(true)
    expect(teamDirectory.items[0]?.name).toBe(team.name)
    finish([team])
    await pending
    expect(teamDirectory.items[0]?.name).toBe(team.name)
  })

  it('does not fetch or disclose teams until both the gate and account are authenticated', async () => {
    await refreshTeamDirectory()
    expect(mocks.list).not.toHaveBeenCalled()
    expect(teamDirectory.items).toEqual([])
    signIn('account-a')
    await flushPromises()
    expect(teamDirectory.items.map((item) => item.name)).toEqual(['自定义生产班组'])
  })

  it('refreshes newly created or renamed groups from the server', async () => {
    signIn('account-a')
    await flushPromises()
    mocks.list.mockResolvedValue([{ ...team, name: '更新后的班组', sort_order: 80 }])
    await refreshTeamDirectory()
    expect(teamDirectory.items[0]?.name).toBe('更新后的班组')
    expect(teamDirectory.items[0]?.sort_order).toBe(80)
  })

  it('clears names synchronously when the gate expires', async () => {
    signIn('account-a')
    await flushPromises()
    notifySiteAccessRequired()
    expect(teamDirectory.items).toEqual([])
  })

  it('never restores an old account response after account switching or logout', async () => {
    let resolveOld: (teams: Team[]) => void = () => undefined
    mocks.list.mockReturnValueOnce(new Promise<Team[]>((resolve) => { resolveOld = resolve }))
    signIn('account-a')
    mocks.list.mockResolvedValueOnce([{ ...team, id: 8, name: '新账号可见班组' }])
    signIn('account-b')
    expect(teamDirectory.items).toEqual([])
    await flushPromises()
    expect(teamDirectory.items[0]?.name).toBe('新账号可见班组')
    resolveOld([{ ...team, name: '旧账号班组' }])
    await flushPromises()
    expect(teamDirectory.items[0]?.name).toBe('新账号可见班组')
    clearSession()
    expect(teamDirectory.items).toEqual([])
  })

  it('shows a retryable failure and does not retain stale names', async () => {
    signIn('account-a')
    await flushPromises()
    mocks.list.mockRejectedValueOnce(new Error('暂时不可用'))
    await refreshTeamDirectory()
    expect(teamDirectory.items).toEqual([])
    expect(teamDirectory.error).toBe('暂时不可用')
    await refreshTeamDirectory()
    expect(teamDirectory.error).toBe('')
    expect(teamDirectory.items).toHaveLength(1)
  })
})
