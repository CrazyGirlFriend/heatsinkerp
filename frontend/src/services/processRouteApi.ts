import { httpClient, httpRequest, HttpRequestError } from './httpClient'
import type { ProcessRoute, ProcessRouteContext } from '@/types/processRoute'
import type { MaterialPage } from '@/types/teamMaterials'
import type { TeamProcessingTask, TeamPurpose } from '@/types/teamBusiness'
async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  try {
    return await httpRequest<T>(`/process-routes${path}`, { method, body })
  } catch (error) {
    if (
      ['/import', '/parse'].includes(path) &&
      error instanceof HttpRequestError &&
      error.status === 413
    )
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
  list: (
    query = '',
    page = 1,
    state?: 'draft' | 'published',
    sortOrder: 'asc' | 'desc' = 'desc',
    pageSize = 20,
    kind: 'normal' | 'rework' | 'all' = 'normal',
  ) =>
    request<MaterialPage<ProcessRoute> & { enforced_after: string | null }>(
      `?query=${encodeURIComponent(query)}&page=${page}&page_size=${pageSize}&sort_order=${sortOrder}${state ? '&state=' + state : ''}${kind !== 'normal' ? '&kind=' + kind : ''}`,
    ),
  options: (teamId: number) =>
    request<{ tasks: TeamProcessingTask[]; purposes: TeamPurpose[] }>(`/options/${teamId}`),
  requestRework: (body: {
    source_transfer_id: number
    rework_of_id: number
    inspection_id?: number
    expected_revision: number
    quantity: number
    weight: number
    reason: string
    idempotency_key: string
  }) => request<ProcessRoute>('/rework-requests', 'POST', body),
  resumeRework: (id: number, revision: number) =>
    request(`/rework-lots/${id}/resume`, 'POST', { expected_revision: revision }),
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
  parse: (file: File) => {
    if (!file.name.toLowerCase().endsWith('.docx'))
      return Promise.reject(new Error('仅支持 .docx 格式的工艺单'))
    if (file.size > 5 * 1024 * 1024) return Promise.reject(new Error('工艺单文件不能超过 5 MB'))
    const body = new FormData()
    body.append('file', file)
    return request<
      Pick<ProcessRoute, 'title' | 'filename' | 'serial_nos' | 'steps' | 'source_data'>
    >('/parse', 'POST', body)
  },
  save: (route: ProcessRoute) =>
    request<ProcessRoute>(route.id ? `/${route.id}` : '', route.id ? 'PUT' : 'POST', {
      ...(route.rework_request
        ? { resume_step_index: route.rework_request.resume_step_index }
        : {}),
      title: route.title,
      engineering_employee_id: route.engineering_employee_id ?? null,
      modified_employee_id: route.modified_employee_id ?? route.engineering_employee_id ?? null,
      serial_nos: route.serial_nos,
      steps: route.steps,
      review_note: route.review_note || '',
      version: route.version,
    }),
  attachSource: (route: ProcessRoute, file: File) => {
    const body = new FormData()
    body.append('file', file)
    body.append('version', String(route.version))
    return request<ProcessRoute>(`/${route.id}/source`, 'POST', body)
  },
  uploadDrawing: (route: ProcessRoute, file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf'))
      return Promise.reject(new Error('图纸仅支持 PDF 格式'))
    if (file.size > 5 * 1024 * 1024) return Promise.reject(new Error('每份图纸不能超过 5 MB'))
    const body = new FormData()
    body.append('file', file)
    body.append('version', String(route.version))
    return request<ProcessRoute>(`/${route.id}/drawings`, 'POST', body)
  },
  removeDrawing: (route: ProcessRoute, id: number) =>
    request<ProcessRoute>(`/${route.id}/drawings/${id}?version=${route.version}`, 'DELETE'),
  drawing: async (
    routeId: number,
    id: number,
    signal?: AbortSignal,
    preview = false,
  ): Promise<Blob> => {
    const result = await httpClient.get(
      `/process-routes/${routeId}/drawings/${id}${preview ? '?preview=true' : ''}`,
      {
        responseType: 'blob',
        signal,
      },
    )
    return result.data
  },
  previewDrawing: async (file: File, signal?: AbortSignal): Promise<Blob> => {
    const body = new FormData()
    body.append('file', file)
    const result = await httpClient.post('/process-routes/drawing-preview', body, {
      responseType: 'blob',
      signal,
    })
    return result.data
  },
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
