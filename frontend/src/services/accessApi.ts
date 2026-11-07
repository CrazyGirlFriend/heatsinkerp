import type { components } from '@/types/generated/api'
import axios, { type AxiosInstance, type Method } from 'axios'
import { API_BASE } from './apiConfig'

type ServerAccessStatus = components['schemas']['AccessStatusResponse']

export class AccessError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message)
  }
}

interface AccessRequestOptions {
  method?: Method
  body?: unknown
}

// The site gate uses only its cookie, without account authentication or 401 expiry handling.
export const accessHttpClient: AxiosInstance = axios.create({
  baseURL: `${API_BASE}/access`,
  withCredentials: true,
  headers: {
    Accept: 'application/json',
    'Cache-Control': 'no-store',
  },
})

async function accessRequest(path: string, options: AccessRequestOptions = {}): Promise<unknown> {
  try {
    const response = await accessHttpClient.request<unknown>({
      url: path,
      method: options.method || 'GET',
      data: options.body,
    })
    return response.status === 204 ? null : response.data
  } catch (requestError) {
    if (!axios.isAxiosError(requestError) || !requestError.response) {
      throw new AccessError('无法连接服务器，访问验证尚未完成，请检查网络后重试')
    }
    const body: unknown = requestError.response.data
    const status = requestError.response.status
    const detail = body && typeof body === 'object' && 'detail' in body ? body.detail : null
    throw new AccessError(
      typeof detail === 'string'
        ? detail
        : status === 429
          ? '尝试次数过多，请稍后重试'
          : '访问验证失败，请重试',
      status,
    )
  }
}

function validateStatus(value: unknown): ServerAccessStatus {
  if (
    !value ||
    typeof value !== 'object' ||
    !('enabled' in value) ||
    !('unlocked' in value) ||
    typeof value.enabled !== 'boolean' ||
    typeof value.unlocked !== 'boolean'
  ) {
    throw new AccessError('服务器未返回有效的访问状态，请重试')
  }
  return { enabled: value.enabled, unlocked: value.unlocked }
}

export const accessApi = {
  async status(): Promise<ServerAccessStatus> {
    return validateStatus(await accessRequest('/status'))
  },
  async unlock(password: string): Promise<void> {
    await accessRequest('/unlock', { method: 'POST', body: { password } })
  },
}
