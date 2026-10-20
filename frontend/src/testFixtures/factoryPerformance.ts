import type { FactoryPerformance, ProductionMetrics } from '@/types/factoryPerformance'

export function productionFixture(): ProductionMetrics {
  return {
    record_count: 5,
    initial_record_count: 2,
    rework_record_count: 3,
    completed_quantity: 110,
    completed_weight: 11,
    rework_quantity: 30,
    rework_weight: 3,
    work_quantity: 140,
    work_weight: 14,
  }
}

export function performanceFixture(): FactoryPerformance {
  const quality = {
    team_id: 2,
    team_name: '轧制',
    material_name: 'W80',
    kind: 'patrol' as const,
    scope: 'sample' as const,
    phase: 'first' as const,
    record_count: 1,
    checked_quantity: 100,
    passed_quantity: 90,
    failed_quantity: 10,
    pass_rate: 90,
  }
  return {
    period: 'day',
    period_dates: ['2026-10-19', '2026-10-20'],
    date_from: '2026-10-19',
    date_to: '2026-10-20',
    generated_at: '2026-10-20T04:00:00Z',
    teams: [
      { id: 2, code: 'FACTORY-ROLL', name: '轧制', active: true },
      { id: 3, code: 'FACTORY-GRIND', name: '研磨', active: true },
      { id: 8, code: 'FACTORY-QC', name: '检验', active: true },
    ],
    production: {
      totals: productionFixture(),
      scope: {
        ...productionFixture(),
        scope_id: 10,
        team_id: 2,
        team_name: '轧制',
        serial_no: '805881-5',
        material_name: 'W80',
        purpose_name: '轧制业务1',
        processing_task_name: '压制',
      },
      scopes: [
        {
          ...productionFixture(),
          scope_id: 10,
          team_id: 2,
          team_name: '轧制',
          serial_no: '805881-5',
          material_name: 'W80',
          purpose_name: '轧制业务1',
          processing_task_name: '压制',
        },
      ],
      trend: [
        { ...productionFixture(), date: '2026-10-19' },
        {
          ...productionFixture(),
          date: '2026-10-20',
          record_count: 0,
          initial_record_count: 0,
          rework_record_count: 0,
          completed_quantity: 0,
          completed_weight: 0,
          rework_quantity: 0,
          rework_weight: 0,
          work_quantity: 0,
          work_weight: 0,
        },
      ],
    },
    quality: {
      materials: [
        quality,
        {
          ...quality,
          material_name: '铜铝',
          checked_quantity: 10,
          passed_quantity: 5,
          failed_quantity: 5,
          pass_rate: 50,
        },
        { ...quality, scope: 'full', passed_quantity: 100, failed_quantity: 0, pass_rate: 100 },
        {
          ...quality,
          kind: 'inspection',
          passed_quantity: 100,
          failed_quantity: 0,
          pass_rate: 100,
        },
        { ...quality, phase: 'recheck', passed_quantity: 100, failed_quantity: 0, pass_rate: 100 },
      ],
      groups: [
        quality,
        {
          ...quality,
          team_id: 3,
          team_name: '研磨',
          material_name: '铜铝',
          checked_quantity: 10,
          passed_quantity: 5,
          failed_quantity: 5,
          pass_rate: 50,
        },
        { ...quality, scope: 'full', passed_quantity: 100, failed_quantity: 0, pass_rate: 100 },
        {
          ...quality,
          kind: 'inspection',
          passed_quantity: 100,
          failed_quantity: 0,
          pass_rate: 100,
        },
        { ...quality, phase: 'recheck', passed_quantity: 100, failed_quantity: 0, pass_rate: 100 },
      ],
      trend: [{ ...quality, date: '2026-10-19' }],
    },
    issues: {
      summary: { total: 2, pending: 1, processing: 1, closed: 0, unresolved: 2 },
      problems: [
        { problem_type_id: 1, name: '表面划伤', issue_count: 2, unresolved_count: 2 },
        { problem_type_id: 2, name: '尺寸偏差', issue_count: 1, unresolved_count: 1 },
      ],
      teams: [
        { team_id: 2, team_name: '轧制', issue_count: 2, unresolved_count: 2 },
        { team_id: 3, team_name: '研磨', issue_count: 1, unresolved_count: 1 },
      ],
      trend: [
        { date: '2026-10-19', total: 2, unresolved: 2 },
        { date: '2026-10-20', total: 0, unresolved: 0 },
      ],
    },
  }
}
