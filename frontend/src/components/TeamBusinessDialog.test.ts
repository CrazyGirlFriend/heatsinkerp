// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { ElInputNumber, ElSelect, ElSwitch, ElMessageBox } from 'element-plus'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TeamBusinessDialog from './TeamBusinessDialog.vue'
import WorkspacePagination from './WorkspacePagination.vue'
import { teamMaterialApi } from '@/services/teamMaterialApi'

vi.mock('@/services/materialInputApi', () => ({
  materialSuggestions: vi.fn().mockResolvedValue([]),
}))
const state = vi.hoisted(() => ({ auth: {} as Record<string, unknown> }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => state.auth }))
vi.mock('@/stores/toast', () => ({ showToast: vi.fn() }))
let wrapper: VueWrapper
const allowed = {
  enabled: true,
  completed: false,
  has_stock_history: false,
  can_submit: true,
  items: [],
}
const openingOrder = {
  schedule_id: 71,
  task_id: 19,
  task_batch_number: 1,
  due_at: '2026-11-30T00:00:00Z',
  route_id: 9,
  route_title: '联动工艺',
  route_version: 2,
  steps: [{ index: 1, sequence_no: 1, name: '精切' }],
}
beforeEach(() => {
  state.auth = { currentUser: { id: 41, team_id: 2 }, isTeamAccount: true, isAdmin: false }
  localStorage.clear()
  vi.spyOn(teamMaterialApi, 'processingTasks').mockResolvedValue([
    { id: 1, team_id: 2, name: '检验', active: true, version: 1, purpose_id: 1 },
  ])
  vi.spyOn(teamMaterialApi, 'inspectionProblems').mockResolvedValue([])
  vi.spyOn(teamMaterialApi, 'employees').mockResolvedValue([])
  vi.spyOn(teamMaterialApi, 'purposes').mockResolvedValue([
    { id: 1, team_id: 2, name: '检验', active: true, version: 1 },
  ])
  vi.spyOn(teamMaterialApi, 'openingState').mockResolvedValue(allowed)
  vi.spyOn(teamMaterialApi, 'openingOptions').mockResolvedValue([openingOrder])
  vi.spyOn(teamMaterialApi, 'savePurpose').mockResolvedValue({
    id: 1,
    team_id: 2,
    name: '检验',
    active: true,
    version: 2,
  })
  vi.spyOn(teamMaterialApi, 'saveProcessingTask').mockResolvedValue({
    id: 1,
    team_id: 2,
    name: '去毛刺',
    active: true,
    version: 2,
  })
  vi.spyOn(teamMaterialApi, 'createOpening').mockResolvedValue([])
  vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue(
    'confirm' as Awaited<ReturnType<typeof ElMessageBox.confirm>>,
  )
})
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
  localStorage.clear()
})
async function render(initialTab = 'opening', teamCode?: string) {
  wrapper = mount(TeamBusinessDialog, {
    props: { modelValue: true, teamId: 2, initialTab, teamCode },
    global: {
      stubs: {
        RouterLink: true,
        ElDialog: { template: '<div><slot /><slot name="footer" /></div>' },
      },
    },
  })
  await flushPromises()
}
async function click(text: string) {
  await wrapper
    .findAll('button')
    .find((button) => button.text() === text)!
    .trigger('click')
  await flushPromises()
}

async function saveNew() {
  await wrapper.get('.directory-add').trigger('submit')
  await flushPromises()
}

