import { httpRequest } from './httpClient'
import type { FactoryOverview } from '@/types/factoryOverview'
import { subscribeInventory } from './inventoryStream'

export const factoryOverviewApi = {
  get(days = 30) { return httpRequest<FactoryOverview>(`/factory-overview?days=${days}`, { noCache: true }) },
  subscribe: subscribeInventory,
}
