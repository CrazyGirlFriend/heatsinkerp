import { httpRequest } from './httpClient'
import type { FactoryDashboard, PageResult, StockDetail } from '@/types/factoryDashboard'
const root = '/factory-dashboard'
const read = <T>(path: string) => httpRequest<T>(root + path, { noCache: true })
export const factoryDashboardApi = {
  get: () => read<FactoryDashboard>(''),
  stockDetail: (material = '', teamId?: number, page = 1) =>
    read<PageResult<StockDetail>>(
      `/stock-detail?${new URLSearchParams({ material, page: String(page), ...(teamId ? { team_id: String(teamId) } : {}) })}`,
    ),
}
