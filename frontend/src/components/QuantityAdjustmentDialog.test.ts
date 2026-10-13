// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { reactive } from 'vue'
import { ElInputNumber, ElSelect, ElSwitch } from 'element-plus'
import WeightInput from './WeightInput.vue'
import ProcessingPersonInput from './ProcessingPersonInput.vue'
import SpecificationInput from './SpecificationInput.vue'
import SludgeWeightFields from './SludgeWeightFields.vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import QuantityAdjustmentDialog from './QuantityAdjustmentDialog.vue'
import { teamMaterialApi, TeamMaterialApiError } from '@/services/teamMaterialApi'
import type { QuantityAdjustmentContext } from '@/types/teamMaterials'

const state = vi.hoisted(() => ({
  auth: {
    isTeamAccount: true,
    currentUser: { id: 2, team_id: 2, active: true },
    currentUserError: '',
  },
}))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => state.auth }))
const context = (revision = 0): QuantityAdjustmentContext => ({
  source_transfer_id: 10,
  processor_options: ['王师傅', '李师傅'],
  batch_no: 'TL001',
  quantity: 10,
  weight: 100,
  revision,
  as_of: '2026-09-27T00:00:00Z',
  items: [],
  total: 0,
  page: 1,
  page_size: 10,
})
let wrapper: VueWrapper
beforeEach(() => {
  state.auth = reactive({
    isTeamAccount: true,
    currentUser: { id: 2, team_id: 2, active: true },
    currentUserError: '',
  })
  vi.spyOn(teamMaterialApi, 'quantityContext').mockResolvedValue(context())
  vi.spyOn(teamMaterialApi, 'changeQuantity').mockResolvedValue({
    id: 1,
    source_transfer_id: 10,
    before_quantity: 10,
    after_quantity: 100,
    delta_quantity: 90,
    weight: 100,
    reason: '切割',
    created_by: '班组长',
    created_at: '2026-09-27T00:00:00Z',
  })
})
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
})
async function render(canWrite = true, person = '王师傅') {
  wrapper = mount(QuantityAdjustmentDialog, {
    props: { modelValue: true, teamId: 2, sourceId: 10, canWrite },
    global: { stubs: { ElDialog: { template: '<div><slot/><slot name="footer"/></div>' } } },
  })
  await flushPromises()
  if (wrapper.findComponent(ProcessingPersonInput).exists())
    wrapper.getComponent(ProcessingPersonInput).vm.$emit('update:modelValue', person)
}
async function click(label: string) {
  await wrapper
    .findAll('button')
    .find((button) => button.text() === label)!
    .trigger('click')
  await flushPromises()
}
async function edit() {
  wrapper.getComponent(ElInputNumber).vm.$emit('update:modelValue', 100)
  await wrapper.get('textarea').setValue('切割为100件')
}