describe('team business settings', () => {
  it.each(['QC leader', 'administrator'])(
    'lets the %s maintain versioned problem choices',
    async (actor) => {
      if (actor === 'administrator')
        state.auth = { currentUser: { id: 1, active: true }, isAdmin: true, isTeamAccount: false }
      vi.mocked(teamMaterialApi.inspectionProblems).mockResolvedValue([
        { id: 15, team_id: 2, name: '划伤', active: true, version: 3 },
      ])
      const save = vi.spyOn(teamMaterialApi, 'saveInspectionProblem').mockResolvedValue({
        id: 15,
        team_id: 2,
        name: '表面划伤',
        active: false,
        version: 4,
      })
      wrapper = mount(TeamBusinessDialog, {
        props: { modelValue: true, teamId: 2, inspectionProblems: true, initialTab: 'problems' },
        global: { stubs: { ElDialog: { template: '<div><slot/><slot name="footer"/></div>' } } },
      })
      await flushPromises()
      expect(wrapper.text()).toContain('检验问题')
      expect(wrapper.text()).toContain('改名不改变历史记录')
      await wrapper.get('button[aria-label="编辑 划伤"]').trigger('click')
      await wrapper.get('input[aria-label="问题名称 15"]').setValue('表面划伤')
      wrapper.getComponent(ElSwitch).vm.$emit('update:modelValue', false)
      await click('保存')
      expect(save).toHaveBeenCalledWith(
        2,
        { name: '表面划伤', active: false, expected_version: 3 },
        15,
      )
      expect(teamMaterialApi.savePurpose).not.toHaveBeenCalled()
      await click('新增问题')
      await wrapper.get('input[aria-label="新增问题名称"]').setValue('尺寸超差')
      await saveNew()
      expect(save).toHaveBeenLastCalledWith(2, { name: '尺寸超差', active: true }, undefined)
    },
  )
  it.each([
    [
      'another team',
      { currentUser: { id: 41, team_id: 3 }, isTeamAccount: true, isAdmin: false },
      true,
    ],
    [
      'non-QC team',
      { currentUser: { id: 41, team_id: 2 }, isTeamAccount: true, isAdmin: false },
      false,
    ],
  ])(
    'does not expose or load problem configuration for %s',
    async (_label, auth, inspectionProblems) => {
      state.auth = auth
      wrapper = mount(TeamBusinessDialog, {
        props: { modelValue: true, teamId: 2, inspectionProblems, initialTab: 'problems' },
        global: { stubs: { ElDialog: { template: '<div><slot/><slot name="footer"/></div>' } } },
      })
      await flushPromises()
      expect(wrapper.text()).not.toContain('检验问题')
      expect(wrapper.find('[aria-label="新增问题名称"]').exists()).toBe(false)
      expect(teamMaterialApi.inspectionProblems).not.toHaveBeenCalled()
    },
  )
  it('keeps warehouse personnel and opening stock without receiving or processing tasks', async () => {
    wrapper = mount(TeamBusinessDialog, {
      props: { modelValue: true, teamId: 2, processingTasks: false },
      global: { stubs: { ElDialog: { template: '<div><slot/><slot name="footer"/></div>' } } },
    })
    await flushPromises()
    expect(wrapper.text()).not.toContain('加工任务')
    expect(wrapper.text()).not.toContain('接收任务')
    expect(wrapper.findAll('button').some((button) => button.text() === '新增员工')).toBe(true)
    expect(wrapper.text()).toContain('初始库存')
    expect(teamMaterialApi.processingTasks).not.toHaveBeenCalled()
    expect(teamMaterialApi.purposes).not.toHaveBeenCalled()
    wrapper.unmount()
    wrapper = mount(TeamBusinessDialog, {
      props: { modelValue: true, teamId: 2, processingTasks: false, initialTab: 'opening' },
      global: { stubs: { ElDialog: { template: '<div><slot/><slot name="footer"/></div>' } } },
    })
    await flushPromises()
    expect(wrapper.find('input[aria-label="第1行流水号"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="初始库存加工任务"]').exists()).toBe(false)
  })
  it('maintains task names and activation with versions, separately from businesses', async () => {
    vi.mocked(teamMaterialApi.processingTasks).mockResolvedValue([
      { id: 9, team_id: 2, name: '粗磨', active: true, version: 3 },
    ])
    const save = vi.spyOn(teamMaterialApi, 'saveProcessingTask').mockResolvedValue({
      id: 9,
      team_id: 2,
      name: '精磨',
      active: false,
      version: 4,
    })
    await render('tasks')
    await wrapper.get('button[aria-label="编辑 粗磨"]').trigger('click')
    await wrapper.get('input[aria-label="任务名称 9"]').setValue('精磨')
    wrapper.getComponent(ElSwitch).vm.$emit('update:modelValue', false)
    await click('保存')
    expect(save).toHaveBeenCalledWith(2, { name: '精磨', active: false, expected_version: 3 }, 9)
    expect(teamMaterialApi.savePurpose).not.toHaveBeenCalled()
    await click('新增任务')
    await wrapper.get('input[aria-label="新增任务名称"]').setValue('去毛刺')
    await saveNew()
    expect(save).toHaveBeenLastCalledWith(2, { name: '去毛刺', active: true }, undefined)
  })
  it('maintains employees separately from businesses without a login account', async () => {
    vi.mocked(teamMaterialApi.employees).mockResolvedValue([
      { id: 4, team_id: 2, name: '王师傅', active: true, version: 1 },
    ])
    const save = vi.spyOn(teamMaterialApi, 'saveEmployee').mockResolvedValue({
      id: 4,
      team_id: 2,
      name: '王工',
      active: false,
      version: 2,
    })
    await render('employees')
    expect(wrapper.find('[aria-label="任务名称 1"]').exists()).toBe(false)
    await wrapper.get('button[aria-label="编辑 王师傅"]').trigger('click')
    await wrapper.get('input[aria-label="员工名称 4"]').setValue('王工')
    wrapper.getComponent(ElSwitch).vm.$emit('update:modelValue', false)
    await click('保存')
    expect(save).toHaveBeenCalledWith(2, { name: '王工', active: false, expected_version: 1 }, 4)
    expect(teamMaterialApi.savePurpose).not.toHaveBeenCalled()
    await click('新增员工')
    const nameInput = wrapper.get<HTMLInputElement>('input[aria-label="新增员工名称"]').element
    const nameField = nameInput.closest<HTMLElement>('.el-input')!
    nameField.animate = vi.fn()
    const focus = vi.spyOn(nameInput, 'focus')
    await saveNew()
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(nameField.animate).toHaveBeenCalledOnce()
    expect(
      wrapper
        .get('input[aria-label="新增员工名称"]')
        .element.closest('.el-input')!
        .classList.contains('is-error'),
    ).toBe(true)
    await wrapper.get('input[aria-label="新增员工名称"]').setValue('李师傅')
    await saveNew()
    expect(save).toHaveBeenLastCalledWith(2, { name: '李师傅', active: true }, undefined)
  })

  it('updates the saved row without losing other row edits or the new employee draft', async () => {
    const first = { id: 4, team_id: 2, name: '王师傅', active: true, version: 1 }
    const second = { id: 5, team_id: 2, name: '李师傅', active: true, version: 3 }
    vi.mocked(teamMaterialApi.employees).mockImplementation(async () => [
      { ...first },
      { ...second },
    ])
    const save = vi.spyOn(teamMaterialApi, 'saveEmployee').mockResolvedValueOnce({
      ...first,
      name: '王工',
      version: 2,
    })
    save.mockResolvedValueOnce({ ...second, name: '李工', version: 4 })
    await render('employees')
    await wrapper.get('button[aria-label="编辑 王师傅"]').trigger('click')
    await wrapper.get('button[aria-label="编辑 李师傅"]').trigger('click')
    await wrapper.get('input[aria-label="员工名称 4"]').setValue('王工')
    await wrapper.get('input[aria-label="员工名称 5"]').setValue('李工')
    await click('新增员工')
    await wrapper.get('input[aria-label="新增员工名称"]').setValue('赵师傅')
    await wrapper.get('button[aria-label="保存 王师傅"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('button[aria-label="编辑 王工"]').exists()).toBe(true)
    expect(wrapper.get('input[aria-label="员工名称 5"]').element).toHaveProperty('value', '李工')
    expect(wrapper.get('input[aria-label="新增员工名称"]').element).toHaveProperty(
      'value',
      '赵师傅',
    )
    expect(teamMaterialApi.employees).toHaveBeenCalledTimes(1)
    await wrapper.get('button[aria-label="保存 李师傅"]').trigger('click')
    await flushPromises()
    expect(save).toHaveBeenLastCalledWith(2, { name: '李工', active: true, expected_version: 3 }, 5)
  })

  it.each([
    ['employees', 'employees', 'saveEmployee', '员工'],
    ['tasks', 'processingTasks', 'saveProcessingTask', '任务'],
    ['equipment', 'equipment', 'saveEquipment', '设备'],
  ] as const)(
    'paginates %s and keeps a draft when a different page is saved',
    async (tab, listMethod, saveMethod, label) => {
      const items = Array.from({ length: 11 }, (_, index) => ({
        id: index + 1,
        team_id: 2,
        name: `${label} ${index + 1}`,
        active: true,
        version: 1,
      }))
      const list = vi.spyOn(teamMaterialApi, listMethod).mockResolvedValue(items)
      const save = vi.spyOn(teamMaterialApi, saveMethod).mockResolvedValue({
        ...items[10]!,
        name: '第二页已保存',
        version: 2,
      })
      await render(tab, tab === 'equipment' ? 'FACTORY-WIRE' : undefined)
      const pager = wrapper.getComponent(WorkspacePagination)
      const firstRowInput = `input[aria-label="${label}名称 1"]`
      expect(pager.props()).toMatchObject({ currentPage: 1, pageSize: 10, total: 11 })
      expect(wrapper.findAll('.el-table__body .el-table__row')).toHaveLength(10)
      await wrapper.get(`button[aria-label="编辑 ${label} 1"]`).trigger('click')
      await wrapper.get(firstRowInput).setValue('第一页草稿')
      wrapper.getComponent(ElSwitch).vm.$emit('update:modelValue', false)
      await click(`新增${label}`)
      const newInput = `input[aria-label="新增${label}名称"]`
      await wrapper.get(newInput).setValue('新增草稿')

      await wrapper.get('button.btn-next').trigger('click')
      expect(pager.props('currentPage')).toBe(2)
      expect(wrapper.findAll('.el-table__body .el-table__row')).toHaveLength(1)
      expect(wrapper.find(firstRowInput).exists()).toBe(false)
      await wrapper.get(`button[aria-label="编辑 ${label} 11"]`).trigger('click')
      await wrapper.get(`input[aria-label="${label}名称 11"]`).setValue('第二页已保存')
      await click('保存')
      expect(save).toHaveBeenCalledWith(
        2,
        { name: '第二页已保存', active: true, expected_version: 1 },
        11,
      )
      expect(list).toHaveBeenCalledTimes(1)

      await wrapper.get('button.btn-prev').trigger('click')
      expect(pager.props('currentPage')).toBe(1)
      expect(wrapper.get(firstRowInput).element).toHaveProperty('value', '第一页草稿')
      expect(wrapper.getComponent(ElSwitch).props('modelValue')).toBe(false)
      expect(wrapper.get(newInput).element).toHaveProperty('value', '新增草稿')
    },
  )

  it('returns to the first page after searching or adding an employee', async () => {
    const items = Array.from({ length: 12 }, (_, index) => ({
      id: index + 1,
      team_id: 2,
      name: `员工 ${index + 1}`,
      active: true,
      version: 1,
    }))
    vi.mocked(teamMaterialApi.employees).mockResolvedValue(items)
    vi.spyOn(teamMaterialApi, 'saveEmployee').mockResolvedValue({
      id: 13,
      team_id: 2,
      name: '新增员工甲',
      active: true,
      version: 1,
    })
    await render('employees')
    const pager = wrapper.getComponent(WorkspacePagination)
    await wrapper.get('button.btn-next').trigger('click')
    await wrapper.get('input[aria-label="搜索员工"]').setValue('员工 12')
    expect(pager.props()).toMatchObject({ currentPage: 1, total: 1 })
    expect(wrapper.find('button[aria-label="编辑 员工 12"]').exists()).toBe(true)

    await wrapper.get('input[aria-label="搜索员工"]').setValue('')
    await wrapper.get('button.btn-next').trigger('click')
    await click('新增员工')
    await wrapper.get('input[aria-label="新增员工名称"]').setValue('新增员工甲')
    await saveNew()
    expect(pager.props()).toMatchObject({ currentPage: 1, total: 13 })
    expect(wrapper.find('button[aria-label="编辑 新增员工甲"]').exists()).toBe(true)
  })

  it('shows all batches together, preserves values and marks each invalid field', async () => {
    await render()
    await wrapper.get('input[aria-label="第1行流水号"]').setValue('000017')
    await click('增加物料')
    await wrapper.get('input[aria-label="第2行流水号"]').setValue('000018')
    expect(wrapper.find('nav[aria-label="表单分页"]').exists()).toBe(false)
    expect(wrapper.get('input[aria-label="第1行流水号"]').isVisible()).toBe(true)
    expect(wrapper.get('input[aria-label="第2行流水号"]').isVisible()).toBe(true)
    await click('确认初始库存登记')
    expect(teamMaterialApi.createOpening).not.toHaveBeenCalled()
    expect(wrapper.findAll('.opening-line')).toHaveLength(2)
    expect(wrapper.findAll('.is-error').length).toBeGreaterThanOrEqual(8)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    await wrapper.get('input[aria-label="第1行材质"]').setValue('材料1')
    expect(
      wrapper
        .get('input[aria-label="第1行材质"]')
        .element.closest('.dialog-field')!
        .classList.contains('is-error'),
    ).toBe(false)
    expect(
      wrapper
        .get('input[aria-label="第2行材质"]')
        .element.closest('.dialog-field')!
        .classList.contains('is-error'),
    ).toBe(true)
    expect(wrapper.get('input[aria-label="第1行流水号"]').element).toHaveProperty('value', '000017')
  })
  it('opens business-only settings without reading or exposing opening stock', async () => {
    wrapper = mount(TeamBusinessDialog, {
      props: { modelValue: true, teamId: 2, businessOnly: true, initialTab: 'opening' },
      global: { stubs: { ElDialog: { template: '<div><slot /><slot name="footer" /></div>' } } },
    })
    await flushPromises()
    expect(teamMaterialApi.purposes).toHaveBeenCalledWith(2)
    expect(teamMaterialApi.openingState).not.toHaveBeenCalled()
    expect(wrapper.find('button[aria-label="编辑 检验"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('初始库存')
    await wrapper.get('button[aria-label="编辑 检验"]').trigger('click')
    await wrapper.get('input[aria-label="任务名称 1"]').setValue('新业务')
    await click('保存')
    expect(teamMaterialApi.saveProcessingTask).toHaveBeenCalledWith(
      2,
      { name: '新业务', active: true, expected_version: 1 },
      1,
    )
  })
  it('posts measured sludge opening stock in effective kg', async () => {
    await render()
    wrapper
      .findAllComponents(ElSelect)
      .find((item) => item.find('input[aria-label="第1行登记类型"]').exists())!
      .vm.$emit('update:modelValue', 'non_order')
    await flushPromises()
    expect(wrapper.find('input[aria-label="第1行流水号"]').exists()).toBe(false)
    await wrapper.get('input[aria-label="第1行材质"]').setValue('铜钼')
    wrapper
      .findAllComponents(ElSelect)
      .find((item) => item.find('input[aria-label="第1行物料类型"]').exists())!
      .vm.$emit('update:modelValue', 'sludge')
    await flushPromises()
    const inputs = wrapper.findAllComponents(ElInputNumber)
    ;[10, 30].forEach((value, i) => inputs[i]!.vm.$emit('update:modelValue', value))
    await flushPromises()
    await click('确认初始库存登记')
    expect(teamMaterialApi.createOpening).toHaveBeenCalledWith(
      2,
      [
        expect.objectContaining({
          stock_type: 'non_order',
          serial_no: '',
          quantity: 0,
          weight: 3,
          sludge_gross_weight: 10,
          sludge_content_percent: 30,
        }),
      ],
      expect.any(String),
    )
  })

  it('requires an explicit order batch and route step when several match the serial', async () => {
    vi.mocked(teamMaterialApi.openingOptions).mockResolvedValue([
      openingOrder,
      {
        ...openingOrder,
        schedule_id: 72,
        task_batch_number: 2,
        steps: [...openingOrder.steps, { index: 2, sequence_no: 2, name: '复切' }],
      },
    ])
    await render()
    await wrapper.get('input[aria-label="第1行流水号"]').setValue('000012')
    await wrapper.get('input[aria-label="第1行材质"]').setValue('铜钼')
    const select = (label: string) =>
      wrapper
        .findAllComponents(ElSelect)
        .find((item) => item.find(`input[aria-label="第1行${label}"]`).exists())!
    select('物料类型').vm.$emit('update:modelValue', 'semi_finished')
    wrapper.findAllComponents(ElInputNumber)[0]!.vm.$emit('update:modelValue', 10)
    wrapper.findAllComponents(ElInputNumber)[1]!.vm.$emit('update:modelValue', 2)
    await vi.waitFor(() => expect(teamMaterialApi.openingOptions).toHaveBeenCalledWith(2, '000012'))
    await click('确认初始库存登记')
    expect(teamMaterialApi.createOpening).not.toHaveBeenCalled()
    select('排期批次').vm.$emit('update:modelValue', 72)
    await click('确认初始库存登记')
    expect(teamMaterialApi.createOpening).not.toHaveBeenCalled()
    select('当前工序').vm.$emit('update:modelValue', 2)
    await flushPromises()
    select('工序状态').vm.$emit('update:modelValue', true)
    await click('确认初始库存登记')
    expect(teamMaterialApi.createOpening).toHaveBeenCalledWith(
      2,
      [
        expect.objectContaining({
          stock_type: 'order',
          process_route_id: 9,
          process_route_version: 2,
          production_schedule_id: 72,
          process_step_index: 2,
          process_step_complete: true,
        }),
      ],
      expect.any(String),
    )
  })

  it('does not silently replace a saved opening draft’s order route', async () => {
    localStorage.setItem(
      'heatsink.opening-draft.v1:41:2',
      JSON.stringify([
        {
          stock_type: 'order',
          serial_no: '000012',
          material_name: '铜钼',
          material_type: 'semi_finished',
          quantity: 12,
          weight: 2,
          production_schedule_id: 71,
          process_route_id: 8,
          process_route_version: 2,
          process_step_index: 1,
          process_step_complete: true,
        },
      ]),
    )
    await render()
    await vi.waitFor(() => expect(wrapper.text()).toContain('草稿中的排期或工艺已变化'))
    await click('确认初始库存登记')
    expect(teamMaterialApi.createOpening).not.toHaveBeenCalled()
  })
  it('rejects a blank existing name without taking the separate new-business draft', async () => {
    await render('purposes')
    await wrapper.get('button[aria-label="编辑 检验"]').trigger('click')
    await click('新增任务')
    await wrapper.get('input[aria-label="新增任务名称"]').setValue('去毛刺')
    await wrapper.get('input[aria-label="任务名称 1"]').setValue('')
    const nameInput = wrapper.get<HTMLInputElement>('input[aria-label="任务名称 1"]').element
    const nameField = nameInput.closest<HTMLElement>('.el-input')!
    nameField.animate = vi.fn()
    const focus = vi.spyOn(nameInput, 'focus')
    await click('保存')
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(nameField.animate).toHaveBeenCalledOnce()
    expect(
      wrapper
        .get('input[aria-label="任务名称 1"]')
        .element.closest('.el-input')!
        .classList.contains('is-error'),
    ).toBe(true)
    expect(teamMaterialApi.savePurpose).not.toHaveBeenCalled()
  })
  it('keeps a business edit after a failed save and submits disable with its version', async () => {
    await render('purposes')
    await wrapper.get('button[aria-label="编辑 检验"]').trigger('click')
    await wrapper.get('input[aria-label="任务名称 1"]').setValue('去毛刺')
    wrapper.getComponent(ElSwitch).vm.$emit('update:modelValue', false)
    vi.mocked(teamMaterialApi.saveProcessingTask).mockRejectedValueOnce(
      new Error('业务配置已变化，请刷新后重试'),
    )
    await click('保存')
    expect(teamMaterialApi.saveProcessingTask).toHaveBeenCalledWith(
      2,
      { name: '去毛刺', active: false, expected_version: 1 },
      1,
    )
    expect(wrapper.emitted('changed')).toBeUndefined()
    expect((wrapper.get('input[aria-label="任务名称 1"]').element as HTMLInputElement).value).toBe(
      '去毛刺',
    )
    expect(wrapper.getComponent(ElSwitch).props('modelValue')).toBe(false)
    expect(wrapper.text()).toContain('业务配置已变化')
  })
  it('does not offer posting without administrator authorization', async () => {
    vi.mocked(teamMaterialApi.openingState).mockResolvedValue({
      ...allowed,
      enabled: false,
      can_submit: false,
    })
    await render()
    expect(wrapper.text()).toContain('系统设置 → 班组管理')
    expect(wrapper.text()).toContain('点击「初始库存录入」授权')
    expect(wrapper.text()).not.toContain('确认初始库存登记')
    expect(teamMaterialApi.createOpening).not.toHaveBeenCalled()
  })
  it('closes after success and allows repeated identical entries after reopening with distinct keys', async () => {
    vi.mocked(teamMaterialApi.openingState).mockResolvedValue({
      ...allowed,
      completed: true,
      has_stock_history: true,
    })
    await render()
    for (let i = 0; i < 2; i++) {
      if (i) {
        await wrapper.setProps({ modelValue: false })
        await wrapper.setProps({ modelValue: true })
        await flushPromises()
      }
      await wrapper.get('input[aria-label="第1行流水号"]').setValue('000012')
      await wrapper.get('input[aria-label="第1行材质"]').setValue('材料1')
      wrapper
        .findAllComponents(ElSelect)
        .find((item) => item.find('input[aria-label="第1行物料类型"]').exists())!
        .vm.$emit('update:modelValue', 'semi_finished')
      wrapper.findAllComponents(ElInputNumber)[0]!.vm.$emit('update:modelValue', 100)
      wrapper.findAllComponents(ElInputNumber)[1]!.vm.$emit('update:modelValue', 10)
      await vi.waitFor(() => expect(wrapper.text()).toContain(openingOrder.route_title))
      await click('确认初始库存登记')
    }
    const calls = vi.mocked(teamMaterialApi.createOpening).mock.calls
    expect(calls).toHaveLength(2)
    expect(calls[0]![1]).toEqual(calls[1]![1])
    expect(calls[0]![2]).not.toBe(calls[1]![2])
    expect(wrapper.emitted('update:modelValue')).toEqual([[false], [false]])
    expect(wrapper.emitted('stocked')).toHaveLength(2)
  })
  it.each(['team', 'administrator'])(
    'lets %s post stock and preserves local drafts on failure',
    async (actor) => {
      if (actor === 'administrator') {
        state.auth = { currentUser: { id: 1, active: true }, isAdmin: true, isTeamAccount: false }
        vi.mocked(teamMaterialApi.openingState).mockResolvedValue({ ...allowed, enabled: false })
      }
      await render()
      await wrapper.get('input[aria-label="第1行流水号"]').setValue('000012')
      await wrapper.get('input[aria-label="第1行材质"]').setValue('铜钼')
      wrapper
        .findAllComponents(ElSelect)
        .find((item) => item.find('input[aria-label="第1行物料类型"]').exists())!
        .vm.$emit('update:modelValue', 'semi_finished')
      wrapper.findAllComponents(ElInputNumber)[0]!.vm.$emit('update:modelValue', 100)
      wrapper.findAllComponents(ElInputNumber)[1]!.vm.$emit('update:modelValue', 10.125)
      await vi.waitFor(() => expect(wrapper.text()).toContain(openingOrder.route_title))
      await click('保存本机草稿')
      expect(
        localStorage.getItem(`heatsink.opening-draft.v1:${actor === 'administrator' ? 1 : 41}:2`),
      ).toContain('000012')
      vi.mocked(teamMaterialApi.createOpening).mockRejectedValueOnce(new Error('网络错误'))
      await click('确认初始库存登记')
      expect(wrapper.emitted('update:modelValue')).toBeUndefined()
      expect(
        localStorage.getItem(`heatsink.opening-draft.v1:${actor === 'administrator' ? 1 : 41}:2`),
      ).toContain('000012')
      await click('确认初始库存登记')
      const calls = vi.mocked(teamMaterialApi.createOpening).mock.calls
      expect(calls).toHaveLength(2)
      expect(calls[0]![0]).toBe(2)
      expect(calls[0]![1][0]).toMatchObject({
        serial_no: '000012',
        quantity: 100,
        weight: 10.125,
        material_type: 'semi_finished',
        purpose_id: null,
      })
      expect(calls[0]![2]).toBe(calls[1]![2])
      expect(wrapper.emitted('stocked')).toHaveLength(1)
      expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
      expect(
        localStorage.getItem(`heatsink.opening-draft.v1:${actor === 'administrator' ? 1 : 41}:2`),
      ).toBeNull()
    },
  )
  it('validates empty stock and restores only this account/team draft', async () => {
    localStorage.setItem(
      'heatsink.opening-draft.v1:41:3',
      JSON.stringify([{ serial_no: 'FOREIGN', material_name: '铜' }]),
    )
    await render()
    await click('确认初始库存登记')
    expect(
      wrapper
        .get('input[aria-label="第1行流水号"]')
        .element.closest('.dialog-field')!
        .classList.contains('is-error'),
    ).toBe(true)
    expect(teamMaterialApi.createOpening).not.toHaveBeenCalled()
    expect(wrapper.text()).not.toContain('FOREIGN')
  })
  it('uses versioned own-team purpose saves without production registration', async () => {
    await render('purposes')
    await wrapper.get('button[aria-label="编辑 检验"]').trigger('click')
    await wrapper.get('input[aria-label="任务名称 1"]').setValue('去毛刺')
    await click('保存')
    expect(teamMaterialApi.saveProcessingTask).toHaveBeenCalledWith(
      2,
      { name: '去毛刺', active: true, expected_version: 1 },
      1,
    )
    await click('新增任务')
    await wrapper.get('input[aria-label="新增任务名称"]').setValue('发货')
    await saveNew()
    expect(teamMaterialApi.saveProcessingTask).toHaveBeenLastCalledWith(
      2,
      { name: '发货', active: true },
      undefined,
    )
  })
})

it('registers weight-only opening stock without requesting or retaining pieces from the draft', async () => {
  localStorage.setItem(
    'heatsink.opening-draft.v1:41:2',
    JSON.stringify([
      {
        serial_no: 'YS-1',
        material_name: '材料1',
        material_type: 'scrap_chips',
        quantity: 50,
        weight: 3,
      },
    ]),
  )
  await render()
  expect(wrapper.find('input[aria-label="第1行件数"]').exists()).toBe(false)
  await click('确认初始库存登记')
  expect(teamMaterialApi.createOpening).toHaveBeenCalledWith(
    2,
    [expect.objectContaining({ quantity: 0, weight: 3 })],
    expect.any(String),
  )
})

it.each(['FACTORY-ANNEAL', 'FACTORY-ROLL', 'FACTORY-GRIND', 'FACTORY-WIRE', 'FACTORY-ENGRAVE'])(
  'manages equipment for %s using the shared directory',
  async (teamCode) => {
    const equipment = { id: 3, team_id: 2, name: '01号设备', active: true, version: 1 }
    vi.spyOn(teamMaterialApi, 'equipment').mockResolvedValue([equipment])
    vi.spyOn(teamMaterialApi, 'saveEquipment').mockResolvedValue({ ...equipment, version: 2 })
    await render('equipment')
    await wrapper.setProps({ teamCode })
    await flushPromises()
    expect(wrapper.text()).toContain('设备管理')
    await wrapper.get('#tab-equipment').trigger('click')
    await flushPromises()
    expect(wrapper.find('button[aria-label="编辑 01号设备"]').exists()).toBe(true)
    await click('新增设备')
    await wrapper.get('input[aria-label="新增设备名称"]').setValue('02号设备')
    await saveNew()
    expect(teamMaterialApi.saveEquipment).toHaveBeenCalledWith(
      2,
      { name: '02号设备', active: true },
      undefined,
    )
    expect(teamMaterialApi.saveProcessingTask).not.toHaveBeenCalled()
  },
)

it.each(['FACTORY-WAREHOUSE', 'FACTORY-PLATE', 'FACTORY-QC'])(
  'does not expose equipment for %s',
  async (teamCode) => {
    const lookup = vi.spyOn(teamMaterialApi, 'equipment')
    await render()
    await wrapper.setProps({ teamCode })
    await flushPromises()
    expect(wrapper.text()).not.toContain('设备管理')
    expect(lookup).not.toHaveBeenCalled()
  },
)
