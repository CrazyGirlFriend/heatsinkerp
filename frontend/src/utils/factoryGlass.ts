import type { FactoryLive, LiveLink, LiveTeam } from '@/types/factoryLive'
import type { ChartPoint } from '@/types/materialAnalytics'
import { materialTypeLabel } from '@/types/materialTransfer'

export type Point = [number, number]
export type Curve = [Point, Point, Point, Point]
export interface StockType extends ChartPoint {
  label: string
  color: string
}
export interface GlassLink extends LiveLink {
  key: string
  source: LiveTeam
  target: LiveTeam
  curve: Curve
  labelPoint: Point
}

const typeOrder = [
  'raw_material',
  'semi_finished',
  'finished',
  'finished_surplus',
  'semi_finished_surplus',
  'defective',
  'waste',
  'sludge',
  'scrap_chips',
]
const colors = [
  '#00b99e',
  '#329eee',
  '#ffb238',
  '#f2cf55',
  '#aa87e5',
  '#ba827b',
  '#8194a0',
  '#aaa69a',
  '#779abe',
]
export function stockTypes(rows: ChartPoint[]): StockType[] {
  const keys = [
    ...typeOrder,
    ...rows.map((row) => row.key).filter((key) => !typeOrder.includes(key)),
  ]
  return [...new Set(keys)].map((key) => ({
    key,
    label: key === 'unknown' ? '未分类' : materialTypeLabel(key),
    color: colors[typeOrder.indexOf(key)] || '#647c8b',
    quantity: rows.filter((row) => row.key === key).reduce((total, row) => total + row.quantity, 0),
    weight:
      rows
        .filter((row) => row.key === key)
        .reduce((total, row) => total + Math.round(row.weight * 1000), 0) / 1000,
  }))
}
export const number = (value: number | null | undefined) =>
  value == null ? '—' : value.toLocaleString('zh-CN', { maximumFractionDigits: 3 })
export const kg = (value: number | null | undefined) =>
  value == null
    ? '—'
    : value.toLocaleString('zh-CN', { minimumFractionDigits: 1, maximumFractionDigits: 3 })
// Sum integer grams so per-team and factory totals use the same rounding.
export const sumAmounts = (rows: { quantity: number | null; weight: number | null }[]) => ({
  quantity: rows.reduce((total, row) => total + (row.quantity ?? 0), 0),
  weight: rows.reduce((total, row) => total + Math.round((row.weight ?? 0) * 1000), 0) / 1000,
})
const sameAmount = (
  a: { quantity: number | null; weight: number | null },
  b: { quantity: number | null; weight: number | null },
) =>
  a.quantity != null &&
  a.weight != null &&
  b.quantity != null &&
  b.weight != null &&
  a.quantity === b.quantity &&
  Math.round(a.weight * 1000) === Math.round(b.weight * 1000)

export function inventoryReconciles(report: FactoryLive) {
  const total = { quantity: report.totals.on_hand_quantity, weight: report.totals.on_hand_weight }
  return (
    sameAmount(sumAmounts(report.material_types), total) &&
    sameAmount(
      sumAmounts(
        report.teams.map((team) => ({
          quantity: team.balance?.on_hand_quantity || 0,
          weight: team.balance?.on_hand_weight || 0,
        })),
      ),
      total,
    ) &&
    report.teams.every((team) =>
      sameAmount(sumAmounts(team.material_types), {
        quantity: team.balance?.on_hand_quantity || 0,
        weight: team.balance?.on_hand_weight || 0,
      }),
    ) &&
    report.material_types.every((type) =>
      sameAmount(
        type,
        sumAmounts(
          report.teams.flatMap((team) => team.material_types.filter((row) => row.key === type.key)),
        ),
      ),
    )
  )
}

// Positions locate the eight workshop zones; they do not define any material route.
export const teamPositions: Record<string, Point> = {
  'FACTORY-WAREHOUSE': [500, 258],
  'FACTORY-ROLL': [721, 258],
  'FACTORY-ANNEAL': [941, 258],
  'FACTORY-GRIND': [1160, 258],
  'FACTORY-QC': [490, 527],
  'FACTORY-PLATE': [721, 527],
  'FACTORY-ENGRAVE': [961, 527],
  'FACTORY-WIRE': [1186, 527],
}
export const zonePolygons: Record<string, Point[]> = {
  'FACTORY-WAREHOUSE': [
    [431, 266],
    [582, 266],
    [565, 379],
    [395, 379],
  ],
  'FACTORY-ROLL': [
    [668, 269],
    [799, 269],
    [805, 380],
    [629, 380],
  ],
  'FACTORY-ANNEAL': [
    [886, 269],
    [1008, 269],
    [1031, 380],
    [855, 380],
  ],
  'FACTORY-GRIND': [
    [1110, 270],
    [1225, 270],
    [1261, 380],
    [1084, 380],
  ],
  'FACTORY-QC': [
    [416, 523],
    [568, 523],
    [546, 649],
    [374, 649],
  ],
  'FACTORY-PLATE': [
    [654, 523],
    [793, 523],
    [804, 651],
    [626, 651],
  ],
  'FACTORY-ENGRAVE': [
    [888, 523],
    [1030, 523],
    [1054, 651],
    [872, 651],
  ],
  'FACTORY-WIRE': [
    [1113, 523],
    [1258, 523],
    [1298, 651],
    [1105, 651],
  ],
}
export function curvePoint(curve: Curve, t: number): Point {
  const s = 1 - t
  const axis = (n: 0 | 1) =>
    s ** 3 * curve[0][n] +
    3 * s ** 2 * t * curve[1][n] +
    3 * s * t ** 2 * curve[2][n] +
    t ** 3 * curve[3][n]
  return [axis(0), axis(1)]
}
export function routeCurve(sourceCode: string, targetCode: string): Curve {
  const [sx, sy] = teamPositions[sourceCode]!,
    [tx, ty] = teamPositions[targetCode]!
  const direction = Math.sign(tx - sx) || 1
  if (sy === ty) {
    const bend = (direction > 0 ? 1 : -1) * Math.min(95, 45 + Math.abs(tx - sx) * 0.08)
    return [
      [sx + direction * 44, sy + 33],
      [sx + (tx - sx) * 0.32, sy + 33 + bend],
      [sx + (tx - sx) * 0.68, ty + 33 + bend],
      [tx - direction * 44, ty + 33],
    ]
  }
  const down = ty > sy
  const start: Point = [sx + direction * 25, sy + (down ? 97 : -16)]
  const end: Point = [tx - direction * 25, ty + (down ? -16 : 97)]
  const mid = (start[1] + end[1]) / 2
  // Opposite directions get separate control points, including vertically aligned pairs.
  const offset = down ? 28 : -28
  return [start, [start[0] + offset, mid], [end[0] + offset, mid], end]
}
export function glassLinks(report: FactoryLive): GlassLink[] {
  const byId = new Map(
    report.teams.filter((team) => team.id != null).map((team) => [team.id, team]),
  )
  return report.links.flatMap((link) => {
    const source = byId.get(link.source_id),
      target = byId.get(link.target_id)
    if (!source || !target || !teamPositions[source.code] || !teamPositions[target.code]) return []
    const curve = routeCurve(source.code, target.code)
    return [
      {
        ...link,
        key: `${link.source_id}:${link.target_id}`,
        source,
        target,
        curve,
        labelPoint: curvePoint(curve, 0.55),
      },
    ]
  })
}
