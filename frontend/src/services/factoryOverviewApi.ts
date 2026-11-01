import { httpRequest } from './httpClient'
import type { FactoryOverview } from '@/types/factoryOverview'

export const factoryOverviewApi = {
  get(days = 30) {
    return httpRequest<FactoryOverview>(`/factory-overview?days=${days}`, { noCache: true })
  },
}
