import { afterEach, describe, expect, it, vi } from 'vitest'
import { productionScheduleApi } from '@/services/productionScheduleApi'
import { inventoryScheduleFixture } from '@/testFixtures/inventorySchedule'
import {
  inventoryScheduleBaseline,
  inventoryScheduleDue,
  inventoryScheduleLabel,
  inventoryScheduleTone,
  isScheduleApplicable,
  loadInventorySchedules,
} from './inventorySchedule'

afterEach(() => vi.restoreAllMocks())

describe('inventory delivery schedules', () => {
  it('excludes production waste without excluding reusable surplus or defective workpieces', () => {
    for (const type of ['waste', 'sludge', 'scrap_chips']) {
      expect(isScheduleApplicable(type)).toBe(false)
      const baseline = inventoryScheduleBaseline(type)
      expect(inventoryScheduleDue(baseline)).toBe('—')
      expect(inventoryScheduleLabel(baseline)).toBe('不适用')
    }
    for (const type of ['raw_material', 'finished_surplus', 'semi_finished_surplus', 'defective']) {
      expect(isScheduleApplicable(type)).toBe(true)
      expect(inventoryScheduleBaseline(type)).toBeUndefined()
    }
  })

  it('distinguishes missing, unplanned, single and multiple due dates using server status', () => {
    expect(inventoryScheduleLabel()).toBe('未获取')
    expect(inventoryScheduleLabel(inventoryScheduleFixture())).toBe('未安排')
    const single = inventoryScheduleFixture({
      count: 1,
      due_at: '2026-10-23T08:00:00Z',
      status: 'today',
    })
    expect(inventoryScheduleDue(single)).toBe('2026-10-23 16:00')
    expect(inventoryScheduleTone(single)).toBe('warning')
    const multiple = { ...single, count: 3, overdue_count: 1, status: 'overdue' as const }
    expect(inventoryScheduleDue(multiple)).toBe('3项排期')
    expect(inventoryScheduleLabel(multiple)).toBe('1项逾期')
    expect(inventoryScheduleTone(multiple)).toBe('danger')
    expect(inventoryScheduleLabel({ ...single, status: 'completed_late' })).toBe('逾期完成')
  })

  it('loads all visible groups once and keeps waste outside delivery queries', async () => {
    const api = vi.spyOn(productionScheduleApi, 'inventory').mockResolvedValue({
      groups: [
        { group_id: 11, ...inventoryScheduleFixture() },
        { group_id: 13, ...inventoryScheduleFixture() },
      ],
      sources: [],
    })
    const result = await loadInventorySchedules(
      901,
      [
        { id: 11, materialType: 'raw_material' },
        { id: 12, materialType: 'sludge' },
        { id: 13, materialType: 'defective' },
      ],
      'groups',
    )
    expect(api).toHaveBeenCalledTimes(1)
    expect(api).toHaveBeenCalledWith({ team_id: 901, group_ids: [11, 13] })
    expect(result[12]?.status).toBe('not_applicable')
    expect(result[13]?.status).toBe('unplanned')
  })

  it('does not send empty requests and rejects incomplete replies rather than inventing no plan', async () => {
    const api = vi
      .spyOn(productionScheduleApi, 'inventory')
      .mockResolvedValue({ groups: [], sources: [] })
    expect(await loadInventorySchedules(901, [], 'groups')).toEqual({})
    expect(
      (await loadInventorySchedules(901, [{ id: 1, materialType: 'waste' }], 'sources'))[1]?.status,
    ).toBe('not_applicable')
    expect(api).not.toHaveBeenCalled()
    await expect(
      loadInventorySchedules(901, [{ id: 11, materialType: 'raw_material' }], 'groups'),
    ).rejects.toThrow('排期信息不完整')
  })
})
