// @vitest-environment jsdom
import ProcessingParameterFields from './ProcessingParameterFields.vue'
import ProcessingDurationInput from './ProcessingDurationInput.vue'
import { processRouteApi } from '@/services/processRouteApi'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, reactive } from 'vue'
import { ElInputNumber, ElOption, ElPopover, ElSelect } from 'element-plus'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MaterialStockActionDialog from './MaterialStockActionDialog.vue'
import SerialRouteAttachments from './SerialRouteAttachments.vue'
import AppDialog from './AppDialog.vue'
import WarehouseLocationSelect from './WarehouseLocationSelect.vue'
import SpecificationInput from './SpecificationInput.vue'
import SharedDispatchFields from './SharedDispatchFields.vue'
import WordDocumentPreview from './WordDocumentPreview.vue'
import ProcessRouteDrawingPreview from './ProcessRouteDrawingPreview.vue'
import ProcessRouteAttachments from './ProcessRouteAttachments.vue'
import { routeFixture } from '@/testFixtures/processRoute'
import { orderFixture } from '@/testFixtures/processRouteOrder'
import ProcessingPersonInput from './ProcessingPersonInput.vue'
import { factoryToday } from '@/utils/format'
import { productionScheduleApi } from '@/services/productionScheduleApi'
import type { ProductionSchedule, ScheduleBatch, ScheduleSummary } from '@/types/productionSchedule'
import { materialTransferApi, normalizeMaterialTransfer } from '@/services/materialTransferApi'
import TeamEmployeeInput from './TeamEmployeeInput.vue'
import { teamMaterialApi, TeamMaterialApiError } from '@/services/teamMaterialApi'
import type { MaterialDispatch, MaterialLoss, StockBatch } from '@/types/teamMaterials'
const glass = vi.hoisted(() => ({ enhance: vi.fn() }))
vi.mock('@/utils/glassDialog', () => ({ enhanceGlassDialog: glass.enhance }))
const state = vi.hoisted(() => ({
  auth: {
    isTeamAccount: true,
    currentUser: { team_id: 2 },
    currentUserError: '',
    refreshCurrentUser: vi.fn(),
  },
}))
vi.mock('@/services/materialInputApi', () => ({
  materialSuggestions: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => state.auth }))
vi.mock('@/stores/teamDirectory', () => ({
  useTeamDirectoryStore: () => ({
    items: [
      { id: 2, name: '轧制', active: true },
      { id: 3, name: '退火', active: true },
      { id: 1, name: '库房', kind: 'warehouse', active: true },
    ],
  }),
}))
function source(id = 10, type: 'semi_finished' | null = 'semi_finished'): StockBatch {
  return {
    transfer: normalizeMaterialTransfer({
      id,
      batch_no: `TL${id}`,
      serial_no: `SERIAL${id}`,
      material_name: id === 10 ? '铜钼' : '钨铜',
      source_team: { id: 1, name: '库房' },
      next_team: { id: 2, name: '轧制', code: 'FACTORY-ROLL' },
      material_type: type,
      source_batch_no: `RAW${id}`,
      transfer_specification: '100×80×5 mm',
    }),
    available_quantity: 100,
    available_weight: 10,
  } as StockBatch
}
function warehouseRoute() {
  return {
    id: 8,
    title: '产品工艺',
    version: 1,
    step_index: 0,
    sequence_no: 0,
    step_name: '备料',
    instructions: '备料',
    team_id: 2,
    processing_task_id: null,
    purpose_id: null,
    complete: true,
    split_here: false,
    next_team_id: 3,
  }
}
const warehouseFeedingOption = {
  serial_no: 'ORDER-C',
  schedule_id: 71,
  route_id: 8,
  route_version: 2,
  task_id: 6,
  task_batch_number: 2,
  team_id: 3,
  team_name: '退火',
  remaining_quantity: 226,
  remaining_weight: null,
  due_at: '2026-12-03T00:00:00Z',
}
let wrapper: VueWrapper
beforeEach(() => {
  vi.spyOn(materialTransferApi, 'get').mockImplementation(async (batch) =>
    normalizeMaterialTransfer({ batch_no: batch }),
  )
  vi.spyOn(teamMaterialApi, 'equipment').mockResolvedValue([
    { id: 3, team_id: 2, name: 'ROLL-02', active: true, version: 1 },
  ])
  vi.spyOn(processRouteApi, 'dispatchOrder').mockResolvedValue(null)
  vi.spyOn(productionScheduleApi, 'candidates').mockResolvedValue({ items: [] })
  vi.spyOn(productionScheduleApi, 'serialOptions').mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    page_size: 30,
  })
  vi.spyOn(productionScheduleApi, 'feedingOptions').mockResolvedValue([warehouseFeedingOption])
  glass.enhance.mockReset()
  vi.spyOn(teamMaterialApi, 'employees').mockResolvedValue([
    { id: 22, team_id: 2, name: '发送王师傅', active: true, version: 1 },
  ])
  vi.spyOn(teamMaterialApi, 'warehouseLocations').mockResolvedValue({ items: [] })
  vi.spyOn(teamMaterialApi, 'purposes').mockResolvedValue([])
  state.auth = reactive({
    isTeamAccount: true,
    currentUser: { team_id: 2 },
    currentUserError: '',
    refreshCurrentUser: vi.fn().mockResolvedValue(undefined),
  })
  vi.spyOn(teamMaterialApi, 'createDispatch').mockResolvedValue({
    dispatch_no: 'CK1',
    line_count: 2,
  } as MaterialDispatch)
  vi.spyOn(teamMaterialApi, 'createLoss').mockResolvedValue({ loss_no: 'LS1' } as MaterialLoss)
  vi.spyOn(teamMaterialApi, 'refreshSource').mockImplementation(async (_id, row) => ({
    ...row,
    available_quantity: 5,
    available_weight: 0.5,
  }))
})
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
})
async function render(
  mode: 'dispatch' | 'loss' = 'dispatch',
  sources = [source(), source(11)],
  initialSchedule?: Pick<ProductionSchedule, 'id' | 'next_team_id' | 'external_destination'>,
) {
  wrapper = mount(MaterialStockActionDialog, {
    props: { modelValue: true, teamId: 2, mode, sources, initialSchedule },
    global: {
      stubs: {
        SerialRouteAttachments: true,
        ElDialog: { template: '<div><slot/><slot name="footer"/></div>' },
      },
    },
  })
  await flushPromises()
  const picker = wrapper.findComponent(TeamEmployeeInput)
  if (picker.exists()) {
    picker.vm.$emit('update:modelValue', {
      id: 22,
      team_id: 2,
      name: '发送王师傅',
      active: true,
      version: 1,
    })
    await flushPromises()
  }
}
// Target each source's amounts, independently of nested dimension and disclosure controls.
function sourceAmountInputs() {
  const inputs = wrapper.findAllComponents(ElInputNumber)
  return wrapper.findAll('.source-line').flatMap((row) => {
    return ['件数', '重量', '废泥实重', '有效材料占比'].flatMap((field) =>
      inputs.filter(
        (input) =>
          row.element.contains(input.element) &&
          new RegExp(`^TL\\d+${field}$`).test(input.find('input').attributes('aria-label') || ''),
      ),
    )
  })
}
async function openSourceActions() {
  const row = wrapper.findAll('.source-line')[0]!
  await row.get('button[aria-label$="更多操作"]').trigger('click')
  await vi.waitFor(() => expect(row.find('.source-action-menu').exists()).toBe(true))
  return row
}
async function sourceAction(label: string) {
  const row = await openSourceActions()
  await row
    .findAll('button')
    .find((button) => button.text() === label)!
    .trigger('click')
  await flushPromises()
}
async function submit() {
  await wrapper
    .findAll('button')
    .find((button) => /^(确认出库|确认登记丢失)$/.test(button.text()))!
    .trigger('click')
  await flushPromises()
}
async function destination(id = 3) {
  wrapper
    .findAllComponents(ElSelect)
    .find((item) => item.find('input[aria-label="出库接收班组"]').exists())!
    .vm.$emit('update:modelValue', id)
  await flushPromises()
  if (id === 1) {
    wrapper.findAllComponents(WarehouseLocationSelect).forEach((location, index) => {
      location.vm.$emit('update:modelValue', `测试仓位-${index + 1}`)
      location.vm.$emit('update:reservationKey', `location-${index + 1}`)
    })
    await flushPromises()
  }
}

