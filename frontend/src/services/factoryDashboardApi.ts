import { httpRequest } from './httpClient'
import type {
  FactoryDashboard,
  Delivery,
  DeliveryPlan,
  PageResult,
  SerialChoice,
  Shipments,
  StockDetail,
  TeamYield,
  YieldRow,
} from '@/types/factoryDashboard'
const root = '/factory-dashboard'
const read = <T>(path: string) => httpRequest<T>(root + path, { noCache: true })
export const factoryDashboardApi = {
  get: () => read<FactoryDashboard>(''),
  serials: (query = '', page = 1, pageSize = 50) =>
    read<PageResult<SerialChoice>>(
      `/serials?${new URLSearchParams({ query, page: String(page), page_size: String(pageSize) })}`,
    ),
  shipments: (serials: string[], from: string, to: string) => {
    const query = new URLSearchParams({ date_from: from, date_to: to })
    serials.forEach((serial) => query.append('serial_no', serial))
    return read<Shipments>(`/shipments?${query}`)
  },
  yields: (material = '', page = 1) =>
    read<PageResult<YieldRow>>(`/yields?${new URLSearchParams({ material, page: String(page) })}`),
  teamYields: (serial: string, material: string) =>
    read<{ items: TeamYield[] }>(
      `/team-yields?${new URLSearchParams({ serial_no: serial, material })}`,
    ),
  deliveries: (query = '', page = 1) =>
    read<PageResult<Delivery>>(`/deliveries?${new URLSearchParams({ query, page: String(page) })}`),
  stockDetail: (material = '', teamId?: number, page = 1) =>
    read<PageResult<StockDetail>>(
      `/stock-detail?${new URLSearchParams({ material, page: String(page), ...(teamId ? { team_id: String(teamId) } : {}) })}`,
    ),
  plan: (serial: string) =>
    read<DeliveryPlan>(`/delivery-plan?${new URLSearchParams({ serial_no: serial })}`),
  savePlan: (plan: DeliveryPlan) =>
    httpRequest<DeliveryPlan>(root + '/delivery-plan', {
      method: 'PUT',
      body: {
        serial_no: plan.serial_no,
        expected_version: plan.version,
        installments: plan.installments,
      },
    }),
}
