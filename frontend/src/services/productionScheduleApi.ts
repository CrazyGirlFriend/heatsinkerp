import { httpClient, httpRequest, HttpRequestError, type HttpRequestOptions } from './httpClient'
import type { RouteOrderDocument } from '@/types/processRoute'
import type { MaterialPage } from '@/types/teamMaterials'
import type {
  ScheduleBatchWrite,
  ScheduleReworkOption,
  ScheduleRouteOption,
  ScheduleRouteLink,
  ProductionSchedule,
  InventorySchedules,
  ScheduleFilters,
  ScheduleSummary,
  ScheduleOverview,
  ScheduleSourceOption,
  ScheduleTask,
  DispatchTaskWrite,
  CustomerDeliveryBatch,
  BusinessPerson,
} from '@/types/productionSchedule'

function queryString(params: object) {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value == null || value === '') return
    for (const item of Array.isArray(value) ? value : [value]) query.append(key, String(item))
  })
  return query.toString()
}
async function request<T>(path: string, options?: HttpRequestOptions): Promise<T> {
  try {
    return await httpRequest<T>(path, options)
  } catch (error) {
    if (!(error instanceof HttpRequestError)) throw error
    const detail =
      error.body && typeof error.body === 'object' && 'detail' in error.body
        ? error.body.detail
        : undefined
    const message =
      typeof detail === 'string'
        ? detail
        : Array.isArray(detail)
          ? detail
              .map((item) =>
                item && typeof item === 'object' && typeof item.msg === 'string'
                  ? item.msg.replace(/^Value error, /, '')
                  : '',
              )
              .filter(Boolean)
              .join('；')
          : ''
    throw new HttpRequestError(
      message ||
        (error.status === 0 ? '无法连接服务器，请检查网络后重试' : '排期请求失败，请刷新后重试'),
      error.status,
      error.body,
      error.requestId,
    )
  }
}
export const productionScheduleApi = {
  overview: (days = 7) => request<ScheduleOverview>(`/production-schedules/overview?days=${days}`),
  reworkOptions: (id: number) =>
    request<ScheduleReworkOption[]>(`/production-schedules/tasks/${id}/rework-options`),
  linkRework: (
    id: number,
    body: {
      expected_version: number
      route_id: number
      route_version: number
      schedule_id: number
    },
  ) => request<ScheduleTask>(`/production-schedules/tasks/${id}/rework`, { method: 'POST', body }),
  routeOptions: (id: number) =>
    request<ScheduleRouteOption[]>(`/production-schedules/tasks/${id}/route-options`),
  linkRoute: (id: number, body: ScheduleRouteLink) =>
    request<ScheduleTask>(`/production-schedules/tasks/${id}/route`, { method: 'POST', body }),
  people: (params: { query?: string; page?: number; page_size?: number } = {}) =>
    request<MaterialPage<BusinessPerson>>(
      `/production-schedules/business-people?${queryString(params)}`,
    ),
  savePerson: (body: { name: string; active: boolean; expected_version?: number }, id?: number) =>
    request<BusinessPerson>(`/production-schedules/business-people${id ? `/${id}` : ''}`, {
      method: id ? 'PATCH' : 'POST',
      body,
    }),
  serialOptions: (params: { query?: string; page?: number; page_size?: number } = {}) =>
    request<MaterialPage<{ serial_no: string; task_count: number }>>(
      `/production-schedules/serial-options?${queryString(params)}`,
    ),
  tasks: (params: ScheduleFilters = {}) =>
    request<MaterialPage<ScheduleTask>>(`/production-schedules/tasks?${queryString(params)}`),
  task: (id: number) => request<ScheduleTask>(`/production-schedules/tasks/${id}`),
  createTask: (payload: DispatchTaskWrite, file: File) => {
    const body = new FormData()
    body.append('payload', JSON.stringify(payload))
    body.append('file', file)
    return request<ScheduleTask>('/production-schedules/tasks', { method: 'POST', body })
  },
  parseOrder: (file: File) => {
    const body = new FormData()
    body.append('file', file)
    return request<RouteOrderDocument>('/production-schedules/parse-order', {
      method: 'POST',
      body,
    })
  },
  previewOrder: async (file: File, signal?: AbortSignal): Promise<Blob> => {
    const body = new FormData()
    body.append('file', file)
    const response = await httpClient.post('/production-schedules/order-preview', body, {
      responseType: 'blob',
      signal,
    })
    return response.data
  },
  orderPreview: async (taskId: number, signal?: AbortSignal): Promise<Blob> => {
    const response = await httpClient.get(
      `/production-schedules/tasks/${taskId}/order?preview=true`,
      { responseType: 'blob', signal },
    )
    return response.data
  },
  downloadOrder: async (taskId: number, filename: string) => {
    const response = await httpClient.get(`/production-schedules/tasks/${taskId}/order`, {
      responseType: 'blob',
    })
    const url = URL.createObjectURL(response.data)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  },
  updateTask: (
    id: number,
    body: {
      planned_quantity?: number
      expected_version: number
      title: string
      final_due_at?: string | null
      notes: string | null
      business_person_id?: number | null
      business_person_ids?: number[]
      delivery_batches?: CustomerDeliveryBatch[]
    },
  ) => request<ScheduleTask>(`/production-schedules/tasks/${id}`, { method: 'PATCH', body }),
  taskRouteOptions: (serial_no: string) =>
    request<ScheduleRouteOption[]>(
      `/production-schedules/route-options?${queryString({ serial_no })}`,
    ),
  lockTask: (id: number, body: { expected_version: number; locked: boolean }) =>
    request<ScheduleTask>(`/production-schedules/tasks/${id}/lock`, { method: 'PUT', body }),
  deleteTask: (id: number, expected_version: number) =>
    request<void>(`/production-schedules/tasks/${id}`, {
      method: 'DELETE',
      body: { expected_version },
    }),
  reviewPlan: (id: number, body: { expected_version: number; approve: boolean; reason?: string }) =>
    request<ProductionSchedule>(`/production-schedules/${id}/review`, { method: 'POST', body }),
  candidates: (params: {
    team_id: number
    source_transfer_ids: string
    next_team_id?: number
    external_destination?: string
  }) =>
    request<{ items: { source_transfer_id: number; schedules: ScheduleSummary[] }[] }>(
      `/production-schedules/candidates?${queryString(params)}`,
    ),
  inventory: (body: { team_id: number; group_ids?: number[]; source_transfer_ids?: number[] }) =>
    request<InventorySchedules>('/production-schedules/inventory', { method: 'POST', body }),
  list: (params: ScheduleFilters = {}) =>
    request<MaterialPage<ProductionSchedule>>(`/production-schedules?${queryString(params)}`),
  detail: (id: number) => request<ProductionSchedule>(`/production-schedules/${id}`),
  saveBatches: (id: number, body: { expected_version: number; batches: ScheduleBatchWrite[] }) =>
    request<ProductionSchedule>(`/production-schedules/${id}/batches`, { method: 'PUT', body }),
  sources: (params: {
    team_id: number
    serial_no: string
    schedule_id?: number
    query?: string
    page?: number
    page_size?: number
  }) =>
    request<MaterialPage<ScheduleSourceOption>>(
      `/production-schedules/source-options?${queryString(params)}`,
    ),
}