describe('source batch dispatch and loss drafts', () => {
  it('blocks a warehouse return if any line has no location', async () => {
    await render()
    await destination(1)
    const missing = wrapper.findAllComponents(WarehouseLocationSelect)[1]!
    missing.vm.$emit('update:modelValue', '')
    missing.vm.$emit('update:reservationKey', '')
    await flushPromises()
    await submit()
    expect(teamMaterialApi.createDispatch).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('请选择入库仓位')
    missing.vm.$emit('update:modelValue', 'B-02')
    missing.vm.$emit('update:reservationKey', 'selected-B-02')
    await flushPromises()
    await submit()
    expect(teamMaterialApi.createDispatch).toHaveBeenCalled()
  })
  it.each(['', '30 × 20 × 2 mm'])('accepts optional outbound dimensions %j', async (dimensions) => {
    const lot = source()
    lot.transfer.material_type = 'raw_material'
    lot.transfer.transfer_specification = null
    await render('dispatch', [lot])
    expect(wrapper.get('.source-specification-field').text()).toContain('选填')
    await destination()
    const editor = wrapper.get('.source-specification-field button[aria-expanded]')
    expect(editor.attributes('aria-expanded')).toBe('false')
    if (dimensions) {
      await editor.trigger('click')
      wrapper.getComponent(SpecificationInput).vm.$emit('update:modelValue', dimensions)
    }
    await flushPromises()
    await submit()
    expect(teamMaterialApi.createDispatch).toHaveBeenCalledWith(
      2,
      expect.objectContaining({
        lines: [expect.objectContaining({ source_transfer_id: 10 })],
      }),
    )
    expect(
      vi.mocked(teamMaterialApi.createDispatch).mock.lastCall?.[1].lines[0]?.transfer_specification,
    ).toBe(dimensions || undefined)
  })
  const schedule = (id: number) =>
    ({
      id,
      serial_no: 'SAME-SERIAL',
      task_batch_number: id - 3,
      due_at: '2026-10-24T08:00:00Z',
      remaining_quantity: 100,
      remaining_weight: null,
    }) as ScheduleSummary
  it('automatically carries the only matching deadline without another selection', async () => {
    vi.mocked(productionScheduleApi.candidates).mockResolvedValue({
      items: [
        {
          source_transfer_id: 10,
          schedules: [
            {
              ...schedule(4),
              batches: [
                {
                  id: 41,
                  batch_number: 1,
                  due_at: schedule(4).due_at,
                  target_quantity: 100,
                  dispatched_quantity: 0,
                } as ScheduleBatch,
              ],
            },
          ],
        },
      ],
    })
    await render('dispatch', [source()])
    await destination()
    const scheduleRow = wrapper.get('.dispatch-schedule-row')
    expect(scheduleRow.text()).toContain('排期')
    expect(wrapper.get('.source-weight-field').element.nextElementSibling).toBe(scheduleRow.element)
    expect(
      wrapper
        .get('.source-specification-field')
        .element.compareDocumentPosition(scheduleRow.element) & Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy()
    expect(wrapper.find('[aria-label="TL10交货排期"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="TL10交货批次"]').exists()).toBe(false)
    expect(wrapper.get('.source-schedule-estimate').text()).toContain('交期 2026-10-24 16:00')
    expect(wrapper.get('.source-schedule-estimate').text()).toContain('件数已满足')
    await submit()
    expect(teamMaterialApi.createDispatch).toHaveBeenCalledWith(
      2,
      expect.objectContaining({
        lines: [
          expect.objectContaining({ production_schedule_id: 4, production_schedule_batch_id: 41 }),
        ],
      }),
    )
  })
  it('projects all entered quantities against their selected delivery batch only', async () => {
    const batches = [
      {
        id: 41,
        batch_number: 1,
        due_at: '2026-10-25T01:00:00Z',
        target_quantity: 40,
        dispatched_quantity: 10,
        target_weight: 4,
        dispatched_weight: 1,
      },
      {
        id: 42,
        batch_number: 2,
        due_at: '2026-10-26T02:00:00Z',
        target_quantity: 25,
        dispatched_quantity: 0,
        target_weight: 2,
        dispatched_weight: 0,
      },
    ] as ScheduleBatch[]
    const plan: ScheduleSummary = { ...schedule(4), completion_basis: 'both', batches }
    vi.mocked(productionScheduleApi.candidates).mockResolvedValue({
      items: [10, 11].map((id) => ({ source_transfer_id: id, schedules: [plan] })),
    })
    await render()
    await destination()
    expect(wrapper.find('.source-schedule-estimate').exists()).toBe(false)
    const batchPickers = wrapper
      .findAllComponents(ElSelect)
      .filter((item) => String(item.props('ariaLabel')).endsWith('交货批次'))
    batchPickers.forEach((picker) => picker.vm.$emit('update:modelValue', 41))
    const inputs = sourceAmountInputs()
    inputs[0]!.vm.$emit('update:modelValue', 12)
    inputs[1]!.vm.$emit('update:modelValue', 1.1)
    inputs[2]!.vm.$emit('update:modelValue', 6)
    inputs[3]!.vm.$emit('update:modelValue', 0.7)
    await flushPromises()
    const estimates = () => wrapper.findAll('.source-schedule-estimate').map((item) => item.text())
    expect(estimates()).toEqual([
      expect.stringContaining('交期 2026-10-25 09:00'),
      expect.stringContaining('还差 12 件 · 还差 1.2 kg'),
    ])
    batchPickers[1]!.vm.$emit('update:modelValue', 42)
    await flushPromises()
    expect(estimates()[0]).toContain('还差 18 件 · 还差 1.9 kg')
    expect(estimates()[1]).toContain('交期 2026-10-26 10:00')
    expect(estimates()[1]).toContain('还差 19 件 · 还差 1.3 kg')
  })
  it.each(['quantity', 'weight', 'both'] as const)(
    'labels task progress by its %s completion basis without treating reference amounts as due',
    async (completionBasis) => {
      vi.mocked(productionScheduleApi.candidates).mockResolvedValue({
        items: [
          {
            source_transfer_id: 10,
            schedules: [
              {
                ...schedule(4),
                task_title: '第一批交货',
                completion_basis: completionBasis,
                remaining_quantity: 17,
                remaining_weight: 4.875,
              },
            ],
          },
        ],
      })
      await render('dispatch', [source()])
      await destination()
      expect(wrapper.text()).toContain('SAME-SERIAL · 第1批')
      expect(wrapper.text()).not.toContain('#4')
      const remaining = wrapper.get('.schedule-remaining').text()
      expect(remaining).toContain('待交')
      expect(remaining.includes('17 件')).toBe(completionBasis !== 'weight')
      expect(remaining.includes('4.875 kg')).toBe(completionBasis !== 'quantity')
    },
  )
  it('requires an explicit allocation when one batch has multiple deadlines', async () => {
    vi.mocked(productionScheduleApi.candidates).mockResolvedValue({
      items: [{ source_transfer_id: 10, schedules: [schedule(4), schedule(5)] }],
    })
    await render('dispatch', [source()])
    await destination()
    await submit()
    expect(teamMaterialApi.createDispatch).not.toHaveBeenCalled()
    const picker = wrapper
      .findAllComponents(ElSelect)
      .find((item) => item.props('ariaLabel') === 'TL10交货排期')!
    const labels = picker.findAllComponents(ElOption).map((option) => option.props('label'))
    expect(labels).toEqual([
      expect.stringContaining('SAME-SERIAL · 第1批'),
      expect.stringContaining('SAME-SERIAL · 第2批'),
    ])
    picker.vm.$emit('update:modelValue', 5)
    await submit()
    expect(teamMaterialApi.createDispatch).toHaveBeenCalledWith(
      2,
      expect.objectContaining({ lines: [expect.objectContaining({ production_schedule_id: 5 })] }),
    )
  })
  it('does not load or count waste against a delivery schedule', async () => {
    const waste = source()
    waste.transfer.material_type = 'waste'
    waste.scrap_available_quantity = 0
    waste.scrap_available_weight = 10
    await render('dispatch', [waste])
    await destination(1)
    expect(productionScheduleApi.candidates).not.toHaveBeenCalled()
    expect(wrapper.text()).not.toContain('交货排期')
    await submit()
    expect(teamMaterialApi.createDispatch).toHaveBeenCalled()
    expect(vi.mocked(teamMaterialApi.createDispatch).mock.calls[0]![1].lines[0]).not.toHaveProperty(
      'production_schedule_id',
    )
  })
  it('blocks submission if schedule lookup failed instead of silently dropping its association', async () => {
    vi.mocked(productionScheduleApi.candidates).mockRejectedValue(new Error('排期读取失败'))
    await render('dispatch', [source()])
    await destination()
    await submit()
    expect(teamMaterialApi.createDispatch).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('重新读取排期')
  })
  it.each([422, 409])(
    'offers a safe refresh after a schedule rejection (%s) and preserves the draft',
    async (status) => {
      vi.mocked(productionScheduleApi.candidates)
        .mockResolvedValueOnce({ items: [{ source_transfer_id: 10, schedules: [schedule(4)] }] })
        .mockResolvedValueOnce({ items: [{ source_transfer_id: 10, schedules: [schedule(5)] }] })
      vi.mocked(teamMaterialApi.createDispatch).mockRejectedValueOnce(
        new TeamMaterialApiError('所选排期已调整，请刷新排期', status),
      )
      await render('dispatch', [source()])
      await destination()
      sourceAmountInputs()[0]!.vm.$emit('update:modelValue', 75)
      await submit()
      expect(productionScheduleApi.candidates).toHaveBeenCalledTimes(1)
      expect(wrapper.text()).toContain('重新读取排期')
      await submit()
      expect(teamMaterialApi.createDispatch).toHaveBeenCalledTimes(1)
      await wrapper
        .findAll('button')
        .find((button) => button.text() === '重新读取排期')!
        .trigger('click')
      await flushPromises()
      expect(sourceAmountInputs()[0]!.props('modelValue')).toBe(75)
      await submit()
      const calls = vi.mocked(teamMaterialApi.createDispatch).mock.calls
      expect(calls[1]![1]).toMatchObject({
        next_team_id: 3,
        sent_employee_id: 22,
        lines: [{ source_transfer_id: 10, quantity: 75, production_schedule_id: 5 }],
      })
      expect(calls[1]![1].idempotency_key).not.toBe(calls[0]![1].idempotency_key)
      expect(teamMaterialApi.refreshSource).not.toHaveBeenCalled()
    },
  )
  it('ignores a late candidate response after the receiving destination changes', async () => {
    let finishOld!: (result: Awaited<ReturnType<typeof productionScheduleApi.candidates>>) => void
    vi.mocked(productionScheduleApi.candidates)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishOld = resolve
          }),
      )
      .mockResolvedValueOnce({ items: [{ source_transfer_id: 10, schedules: [schedule(5)] }] })
    await render('dispatch', [source()])
    await destination(3)
    await submit()
    expect(teamMaterialApi.createDispatch).not.toHaveBeenCalled()
    await destination(1)
    finishOld({ items: [{ source_transfer_id: 10, schedules: [schedule(4)] }] })
    await flushPromises()
    expect(wrapper.text()).toContain('SAME-SERIAL · 第2批')
    expect(wrapper.text()).not.toContain('SAME-SERIAL · 第1批')
    await submit()
    expect(vi.mocked(teamMaterialApi.createDispatch).mock.calls[0]![1]).toMatchObject({
      next_team_id: 1,
      lines: [{ production_schedule_id: 5 }],
    })
  })
  it('does not silently replace an invalid initial schedule with another matching deadline', async () => {
    vi.mocked(productionScheduleApi.candidates).mockResolvedValue({
      items: [{ source_transfer_id: 10, schedules: [schedule(5)] }],
    })
    await render('dispatch', [source()], { id: 4, next_team_id: 3, external_destination: null })
    expect(wrapper.text()).toContain('该排期已调整或已完成')
    await submit()
    expect(teamMaterialApi.createDispatch).not.toHaveBeenCalled()
  })
  it('preserves the selected schedule on uncertain retries and changes the key only with the selected deadline', async () => {
    vi.mocked(productionScheduleApi.candidates).mockResolvedValue({
      items: [{ source_transfer_id: 10, schedules: [schedule(4), schedule(5)] }],
    })
    vi.mocked(teamMaterialApi.createDispatch).mockRejectedValue(new Error('网络暂不可用'))
    await render('dispatch', [source()])
    await destination()
    const picker = wrapper
      .findAllComponents(ElSelect)
      .find((item) => item.props('ariaLabel') === 'TL10交货排期')!
    picker.vm.$emit('update:modelValue', 4)
    await submit()
    await submit()
    expect(productionScheduleApi.candidates).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).not.toContain('重新读取排期')
    picker.vm.$emit('update:modelValue', 5)
    await submit()
    const calls = vi.mocked(teamMaterialApi.createDispatch).mock.calls
    expect(calls[0]![1].lines[0]!.production_schedule_id).toBe(4)
    expect(calls[1]![1].idempotency_key).toBe(calls[0]![1].idempotency_key)
    expect(calls[2]![1].lines[0]!.production_schedule_id).toBe(5)
    expect(calls[2]![1].idempotency_key).not.toBe(calls[1]![1].idempotency_key)
  })
  it.each([
    ['FACTORY-ROLL', true],
    ['FACTORY-WIRE', true],
    ['FACTORY-ENGRAVE', true],
    ['FACTORY-WAREHOUSE', false],
    ['FACTORY-ANNEAL', false],
    ['FACTORY-GRIND', false],
    ['FACTORY-PLATE', false],
    ['FACTORY-QC', false],
  ])('limits inline processing to the configured teams: %s', async (code, allowed) => {
    const row = source()
    row.transfer.next_team.code = code
    if (code === 'FACTORY-WAREHOUSE') row.transfer.process_route = warehouseRoute()
    await render('dispatch', [row])
    if (code === 'FACTORY-WAREHOUSE') {
      await wrapper.get('input[aria-label="目标流水号"]').setValue(warehouseFeedingOption.serial_no)
      await vi.waitFor(() => expect(wrapper.text()).toContain('库房待转出'))
      expect(wrapper.getComponent(SerialRouteAttachments).props('items')).toMatchObject([
        {
          serialNo: warehouseFeedingOption.serial_no,
          scheduleTaskId: warehouseFeedingOption.task_id,
        },
      ])
    } else {
      expect(
        wrapper
          .get('.form-workspace-documents')
          .getComponent(SerialRouteAttachments)
          .props('items'),
      ).toMatchObject([{ batchNo: 'TL10', serialNo: 'SERIAL10' }])
    }
    const menu = wrapper.find('button[aria-label$="更多操作"]')
    if (menu.exists()) await openSourceActions()
    expect(wrapper.findAll('button').some((button) => button.text() === '登记加工后件数')).toBe(
      allowed,
    )
    if (!row.transfer.process_route) await destination()
    sourceAmountInputs()[0]!.vm.$emit('update:modelValue', 120)
    await flushPromises()
    expect(wrapper.find('.processing-count-notice').exists()).toBe(allowed)
    if (!allowed) {
      // Ordinary outbound remains available; it must not create a processing registration.
      await submit()
      expect(teamMaterialApi.createDispatch).toHaveBeenCalled()
      expect(
        vi.mocked(teamMaterialApi.createDispatch).mock.calls[0]![1].quantity_adjustments,
      ).toBeUndefined()
    }
  })
  it('requires a sender from the team picker and submits one employee for all lines', async () => {
    await render()
    await destination()
    const picker = wrapper.getComponent(TeamEmployeeInput)
    picker.vm.$emit('update:modelValue', null)
    await submit()
    expect(teamMaterialApi.createDispatch).not.toHaveBeenCalled()
    expect(wrapper.get('button[aria-label="转料人"]').attributes('aria-invalid')).toBe('true')
    await wrapper.get('button[aria-label="转料人"]').trigger('click')
    await flushPromises()
    await wrapper.get('input[aria-label="搜索转料人"]').setValue('王')
    await wrapper.get('.person-choice').trigger('click')
    await submit()
    expect(teamMaterialApi.createDispatch).toHaveBeenCalledWith(
      2,
      expect.objectContaining({ sent_employee_id: 22, lines: expect.any(Array) }),
    )
    expect(vi.mocked(teamMaterialApi.createDispatch).mock.calls[0]![1].lines).toHaveLength(2)
  })
  it('clears the selected sender when the outbound form is reopened', async () => {
    await render()
    await wrapper.setProps({ modelValue: false })
    await wrapper.setProps({ modelValue: true })
    await flushPromises()
    expect(wrapper.get('button[aria-label="转料人"]').text()).toContain('请选择转料人')
  })
  it('does not ask for a sending employee when registering a loss', async () => {
    await render('loss')
    expect(wrapper.findComponent(TeamEmployeeInput).exists()).toBe(false)
  })
  it('shares the existing tolerance across sibling outputs once instead of granting one kg per child', async () => {
    const first = source(),
      second = source(11)
    for (const row of [first, second]) {
      row.weight_root_transfer_id = 1
      row.weight_difference = 0.7
    }
    await render('dispatch', [first, second])
    await destination()
    sourceAmountInputs()[1]!.vm.$emit('update:modelValue', 10.2)
    sourceAmountInputs()[3]!.vm.$emit('update:modelValue', 10.2)
    await flushPromises()
    expect(wrapper.text()).toContain('累计多 1.1 kg')
    expect(wrapper.text()).toContain('超过允许的 1 kg')
    await submit()
    expect(teamMaterialApi.createDispatch).toHaveBeenCalled()
  })
  it('offers a soft processing prompt for piece expansion without guessing the registered total or blocking dispatch', async () => {
    const row = source()
    row.available_quantity = 1
    row.transfer.next_team = { id: '2', name: '轧制', code: 'FACTORY-ROLL' }
    vi.spyOn(teamMaterialApi, 'quantityContext').mockResolvedValue({
      source_transfer_id: 10,
      batch_no: 'TL10',
      quantity: 1,
      weight: 10,
      revision: 7,
      as_of: '',
      items: [],
      total: 0,
      page: 1,
      page_size: 10,
    })
    await render('dispatch', [row])
    await destination()
    sourceAmountInputs()[0]!.vm.$emit('update:modelValue', 20)
    await flushPromises()
    expect(wrapper.get('.processing-count-notice').text()).toContain('超过账面可用 1 件')
    await submit()
    expect(teamMaterialApi.createDispatch).toHaveBeenCalledWith(
      2,
      expect.objectContaining({ lines: [expect.objectContaining({ quantity: 20 })] }),
    )
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '展开加工登记')!
      .trigger('click')
    await flushPromises()
    expect(wrapper.findComponent({ name: 'QuantityAdjustmentDialog' }).exists()).toBe(false)
    expect(wrapper.get('input[aria-label="TL10加工后未转出件数"]').element).toHaveProperty(
      'value',
      '1',
    )
    expect(wrapper.find('.processing-count-notice').exists()).toBe(false)
  })
  it('calculates optional clearance from the staged processing total and never from the old count', async () => {
    const row = source()
    row.transfer.next_team = { id: '2', name: '轧制', code: 'FACTORY-ROLL' }
    vi.spyOn(teamMaterialApi, 'quantityContext').mockResolvedValue({
      source_transfer_id: 10,
      batch_no: 'TL10',
      quantity: 100,
      weight: 10,
      revision: 7,
      as_of: '',
      items: [],
      total: 0,
      page: 1,
      page_size: 10,
    })
    await render('dispatch', [row])
    await destination()
    await sourceAction('登记加工后件数')
    await flushPromises()
    const count = wrapper
      .findAllComponents(ElInputNumber)
      .find((input) => input.props('ariaLabel') === 'TL10加工后未转出件数')!
    count.vm.$emit('update:modelValue', 120)
    await flushPromises()
    expect(wrapper.text()).toContain('账面仍有 20 件')
    await wrapper.get('[aria-label="TL10清零剩余件数"] input').setValue(true)
    wrapper
      .findAllComponents(ProcessingPersonInput)
      .find((picker) => picker.props('label') === 'TL10加工人')!
      .vm.$emit('update:modelValue', '王师傅')
    await submit()
    expect(vi.mocked(teamMaterialApi.createDispatch).mock.calls[0]![1]).toMatchObject({
      quantity_adjustments: [{ quantity: 120 }],
      quantity_clearances: [{ source_transfer_id: 10, quantity: 20 }],
    })
    count.vm.$emit('update:modelValue', 100)
    await flushPromises()
    expect(wrapper.find('[aria-label="TL10清零剩余件数"]').exists()).toBe(false)
  })
  it('keeps an unreadable stock balance as an operational error instead of marking inputs', async () => {
    const row = source()
    row.available_weight = null
    await render('dispatch', [row])
    await destination()
    await submit()
    expect(teamMaterialApi.createDispatch).not.toHaveBeenCalled()
    expect(wrapper.find('.el-alert--error').text()).toContain('请先刷新该批次的可转出库存')
    expect(wrapper.find('.is-error').exists()).toBe(false)
  })
  it('lets each outbound line carry a changed actual specification while defaults inherit on the server', async () => {
    const row = source()
    row.current_specification = '20 × 10 × 2 mm'
    await render('dispatch', [row])
    await destination()
    expect(wrapper.getComponent(SpecificationInput).props('modelValue')).toBe('20 × 10 × 2 mm')
    await submit()
    expect(vi.mocked(teamMaterialApi.createDispatch).mock.calls[0]![1].lines[0]).not.toHaveProperty(
      'transfer_specification',
    )
    vi.mocked(teamMaterialApi.createDispatch).mockClear()
    wrapper.getComponent(SpecificationInput).vm.$emit('update:modelValue', '10 × 10 × 2 mm')
    await submit()
    expect(vi.mocked(teamMaterialApi.createDispatch).mock.calls[0]![1].lines[0]).toHaveProperty(
      'transfer_specification',
      '10 × 10 × 2 mm',
    )
  })
  it('submits an unchanged processing count with a partial progress registration atomically with outbound', async () => {
    const row = source()
    row.transfer.next_team = { id: '2', name: '轧制', code: 'FACTORY-ROLL' }
    vi.spyOn(teamMaterialApi, 'quantityContext').mockResolvedValue({
      source_transfer_id: 10,
      batch_no: 'TL10',
      quantity: 100,
      weight: 10,
      revision: 7,
      as_of: '',
      items: [],
      total: 0,
      page: 1,
      page_size: 10,
    })
    await render('dispatch', [row])
    await destination()
    await sourceAction('登记加工后件数')
    await flushPromises()
    await submit()
    expect(teamMaterialApi.createDispatch).not.toHaveBeenCalled()
    expect(
      wrapper
        .findAllComponents(ProcessingPersonInput)
        .find((picker) => picker.props('label') === 'TL10加工人')!
        .element.closest('.el-form-item')
        ?.classList.contains('is-error'),
    ).toBe(true)
    wrapper
      .findAllComponents(ProcessingPersonInput)
      .find((picker) => picker.props('label') === 'TL10加工人')!
      .vm.$emit('update:modelValue', '王师傅')
    await submit()
    expect(
      vi.mocked(teamMaterialApi.createDispatch).mock.calls[0]![1].quantity_adjustments,
    ).toEqual([
      {
        source_transfer_id: 10,
        quantity: 100,
        expected_revision: 7,
        processor_name: '王师傅',
        reason: '',
        processing_status: 'partial',
      },
    ])
  })
  it.each([false, true])('validates inline work (self-check %s)', async (selfCheck) => {
    vi.spyOn(teamMaterialApi, 'processingTasks').mockResolvedValue([
      { id: 9, team_id: 2, name: '压轧', active: true, version: 1 },
    ])
    vi.spyOn(teamMaterialApi, 'quantityContext').mockResolvedValue({
      source_transfer_id: 10,
      batch_no: 'TL10',
      quantity: 100,
      weight: 10,
      revision: 7,
      processing_mode: 'split',
      self_check_enabled: selfCheck,
      parameter_fields: ['machine_no'],
      task_required: true,
      allowed_task_ids: [9],
      as_of: '',
      items: [],
      total: 0,
      page: 1,
      page_size: 10,
    })
    const batch = source()
    if (selfCheck) Object.assign(batch.transfer.next_team, { name: '线切割', code: 'FACTORY-WIRE' })
    await render('dispatch', [batch])
    await destination()
    await sourceAction('登记加工后件数')
    await flushPromises()
    await submit()
    expect(teamMaterialApi.createDispatch).not.toHaveBeenCalled()
    const picker = wrapper
      .findAllComponents(TeamEmployeeInput)
      .find((item) => item.props('label') === '加工人')!
    expect(picker.props('invalid')).toBe(true)
    picker.vm.$emit('update:people', [
      {
        id: 22,
        team_id: 2,
        name: '发送王师傅',
        active: true,
        version: 1,
      },
    ])
    await flushPromises()
    await wrapper.get('input[aria-label="实际加工日期"]').setValue('')
    await submit()
    expect(teamMaterialApi.createDispatch).not.toHaveBeenCalled()
    await wrapper.get('input[aria-label="实际加工日期"]').setValue(factoryToday())
    await submit()
    expect(teamMaterialApi.createDispatch).not.toHaveBeenCalled()
    const task = wrapper
      .findAllComponents(ElSelect)
      .find((item) => item.find('[aria-label="加工任务"]').exists())!
    expect(task.element.closest('.is-error')).not.toBeNull()
    wrapper
      .getComponent(ProcessingParameterFields)
      .vm.$emit('update:modelValue', { machine_no: 'ROLL-02', equipment_id: 3 })
    task.vm.$emit('update:modelValue', 9)
    await flushPromises()
    await submit()
    expect(teamMaterialApi.createDispatch).not.toHaveBeenCalled()
    expect(wrapper.getComponent(ProcessingDurationInput).props('invalid')).toBe(true)
    wrapper.getComponent(ProcessingDurationInput).vm.$emit('update:modelValue', 90)
    await submit()
    expect(teamMaterialApi.createDispatch).not.toHaveBeenCalled()
    await wrapper.get('textarea[aria-label="加工备注"]').setValue('无')
    if (selfCheck) {
      await submit()
      expect(teamMaterialApi.createDispatch).not.toHaveBeenCalled()
      wrapper
        .findAllComponents(ElInputNumber)
        .find((item) => item.find('input[aria-label="不合格数"]').exists())!
        .vm.$emit('update:modelValue', 0)
      await flushPromises()
    }
    await submit()
    expect(
      vi.mocked(teamMaterialApi.createDispatch).mock.calls[0]![1].quantity_adjustments,
    ).toEqual([
      expect.objectContaining({
        source_transfer_id: 10,
        quantity: 100,
        expected_revision: 7,
        ...(selfCheck
          ? { self_check: { failed_quantity: 0, failed_weight: 0, failure_reason: '' } }
          : {}),
        processor_employee_id: 22,
        machine_no: 'ROLL-02',
        processing_minutes: 90,
        processing_task_id: 9,
        processor_name: '发送王师傅',
        processing_mode: 'split',
        processing_date: factoryToday(),
        input_quantity: 100,
        processing_status: 'complete',
      }),
    ])
  })
  it('keeps the next source menu open when the previous menu finishes closing', async () => {
    await render()
    const [first, second] = wrapper
      .findAll('.source-actions')
      .map((actions) => actions.getComponent(ElPopover))
    first!.vm.$emit('update:visible', true)
    await flushPromises()
    second!.vm.$emit('update:visible', true)
    first!.vm.$emit('update:visible', false)
    await flushPromises()
    expect(first!.props('visible')).toBe(false)
    expect(second!.props('visible')).toBe(true)
  })
  it('reveals invalid collapsed dimensions and retains edited dimensions after collapsing', async () => {
    await render('dispatch', [source()])
    await destination()
    const dimensions = wrapper.getComponent(SpecificationInput)
    const section = wrapper.get('.source-specification-field')
    const trigger = section.get('button[aria-expanded]')
    expect(trigger.attributes('aria-expanded')).toBe('false')
    dimensions.vm.$emit('validity-change', false)
    await submit()
    expect(teamMaterialApi.createDispatch).not.toHaveBeenCalled()
    expect(trigger.attributes('aria-expanded')).toBe('true')
    expect(section.find('.el-form-item.is-error').exists()).toBe(true)

    dimensions.vm.$emit('update:modelValue', '30 × 20 × 2 mm')
    dimensions.vm.$emit('validity-change', true)
    await flushPromises()
    expect(trigger.attributes('aria-expanded')).toBe('true')
    await trigger.trigger('click')
    expect(trigger.attributes('aria-expanded')).toBe('false')
    expect(trigger.text()).toContain('30 × 20 × 2 mm')
    await submit()
    expect(teamMaterialApi.createDispatch).toHaveBeenCalledWith(
      2,
      expect.objectContaining({
        lines: [expect.objectContaining({ transfer_specification: '30 × 20 × 2 mm' })],
      }),
    )
  })
  it('refreshes inherited specifications after conflict without overwriting an edited line', async () => {
    const first = source(),
      second = source(11)
    first.current_specification = second.current_specification = '20 × 10 × 2 mm'
    vi.mocked(teamMaterialApi.refreshSource).mockImplementation(async (_id, row) => ({
      ...row,
      current_specification: '15 × 10 × 2 mm',
    }))
    vi.mocked(teamMaterialApi.createDispatch).mockRejectedValueOnce(
      new TeamMaterialApiError('库存已变化', 409),
    )
    await render('dispatch', [first, second])
    await destination()
    wrapper
      .findAllComponents(SpecificationInput)[1]!
      .vm.$emit('update:modelValue', '10 × 10 × 2 mm')
    await submit()
    expect(
      wrapper.findAllComponents(SpecificationInput).map((input) => input.props('modelValue')),
    ).toEqual(['15 × 10 × 2 mm', '10 × 10 × 2 mm'])
    await submit()
    const lines = vi.mocked(teamMaterialApi.createDispatch).mock.calls[1]![1].lines
    expect(lines[0]).not.toHaveProperty('transfer_specification')
    expect(lines[1]).toHaveProperty('transfer_specification', '10 × 10 × 2 mm')
  })
  it('does not validate hidden dimensions after switching outbound to weight-only scrap', async () => {
    await render('dispatch', [source()])
    await destination(1)
    wrapper.getComponent(SpecificationInput).vm.$emit('validity-change', false)
    wrapper
      .findAllComponents(ElSelect)
      .find((item) => item.props('ariaLabel') === 'TL10物料类型')!
      .vm.$emit('update:modelValue', 'scrap_chips')
    await flushPromises()
    await submit()
    expect(teamMaterialApi.createDispatch).toHaveBeenCalledWith(
      2,
      expect.objectContaining({
        lines: [expect.objectContaining({ quantity: 0, weight: 10, material_type: 'scrap_chips' })],
      }),
    )
  })
  it('shows every source and marks an invalid row without hiding other values', async () => {
    await render()
    await destination()
    sourceAmountInputs()[0]!.vm.$emit('update:modelValue', 60)
    sourceAmountInputs()[2]!.vm.$emit('update:modelValue', undefined)
    await submit()
    expect(wrapper.find('nav[aria-label="表单分页"]').exists()).toBe(false)
    expect(wrapper.findAll('.source-line').every((line) => line.isVisible())).toBe(true)
    expect(teamMaterialApi.createDispatch).not.toHaveBeenCalled()
    expect(
      wrapper
        .get('input[aria-label="TL11件数"]')
        .element.closest('.el-form-item')!
        .classList.contains('is-error'),
    ).toBe(true)
    expect(wrapper.find('.el-alert--error').exists()).toBe(false)
    expect(sourceAmountInputs()[0]!.props('modelValue')).toBe(60)
    sourceAmountInputs()[2]!.vm.$emit('update:modelValue', 90)
    await flushPromises()
    expect(
      wrapper
        .get('input[aria-label="TL11件数"]')
        .element.closest('.el-form-item')!
        .classList.contains('is-error'),
    ).toBe(false)
    await submit()
    expect(teamMaterialApi.createDispatch).toHaveBeenCalledWith(
      2,
      expect.objectContaining({
        lines: [
          expect.objectContaining({ quantity: 60 }),
          expect.objectContaining({ quantity: 90 }),
        ],
      }),
    )
  })
  it('converts newly produced sludge and clears remaining pieces only on the final material kg', async () => {
    await render('dispatch', [source()])
    await destination(1)
    wrapper
      .findAllComponents(ElSelect)
      .find((item) => item.props('ariaLabel') === 'TL10物料类型')!
      .vm.$emit('update:modelValue', 'sludge')
    await flushPromises()
    const inputs = sourceAmountInputs()
    ;[10, 30].forEach((value, i) => inputs[i]!.vm.$emit('update:modelValue', value))
    await wrapper.get('textarea').setValue('废泥回库')
    await flushPromises()
    await submit()
    expect(teamMaterialApi.createDispatch).toHaveBeenCalledWith(
      2,
      expect.objectContaining({
        lines: [
          expect.objectContaining({
            material_type: 'sludge',
            quantity: 0,
            weight: 3,
            sludge_gross_weight: 10,
            sludge_content_percent: 30,
          }),
        ],
      }),
    )
    expect(wrapper.text()).not.toContain('将清零')
    vi.mocked(teamMaterialApi.createDispatch).mockClear()
    inputs[0]!.vm.$emit('update:modelValue', 20)
    inputs[1]!.vm.$emit('update:modelValue', 50)
    await flushPromises()
    await submit()
    expect(teamMaterialApi.createDispatch).toHaveBeenCalled()
    expect(wrapper.text()).toContain('账面仍有 100 件')
  })
  it('fills remaining actual sludge instead of dividing a rounded ledger weight, and locks its ratio', async () => {
    const row = source()
    row.transfer.material_type = 'sludge'
    row.transfer.sludge_gross_weight = 1.005
    row.transfer.sludge_content_percent = 10
    row.available_quantity = 0
    row.available_weight = 0
    row.scrap_available_quantity = 0
    row.scrap_available_weight = 0.101
    row.sludge_available_gross_weight = 1.005
    await render('dispatch', [row])
    await destination(1)
    expect(wrapper.get('input[aria-label="TL10有效材料占比"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('input[aria-label="TL10废泥实重"]').element).toHaveProperty('value', '1.005')
    await wrapper.get('textarea').setValue('废泥回库')
    await submit()
    expect(teamMaterialApi.createDispatch).toHaveBeenCalledWith(
      2,
      expect.objectContaining({
        lines: [
          expect.objectContaining({
            weight: 0.1005,
            sludge_gross_weight: 1.005,
            sludge_content_percent: 10,
          }),
        ],
      }),
    )
  })
  it('keeps leftover pieces unless the optional clearance is explicitly requested', async () => {
    await render('dispatch', [source()])
    await destination()
    sourceAmountInputs()[0]!.vm.$emit('update:modelValue', 80)
    await flushPromises()
    expect(wrapper.text()).toContain('账面仍有 20 件')
    await submit()
    expect(vi.mocked(teamMaterialApi.createDispatch).mock.calls[0]![1].quantity_clearances).toEqual(
      [],
    )
    vi.mocked(teamMaterialApi.createDispatch).mockClear()
    await wrapper.get('[aria-label="TL10清零剩余件数"] input').setValue(true)
    await wrapper.get('textarea[aria-label="TL10清零原因"]').setValue('  加工后实际件数减少  ')
    await submit()
    expect(teamMaterialApi.createDispatch).toHaveBeenCalledWith(
      2,
      expect.objectContaining({
        quantity_clearances: [
          { source_transfer_id: 10, quantity: 20, reason: '加工后实际件数减少' },
        ],
        lines: [expect.objectContaining({ quantity: 80, weight: 10 })],
      }),
    )
  })
  it('clears remaining pieces without a reason only after explicit selection and resets on reopening', async () => {
    await render('dispatch', [source()])
    await destination()
    sourceAmountInputs()[0]!.vm.$emit('update:modelValue', 80)
    await flushPromises()
    await wrapper.get('[aria-label="TL10清零剩余件数"] input').setValue(true)
    await submit()
    expect(vi.mocked(teamMaterialApi.createDispatch).mock.calls[0]![1].quantity_clearances).toEqual(
      [{ source_transfer_id: 10, quantity: 20, reason: '' }],
    )
    await wrapper.setProps({ modelValue: false })
    await wrapper.setProps({ modelValue: true })
    wrapper.getComponent(TeamEmployeeInput).vm.$emit('update:modelValue', {
      id: 22,
      team_id: 2,
      name: '发送王师傅',
      active: true,
      version: 1,
    })
    await destination()
    sourceAmountInputs()[0]!.vm.$emit('update:modelValue', 80)
    await flushPromises()
    await submit()
    expect(vi.mocked(teamMaterialApi.createDispatch).mock.calls[1]![1].quantity_clearances).toEqual(
      [],
    )
  })
  it('clears one source remainder across split lines and discards consent when the amounts change', async () => {
    await render('dispatch', [source()])
    await destination()
    await sourceAction('拆分物料')
    const inputs = sourceAmountInputs()
    ;[30, 4, 50, 6].forEach((value, i) => inputs[i]!.vm.$emit('update:modelValue', value))
    await flushPromises()
    expect(wrapper.findAll('[aria-label="TL10清零剩余件数"] input')).toHaveLength(1)
    await wrapper.get('[aria-label="TL10清零剩余件数"] input').setValue(true)
    await wrapper.get('textarea[aria-label="TL10清零原因"]').setValue('加工后余数核对')
    inputs[2]!.vm.$emit('update:modelValue', 40)
    await flushPromises()
    await submit()
    expect(vi.mocked(teamMaterialApi.createDispatch).mock.calls[0]![1].quantity_clearances).toEqual(
      [],
    )
    vi.mocked(teamMaterialApi.createDispatch).mockClear()
    expect(wrapper.text()).toContain('账面仍有 30 件')
    await wrapper.get('[aria-label="TL10清零剩余件数"] input').setValue(true)
    await wrapper.get('textarea[aria-label="TL10清零原因"]').setValue('重新核对余数')
    await submit()
    expect(vi.mocked(teamMaterialApi.createDispatch).mock.calls[0]![1].quantity_clearances).toEqual(
      [{ source_transfer_id: 10, quantity: 30, reason: '重新核对余数' }],
    )
  })
  it('does not silently apply an old reason to another batch or to a loss', async () => {
    await render()
    await destination()
    sourceAmountInputs()[0]!.vm.$emit('update:modelValue', 80)
    sourceAmountInputs()[2]!.vm.$emit('update:modelValue', 90)
    await flushPromises()
    await wrapper.get('[aria-label="TL10清零剩余件数"] input').setValue(true)
    await wrapper.get('textarea[aria-label="TL10清零原因"]').setValue('第一批核对')
    await submit()
    expect(
      vi.mocked(teamMaterialApi.createDispatch).mock.calls[0]![1].quantity_clearances,
    ).toHaveLength(1)
    vi.mocked(teamMaterialApi.createDispatch).mockClear()
    await wrapper.get('[aria-label="TL11清零剩余件数"] input').setValue(true)
    await wrapper.get('textarea[aria-label="TL11清零原因"]').setValue('第二批核对')
    await submit()
    expect(
      vi.mocked(teamMaterialApi.createDispatch).mock.calls[0]![1].quantity_clearances,
    ).toHaveLength(2)
    await wrapper.setProps({ mode: 'loss' })
    expect(wrapper.find('[aria-label="剩余件数清零"]').exists()).toBe(false)
  })
  it('warehouse transfers show the source serial only and carry the original material type', async () => {
    const row = source()
    row.transfer.next_team = { id: '2', name: '库房', code: 'FACTORY-WAREHOUSE' }
    row.transfer.process_route = warehouseRoute()
    row.transfer.warehouse_location = '历史仓位'
    row.warehouse_positions = []
    row.unassigned_quantity = 100
    row.unassigned_weight = 10
    await render('dispatch', [row])
    expect(wrapper.get('.warehouse-serial').text()).toBe(row.transfer.serial_no)
    expect(wrapper.find('.warehouse-materials .source-actions').exists()).toBe(false)
    expect(wrapper.find('.warehouse-materials .source-specification-field').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('当前仓位')
    expect(wrapper.text()).not.toContain('历史仓位')
    expect(wrapper.text()).not.toContain('登记加工后件数')
    expect(wrapper.text()).not.toContain('拆分物料')
    expect(
      wrapper
        .findAllComponents(ElSelect)
        .some((select) => String(select.attributes('aria-label')).includes('物料类型')),
    ).toBe(false)
    await wrapper.get('input[aria-label="目标流水号"]').setValue(warehouseFeedingOption.serial_no)
    await vi.waitFor(() => expect(wrapper.text()).toContain('库房待转出'))
    await submit()
    expect(teamMaterialApi.createDispatch).toHaveBeenCalledWith(
      2,
      expect.objectContaining({
        lines: [
          expect.objectContaining({ material_type: 'semi_finished', source_transfer_id: 10 }),
        ],
      }),
    )
  })
  it('sends each incoming batch with its own selected location and lease key', async () => {
    await render()
    await destination(1)
    const selectors = wrapper.findAllComponents(WarehouseLocationSelect)
    expect(selectors).toHaveLength(2)
    selectors[0]!.vm.$emit('update:modelValue', 'A-01')
    selectors[0]!.vm.$emit('update:reservationKey', 'first-selected-location-key')
    selectors[1]!.vm.$emit('update:modelValue', 'A-02')
    selectors[1]!.vm.$emit('update:reservationKey', 'second-selected-location-key')
    selectors[0]!.vm.$emit('busyChange', true)
    await submit()
    expect(teamMaterialApi.createDispatch).not.toHaveBeenCalled()
    selectors[0]!.vm.$emit('busyChange', false)
    await flushPromises()
    await submit()
    expect(vi.mocked(teamMaterialApi.createDispatch).mock.calls[0]![1].lines).toEqual([
      expect.objectContaining({
        warehouse_location: 'A-01',
        warehouse_location_reservation_key: 'first-selected-location-key',
      }),
      expect.objectContaining({
        warehouse_location: 'A-02',
        warehouse_location_reservation_key: 'second-selected-location-key',
      }),
    ])
  })

  it('stages a processing count with outbound without a separate mutation', async () => {
    vi.spyOn(teamMaterialApi, 'quantityContext').mockResolvedValue({
      source_transfer_id: 10,
      batch_no: 'TL10',
      quantity: 100,
      weight: 10,
      revision: 7,
      as_of: '',
      items: [],
      total: 0,
      page: 1,
      page_size: 10,
    })
    const change = vi.spyOn(teamMaterialApi, 'changeQuantity')
    await render('dispatch', [source()])
    await destination()
    const inputs = sourceAmountInputs()
    inputs[0]!.vm.$emit('update:modelValue', 3)
    inputs[1]!.vm.$emit('update:modelValue', 0.3)
    await sourceAction('登记加工后件数')
    await flushPromises()
    wrapper
      .findAllComponents(ElInputNumber)
      .find((input) => input.props('ariaLabel')?.endsWith('加工后未转出件数'))!
      .vm.$emit('update:modelValue', 120)
    wrapper
      .findAllComponents(ProcessingPersonInput)
      .find((picker) => picker.props('label') === 'TL10加工人')!
      .vm.$emit('update:modelValue', '王师傅')
    await submit()
    expect(change).not.toHaveBeenCalled()
    expect(teamMaterialApi.createDispatch).toHaveBeenCalledWith(
      2,
      expect.objectContaining({
        quantity_adjustments: [
          {
            source_transfer_id: 10,
            quantity: 120,
            expected_revision: 7,
            processor_name: '王师傅',
            processing_status: 'partial',
            reason: '',
          },
        ],
        lines: [
          { source_transfer_id: 10, quantity: 3, weight: 0.3, material_type: 'semi_finished' },
        ],
      }),
    )
  })
  it('discards a staged recount when outbound is canceled and opens an enabled field after loading', async () => {
    let resolve!: (value: Awaited<ReturnType<typeof teamMaterialApi.quantityContext>>) => void
    vi.spyOn(teamMaterialApi, 'quantityContext').mockReturnValue(
      new Promise((done) => {
        resolve = done
      }),
    )
    const change = vi.spyOn(teamMaterialApi, 'changeQuantity')
    await render('dispatch', [source()])
    await destination()
    await sourceAction('登记加工后件数')
    expect(wrapper.find('input[aria-label="TL10加工后未转出件数"]').exists()).toBe(false)
    resolve({
      source_transfer_id: 10,
      batch_no: 'TL10',
      quantity: 100,
      weight: 10,
      revision: 7,
      as_of: '',
      items: [],
      total: 0,
      page: 1,
      page_size: 10,
    })
    await flushPromises()
    const field = wrapper.get('input[aria-label="TL10加工后未转出件数"]')
    expect(field.attributes('disabled')).toBeUndefined()
    expect(field.attributes('aria-disabled')).not.toBe('true')
    await field.setValue('120')
    await field.trigger('change')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '取消')!
      .trigger('click')
    expect(change).not.toHaveBeenCalled()
    expect(teamMaterialApi.createDispatch).not.toHaveBeenCalled()
    await wrapper.setProps({ modelValue: false })
    await wrapper.setProps({ modelValue: true })
    expect(wrapper.find('input[aria-label="TL10加工后未转出件数"]').exists()).toBe(false)
  })
  it('removes the recount draft when its last outbound line is removed', async () => {
    vi.spyOn(teamMaterialApi, 'quantityContext').mockResolvedValue({
      source_transfer_id: 10,
      batch_no: 'TL10',
      quantity: 100,
      weight: 10,
      revision: 7,
      as_of: '',
      items: [],
      total: 0,
      page: 1,
      page_size: 10,
    })
    await render()
    await destination()
    await sourceAction('登记加工后件数')
    await flushPromises()
    wrapper
      .findAllComponents(ElInputNumber)
      .find((input) => input.props('ariaLabel')?.endsWith('加工后未转出件数'))!
      .vm.$emit('update:modelValue', 120)
    await sourceAction('移除')
    await submit()
    expect(teamMaterialApi.createDispatch).toHaveBeenCalledWith(
      2,
      expect.objectContaining({
        lines: [
          { source_transfer_id: 11, quantity: 100, weight: 10, material_type: 'semi_finished' },
        ],
      }),
    )
    expect(
      vi.mocked(teamMaterialApi.createDispatch).mock.calls[0]![1].quantity_adjustments,
    ).toBeUndefined()
  })
  it.each([true, false])(
    'leaves downstream task selection to that team, even with active=%s settings',
    async (active) => {
      vi.mocked(teamMaterialApi.purposes).mockResolvedValue([
        { id: 31, team_id: 3, name: '精磨', active, version: 1 },
      ])
      await render()
      await destination()
      expect(wrapper.text()).not.toMatch(/下序接收任务|统一接收任务/)
      await submit()
      expect(teamMaterialApi.createDispatch).toHaveBeenCalledOnce()
      expect(teamMaterialApi.purposes).not.toHaveBeenCalled()
      for (const line of vi.mocked(teamMaterialApi.createDispatch).mock.lastCall![1].lines)
        expect(line).not.toHaveProperty('purpose_id')
    },
  )
  it('submits excessive split amounts and shows the combined shortage without blocking', async () => {
    await render('dispatch', [source()])
    await destination(1)
    await sourceAction('拆分物料')
    await flushPromises()
    const inputs = sourceAmountInputs()
    ;[80, 8, 21, 2.001].forEach((value, i) => inputs[i]!.vm.$emit('update:modelValue', value))
    wrapper
      .findAllComponents(ElSelect)
      .filter((select) => select.props('ariaLabel')?.endsWith('物料类型'))[1]!
      .vm.$emit('update:modelValue', 'waste')
    await wrapper.get('textarea').setValue('加工废料回库')
    await flushPromises()
    wrapper.findAllComponents(WarehouseLocationSelect).forEach((location, index) => {
      location.vm.$emit('update:modelValue', `回库-${index + 1}`)
      location.vm.$emit('update:reservationKey', `return-location-${index + 1}`)
    })
    await flushPromises()
    expect(wrapper.text()).toContain('本次转出比账面剩余多 0.001 kg')
    expect(wrapper.text()).toContain('在允许的 1 kg 误差范围内')
    await submit()
    expect(teamMaterialApi.createDispatch).toHaveBeenCalledWith(
      2,
      expect.objectContaining({
        next_team_id: 1,
        lines: [
          expect.objectContaining({
            source_transfer_id: 10,
            quantity: 80,
            weight: 8,
            material_type: 'semi_finished',
            warehouse_location: '回库-1',
          }),
          expect.objectContaining({
            source_transfer_id: 10,
            quantity: 21,
            weight: 2.001,
            material_type: 'waste',
            warehouse_location: '回库-2',
          }),
        ],
      }),
    )
  })
  it.each([1, 1.000001])(
    'warns for a cumulative per-source difference of %s kg without blocking',
    async (difference) => {
      await render('dispatch', [source()])
      await destination()
      await sourceAction('拆分物料')
      await flushPromises()
      const inputs = sourceAmountInputs()
      ;[50, 5, 50, 5 + difference].forEach((value, index) =>
        inputs[index]!.vm.$emit('update:modelValue', value),
      )
      await flushPromises()
      expect(wrapper.text()).toContain(
        difference <= 1 ? '在允许的 1 kg 误差范围内' : '超过允许的 1 kg 误差，请核对，仍可提交',
      )
      await submit()
      expect(teamMaterialApi.createDispatch).toHaveBeenCalled()
    },
  )
  it('includes an earlier weight difference when the same source is used again', async () => {
    const row = source()
    row.available_quantity = 0
    row.available_weight = -0.6
    vi.mocked(teamMaterialApi.refreshSource).mockResolvedValue(row)
    await render('dispatch', [row])
    await destination()
    const inputs = sourceAmountInputs()
    inputs[0]!.vm.$emit('update:modelValue', 0)
    inputs[1]!.vm.$emit('update:modelValue', 0.5)
    await flushPromises()
    expect(wrapper.text()).toContain('累计多 1.1 kg')
    expect(wrapper.text()).toContain('超过允许的 1 kg 误差，请核对，仍可提交')
    await submit()
    expect(teamMaterialApi.createDispatch).toHaveBeenCalledWith(
      2,
      expect.objectContaining({ lines: [expect.objectContaining({ quantity: 0, weight: 0.5 })] }),
    )
  })
  it('allows optional scrap reasons but excludes production destinations', async () => {
    await render('dispatch', [source()])
    await destination(3)
    wrapper
      .findAllComponents(ElSelect)
      .find((item) => item.find('input[aria-label$="物料类型"]').exists())!
      .vm.$emit('update:modelValue', 'waste')
    await submit()
    expect(teamMaterialApi.createDispatch).not.toHaveBeenCalled()
    expect(
      wrapper
        .get('input[aria-label="出库接收班组"]')
        .element.closest('.el-form-item')!
        .classList.contains('is-error'),
    ).toBe(true)
    await destination(1)
    await submit()
    expect(teamMaterialApi.createDispatch).toHaveBeenCalledWith(
      2,
      expect.objectContaining({ notes: null, next_team_id: 1 }),
    )
  })
  it('sends one atomic bulk request with separate source identities and amounts', async () => {
    await render()
    await destination()
    const inputs = sourceAmountInputs()
    inputs[0]!.vm.$emit('update:modelValue', 5)
    inputs[1]!.vm.$emit('update:modelValue', 0)
    inputs[2]!.vm.$emit('update:modelValue', 0)
    inputs[3]!.vm.$emit('update:modelValue', 1.005)
    await submit()
    expect(teamMaterialApi.createDispatch).toHaveBeenCalledWith(2, {
      sent_employee_id: 22,
      next_team_id: 3,
      notes: null,
      idempotency_key: expect.any(String),
      lines: [
        { source_transfer_id: 10, quantity: 5, weight: 0, material_type: 'semi_finished' },
        { source_transfer_id: 11, quantity: 0, weight: 1.005, material_type: 'semi_finished' },
      ],
    })
    expect(wrapper.emitted('saved')).toHaveLength(1)
  })
  it('preserves all drafts on 409, refreshes balances and refuses unchanged excessive quantities', async () => {
    vi.mocked(teamMaterialApi.createDispatch).mockRejectedValueOnce(
      new TeamMaterialApiError('余额不足', 409),
    )
    await render()
    await destination()
    await submit()
    expect(teamMaterialApi.refreshSource).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('填写内容已保留')
    expect(sourceAmountInputs()[0]!.props('modelValue')).toBe(100)
    await submit()
    expect(teamMaterialApi.createDispatch).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('仅记录重量差异')
    sourceAmountInputs().forEach((input) => input.vm.$emit('update:modelValue', 0.0))
    sourceAmountInputs()[0]!.vm.$emit('update:modelValue', 1)
    sourceAmountInputs()[2]!.vm.$emit('update:modelValue', 1)
    await submit()
    expect(teamMaterialApi.createDispatch).toHaveBeenCalledTimes(3)
  })
  it('reuses the same idempotency key after uncertain network failure and regenerates when content changes', async () => {
    vi.mocked(teamMaterialApi.createDispatch).mockRejectedValue(
      new TeamMaterialApiError('网络错误'),
    )
    await render()
    await destination()
    await submit()
    await submit()
    const calls = vi.mocked(teamMaterialApi.createDispatch).mock.calls
    expect(calls[0]![1].idempotency_key).toBe(calls[1]![1].idempotency_key)
    sourceAmountInputs()[0]!.vm.$emit('update:modelValue', 2)
    sourceAmountInputs()[1]!.vm.$emit('update:modelValue', 0.2)
    await submit()
    expect(calls[2]![1].idempotency_key).not.toBe(calls[1]![1].idempotency_key)
  })
  it('requires material type for a legacy source returning to warehouse and accepts an optional loss reason', async () => {
    await render('dispatch', [source(10, null)])
    await destination(1)
    await submit()
    expect(teamMaterialApi.createDispatch).not.toHaveBeenCalled()
    expect(
      wrapper
        .get('input[aria-label="TL10物料类型"]')
        .element.closest('.el-form-item')!
        .classList.contains('is-error'),
    ).toBe(true)
    await wrapper.setProps({ mode: 'loss' })
    const inputs = sourceAmountInputs()
    inputs[0]!.vm.$emit('update:modelValue', 0)
    inputs[1]!.vm.$emit('update:modelValue', 0.005)
    await submit()
    expect(teamMaterialApi.createLoss).toHaveBeenCalledWith(
      2,
      expect.objectContaining({ reason: '' }),
    )
    vi.mocked(teamMaterialApi.createLoss).mockClear()
    await wrapper.get('textarea').setValue('实物清点短缺')
    await submit()
    expect(teamMaterialApi.createLoss).toHaveBeenCalledWith(2, {
      source_transfer_id: 10,
      quantity: 0,
      weight: 0.005,
      reason: '实物清点短缺',
      idempotency_key: expect.any(String),
    })
  })
  it('closes a draft and makes no write when the current account is rebound during verification', async () => {
    await render()
    await destination()
    state.auth.refreshCurrentUser.mockImplementation(async () => {
      state.auth.currentUser.team_id = 3
    })
    await submit()
    expect(teamMaterialApi.createDispatch).not.toHaveBeenCalled()
    expect(wrapper.emitted('update:modelValue')).toContainEqual([false])
  })
})

