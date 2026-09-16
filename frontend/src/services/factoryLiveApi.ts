import { httpRequest } from './httpClient'
import type { FactoryLive } from '@/types/factoryLive'
import { subscribeFactoryLive } from './inventoryStream'

export const factoryLiveApi = {
  get() { return httpRequest<FactoryLive>('/factory-overview/live', { noCache: true }) },
  subscribe: subscribeFactoryLive,
}
