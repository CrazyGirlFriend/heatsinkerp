import { normalizeMaterialTransfer } from '@/services/materialTransferApi'
import type { DispatchKind, MaterialDispatchDocument } from '@/types/teamMaterials'

export function dispatchFixture(count = 2, kind: DispatchKind = 'transfer', extra: Partial<MaterialDispatchDocument> = {}): MaterialDispatchDocument {
  const source = { id: kind === 'inspection_shipment' ? 8 : 1, code: kind === 'inspection_shipment' ? 'FACTORY-QC' : 'FACTORY-WAREHOUSE', name: kind === 'inspection_shipment' ? '检验' : '库房', kind: kind === 'inspection_shipment' ? 'production' as const : 'warehouse' as const }
  const target = kind === 'transfer' ? { id: 2, code: 'FACTORY-ROLL', name: '轧制', kind: 'production' as const } : { id: '', code: '', name: '客户收货仓' }
  const items = Array.from({ length: count }, (_, index) => normalizeMaterialTransfer({ id: 30 + index, batch_no: `TL-GROUP-${index + 1}`, dispatch_no: 'CK-GROUP', serial_no: `QA-GROUP-${index + 1}`, material_name: '铜钼合金', material_type: 'semi_finished', quantity: 10, weight: 1.005, source_team: source, next_team: target, status: 'pending', locked: false, entry_kind: kind, external_destination: kind === 'transfer' ? null : target.name, version: 1, source_transfer_id: 10 + index, source_transfer_batch_no: `TL-ROOT-${index + 1}`, allowed_actions: ['edit', 'void', kind === 'transfer' ? 'confirm' : 'confirm_outbound'], history: [{ id: index + 1, action: 'created', actor: '库管', occurred_at: '2026-09-07T00:00:00Z', changes: {} }] }))
  return { id: 1, dispatch_no: 'CK-GROUP', barcode_payload: 'CK-GROUP', barcode_type: 'CODE128', source_team_id: source.id, source_team: source, next_team: target, entry_kind: kind, external_destination: kind === 'transfer' ? null : target.name, revision: 'a'.repeat(64), allowed_actions: [kind === 'transfer' ? 'confirm' : 'confirm_outbound'], pending_line_count: count, locked: false, status: 'pending', created_by: '库管', created_at: '2026-09-07T00:00:00Z', notes: '整批核对', total_quantity: count * 10, total_weight: Math.round(count * 1005) / 1000, line_count: count, items, ...extra }
}
export function completedDispatch(group: MaterialDispatchDocument): MaterialDispatchDocument {
  const status = group.entry_kind === 'transfer' ? 'received' as const : 'dispatched' as const
  return { ...group, revision: 'f'.repeat(64), status, locked: true, allowed_actions: [], pending_line_count: 0, confirmed_by: '确认班组长', confirmed_at: '2026-09-07T01:00:00Z', items: group.items.map(line => line.status === 'pending' ? { ...line, status, locked: true, version: 2, allowed_actions: [] } : line) }
}
