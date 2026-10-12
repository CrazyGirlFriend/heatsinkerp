import type { MaterialTrace, TraceAmount, TraceBatch, TraceHolding } from '@/types/materialTrace'
import { isExternalTransfer } from '@/types/materialTransfer'

const palette = ['#128974', '#4477bc', '#9466aa', '#967531', '#198b9b', '#b5684f', '#688947', '#af6387', '#6479a0']
export const sharedSerialColor = (index: number) => palette[(index + 1) % palette.length]!
export function traceOrigins(items: TraceBatch[]) {
  const byId = new Map(items.map(item => [String(item.id), item]))
  const originById = new Map<string, TraceBatch>()
  for (const item of items) {
    let origin = item
    const seen = new Set<string>([String(item.id)])
    while (origin.source_transfer_id) {
      const parent = byId.get(String(origin.source_transfer_id))
      if (!parent || seen.has(String(parent.id))) break
      seen.add(String(parent.id)); origin = parent
    }
    originById.set(String(item.id), origin)
  }
  const roots = [...new Map([...originById.values()].map(item => [String(item.id), item])).values()]
    .sort((a, b) => a.transferred_at.localeCompare(b.transferred_at) || Number(a.id) - Number(b.id))
  const groups = roots.map((batch, index) => ({ id: String(batch.id), batch, color: palette[index % palette.length]!,
    name: batch.shared_unallocated ? `共投来源 ${index + 1}` : batch.entry_kind === 'warehouse_receipt' ? `入库批次 ${index + 1}` : batch.entry_kind === 'opening_stock' ? '初始库存' : batch.entry_kind === 'serial_reallocation' ? `${batch.source_serial_no || '其他流水号'} 转投入` : '历史起点',
    items: items.filter(item => originById.get(String(item.id)) === batch),
  }))
  return { groups, originById, colors: new Map(items.map(item => [String(item.id), item.shared_group_id && !item.shared_unallocated ? sharedSerialColor((item.shared_serials || []).findIndex(member => member.serial_no === item.serial_no)) : groups.find(group => group.batch === originById.get(String(item.id)))!.color])) }
}

const add = (target: TraceAmount, value: TraceAmount) => {
  target.quantity += value.quantity
  target.weight = Math.round((target.weight + value.weight) * 1000000) / 1000000
}

// Filter the entire family, not just its highlighted path. Pending weight stays
// with the upstream lot's original material nature, matching backend ownership.
export function traceOriginScope(trace: MaterialTrace, items: TraceBatch[]): MaterialTrace {
  const holdings = new Map<number, TraceHolding>()
  const positions = new Map<number, MaterialTrace['positions'][number]>()
  const differences = new Map<number, number>(), shortage = { quantity: 0, weight: 0 }
  let processingDelta = 0
  const totals: MaterialTrace['totals'] = { on_hand: { quantity: 0, weight: 0 }, in_transit: { quantity: 0, weight: 0 }, external_pending: { quantity: 0, weight: 0 }, dispatched: { quantity: 0, weight: 0 }, lost: { quantity: 0, weight: 0 } }
  const sharedTotals: MaterialTrace['totals'] = { on_hand: { quantity: 0, weight: 0 }, in_transit: { quantity: 0, weight: 0 }, external_pending: { quantity: 0, weight: 0 }, dispatched: { quantity: 0, weight: 0 }, lost: { quantity: 0, weight: 0 } }
  const sharedPositions: NonNullable<MaterialTrace['shared_positions']> = []
  for (const item of items) {
    if (item.shared_unallocated) {
      add(sharedTotals.on_hand, { quantity: item.on_hand_quantity || 0, weight: item.on_hand_weight || 0 })
      if (item.status === 'pending') add(sharedTotals[isExternalTransfer(item) ? 'external_pending' : 'in_transit'], item)
      if (item.status === 'dispatched') add(sharedTotals.dispatched, item)
      for (const loss of item.loss_records || []) add(sharedTotals.lost, loss)
      const owned = { quantity: item.owned_quantity ?? item.on_hand_quantity ?? 0, weight: item.owned_weight ?? item.on_hand_weight ?? 0 }
      if (owned.quantity || owned.weight) sharedPositions.push({ ...owned, team_id: Number(item.next_team.id), team_name: item.next_team.name, origin_batch_no: item.shared_origin_batch_no || item.batch_no, material_type: item.material_type || null, serials: (item.shared_serials || []).map(member => member.serial_no) })
      continue
    }
    if (item.weight_difference !== undefined) differences.set(item.weight_root_transfer_id || Number(item.id), item.weight_difference)
    processingDelta += item.processing_delta_weight || 0
    add(shortage, { quantity: Math.max(0, -(item.on_hand_quantity || 0)), weight: Math.max(0, -(item.on_hand_weight || 0)) })
    if (item.on_hand_quantity !== null && item.on_hand_weight !== null) {
      add(totals.on_hand, { quantity: item.on_hand_quantity, weight: item.on_hand_weight })
      const teamId = Number(item.next_team.id)
      if (item.on_hand_quantity || item.on_hand_weight) {
        const position = positions.get(teamId) || { team_id: teamId, team_name: item.next_team.name, batch_count: 0, quantity: 0, weight: 0 }
        add(position, { quantity: item.on_hand_quantity, weight: item.on_hand_weight })
        position.batch_count += 1; positions.set(teamId, position)
      }
      const pending = items.filter(child => String(child.source_transfer_id) === String(item.id) && child.status === 'pending')
        .reduce((sum, child) => { add(sum, child); return sum }, { quantity: 0, weight: 0 })
      const owned = { quantity: item.owned_quantity ?? item.on_hand_quantity + pending.quantity, weight: item.owned_weight ?? Math.round((item.on_hand_weight + pending.weight) * 1000000) / 1000000 }
      if (owned.quantity || owned.weight) {
        const team = holdings.get(teamId) || { team_id: teamId, team_code: item.next_team.code, team_name: item.next_team.name, material_types: [] }
        let nature = team.material_types.find(row => row.material_type === (item.material_type ?? null))
        if (!nature) { nature = { material_type: item.material_type ?? null, quantity: 0, weight: 0 }; team.material_types.push(nature) }
        add(nature, owned); holdings.set(teamId, team)
      }
    }
    if (item.status === 'pending') add(totals[isExternalTransfer(item) ? 'external_pending' : 'in_transit'], item)
    if (item.status === 'dispatched') add(totals.dispatched, item)
    for (const loss of item.loss_records || []) add(totals.lost, loss)
  }
  return { ...trace, items, totals, shared_totals: sharedTotals, shared_positions: sharedPositions, shortage, processing_delta_weight: Math.round(processingDelta * 1000000) / 1000000,
    weight_difference: Math.round([...differences.values()].reduce((sum, value) => sum + value, 0) * 1000000) / 1000000,
    max_weight_difference: Math.max(0, ...[...differences.values()].map(Math.abs)),
    holdings: [...holdings.values()], positions: [...positions.values()], untracked_count: items.filter(item => item.status === 'received' && !item.stock_tracked).length }
}