it('converts a countable source to chips without sending its piece quantity', async () => {
  await render('dispatch', [source()])
  await destination(1)
  wrapper
    .findAllComponents(ElSelect)
    .find((item) => item.props('ariaLabel') === 'TL10物料类型')!
    .vm.$emit('update:modelValue', 'scrap_chips')
  await flushPromises()
  expect(wrapper.find('input[aria-label="TL10件数"]').exists()).toBe(false)
  expect(wrapper.text()).not.toContain('登记加工后件数')
  await submit()
  expect(teamMaterialApi.createDispatch).toHaveBeenCalledWith(
    2,
    expect.objectContaining({
      lines: [expect.objectContaining({ quantity: 0, weight: 10, material_type: 'scrap_chips' })],
      quantity_clearances: [],
    }),
  )
})
it('records a chips loss using only weight', async () => {
  const row = source()
  row.transfer.material_type = 'scrap_chips'
  row.scrap_available_quantity = 0
  row.scrap_available_weight = 10
  await render('loss', [row])
  expect(wrapper.find('input[aria-label="TL10件数"]').exists()).toBe(false)
  sourceAmountInputs()[0]!.vm.$emit('update:modelValue', 1)
  await flushPromises()
  await submit()
  expect(teamMaterialApi.createLoss).toHaveBeenCalledWith(
    2,
    expect.objectContaining({ quantity: 0, weight: 1 }),
  )
})

