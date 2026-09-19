import type { TraceBatch } from '@/types/materialTrace'

export const traceNodeSize = { width: 248, height: 236 }
export interface TraceNode { batch: TraceBatch; x: number; y: number; depth: number; detached: boolean }

export function materialTraceGraph(items: TraceBatch[]) {
  const rows = [...items].sort((a, b) => a.transferred_at.localeCompare(b.transferred_at) || Number(a.id) - Number(b.id))
  const ids = new Set(rows.map(row => String(row.id)))
  const children = new Map<string, TraceBatch[]>()
  const roots: TraceBatch[] = []
  for (const row of rows) {
    if (row.source_transfer_id && ids.has(String(row.source_transfer_id))) {
      const key = String(row.source_transfer_id)
      children.set(key, [...(children.get(key) || []), row])
    } else roots.push(row)
  }
  const nodes: TraceNode[] = []
  let leaf = 0
  function place(batch: TraceBatch, depth: number): TraceNode {
    const descendants = (children.get(String(batch.id)) || []).map(child => place(child, depth + 1))
    // Keep the origin in the first visible row even when a lot has many splits.
    const y = descendants.length ? descendants[0]!.y : 36 + leaf++ * (traceNodeSize.height + 36)
    const node = { batch, depth, x: 32 + depth * 318, y, detached: batch.entry_kind === 'transfer' && !ids.has(String(batch.source_transfer_id)) }
    nodes.push(node)
    return node
  }
  roots.forEach(root => place(root, 0))
  const byId = new Map(nodes.map(node => [String(node.batch.id), node]))
  const edges = nodes.flatMap(node => {
    const source = byId.get(String(node.batch.source_transfer_id))
    if (!source) return []
    const x1 = source.x + traceNodeSize.width, x2 = node.x
    const y1 = source.y + traceNodeSize.height / 2, y2 = node.y + traceNodeSize.height / 2
    return [{ source, target: node, path: `M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}` }]
  })
  return { nodes, edges, width: Math.max(640, ...nodes.map(node => node.x + traceNodeSize.width + 32)), height: Math.max(320, ...nodes.map(node => node.y + traceNodeSize.height + 40)) }
}
