import { teamWorkspaceProfiles } from '@/config/teamWorkspaces'
import type { FactoryOverview, FactoryFlow } from '@/types/factoryOverview'
import { serialFixture } from './materialAnalytics'

export function factoryFixture(): FactoryOverview {
  const amounts = Object.fromEntries(['inbound','outbound','shipment','internal','loss'].map(key => [key, { quantity: 0, weight: 0 }])) as FactoryOverview['period_totals']
  amounts.inbound = { quantity: 100, weight: 10 }
  return {
    as_of: '2026-09-12T01:02:00Z', days: 30, totals: serialFixture(), pending: { batches: 2, quantity: 10, weight: 1 },
    teams: teamWorkspaceProfiles.map((team, i) => ({ ...team, id: i + 1, active: true, balance: serialFixture() })),
    period_totals: amounts, trend: [{ key: '2026-09-12', ...Object.fromEntries(Object.entries(amounts).map(([key, value]) => [key as FactoryFlow, value])) } as FactoryOverview['trend'][number]],
    material_types: [{ key: 'semi_finished', quantity: 100, weight: 10 }], stock_age: [], waiting_age: [], legacy_received_count: 0,
    material_ranking: { quantity: [{ key: '无氧铜', quantity: 100, weight: 10 }], weight: [{ key: '无氧铜', quantity: 100, weight: 10 }] },
    serial_ranking: { quantity: [{ key: 'SERIAL-001', quantity: 100, weight: 10 }], weight: [{ key: 'SERIAL-001', quantity: 100, weight: 10 }] },
    recent_batches: [],
    stock_matrix: {
      materials: [{ name: '无氧铜', quantity: 100, weight: 10 }],
      rows: teamWorkspaceProfiles.map((team, i): FactoryOverview['stock_matrix']['rows'][number] => ({ team_id: i + 1, team_code: team.code, team_name: team.name, active: true,
        amounts: i === 0 ? { '无氧铜': { quantity: 100, weight: 10 } } : {}, total: { quantity: i === 0 ? 100 : 0, weight: i === 0 ? 10 : 0 } })),
      total: { quantity: 100, weight: 10 },
    },
  }
}
