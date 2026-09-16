// @vitest-environment jsdom
import { AxiosError, AxiosHeaders, type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface AdapterReply {
  data: unknown
  status?: number
}

function responseFor(config: InternalAxiosRequestConfig, reply: AdapterReply): AxiosResponse {
  const status = reply.status ?? 200
  return {
    data: reply.data,
    status,
    statusText: status >= 400 ? 'Error' : 'OK',
    headers: new AxiosHeaders({ 'Content-Type': 'application/json' }),
    config,
  }
}

function createAdapter(...replies: Array<AdapterReply | Error>) {
  let index = 0
  return vi.fn<AxiosAdapter>(async (config: InternalAxiosRequestConfig) => {
    const reply = replies[Math.min(index++, replies.length - 1)]
    if (!reply || reply instanceof Error) throw new AxiosError(reply?.message || 'Network Error', AxiosError.ERR_NETWORK, config)
    const response = responseFor(config, reply)
    if (response.status >= 400) {
      throw new AxiosError(`Request failed with status code ${response.status}`, AxiosError.ERR_BAD_REQUEST, config, undefined, response)
    }
    return response
  })
}

async function loadAccess(...replies: Array<AdapterReply | Error>) {
  const access = await import('./access')
  const adapter = createAdapter(...replies)
  access.accessHttpClient.defaults.adapter = adapter
  return { access, adapter }
}

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('server-owned site access', () => {
  it('stays closed before checking and ignores local storage bypass flags', async () => {
    localStorage.setItem('site-unlocked', 'true')
    const { access, adapter } = await loadAccess({ data: { enabled: true, unlocked: false } })
    expect(access.canEnterSite.value).toBe(false)
    expect(await access.checkSiteAccess()).toBe(false)
    expect(access.accessState.status).toBe('locked')
    expect(adapter).toHaveBeenCalledOnce()
    expect(adapter.mock.calls[0]![0]).toMatchObject({
      baseURL: '/api/access',
      url: '/status',
      method: 'get',
      withCredentials: true,
    })
    expect(adapter.mock.calls[0]![0].headers.get('Cache-Control')).toBe('no-store')
  })

  it.each([
    { enabled: false, unlocked: false },
    { enabled: true, unlocked: true },
  ])('permits entry only when the server allows it: %j', async (status) => {
    const { access } = await loadAccess({ data: status })
    expect(await access.checkSiteAccess()).toBe(true)
    expect(access.canEnterSite.value).toBe(true)
  })

  it('shares the initial check across simultaneous callers', async () => {
    const { access, adapter } = await loadAccess({ data: { enabled: true, unlocked: false } })
    const first = access.checkSiteAccess()
    expect(access.checkSiteAccess()).toBe(first)
    await first
    expect(adapter).toHaveBeenCalledTimes(1)
  })

  it('fails closed on network errors and allows a retry', async () => {
    const { access } = await loadAccess(
      new Error('offline'),
      { data: { enabled: true, unlocked: false } },
    )
    expect(await access.checkSiteAccess()).toBe(false)
    expect(access.accessState.status).toBe('error')
    expect(access.accessState.error).toContain('重试')
    expect(await access.checkSiteAccess(true)).toBe(false)
    expect(access.accessState.status).toBe('locked')
  })

  it.each([{}, { enabled: 'false', unlocked: true }, { enabled: true, unlocked: 'true' }, null])(
    'fails closed on malformed server status %j', async (status) => {
      const { access } = await loadAccess({ data: status })
      expect(await access.checkSiteAccess()).toBe(false)
      expect(access.accessState.status).toBe('error')
    },
  )

  it('verifies the cookie after unlock without persisting the password', async () => {
    const { access, adapter } = await loadAccess(
      { data: { unlocked: true } },
      { data: { enabled: true, unlocked: true } },
    )
    expect(await access.unlockSite('test-only-password')).toBe(true)
    expect(adapter).toHaveBeenNthCalledWith(1, expect.objectContaining({
      baseURL: '/api/access',
      url: '/unlock',
      method: 'post',
      data: JSON.stringify({ password: 'test-only-password' }),
      withCredentials: true,
    }))
    expect(adapter).toHaveBeenNthCalledWith(2, expect.objectContaining({ url: '/status', method: 'get' }))
    expect(localStorage.length).toBe(0)
  })

  it('does not unlock on a success response if the cookie was not accepted', async () => {
    const { access } = await loadAccess(
      { data: { unlocked: true } },
      { data: { enabled: true, unlocked: false } },
    )
    expect(await access.unlockSite('test-only-password')).toBe(false)
    expect(access.canEnterSite.value).toBe(false)
    expect(access.accessState.error).toContain('Cookie')
  })

  it.each([401, 429])('shows a server error for HTTP %i and keeps the account session', async (status) => {
    localStorage.setItem('heatsink-flow.auth-session.v1', 'existing-session')
    const { access } = await loadAccess({ data: { detail: '口令错误或尝试过多' }, status })
    expect(await access.unlockSite('wrong-password')).toBe(false)
    expect(access.accessState.status).toBe('locked')
    expect(access.accessState.error).toBe('口令错误或尝试过多')
    expect(localStorage.getItem('heatsink-flow.auth-session.v1')).toBe('existing-session')
  })

  it('closes immediately on expiry and a stale status response cannot reopen it', async () => {
    const access = await import('./access')
    let respond: (value: AxiosResponse) => void = () => undefined
    const adapter = vi.fn<AxiosAdapter>((config: InternalAxiosRequestConfig) => new Promise((resolve) => {
      respond = resolve
      void config
    }))
    access.accessHttpClient.defaults.adapter = adapter
    const expiredListener = vi.fn()
    window.addEventListener(access.SITE_ACCESS_REQUIRED_EVENT, expiredListener)
    const check = access.checkSiteAccess()
    access.notifySiteAccessRequired()
    const config = adapter.mock.calls[0]![0]
    respond(responseFor(config, { data: { enabled: true, unlocked: true } }))
    expect(await check).toBe(false)
    expect(access.canEnterSite.value).toBe(false)
    expect(access.accessState.status).toBe('locked')
    expect(expiredListener).toHaveBeenCalledOnce()
    window.removeEventListener(access.SITE_ACCESS_REQUIRED_EVENT, expiredListener)
  })
})

describe('all API clients enforce site access expiry', () => {
  it.each(['material-transfers', 'admin', 'team-materials'])('handles a 423 from %s without clearing account authentication', async (client) => {
    const storedSession = JSON.stringify({ access_token: 'test-token', user: { username: 'test' } })
    localStorage.setItem('heatsink-flow.auth-session.v1', storedSession)
    const access = await import('./access')
    const { httpClient } = await import('@/services/httpClient')
    const originalAdapter = httpClient.defaults.adapter
    httpClient.defaults.adapter = createAdapter({
      data: { code: 'site_access_required', detail: '请先输入访问口令' },
      status: 423,
    })
    try {
      const call = client === 'material-transfers'
        ? (await import('@/services/materialTransferApi')).materialTransferApi.list()
        : client === 'admin'
          ? (await import('@/services/adminApi')).adminApi.currentUser()
          : (await import('@/services/teamMaterialApi')).teamMaterialApi.overview(2)
      await expect(call).rejects.toMatchObject({ status: 423 })
      expect(access.accessState.status).toBe('locked')
      expect(localStorage.getItem('heatsink-flow.auth-session.v1')).toBe(storedSession)
    } finally {
      httpClient.defaults.adapter = originalAdapter
    }
  })
})
