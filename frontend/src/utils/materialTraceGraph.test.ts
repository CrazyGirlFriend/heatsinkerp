import { describe, expect, it } from 'vitest'
import { normalizeMaterialTransfer } from '@/services/materialTransferApi'
import { materialTraceGraph, traceNodeSize } from './materialTraceGraph'
import type { TraceBatch } from '@/types/materialTrace'

function batch(id: number, parent: number | null = null, team = 1): TraceBatch {
  return { ...normalizeMaterialTransfer({ id, batch_no: 'TL-' + id, serial_no: '000012', source_transfer_id: parent,
    entry_kind: parent ? 'transfer' : 'warehouse_receipt', next_team: { id: team, name: '班组' + team },
    quantity: 10, weight: 1, status: 'received', created_at: '2026-09-19T00:00:00Z' }), on_hand_quantity: 10, on_hand_weight: 1 }
}
describe('batch genealogy layout', () => {
  it('connects actual parents, preserving parallel splits and repeated-team returns', () => {
    const graph = materialTraceGraph([batch(4, 2, 1), batch(3, 1, 3), batch(1), batch(2, 1, 2)])
    expect(graph.edges.map(edge => [edge.source.batch.id, edge.target.batch.id])).toEqual(expect.arrayContaining([[1, 2], [1, 3], [2, 4]]))
    expect(graph.edges).toHaveLength(3)
    expect(graph.nodes.filter(node => node.batch.next_team.id === 1)).toHaveLength(2)
    const split = graph.nodes.filter(node => [2, 3].includes(Number(node.batch.id)))
    expect(split[0]!.x).toBe(split[1]!.x)
    expect(Math.abs(split[0]!.y - split[1]!.y)).toBeGreaterThan(traceNodeSize.height)
    expect(graph.edges.every(edge => edge.source.x < edge.target.x)).toBe(true)
    expect(graph.nodes.find(node => node.batch.id === 1)?.y).toBe(Math.min(...graph.nodes.map(node => node.y)))
  })
  it('does not invent links from serial order, team identity or a missing parent', () => {
    const graph = materialTraceGraph([batch(1), batch(2), batch(3, 999)])
    expect(graph.edges).toHaveLength(0)
    expect(graph.nodes).toHaveLength(3)
    expect(graph.nodes.find(node => node.batch.id === 3)?.detached).toBe(true)
    expect(graph.nodes.every(node => node.depth === 0)).toBe(true)
  })
})