const GlassDialogStub = defineComponent({
  name: 'ElDialog',
  props: ['modelValue'],
  emits: ['opened', 'closed', 'close'],
  template: `<section v-if="modelValue" class="el-dialog">
    <header><slot name="header" title-id="stock-test-title" title-class="el-dialog__title" /></header>
    <slot /><footer class="el-dialog__footer"><slot name="footer" /></footer>
  </section>`,
})

async function renderGlassDialog(host: HTMLElement) {
  wrapper = mount(MaterialStockActionDialog, {
    attachTo: host,
    props: { modelValue: true, teamId: 2, mode: 'dispatch', sources: [source()] },
    global: { stubs: { ElDialog: GlassDialogStub } },
  })
  await flushPromises()
  return wrapper.getComponent(AppDialog).getComponent(GlassDialogStub)
}

it('uses the shared shell to enhance its own dialog and release each instance on close or unmount', async () => {
  const host = document.createElement('div')
  const otherDialog = document.createElement('section')
  otherDialog.className = 'el-dialog'
  document.body.append(otherDialog, host)
  const firstCleanup = vi.fn()
  const nextCleanup = vi.fn()
  const replacementCleanup = vi.fn()
  glass.enhance
    .mockReturnValueOnce(firstCleanup)
    .mockReturnValueOnce(nextCleanup)
    .mockReturnValueOnce(replacementCleanup)
  try {
    const dialog = await renderGlassDialog(host)
    expect(glass.enhance).not.toHaveBeenCalled()
    expect(wrapper.get('.stock-dialog-heading').element.isConnected).toBe(true)
    dialog.vm.$emit('opened')
    await flushPromises()
    expect(glass.enhance).toHaveBeenCalledOnce()
    expect(glass.enhance).toHaveBeenCalledWith(wrapper.get('.el-dialog').element)
    expect(glass.enhance).not.toHaveBeenCalledWith(otherDialog)

    await wrapper.setProps({ modelValue: false })
    dialog.vm.$emit('closed')
    expect(firstCleanup).toHaveBeenCalledOnce()
    await wrapper.setProps({ modelValue: true })
    dialog.vm.$emit('opened')
    await flushPromises()
    expect(glass.enhance).toHaveBeenCalledTimes(2)
    dialog.vm.$emit('opened')
    expect(nextCleanup).toHaveBeenCalledOnce()
    await flushPromises()
    expect(glass.enhance).toHaveBeenCalledTimes(3)
    wrapper.unmount()
    expect(firstCleanup).toHaveBeenCalledOnce()
    expect(nextCleanup).toHaveBeenCalledOnce()
    expect(replacementCleanup).toHaveBeenCalledOnce()
  } finally {
    host.remove()
    otherDialog.remove()
  }
})

