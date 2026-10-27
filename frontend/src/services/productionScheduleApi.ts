import { httpRequest, HttpRequestError, type HttpRequestOptions } from './httpClient'
import type { MaterialPage } from '@/types/teamMaterials'
import type {
  ScheduleReworkOption,
  ScheduleRouteOption,
  ScheduleRouteLink,
  ProductionSchedule,
  InventorySchedules,
  ScheduleFilters,
  ScheduleSummary,
  ScheduleSourceOption,
  ScheduleWrite,
  ScheduleTask,
  ScheduleTaskWrite,
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
  createTask: (body: ScheduleTaskWrite) =>
    request<ScheduleTask>('/production-schedules/tasks', { method: 'POST', body }),
  updateTask: (
    id: number,
    body: {
      expected_version: number
      title: string
      final_due_at?: string | null
      notes: string | null
      business_person_id?: number | null
    },
  ) => request<ScheduleTask>(`/production-schedules/tasks/${id}`, { method: 'PATCH', body }),
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
  create: (body: ScheduleWrite & { idempotency_key: string }) =>
    request<ProductionSchedule>('/production-schedules', { method: 'POST', body }),
  update: (id: number, body: ScheduleWrite & { expected_version: number }) =>
    request<ProductionSchedule>(`/production-schedules/${id}`, { method: 'PATCH', body }),
  updateCommitment: (
    id: number,
    body: Pick<
      ScheduleWrite,
      'due_at' | 'target_quantity' | 'target_weight' | 'completion_basis' | 'notes'
    > & { expected_version: number },
  ) =>
    request<ProductionSchedule>(`/production-schedules/${id}/commitment`, {
      method: 'PATCH',
      body,
    }),
  cancel: (id: number, body: { expected_version: number; reason?: string }) =>
    request<ProductionSchedule>(`/production-schedules/${id}/cancel`, { method: 'POST', body }),
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
