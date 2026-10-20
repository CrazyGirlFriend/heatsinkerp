import { httpRequest } from './httpClient'
import type { FactoryPerformance, PerformanceFilters } from '@/types/factoryPerformance'

export const factoryPerformanceApi = {
  get(filters: PerformanceFilters) {
    const params = new URLSearchParams(
      Object.entries(filters)
        .filter(([, value]) => value != null)
        .map(([key, value]) => [key, String(value)]),
    )
    return httpRequest<FactoryPerformance>(`/factory-performance?${params}`, { noCache: true })
  },
}
