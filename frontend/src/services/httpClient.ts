import axios, { type AxiosInstance, type AxiosRequestConfig, type Method } from 'axios'
import { notifySiteAccessRequired } from '@/stores/access'

export const API_BASE = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '')
export const HTTP_AUTH_SESSION_STORAGE_KEY = 'heatsink-flow.auth-session.v1'

type UnknownRecord = Record<string, unknown>

export interface HttpRequestOptions {
  method?: string
  body?: unknown
  headers?: Record<string, string>
  skipAuthExpiry?: boolean
  noCache?: boolean
}

export class HttpRequestError extends Error {
  readonly status: number
  readonly body?: unknown

  constructor(message: string, status = 0, body?: unknown) {
    super(message)
    this.name = 'HttpRequestError'
    this.status = status
    this.body = body
  }
}

function objectValue(value: unknown): UnknownRecord {
  return value && typeof value === 'object' ? value as UnknownRecord : {}
}

function safeStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export function authorizationValue(): string | null {
  const serialized = safeStorage()?.getItem(HTTP_AUTH_SESSION_STORAGE_KEY)
  if (!serialized) return null
  try {
    const session = objectValue(JSON.parse(serialized))
    const token = session.access_token ?? session.accessToken ?? session.token
    const tokenType = session.token_type ?? session.tokenType ?? 'Bearer'
    return typeof token === 'string' && token ? `${String(tokenType)} ${token}` : null
  } catch {
    return null
  }
}

export const httpClient: AxiosInstance = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
  headers: { Accept: 'application/json' },
})

httpClient.interceptors.request.use((config) => {
  const authorization = authorizationValue()
  if (authorization) config.headers.set('Authorization', authorization)
  else config.headers.delete('Authorization')
  if (config.data !== undefined && config.data !== null && !config.headers.has('Content-Type')) {
    config.headers.set('Content-Type', 'application/json')
  }
  return config
})

export function invalidateAccountSession(): void {
  safeStorage()?.removeItem(HTTP_AUTH_SESSION_STORAGE_KEY)
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('heatsink-auth-expired'))
}

export async function httpRequest<T>(path: string, options: HttpRequestOptions = {}): Promise<T> {
  const config: AxiosRequestConfig = {
    url: path,
    method: (options.method || 'GET') as Method,
    data: options.body,
    headers: options.headers,
    ...(options.noCache ? { headers: { 'Cache-Control': 'no-cache', ...options.headers } } : {}),
  }
  try {
    const response = await httpClient.request<T>(config)
    return (response.status === 204 ? undefined : response.data) as T
  } catch (error) {
    if (!axios.isAxiosError(error)) {
      throw new HttpRequestError(error instanceof Error ? error.message : '无法连接服务器')
    }
    const status = error.response?.status ?? 0
    const body = error.response?.data
    if (status === 423) notifySiteAccessRequired()
    if (status === 401 && !options.skipAuthExpiry) invalidateAccountSession()
    throw new HttpRequestError(error.message || '无法连接服务器', status, body)
  }
}
