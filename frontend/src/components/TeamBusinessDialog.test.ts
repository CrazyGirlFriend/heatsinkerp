// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { ElInputNumber, ElSelect, ElSwitch, ElMessageBox } from 'element-plus'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TeamBusinessDialog from './TeamBusinessDialog.vue'
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
beforeEach(() => {
  state.auth = { currentUser: { id: 41, team_id: 2 }, isTeamAccount: true, isAdmin: false }
  localStorage.clear()
  vi.spyOn(teamMaterialApi, 'processingTasks').mockResolvedValue([])
  vi.spyOn(teamMaterialApi, 'inspectionProblems').mockResolvedValue([])
  vi.spyOn(teamMaterialApi, 'employees').mockResolvedValue([])
  vi.spyOn(teamMaterialApi, 'purposes').mockResolvedValue([
    { id: 1, team_id: 2, name: '检验', active: true, version: 1 },
  ])
  vi.spyOn(teamMaterialApi, 'openingState').mockResolvedValue(allowed)
  vi.spyOn(teamMaterialApi, 'savePurpose').mockResolvedValue({
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
async function render(initialTab = 'opening') {
  wrapper = mount(TeamBusinessDialog, {
    props: { modelValue: true, teamId: 2, initialTab },
    global: { stubs: { ElDialog: { template: '<div><slot /><slot name="footer" /></div>' } } },
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

describe('team business settings', () => {
  it('lets the QC leader maintain versioned problem choices separately from businesses', async () => {
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
    await wrapper.get('input[aria-label="问题名称 15"]').setValue('表面划伤')
    wrapper.getComponent(ElSwitch).vm.$emit('update:modelValue', false)
    await click('保存')
    expect(save).toHaveBeenCalledWith(
      2,
      { name: '表面划伤', active: false, expected_version: 3 },
      15,
    )
    expect(teamMaterialApi.savePurpose).not.toHaveBeenCalled()
    await wrapper.get('input[aria-label="新增问题名称"]').setValue('尺寸超差')
    await click('新增问题')
    expect(save).toHaveBeenLastCalledWith(2, { name: '尺寸超差', active: true }, undefined)
  })
  it.each([
    [
      'another team',
      { currentUser: { id: 41, team_id: 3 }, isTeamAccount: true, isAdmin: false },
      true,
    ],
    [
      'administrator',
      { currentUser: { id: 41, team_id: null }, isTeamAccount: false, isAdmin: true },
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
  it('does not show or load processing tasks for warehouse settings', async () => {
    wrapper = mount(TeamBusinessDialog, {
      props: { modelValue: true, teamId: 2, processingTasks: false },
      global: { stubs: { ElDialog: { template: '<div><slot/><slot name="footer"/></div>' } } },
    })
    await flushPromises()
    expect(wrapper.text()).not.toContain('加工任务')
    expect(teamMaterialApi.processingTasks).not.toHaveBeenCalled()
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
    await wrapper.get('input[aria-label="任务名称 9"]').setValue('精磨')
    wrapper.getComponent(ElSwitch).vm.$emit('update:modelValue', false)
    await click('保存')
    expect(save).toHaveBeenCalledWith(2, { name: '精磨', active: false, expected_version: 3 }, 9)
    expect(teamMaterialApi.savePurpose).not.toHaveBeenCalled()
    await wrapper.get('input[aria-label="新增任务名称"]').setValue('去毛刺')
    await click('新增任务')
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
    expect(wrapper.find('[aria-label="业务名称 1"]').exists()).toBe(false)
    await wrapper.get('input[aria-label="员工名称 4"]').setValue('王工')
    wrapper.getComponent(ElSwitch).vm.$emit('update:modelValue', false)
    await click('保存')
    expect(save).toHaveBeenCalledWith(2, { name: '王工', active: false, expected_version: 1 }, 4)
    expect(teamMaterialApi.savePurpose).not.toHaveBeenCalled()
    const nameInput = wrapper.get<HTMLInputElement>('input[aria-label="新增员工名称"]').element
    const nameField = nameInput.closest<HTMLElement>('.el-input')!
    nameField.animate = vi.fn()
    const focus = vi.spyOn(nameInput, 'focus')
    await click('新增员工')
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(nameField.animate).toHaveBeenCalledOnce()
    expect(
      wrapper
        .get('input[aria-label="新增员工名称"]')
        .element.closest('.el-input')!
        .classList.contains('is-error'),
    ).toBe(true)
    await wrapper.get('input[aria-label="新增员工名称"]').setValue('李师傅')
    await click('新增员工')
    expect(save).toHaveBeenLastCalledWith(2, { name: '李师傅', active: true }, undefined)
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
    expect(wrapper.find('[aria-label="业务名称 1"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('初始库存')
    await wrapper.get('input[aria-label="业务名称 1"]').setValue('新业务')
    await click('保存')
    expect(teamMaterialApi.savePurpose).toHaveBeenCalledWith(
      2,
      { name: '新业务', active: true, expected_version: 1 },
      1,
    )
  })
  it('posts measured sludge opening stock in effective kg', async () => {
    await render()
    await wrapper.get('input[aria-label="第1行流水号"]').setValue('000012')
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
          quantity: 0,
          weight: 3,
          sludge_gross_weight: 10,
          sludge_content_percent: 30,
        }),
      ],
      expect.any(String),
    )
  })
  it('rejects a blank existing name without taking the separate new-business draft', async () => {
    await render('purposes')
    await wrapper.get('input[aria-label="新增业务名称"]').setValue('去毛刺')
    await wrapper.get('input[aria-label="业务名称 1"]').setValue('')
    const nameInput = wrapper.get<HTMLInputElement>('input[aria-label="业务名称 1"]').element
    const nameField = nameInput.closest<HTMLElement>('.el-input')!
    nameField.animate = vi.fn()
    const focus = vi.spyOn(nameInput, 'focus')
    await click('保存')
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(nameField.animate).toHaveBeenCalledOnce()
    expect(
      wrapper
        .get('input[aria-label="业务名称 1"]')
        .element.closest('.el-input')!
        .classList.contains('is-error'),
    ).toBe(true)
    expect(teamMaterialApi.savePurpose).not.toHaveBeenCalled()
  })
  it('keeps a business edit after a failed save and submits disable with its version', async () => {
    await render('purposes')
    await wrapper.get('input[aria-label="业务名称 1"]').setValue('去毛刺')
    wrapper.getComponent(ElSwitch).vm.$emit('update:modelValue', false)
    vi.mocked(teamMaterialApi.savePurpose).mockRejectedValueOnce(
      new Error('业务配置已变化，请刷新后重试'),
    )
    await click('保存')
    expect(teamMaterialApi.savePurpose).toHaveBeenCalledWith(
      2,
      { name: '去毛刺', active: false, expected_version: 1 },
      1,
    )
    expect(wrapper.emitted('changed')).toBeUndefined()
    expect((wrapper.get('input[aria-label="业务名称 1"]').element as HTMLInputElement).value).toBe(
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
    expect(wrapper.text()).toContain('请系统管理员')
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
      await flushPromises()
      await click('确认初始库存登记')
    }
    const calls = vi.mocked(teamMaterialApi.createOpening).mock.calls
    expect(calls).toHaveLength(2)
    expect(calls[0]![1]).toEqual(calls[1]![1])
    expect(calls[0]![2]).not.toBe(calls[1]![2])
    expect(wrapper.emitted('update:modelValue')).toEqual([[false], [false]])
    expect(wrapper.emitted('stocked')).toHaveLength(2)
  })
  it('posts leading-zero stock once after confirmation, preserving local drafts on failure', async () => {
    await render()
    await wrapper.get('input[aria-label="第1行流水号"]').setValue('000012')
    await wrapper.get('input[aria-label="第1行材质"]').setValue('铜钼')
    wrapper
      .findAllComponents(ElSelect)
      .find((item) => item.find('input[aria-label="第1行物料类型"]').exists())!
      .vm.$emit('update:modelValue', 'semi_finished')
    wrapper.findAllComponents(ElInputNumber)[0]!.vm.$emit('update:modelValue', 100)
    wrapper.findAllComponents(ElInputNumber)[1]!.vm.$emit('update:modelValue', 10.125)
    await click('保存本机草稿')
    expect(localStorage.getItem('heatsink.opening-draft.v1:41:2')).toContain('000012')
    vi.mocked(teamMaterialApi.createOpening).mockRejectedValueOnce(new Error('网络错误'))
    await click('确认初始库存登记')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    expect(localStorage.getItem('heatsink.opening-draft.v1:41:2')).toContain('000012')
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
    expect(localStorage.getItem('heatsink.opening-draft.v1:41:2')).toBeNull()
  })
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
    await wrapper.get('input[aria-label="业务名称 1"]').setValue('去毛刺')
    await click('保存')
    expect(teamMaterialApi.savePurpose).toHaveBeenCalledWith(
      2,
      { name: '去毛刺', active: true, expected_version: 1 },
      1,
    )
    await wrapper.get('input[aria-label="新增业务名称"]').setValue('发货')
    await click('新增业务')
    expect(teamMaterialApi.savePurpose).toHaveBeenLastCalledWith(
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
