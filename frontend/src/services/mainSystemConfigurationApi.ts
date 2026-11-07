import { httpRequest, HttpRequestError, type HttpRequestOptions } from './httpClient'
import type { components } from '@/types/generated/api'

type Contract = components['schemas']
export type MainSystemConfiguration = Contract['MainSystemConfigurationResponse']
export type ConfigurationSave = Contract['ConfigurationSave']
export type ConfigurationTestResult = Contract['ConfigurationTestResponse']

async function request<T>(suffix = '', options: HttpRequestOptions = {}): Promise<T> {
  try {
    return await httpRequest<T>('/main-system/configuration' + suffix, {
      ...options,
      noCache: true,
    })
  } catch (error) {
    if (error instanceof HttpRequestError) {
      const detail = (error.body as { detail?: unknown } | undefined)?.detail
      // eslint-disable-next-line preserve-caught-error -- The original Axios cause can contain the submitted secret token.
      throw new Error(
        typeof detail === 'string'
          ? detail
          : error.status === 422
            ? '配置格式不正确，请检查地址、令牌和超时时间'
            : error.status === 403
              ? '仅管理员可以配置主系统对接'
              : '无法读取或保存配置，请稍后重试',
      )
    }
    throw error
  }
}
export const mainSystemConfigurationApi = {
  get: () => request<MainSystemConfiguration>(),
  save: (body: ConfigurationSave) => request<MainSystemConfiguration>('', { method: 'PUT', body }),
  test: (serial_no: string, expected_version: number) =>
    request<ConfigurationTestResult>('/test', {
      method: 'POST',
      body: { serial_no, expected_version },
    }),
}
