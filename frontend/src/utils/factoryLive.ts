import type { LiveBatch, LiveTeam } from '@/types/factoryLive'
import { dispatchStatusLabel } from '@/types/teamMaterials'

export const liveBatchStatus = (row: LiveBatch) => row.entry_kind === 'warehouse_receipt' && row.status !== 'voided' ? '已入库' : dispatchStatusLabel(row.status, row.entry_kind)
export const liveParties = (row: LiveBatch) => ({
  source: row.source_name || (row.entry_kind === 'warehouse_receipt' ? '手工入库' : '未记录上序'),
  target: row.target_name || row.external_destination || '未记录下序',
})
export function liveLook(id: number | null, teams: LiveTeam[]): 'left' | 'right' | 'center' {
  const index = id == null ? -1 : teams.findIndex(team => team.id === id)
  return index < 0 || index > 7 ? 'center' : index < 4 ? 'left' : 'right'
}
export const liveMaterial = (row: LiveBatch) => row.material_count > 1 ? `多材质（${row.material_count}种）` : row.material_name || '—'
export function liveWaiting(row: LiveBatch, now: number) {
  if (!row.waiting_since || !['pending', 'partial'].includes(row.status)) return '—'
  const minutes = Math.max(0, Math.floor((now - Date.parse(row.waiting_since)) / 60000))
  if (!Number.isFinite(minutes)) return '—'
  if (minutes < 60) return `${minutes}分钟`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}小时${minutes % 60}分`
  return `${Math.floor(minutes / 1440)}天${Math.floor(minutes % 1440 / 60)}小时`
}
export function liveWindow(rows: LiveBatch[], start: number, size = 8) {
  if (!rows.length) return []
  const index = ((start % rows.length) + rows.length) % rows.length
  return [...rows.slice(index), ...rows.slice(0, index)].slice(0, size)
}