it('discards an opening closed during lazy import and permits a later opening to enhance normally', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const cleanup = vi.fn()
  glass.enhance.mockReturnValue(cleanup)
  try {
    const dialog = await renderGlassDialog(host)
    dialog.vm.$emit('opened')
    dialog.vm.$emit('closed')
    await wrapper.setProps({ modelValue: false })
    await vi.dynamicImportSettled()
    await flushPromises()
    expect(glass.enhance).not.toHaveBeenCalled()

    await wrapper.setProps({ modelValue: true })
    expect(wrapper.get('.stock-dialog-heading').element.isConnected).toBe(true)
    dialog.vm.$emit('opened')
    await vi.dynamicImportSettled()
    await flushPromises()
    expect(glass.enhance).toHaveBeenCalledOnce()
    expect(glass.enhance).toHaveBeenCalledWith(wrapper.get('.el-dialog').element)
    wrapper.unmount()
    expect(cleanup).toHaveBeenCalledOnce()
  } finally {
    host.remove()
  }
})

it('carries the published route destination and business into dispatch without another choice', async () => {
  const lot = source()
  lot.transfer.process_route = {
    id: 8,
    title: '首批派工',
    version: 2,
    step_index: 1,
    sequence_no: 1,
    step_name: '轧制',
    instructions: '按图纸',
    team_id: 2,
    processing_task_id: 9,
    purpose_id: 1,
    split_here: false,
    complete: true,
    next_team_id: 3,
    next_purpose_id: 33,
  }
  vi.mocked(teamMaterialApi.purposes).mockResolvedValue([
    { id: 33, team_id: 3, name: '退火业务', active: true, version: 1 },
  ])
  await render('dispatch', [lot])
  await submit()
  expect(teamMaterialApi.createDispatch).toHaveBeenCalledWith(
    2,
    expect.objectContaining({
      next_team_id: 3,
      lines: [expect.objectContaining({ source_transfer_id: 10 })],
    }),
  )
})

