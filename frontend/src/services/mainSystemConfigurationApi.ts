import { httpRequest, HttpRequestError, type HttpRequestOptions } from './httpClient'
import type { MaterialTransferDocumentFields } from '@/types/materialTransfer'

export interface MainSystemConfiguration {
  enabled: boolean; base_url: string; timeout_seconds: number; has_token: boolean; version: number
  source: 'database' | 'environment'; key_ready: boolean; allowed_origins: string[]
  updated_by: string | null; updated_at: string | null
  last_test_at: string | null; last_test_ok: boolean | null; last_test_message: string | null
}
export interface ConfigurationSave {
  enabled: boolean; base_url: string; token: string; timeout_seconds: number; expected_version: number
}
export interface ConfigurationTestResult {
  ok: boolean; message: string; tested_at: string
  data: null | { serial_no: string; revision: string; updated_at: string; active: boolean; document: MaterialTransferDocumentFields }
}
async function request<T>(suffix = '', options: HttpRequestOptions = {}): Promise<T> {
  try { return await httpRequest<T>('/main-system/configuration' + suffix, { ...options, noCache: true }) }
  catch (error) {
    if (error instanceof HttpRequestError) {
      const detail = (error.body as { detail?: unknown } | undefined)?.detail
      throw new Error(typeof detail === 'string' ? detail : error.status === 422 ? '配置格式不正确，请检查地址、令牌和超时时间' : error.status === 403 ? '仅管理员可以配置主系统对接' : '无法读取或保存配置，请稍后重试')
    }
    throw error
  }
}
export const mainSystemConfigurationApi = {
  get: () => request<MainSystemConfiguration>(),
  save: (body: ConfigurationSave) => request<MainSystemConfiguration>('', { method: 'PUT', body }),
  test: (serial_no: string, expected_version: number) => request<ConfigurationTestResult>('/test', { method: 'POST', body: { serial_no, expected_version } }),
}