describe('processing piece adjustment', () => {
  it('marks an empty processing person and preserves the entered name on save', async () => {
    await render(true, '')
    await wrapper.setProps({ processing: true })
    const trigger = wrapper.get('button[aria-label="加工人"]')
    const focus = vi.spyOn(trigger.element as HTMLButtonElement, 'focus')
    await click('保存加工登记')
    expect(teamMaterialApi.changeQuantity).not.toHaveBeenCalled()
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(trigger.attributes('aria-invalid')).toBe('true')
    const person = wrapper.getComponent(ProcessingPersonInput)
    expect(person.element.closest('.el-form-item')?.classList.contains('is-error')).toBe(true)
    person.vm.$emit('update:modelValue', '  李师傅  ')
    await flushPromises()
    expect(person.element.closest('.el-form-item')?.classList.contains('is-error')).toBe(false)
    expect(trigger.attributes('aria-invalid')).toBeUndefined()
    await click('保存加工登记')
    expect(teamMaterialApi.changeQuantity).toHaveBeenCalledWith(
      2,
      expect.objectContaining({ processor_name: '李师傅' }),
    )
    await wrapper.setProps({ modelValue: false })
    await wrapper.setProps({ modelValue: true })
    await flushPromises()
    expect(wrapper.getComponent(ProcessingPersonInput).props('modelValue')).toBe('')
  })

  it('requires an order only for shared produced output and keeps remainder and scrap unallocated', async () => {
    vi.mocked(teamMaterialApi.quantityContext).mockResolvedValue({
      ...context(),
      shared_group_id: 1,
      shared_unallocated: true,
      shared_serials: [{ serial_no: 'A' }, { serial_no: 'B' }],
    })
    wrapper = mount(QuantityAdjustmentDialog, {
      props: { modelValue: true, teamId: 2, sourceId: 10, canWrite: true, processing: true },
      global: { stubs: { ElDialog: { template: '<div><slot/><slot name="footer"/></div>' } } },
    })
    await flushPromises()
    wrapper.getComponent(ProcessingPersonInput).vm.$emit('update:modelValue', '王师傅')
    expect(wrapper.getComponent(ElSwitch).props('disabled')).toBe(true)
    pieces(1, 1)
    weight(1, 40)
    pieces(2, 30)
    weight(2, 55)
    pieces(3, 0)
    weight(3, 5)
    await click('保存加工登记')
    expect(teamMaterialApi.changeQuantity).not.toHaveBeenCalled()
    const select = wrapper
      .findAllComponents(ElSelect)
      .find((input) => input.props('ariaLabel') === '明细2归属流水号')!
    expect(select.element.closest('.dialog-field')?.classList.contains('is-error')).toBe(true)
    select.vm.$emit('update:modelValue', 'A')
    await click('保存加工登记')
    const outputs = vi.mocked(teamMaterialApi.changeQuantity).mock.calls[0]![1].outputs!
    expect(outputs.map((output) => output.serial_no)).toEqual([undefined, 'A', undefined])
    expect(outputs.map((output) => output.weight)).toEqual([40, 55, 5])
  })

  async function detailMode() {
    await render()
    await wrapper.setProps({ processing: true })
    wrapper.getComponent(ElSwitch).vm.$emit('update:modelValue', true)
    await flushPromises()
  }
  function pieces(row: number, value: number) {
    wrapper
      .findAllComponents(ElInputNumber)
      .find((input) => input.props('ariaLabel') === `明细${row}件数`)!
      .vm.$emit('update:modelValue', value)
  }
  function weight(row: number, value: number) {
    wrapper
      .findAllComponents(WeightInput)
      .find((input) => input.props('ariaLabel') === `明细${row}重量`)!
      .vm.$emit('update:modelValue', value)
  }
  it('records remaining stock, multiple sizes and scrap as complete measured outputs without guessing amounts', async () => {
    await detailMode()
    expect(
      wrapper.findAllComponents(WeightInput).every((input) => input.props('modelValue') == null),
    ).toBe(true)
    pieces(1, 2)
    weight(1, 40)
    pieces(2, 8)
    weight(2, 55)
    pieces(3, 0)
    weight(3, 5)
    wrapper
      .findAllComponents(SpecificationInput)[0]!
      .vm.$emit('update:modelValue', '100 × 50 × 2 mm')
    wrapper.findAllComponents(SpecificationInput)[1]!.vm.$emit('update:modelValue', '10 × 5 × 2 mm')
    await click('增加明细')
    await click('保存加工登记')
    expect(teamMaterialApi.changeQuantity).toHaveBeenCalledWith(
      2,
      expect.objectContaining({
        quantity: 10,
        processing_status: 'partial',
        outputs: [
          {
            role: 'remaining',
            quantity: 2,
            weight: 40,
            material_type: 'semi_finished',
            transfer_specification: '100 × 50 × 2 mm',
          },
          {
            role: 'produced',
            quantity: 8,
            weight: 55,
            material_type: 'semi_finished',
            transfer_specification: '10 × 5 × 2 mm',
          },
          {
            role: 'scrap',
            quantity: 0,
            weight: 5,
            material_type: 'waste',
            transfer_specification: '',
          },
        ],
      }),
    )
  })
  it('marks incomplete active output rows, ignores all-zero rows and permits measured weight differences', async () => {
    await detailMode()
    await click('保存加工登记')
    expect(teamMaterialApi.changeQuantity).not.toHaveBeenCalled()
    expect(wrapper.get('.processing-outputs').classes()).toContain('is-error')
    pieces(2, 20)
    await click('保存加工登记')
    expect(teamMaterialApi.changeQuantity).not.toHaveBeenCalled()
    expect(wrapper.findAll('.processing-output-table .is-error').length).toBeGreaterThan(0)
    weight(2, 105)
    pieces(1, 0)
    weight(1, 0)
    await flushPromises()
    expect(wrapper.get('.processing-weight-notice').text()).toContain('超过每批 1 kg')
    await click('保存加工登记')
    expect(teamMaterialApi.changeQuantity).toHaveBeenCalledWith(
      2,
      expect.objectContaining({
        quantity: 20,
        outputs: [
          {
            role: 'produced',
            quantity: 20,
            weight: 105,
            material_type: 'semi_finished',
            transfer_specification: '',
          },
        ],
      }),
    )
  })
  it.each([
    [0.7, 100.4, '多 1.1'],
    [-0.7, 99.6, '少 1.1'],
  ])(
    'carries the same source tolerance into further processing (%s kg)',
    async (prior, measured, label) => {
      vi.mocked(teamMaterialApi.quantityContext).mockResolvedValue({
        ...context(),
        weight_difference: Number(prior),
        weight_root_transfer_id: 1,
      })
      await detailMode()
      pieces(2, 20)
      await flushPromises()
      expect(wrapper.find('.processing-weight-notice').exists()).toBe(false)
      weight(2, Number(measured))
      await flushPromises()
      expect(wrapper.get('.processing-weight-notice').text()).toContain(`累计${label} kg`)
      expect(wrapper.get('.processing-weight-notice').text()).toContain('超过每批 1 kg')
      await click('保存加工登记')
      expect(teamMaterialApi.changeQuantity).toHaveBeenCalled()
    },
  )
  it('shows the registration that created a child batch without changing the child history pagination', async () => {
    vi.mocked(teamMaterialApi.quantityContext).mockResolvedValue({
      ...context(),
      origin_processing_record: {
        id: 3,
        source_transfer_id: 1,
        before_quantity: 10,
        after_quantity: 20,
        delta_quantity: 10,
        weight: 100,
        reason: '父批加工分解',
        created_by: '班组长',
        created_at: '2026-09-27T00:00:00Z',
        outputs: [
          {
            id: 10,
            batch_no: 'TL001',
            role: 'remaining',
            quantity: 2,
            weight: 40,
            material_type: 'semi_finished',
          },
        ],
      },
    })
    await render(false)
    await wrapper.setProps({ processing: true })
    await flushPromises()
    expect(wrapper.text()).toContain('创建本批的加工登记')
    expect(wrapper.text()).toContain('父批加工分解')
    expect(wrapper.text()).toContain('TL001 · 剩余大料')
    expect(wrapper.find('.el-pagination').exists()).toBe(false)
  })
  it('requires real sludge measurements and sends only the derived material weight with zero pieces', async () => {
    await detailMode()
    const type = wrapper
      .findAllComponents(ElSelect)
      .find((select) => select.props('ariaLabel') === '明细3物料类型')!
    type.vm.$emit('update:modelValue', 'sludge')
    type.vm.$emit('change', 'sludge')
    await flushPromises()
    const measurement = wrapper.getComponent(SludgeWeightFields)
    measurement.vm.$emit('update:gross', 10)
    await flushPromises()
    await click('保存加工登记')
    expect(teamMaterialApi.changeQuantity).not.toHaveBeenCalled()
    measurement.vm.$emit('update:percent', 20)
    await flushPromises()
    await click('保存加工登记')
    expect(teamMaterialApi.changeQuantity).toHaveBeenCalledWith(
      2,
      expect.objectContaining({
        quantity: 0,
        outputs: [
          expect.objectContaining({
            role: 'scrap',
            material_type: 'sludge',
            quantity: 0,
            weight: 2,
            sludge_gross_weight: 10,
            sludge_content_percent: 20,
          }),
        ],
      }),
    )
  })
  it('shows saved processing output batches, roles, dimensions and weights in read-only history', async () => {
    vi.mocked(teamMaterialApi.quantityContext).mockResolvedValue({
      ...context(),
      total: 1,
      items: [
        {
          id: 3,
          source_transfer_id: 10,
          before_quantity: 10,
          after_quantity: 20,
          delta_quantity: 10,
          weight: 100,
          after_weight: 99.5,
          reason: '',
          created_by: '班组长',
          created_at: '2026-09-27T00:00:00Z',
          outputs: [
            {
              id: 22,
              batch_no: 'JG-022',
              role: 'produced',
              quantity: 20,
              weight: 99.5,
              material_type: 'semi_finished',
              transfer_specification: '10 × 5 × 2 mm',
            },
          ],
        },
      ],
    })
    await render(false)
    await wrapper.setProps({ processing: true })
    await flushPromises()
    expect(wrapper.text()).toContain('JG-022 · 加工产出')
    expect(wrapper.text()).toContain('99.5 kg · 10 × 5 × 2 mm')
    expect(wrapper.findComponent(ElSwitch).exists()).toBe(false)
  })
  it('requires partial progress while remaining large stock exists and clears stale sludge measurements on a type change', async () => {
    await detailMode()
    pieces(1, 2)
    weight(1, 100)
    const progress = wrapper
      .findAllComponents(ElSelect)
      .find((select) => select.props('ariaLabel') === '本批加工进度')!
    progress.vm.$emit('update:modelValue', 'complete')
    await click('保存加工登记')
    expect(teamMaterialApi.changeQuantity).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('仍有剩余大料，请选择部分加工')
    progress.vm.$emit('update:modelValue', 'partial')
    const type = wrapper
      .findAllComponents(ElSelect)
      .find((select) => select.props('ariaLabel') === '明细3物料类型')!
    type.vm.$emit('update:modelValue', 'sludge')
    type.vm.$emit('change', 'sludge')
    await flushPromises()
    wrapper.getComponent(SludgeWeightFields).vm.$emit('update:gross', 10)
    wrapper.getComponent(SludgeWeightFields).vm.$emit('update:percent', 20)
    await flushPromises()
    type.vm.$emit('update:modelValue', 'waste')
    type.vm.$emit('change', 'waste')
    await flushPromises()
    await click('保存加工登记')
    expect(teamMaterialApi.changeQuantity).toHaveBeenCalledWith(
      2,
      expect.objectContaining({
        outputs: [expect.objectContaining({ role: 'remaining', quantity: 2, weight: 100 })],
      }),
    )
  })
  it('registers actual remaining pieces with an explicit material type and processing state', async () => {
    vi.mocked(teamMaterialApi.quantityContext).mockResolvedValue({
      ...context(),
      quantity: 1,
      serial_no: 'YS-007',
      material_type: 'semi_finished',
    })
    await render()
    await wrapper.setProps({ processing: true })
    expect(wrapper.text()).toContain('半成品')
    expect(wrapper.text()).toContain('本批加工进度')
    wrapper.getComponent(ElInputNumber).vm.$emit('update:modelValue', 20)
    await click('保存加工登记')
    expect(teamMaterialApi.changeQuantity).toHaveBeenCalledWith(
      2,
      expect.objectContaining({ source_transfer_id: 10, quantity: 20 }),
    )
    expect(wrapper.emitted('saved')).toHaveLength(1)
  })
  it('records unchanged pieces with explicit progress and the actual specification', async () => {
    vi.mocked(teamMaterialApi.quantityContext).mockResolvedValue({
      ...context(),
      transfer_specification: 'old',
    })
    await render()
    await wrapper.setProps({ processing: true })
    wrapper
      .findAllComponents(ElSelect)
      .find((select) => select.props('ariaLabel') === '本批加工进度')!
      .vm.$emit('update:modelValue', 'complete')
    await click('保存加工登记')
    expect(teamMaterialApi.changeQuantity).toHaveBeenCalledWith(
      2,
      expect.objectContaining({
        quantity: 10,
        processing_status: 'complete',
        transfer_specification: 'old',
      }),
    )
  })
  it('labels outbound count clearance separately from processing history', async () => {
    vi.mocked(teamMaterialApi.quantityContext).mockResolvedValue({
      ...context(),
      items: [
        {
          id: 3,
          source_transfer_id: 10,
          before_quantity: 2,
          after_quantity: 0,
          delta_quantity: -2,
          weight: 0,
          reason: '',
          created_by: '班组长',
          created_at: '2026-09-27T00:00:00Z',
          operation_kind: 'outbound_clearance',
        },
      ],
      total: 1,
    })
    await render(false)
    await wrapper.setProps({ processing: true })
    expect(wrapper.text()).toContain('出库余件清零')
    expect(wrapper.text()).toContain('本批操作记录')
  })
  it('saves a guarded piece change with no editable weight or receipt rewrite', async () => {
    await render()
    await edit()
    await click('保存件数')
    expect(teamMaterialApi.changeQuantity).toHaveBeenCalledWith(2, {
      source_transfer_id: 10,
      quantity: 100,
      expected_revision: 0,
      processor_name: '王师傅',
      reason: '切割为100件',
      idempotency_key: expect.any(String),
    })
    expect(wrapper.findAllComponents(ElInputNumber)).toHaveLength(1)
    expect(wrapper.emitted('saved')).toHaveLength(1)
    expect(wrapper.emitted('update:modelValue')).toContainEqual([false])
  })
  it('retains drafts on conflict and requires an explicit fresh snapshot before retry', async () => {
    vi.mocked(teamMaterialApi.changeQuantity).mockRejectedValueOnce(
      new TeamMaterialApiError('库存已变化', 409),
    )
    await render()
    await edit()
    await click('保存件数')
    expect(wrapper.get('textarea').element.value).toBe('切割为100件')
    await click('保存件数')
    expect(teamMaterialApi.changeQuantity).toHaveBeenCalledTimes(1)
    vi.mocked(teamMaterialApi.quantityContext).mockResolvedValue({
      ...context(3),
      quantity: 6,
      weight: 60,
    })
    await click('刷新并核对')
    expect(wrapper.getComponent(ElInputNumber).props('modelValue')).toBe(100)
    await click('保存件数')
    expect(vi.mocked(teamMaterialApi.changeQuantity).mock.calls[1]![1].expected_revision).toBe(3)
  })
  it('retries uncertain writes with the same key and validates description length and unchanged count', async () => {
    await render()
    await click('保存件数')
    expect(wrapper.text()).toContain('件数未发生变化')
    wrapper.getComponent(ElInputNumber).vm.$emit('update:modelValue', 100)
    await wrapper.get('textarea').setValue('x'.repeat(2001))
    await click('保存件数')
    expect(
      wrapper
        .get('textarea[aria-label="加工说明"]')
        .element.closest('.el-form-item')!
        .classList.contains('is-error'),
    ).toBe(true)
    await edit()
    vi.mocked(teamMaterialApi.changeQuantity).mockRejectedValue(new Error('网络错误'))
    await click('保存件数')
    await click('保存件数')
    const calls = vi.mocked(teamMaterialApi.changeQuantity).mock.calls
    expect(calls[0]![1].idempotency_key).toBe(calls[1]![1].idempotency_key)
  })
  it('saves a quantity change with an empty optional description', async () => {
    await render()
    wrapper.getComponent(ElInputNumber).vm.$emit('update:modelValue', 20)
    await click('保存件数')
    expect(teamMaterialApi.changeQuantity).toHaveBeenCalledWith(
      2,
      expect.objectContaining({ quantity: 20, reason: '' }),
    )
  })
  it('provides read-only history and blocks foreign-team writes', async () => {
    await render(false)
    expect(wrapper.findAllComponents(ElInputNumber)).toHaveLength(0)
    expect(wrapper.text()).not.toContain('保存件数')
    await wrapper.setProps({ canWrite: true })
    state.auth.currentUser.team_id = 99
    await flushPromises()
    expect(wrapper.text()).not.toContain('保存件数')
    expect(wrapper.emitted('update:modelValue')).toContainEqual([false])
  })
  it('keeps exhausted lots readable but disables piece changes', async () => {
    vi.mocked(teamMaterialApi.quantityContext).mockResolvedValue({
      ...context(),
      quantity: 0,
      weight: 0,
    })
    await render()
    expect(wrapper.text()).toContain('本批没有未转出的库存')
    expect(
      wrapper
        .findAll('button')
        .find((button) => button.text() === '保存件数')!
        .attributes('disabled'),
    ).toBeDefined()
    expect(wrapper.findComponent(ElInputNumber).exists()).toBe(false)
  })
  it('does not load or submit when closed and cannot repopulate another batch with a stale request', async () => {
    let finish!: (value: QuantityAdjustmentContext) => void
    vi.mocked(teamMaterialApi.quantityContext).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    await render()
    await wrapper.setProps({ sourceId: 11 })
    await flushPromises()
    finish({ ...context(), batch_no: 'STALE' })
    await flushPromises()
    expect(wrapper.text()).not.toContain('STALE')
    await wrapper.setProps({ modelValue: false })
    expect(teamMaterialApi.changeQuantity).not.toHaveBeenCalled()
  })
})