it('resolves the warehouse route when dispatching from an existing delivery schedule', async () => {
  const { routeFixture } = await import('@/testFixtures/processRoute')
  const { orderFixture } = await import('@/testFixtures/processRouteOrder')
  const { processRouteApi } = await import('@/services/processRouteApi')
  const row = source()
  row.transfer.next_team = { id: '2', name: '库房', code: 'FACTORY-WAREHOUSE' }
  const resolved = {
    ...routeFixture,
    state: 'published' as const,
    serial_nos: ['PROCESS-001'],
    source_data: {
      ...routeFixture.source_data,
      order_document: undefined,
    },
    drawings: [{ id: 1, filename: '图纸.pdf', size_bytes: 100 }],
    steps: [
      { ...routeFixture.steps[0]!, team_id: 2 },
      { ...routeFixture.steps[1]!, team_id: 3, purpose_id: null },
    ],
  }
  vi.mocked(processRouteApi.dispatchOrder).mockResolvedValue({
    task_id: 31,
    document: { ...orderFixture, serial_no: row.transfer.serial_no },
  })
  vi.mocked(productionScheduleApi.candidates).mockImplementation(async (params) => ({
    items: [
      {
        source_transfer_id: 10,
        schedules: params.process_route_id
          ? [
              {
                id: 71,
                task_id: 31,
                task_batch_number: 1,
                serial_no: row.transfer.serial_no,
                due_at: '2026-12-01T08:00:00Z',
                remaining_quantity: 100,
              } as ScheduleSummary,
            ]
          : [],
      },
    ],
  }))
  let resolveRoute!: (value: typeof resolved) => void
  vi.spyOn(processRouteApi, 'resolve').mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveRoute = resolve
      }),
  )
  await render('dispatch', [row], { id: 71, next_team_id: 3, external_destination: null })
  await submit()
  expect(teamMaterialApi.createDispatch).not.toHaveBeenCalled()
  await new Promise((resolve) => setTimeout(resolve, 350))
  resolveRoute(resolved)
  await flushPromises()
  expect(processRouteApi.resolve).toHaveBeenCalledWith(row.transfer.serial_no)
  expect(wrapper.get('.destination-field [role="status"]').text()).toBe('退火')
  expect(wrapper.text()).not.toContain('选择工艺')
  expect(productionScheduleApi.candidates).toHaveBeenCalledWith(
    expect.objectContaining({
      serial_no: row.transfer.serial_no,
      process_route_id: routeFixture.id,
    }),
  )
  expect(
    wrapper.get('.form-workspace-documents').findComponent(SerialRouteAttachments).props(),
  ).toMatchObject({
    availableOnly: true,
    items: [expect.objectContaining({ serialNo: 'SERIAL10', scheduleTaskId: 31 })],
  })
  await submit()
  expect(teamMaterialApi.createDispatch).toHaveBeenCalledWith(
    2,
    expect.objectContaining({
      next_team_id: 3,
      lines: [
        expect.objectContaining({
          process_route_id: routeFixture.id,
          process_route_version: routeFixture.version,
          production_schedule_id: 71,
        }),
      ],
    }),
  )
})

