import { subscribeInventoryChanges, type InventoryChange, type InventoryConnection, type InventorySubscription } from './inventoryStream'

type Listener = InventorySubscription<InventoryChange>
const listeners = new Set<Listener>()
let disconnect: (() => void) | undefined
let connection: InventoryConnection = 'connecting'
let received = false

export function shouldRefreshInventory(change: InventoryChange, teamId?: number, scope: 'inventory' | 'directory' | 'accounts' = 'inventory') {
  // Initial/reconnected streams and old servers require a full refresh.
  if (change.team_ids === undefined || change.current_user_changed) return true
  if (scope === 'accounts') return Boolean(change.accounts_changed || change.directory_changed)
  if (scope === 'directory') return Boolean(change.directory_changed)
  if (change.directory_changed || change.team_ids === null) return true
  return teamId === undefined ? change.team_ids.length > 0 : change.team_ids.includes(teamId)
}

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
