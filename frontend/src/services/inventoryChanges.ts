import { subscribeInventoryChanges, type InventoryConnection, type InventorySubscription } from './inventoryStream'

type Listener = InventorySubscription<{ changed: boolean }>
const listeners = new Set<Listener>()
let disconnect: (() => void) | undefined
let connection: InventoryConnection = 'connecting'
let received = false

// A list and its nested read-only drawers share one lightweight connection.
export function subscribeSharedInventoryChanges(listener: Listener) {
  listeners.add(listener)
  if (listeners.size === 1) {
    received = false
    connection = 'connecting'
    disconnect = subscribeInventoryChanges({
      onData(data) { received = true; for (const entry of listeners) entry.onData(data) },
      onState(state) { connection = state; for (const entry of listeners) entry.onState(state) },
    })
  } else {
    listener.onState(connection)
    if (received) listener.onData({ changed: true })
  }
  return () => {
    listeners.delete(listener)
    if (!listeners.size) { disconnect?.(); disconnect = undefined; received = false }
  }
}