it('requires the current order instead of accepting another order retained by the engineering route', async () => {
  const { routeFixture } = await import('@/testFixtures/processRoute')
  const { orderFixture } = await import('@/testFixtures/processRouteOrder')
  const row = source()
  row.transfer.next_team = { id: '2', name: '库房', code: 'FACTORY-WAREHOUSE' }
  vi.spyOn(processRouteApi, 'resolve').mockResolvedValue({
    ...routeFixture,
    state: 'published',
    serial_nos: ['PROCESS-001'],
    source_data: { ...routeFixture.source_data, order_document: orderFixture },
    drawings: [{ id: 1, filename: '图纸.pdf', size_bytes: 100 }],
    steps: [
      { ...routeFixture.steps[0]!, team_id: 2 },
      { ...routeFixture.steps[1]!, team_id: 3, purpose_id: null },
    ],
  })
  await render('dispatch', [row], { id: 71, next_team_id: 3, external_destination: null })
  await new Promise((resolve) => setTimeout(resolve, 350))
  await flushPromises()
  await submit()
  expect(wrapper.text()).toContain('缺少：订单表')
  expect(teamMaterialApi.createDispatch).not.toHaveBeenCalled()
})

it.each([
  ['SERIAL10', 'SERIAL10'],
  ['', ''],
])(
  'selects a single target schedule for stock with source serials %j and %j',
  async (first, second) => {
    const rows = [source(), source(11)]
    for (const [index, row] of rows.entries()) {
      row.transfer.next_team = { id: '2', name: '库房', code: 'FACTORY-WAREHOUSE' }
      row.transfer.serial_no = index ? second : first
    }
    await render('dispatch', rows)
    expect(wrapper.findAll('input[aria-label="目标流水号"]')).toHaveLength(1)
    expect(wrapper.find('input[aria-label="出库流水号"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="投料方式"]').exists()).toBe(false)
    await submit()
    expect(teamMaterialApi.createDispatch).not.toHaveBeenCalled()
    await wrapper.get('input[aria-label="目标流水号"]').setValue(warehouseFeedingOption.serial_no)
    await vi.waitFor(() =>
      expect(wrapper.get('.destination-field [role="status"]').text()).toBe('退火'),
    )
    await submit()
    const body = vi.mocked(teamMaterialApi.createDispatch).mock.calls[0]![1]
    expect(body.feeding_target?.schedule_id).toBe(warehouseFeedingOption.schedule_id)
    expect(body.lines.map((line) => line.source_transfer_id)).toEqual([10, 11])
  },
)

it.each([null, 'ORDER-A', 'ORDER-B'])(
  'dispatches joint material and preserves the task specified by %s without requiring cutting plans',
  async (specifiedSerial) => {
    const { routeFixture } = await import('@/testFixtures/processRoute')
    const { orderFixture } = await import('@/testFixtures/processRouteOrder')
    const SharedFields = (await import('./SharedDispatchFields.vue')).default
    const row = source()
    row.transfer.entry_kind = 'warehouse_receipt'
    row.transfer.receipt_kind = 'external'
    row.transfer.serial_no = ''
    row.transfer.next_team = { id: '2', name: '库房', code: 'FACTORY-WAREHOUSE' }
    vi.spyOn(processRouteApi, 'resolve').mockImplementation(async (serial) => ({
      ...routeFixture,
      id: serial === 'ORDER-A' ? 8 : 9,
      state: 'published',
      serial_nos: [serial],
      drawings: [{ id: 1, filename: '图纸.pdf', size_bytes: 100 }],
      source_data: {
        ...routeFixture.source_data,
        order_document: { ...orderFixture, serial_no: serial, receipt_fields: {} },
      },
      steps: [
        { ...routeFixture.steps[0]!, team_id: 2 },
        {
          ...routeFixture.steps[1]!,
          team_id: 3,
          purpose_id: serial === specifiedSerial ? 55 : null,
        },
      ],
    }))
    if (specifiedSerial)
      vi.mocked(teamMaterialApi.purposes).mockResolvedValue([
        { id: 55, team_id: 3, name: '粗切', active: true, version: 1 },
      ])
    await render('dispatch', [row], { id: 71, next_team_id: 3, external_destination: null })
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '共投')!
      .trigger('click')
    await flushPromises()
    const fields = wrapper.getComponent(SharedFields)
    expect(fields.text()).not.toMatch(/计划用料|切出件数|切割尺寸/)
    fields.vm.$emit('update:modelValue', [{ serial_no: 'ORDER-A' }, { serial_no: 'ORDER-B' }])
    await vi.waitFor(() => expect(fields.emitted('validation-change')?.at(-1)).toEqual(['']))
    await flushPromises()
    const sidebar = () => wrapper.getComponent(SerialRouteAttachments).props('items')
    expect(sidebar()).toMatchObject([{ serialNo: 'ORDER-A', routeId: 8 }])
    await fields.get('[aria-label="共投流水号 2"]').trigger('focusin')
    expect(sidebar()).toMatchObject([{ serialNo: 'ORDER-B', routeId: 9 }])
    await submit()
    expect(wrapper.findAll('[role="alert"]').map((node) => node.text())).toEqual([])
    expect(teamMaterialApi.createDispatch).toHaveBeenCalledOnce()
    const body = vi.mocked(teamMaterialApi.createDispatch).mock.calls[0]![1]
    expect(body.next_team_id).toBe(3)
    expect(body.lines).toHaveLength(1)
    expect(body.lines[0]).toMatchObject({
      quantity: 100,
      weight: 10,
      shared_serials: [
        expect.objectContaining({ serial_no: 'ORDER-A', process_route_id: 8 }),
        expect.objectContaining({ serial_no: 'ORDER-B', process_route_id: 9 }),
      ],
    })
    expect(body.lines[0]).not.toHaveProperty('purpose_id')
    expect(body.lines[0]).not.toHaveProperty('serial_no')
    expect(body.lines[0]).not.toHaveProperty('production_schedule_id')
    for (const member of body.lines[0]!.shared_serials!) {
      expect(member).not.toHaveProperty('planned_weight')
      expect(member).not.toHaveProperty('planned_quantity')
      expect(member).not.toHaveProperty('planned_specification')
    }
  },
)

