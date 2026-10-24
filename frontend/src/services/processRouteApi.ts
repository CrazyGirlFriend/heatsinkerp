import { httpClient, httpRequest, HttpRequestError } from './httpClient'
import type { ProcessRoute, ProcessRouteContext } from '@/types/processRoute'
import type { MaterialPage } from '@/types/teamMaterials'
import type { TeamProcessingTask, TeamPurpose } from '@/types/teamBusiness'
async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  try {
    return await httpRequest<T>(`/process-routes${path}`, { method, body })
  } catch (error) {
    if (path === '/import' && error instanceof HttpRequestError && error.status === 413)
      throw new Error(
        '工艺单上传被服务器拒绝，请使用不超过 5 MB 的 .docx 文件；若文件符合要求，请联系管理员检查上传限制。',
        { cause: error },
      )
    if (
      error instanceof HttpRequestError &&
      error.body &&
      typeof error.body === 'object' &&
      'detail' in error.body &&
      typeof error.body.detail === 'string'
    )
      throw new Error(error.body.detail, { cause: error })
    throw error
  }
}
export const processRouteApi = {
  list: (query = '', page = 1, state?: 'published') =>
    request<MaterialPage<ProcessRoute> & { enforced_after: string | null }>(
      `?query=${encodeURIComponent(query)}&page=${page}&page_size=20${state ? '&state=' + state : ''}`,
    ),
  options: (teamId: number) =>
    request<{ tasks: TeamProcessingTask[]; purposes: TeamPurpose[] }>(`/options/${teamId}`),
  detail: (id: number) => request<ProcessRoute>(`/${id}`),
  lot: (id: number) =>
    request<{ current: ProcessRouteContext | null; route: ProcessRoute | null }>(`/lots/${id}`),
  import: (file: File) => {
    if (!file.name.toLowerCase().endsWith('.docx'))
      return Promise.reject(new Error('仅支持 .docx 格式的工艺单'))
    if (file.size > 5 * 1024 * 1024) return Promise.reject(new Error('工艺单文件不能超过 5 MB'))
    const body = new FormData()
    body.append('file', file)
    return request<ProcessRoute>('/import', 'POST', body)
  },
  save: (route: ProcessRoute) =>
    request<ProcessRoute>(`/${route.id}`, 'PUT', {
      title: route.title,
      serial_nos: route.serial_nos,
      steps: route.steps,
      review_note: route.review_note || '',
      version: route.version,
    }),
  publish: (route: ProcessRoute) =>
    request<ProcessRoute>(`/${route.id}/publish`, 'POST', { version: route.version }),
  revise: (id: number) => request<ProcessRoute>(`/${id}/revise`, 'POST'),
  bind: (id: number, lotId: number) =>
    request(`/${id}/bind`, 'POST', { source_transfer_ids: [lotId] }),
  source: async (id: number, signal?: AbortSignal): Promise<Blob> => {
    const result = await httpClient.get(`/process-routes/${id}/source`, {
      responseType: 'blob',
      signal,
    })
    return result.data
  },
  download: async (route: ProcessRoute) => {
    const data = await processRouteApi.source(route.id)
    const url = URL.createObjectURL(data)
    const link = document.createElement('a')
    link.href = url
    link.download = route.filename
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  },
}