it('does not show joint production for downstream stock or external returns', async () => {
  await render('dispatch', [source()])
  expect(wrapper.findAll('button').some((button) => button.text() === '共投')).toBe(false)
  const returned = source()
  returned.transfer.next_team = { id: '2', name: '库房', code: 'FACTORY-WAREHOUSE' }
  returned.transfer.entry_kind = 'warehouse_receipt'
  returned.transfer.receipt_kind = 'return'
  returned.transfer.process_route = warehouseRoute()
  wrapper.unmount()
  await render('dispatch', [returned])
  expect(wrapper.findAll('button').some((button) => button.text() === '共投')).toBe(false)
})

it('opens the process, drawing and order belonging to the clicked joint production row', async () => {
  vi.spyOn(processRouteApi, 'resolve').mockImplementation(async (serial) => ({
    ...routeFixture,
    id: serial === 'ORDER-A' ? 8 : 9,
    state: 'published',
    serial_nos: [serial],
    steps: [{ ...routeFixture.steps[0]!, team_id: 2 }],
    drawings: [{ id: serial === 'ORDER-A' ? 1 : 2, filename: `${serial}.pdf`, size_bytes: 100 }],
  }))
  vi.mocked(processRouteApi.dispatchOrder).mockImplementation(async (routeId, serial) => ({
    task_id: 100 + routeId,
    document: { ...orderFixture, filename: `${serial}.xlsx`, serial_no: serial },
  }))
  wrapper = mount(SharedDispatchFields, {
    props: { teamId: 2, modelValue: [{ serial_no: 'ORDER-A' }, { serial_no: 'ORDER-B' }] },
    global: {
      stubs: {
        ElDialog: { template: '<div><slot /></div>' },
        WordDocumentPreview: true,
        ProcessRouteDrawingPreview: true,
        ProcessRouteAttachments: true,
      },
    },
  })
  await vi.waitFor(() => expect(wrapper.findAll('[aria-label$="订单表"]')).toHaveLength(2))
  await wrapper.get('button[aria-label="查看 ORDER-A 工艺原件"]').trigger('click')
  expect(wrapper.getComponent(WordDocumentPreview).props('route').id).toBe(8)
  wrapper.getComponent(AppDialog).vm.$emit('close')
  await flushPromises()
  await wrapper.get('button[aria-label="查看 ORDER-B 图纸"]').trigger('click')
  expect(wrapper.getComponent(ProcessRouteDrawingPreview).props()).toMatchObject({
    routeId: 9,
    drawing: { id: 2, filename: 'ORDER-B.pdf' },
  })
  wrapper.getComponent(AppDialog).vm.$emit('close')
  await flushPromises()
  await wrapper.get('button[aria-label="查看 ORDER-A 订单表"]').trigger('click')
  expect(wrapper.getComponent(ProcessRouteAttachments).props()).toMatchObject({
    orderTaskId: 108,
    orderDocument: { filename: 'ORDER-A.xlsx' },
  })
})

it('assigns two warehouse serials to one processing plan without crediting the input pieces', async () => {
  const rows = [source(), source(11)]
  rows.forEach((row) => {
    row.transfer.next_team = { id: '2', name: '库房', code: 'FACTORY-WAREHOUSE' }
  })
  const option = warehouseFeedingOption
  vi.mocked(productionScheduleApi.feedingOptions).mockResolvedValue([
    { ...option, schedule_id: 70, task_batch_number: 1 },
    option,
  ])
  await render('dispatch', rows)
  expect(wrapper.findAll('h3').map((node) => node.text())).toEqual([
    '投料排期',
    '转出物料',
    '收发信息',
  ])
  expect(wrapper.findAll('.materials-head > span').map((cell) => cell.text())).toEqual([
    '流水号',
    '账面库存',
    '出库件数',
    '出库重量',
  ])
  expect(wrapper.findAll('.warehouse-serial').map((cell) => cell.text())).toEqual([
    'SERIAL10',
    'SERIAL11',
  ])
  expect(wrapper.find('.warehouse-materials .source-actions').exists()).toBe(false)
  expect(wrapper.find('.warehouse-materials .source-specification-field').exists()).toBe(false)
  expect(wrapper.text()).not.toContain('按原流水号')
  expect(wrapper.find('[aria-label="投料方式"]').exists()).toBe(false)
  expect(wrapper.get('.action-notes-section button').attributes('aria-expanded')).toBe('true')
  await wrapper.get('.action-notes-section button').trigger('click')
  expect(wrapper.get('.action-notes-section button').attributes('aria-expanded')).toBe('false')
  await wrapper.get('input[aria-label="目标流水号"]').setValue('ORDER-C')
  await vi.waitFor(() =>
    expect(productionScheduleApi.feedingOptions).toHaveBeenCalledWith(2, 'ORDER-C'),
  )
  await flushPromises()
  const planPickers = wrapper
    .findAllComponents(ElSelect)
    .filter((picker) => picker.find('input[aria-label="加工排期"]').exists())
  expect(planPickers).toHaveLength(1)
  await submit()
  expect(teamMaterialApi.createDispatch).not.toHaveBeenCalled()
  planPickers[0]!.vm.$emit('update:modelValue', 71)
  await vi.waitFor(() => expect(wrapper.text()).toContain('库房待转出 226 件'))
  expect(wrapper.text()).toContain('本次投料 200 件 / 20 kg')
  expect(wrapper.text()).not.toContain('本次转出后')
  const [q1, w1, q2, w2] = sourceAmountInputs()
  q1!.vm.$emit('update:modelValue', 1)
  w1!.vm.$emit('update:modelValue', 2)
  q2!.vm.$emit('update:modelValue', 3)
  w2!.vm.$emit('update:modelValue', 4)
  await flushPromises()
  expect(wrapper.text()).toContain('本次投料 4 件 / 6 kg')
  expect(wrapper.text()).toContain('库房待转出 226 件')
  await submit()
  expect(teamMaterialApi.createDispatch).toHaveBeenCalledWith(
    2,
    expect.objectContaining({
      next_team_id: 3,
      feeding_target: { serial_no: 'ORDER-C', schedule_id: 71, route_id: 8, route_version: 2 },
      lines: [
        expect.objectContaining({ source_transfer_id: 10, quantity: 1, weight: 2 }),
        expect.objectContaining({ source_transfer_id: 11, quantity: 3, weight: 4 }),
      ],
    }),
  )
  expect(
    vi
      .mocked(teamMaterialApi.createDispatch)
      .mock.calls[0]![1].lines.some(
        (line) =>
          'serial_no' in line || 'production_schedule_id' in line || 'process_route_id' in line,
      ),
  ).toBe(false)
})

it('shares the source rows across target serials, each with its selected schedule', async () => {
  const rows = [source(), source(11)]
  for (const row of rows)
    row.transfer.next_team = { id: '2', name: '库房', code: 'FACTORY-WAREHOUSE' }
  const planA = { ...warehouseFeedingOption, serial_no: 'A' }
  const planB = {
    ...warehouseFeedingOption,
    serial_no: 'B',
    schedule_id: 94,
    task_id: 22,
    route_id: 9,
  }
  vi.mocked(productionScheduleApi.feedingOptions).mockImplementation(async (_, serial) => {
    if (serial === 'A') return [planA]
    if (serial === 'X') return [{ ...planB, serial_no: 'X', team_id: 4 }]
    return [{ ...planB, schedule_id: 93, task_id: 21, task_batch_number: 1 }, planB]
  })
  await render('dispatch', rows)
  await wrapper.get('[aria-label="目标流水号"]').setValue('A')
  await vi.waitFor(() => expect(wrapper.text()).toContain('库房待转出 226 件'))
  await wrapper
    .findAll('button')
    .find((b) => b.text() === '共投')!
    .trigger('click')
  const second = wrapper.get('[aria-label="共投流水号 2"]')
  await submit()
  expect(teamMaterialApi.createDispatch).not.toHaveBeenCalled()
  await second.setValue('A')
  await vi.waitFor(() => expect(wrapper.text()).toContain('共投流水号不能重复'))
  await second.setValue('X')
  await vi.waitFor(() => expect(wrapper.text()).toContain('共投排期须由同一班组接收'))
  await second.setValue('B')
  await vi.waitFor(() => expect(productionScheduleApi.feedingOptions).toHaveBeenCalledWith(2, 'B'))
  await flushPromises()
  wrapper
    .findAllComponents(ElSelect)
    .find((p) => p.find('input[aria-label="加工排期 2"]').exists())!
    .vm.$emit('update:modelValue', 94)
  await flushPromises()
  expect(wrapper.getComponent(SerialRouteAttachments).props('items')).toMatchObject([
    { serialNo: 'A', scheduleTaskId: 6 },
    { serialNo: 'B', scheduleTaskId: 22 },
  ])
  await wrapper
    .findAll('button')
    .find((b) => b.text() === '增加流水号')!
    .trigger('click')
  await wrapper.get('[aria-label="移除目标流水号 3"]').trigger('click')
  await submit()
  expect(teamMaterialApi.createDispatch).toHaveBeenCalledOnce()
  const body = vi.mocked(teamMaterialApi.createDispatch).mock.calls[0]![1]
  expect(body.feeding_target).toBeUndefined()
  expect(body.feeding_targets).toEqual([
    { serial_no: 'A', route_id: 8, route_version: 2, schedule_id: 71 },
    { serial_no: 'B', route_id: 9, route_version: 2, schedule_id: 94 },
  ])
  expect(
    body.lines.map(({ source_transfer_id, quantity, weight }) => [
      source_transfer_id,
      quantity,
      weight,
    ]),
  ).toEqual([
    [10, 100, 10],
    [11, 100, 10],
  ])
})

it('assigns each source serial to its own destination when issuing separate warehouse documents', async () => {
  const rows = [source(), source(11)]
  for (const row of rows)
    row.transfer.next_team = { id: '2', name: '库房', code: 'FACTORY-WAREHOUSE' }
  vi.mocked(productionScheduleApi.feedingOptions).mockImplementation(async (_, serial) => [
    {
      ...warehouseFeedingOption,
      serial_no: serial,
      schedule_id: serial === 'X' ? 71 : 72,
      team_id: serial === 'X' ? 3 : 4,
      team_name: serial === 'X' ? '退火' : '线切割',
    },
  ])
  await render('dispatch', rows)
  await wrapper
    .findAll('button')
    .find((b) => b.text() === '分别指定目标')!
    .trigger('click')
  await wrapper.get('[aria-label="SERIAL10 的目标流水号"]').setValue('X')
  await submit()
  expect(teamMaterialApi.createDispatch).not.toHaveBeenCalled()
  await wrapper.get('[aria-label="SERIAL11 的目标流水号"]').setValue('Y')
  await vi.waitFor(() => expect(wrapper.text()).toContain('退火 / 线切割'))
  await submit()
  expect(teamMaterialApi.createDispatch).toHaveBeenCalledOnce()
  const body = vi.mocked(teamMaterialApi.createDispatch).mock.calls[0]![1]
  expect(body.next_team_id).toBeUndefined()
  expect(body.feeding_targets).toBeUndefined()
  expect(body.feeding_assignments).toEqual([
    {
      target: { serial_no: 'X', route_id: 8, route_version: 2, schedule_id: 71 },
      next_team_id: 3,
      source_transfer_ids: [10],
    },
    {
      target: { serial_no: 'Y', route_id: 8, route_version: 2, schedule_id: 72 },
      next_team_id: 4,
      source_transfer_ids: [11],
    },
  ])
})
