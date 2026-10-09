// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { ElInputNumber, ElSelect, ElSwitch, ElMessageBox } from 'element-plus'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TeamBusinessDialog from './TeamBusinessDialog.vue'
import { teamMaterialApi } from '@/services/teamMaterialApi'

vi.mock('@/services/materialInputApi', () => ({ materialSuggestions: vi.fn().mockResolvedValue([]) }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ currentUser: { id: 41, team_id: 2 } }) }))
vi.mock('@/stores/toast', () => ({ showToast: vi.fn() }))
let wrapper: VueWrapper
const allowed = { enabled: true, completed: false, has_stock_history: false, can_submit: true, items: [] }
beforeEach(() => {
  localStorage.clear()
  vi.spyOn(teamMaterialApi, 'purposes').mockResolvedValue([{ id: 1, team_id: 2, name: '检验', active: true, version: 1 }])
  vi.spyOn(teamMaterialApi, 'openingState').mockResolvedValue(allowed)
  vi.spyOn(teamMaterialApi, 'savePurpose').mockResolvedValue({ id: 1, team_id: 2, name: '去毛刺', active: true, version: 2 })
  vi.spyOn(teamMaterialApi, 'createOpening').mockResolvedValue([])
  vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as Awaited<ReturnType<typeof ElMessageBox.confirm>>)
})
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks(); localStorage.clear() })
async function render(initialTab = 'opening') {
  wrapper = mount(TeamBusinessDialog, { props: { modelValue: true, teamId: 2, initialTab }, global: { stubs: { ElDialog: { template: '<div><slot /><slot name="footer" /></div>' } } } })
  await flushPromises()
}
async function click(text: string) { await wrapper.findAll('button').find(button => button.text() === text)!.trigger('click'); await flushPromises() }

describe('team business settings', () => {
  it('preserves every batch while paging and returns to an invalid hidden batch on submit', async () => {
    await render()
    await wrapper.get('input[aria-label="第1行流水号"]').setValue('000017')
    await click('增加物料')
    expect(wrapper.get('nav[aria-label="表单分页"]').text()).toContain('4 / 6')
    await wrapper.get('input[aria-label="第2行流水号"]').setValue('000018')
    await click('上一页'); await click('上一页'); await click('上一页')
    expect(wrapper.get('input[aria-label="第1行流水号"]').element).toHaveProperty('value', '000017')
    await click('下一页'); await click('下一页'); await click('下一页')
    expect(wrapper.get('input[aria-label="第2行流水号"]').element).toHaveProperty('value', '000018')
    await click('确认初始库存登记')
    expect(wrapper.get('nav[aria-label="表单分页"]').text()).toContain('1 / 6')
    expect(teamMaterialApi.createOpening).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('请输入材质')
    expect(wrapper.text()).toContain('第 1 页 · 物料 1 · 物料资料')
    await click('下一页'); await click('前往补填')
    expect(wrapper.get('nav[aria-label="表单分页"]').text()).toContain('1 / 6')
  })
  it('opens business-only settings without reading or exposing opening stock', async () => {
    wrapper = mount(TeamBusinessDialog, { props: { modelValue: true, teamId: 2, businessOnly: true, initialTab: 'opening' }, global: { stubs: { ElDialog: { template: '<div><slot /><slot name="footer" /></div>' } } } })
    await flushPromises()
    expect(teamMaterialApi.purposes).toHaveBeenCalledWith(2)
    expect(teamMaterialApi.openingState).not.toHaveBeenCalled()
    expect(wrapper.find('[aria-label="业务名称 1"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('初始库存')
    await wrapper.get('input[aria-label="业务名称 1"]').setValue('新业务')
    await click('保存')
    expect(teamMaterialApi.savePurpose).toHaveBeenCalledWith(2, { name: '新业务', active: true, expected_version: 1 }, 1)
  })
  it('posts measured sludge opening stock in effective kg', async () => {
    await render()
    await wrapper.get('input[aria-label="第1行流水号"]').setValue('000012')
    await wrapper.get('input[aria-label="第1行材质"]').setValue('铜钼')
    wrapper.findAllComponents(ElSelect).find(item => item.find('input[aria-label="第1行物料类型"]').exists())!.vm.$emit('update:modelValue', 'sludge'); await flushPromises()
    const inputs = wrapper.findAllComponents(ElInputNumber)
    ;[0, 10, 30].forEach((value, i) => inputs[i]!.vm.$emit('update:modelValue', value))
    await flushPromises(); await click('确认初始库存登记')
    expect(teamMaterialApi.createOpening).toHaveBeenCalledWith(2, [expect.objectContaining({ quantity: 0, weight: 3, sludge_gross_weight: 10, sludge_content_percent: 30 })], expect.any(String))
  })
  it('rejects a blank existing name without taking the separate new-business draft', async () => {
    await render('purposes')
    await wrapper.get('input[aria-label="新增业务名称"]').setValue('去毛刺')
    await wrapper.get('input[aria-label="业务名称 1"]').setValue('')
    await click('保存')
    expect(wrapper.text()).toContain('请输入业务名称')
    expect(teamMaterialApi.savePurpose).not.toHaveBeenCalled()
  })
  it('keeps a business edit after a failed save and submits disable with its version', async () => {
    await render('purposes')
    await wrapper.get('input[aria-label="业务名称 1"]').setValue('去毛刺')
    wrapper.getComponent(ElSwitch).vm.$emit('update:modelValue', false)
    vi.mocked(teamMaterialApi.savePurpose).mockRejectedValueOnce(new Error('业务配置已变化，请刷新后重试'))
    await click('保存')
    expect(teamMaterialApi.savePurpose).toHaveBeenCalledWith(2, { name: '去毛刺', active: false, expected_version: 1 }, 1)
    expect(wrapper.emitted('changed')).toBeUndefined()
    expect((wrapper.get('input[aria-label="业务名称 1"]').element as HTMLInputElement).value).toBe('去毛刺')
    expect(wrapper.getComponent(ElSwitch).props('modelValue')).toBe(false)
    expect(wrapper.text()).toContain('业务配置已变化')
  })
  it('does not offer posting without administrator authorization', async () => {
    vi.mocked(teamMaterialApi.openingState).mockResolvedValue({ ...allowed, enabled: false, can_submit: false })
    await render(); expect(wrapper.text()).toContain('请系统管理员')
    expect(wrapper.text()).not.toContain('确认初始库存登记')
    expect(teamMaterialApi.createOpening).not.toHaveBeenCalled()
  })
  it('closes after success and allows repeated identical entries after reopening with distinct keys', async () => {
    vi.mocked(teamMaterialApi.openingState).mockResolvedValue({ ...allowed, completed: true, has_stock_history: true })
    await render()
    for (let i = 0; i < 2; i++) {
      if (i) { await wrapper.setProps({ modelValue: false }); await wrapper.setProps({ modelValue: true }); await flushPromises() }
      await wrapper.get('input[aria-label="第1行流水号"]').setValue('000012')
      await wrapper.get('input[aria-label="第1行材质"]').setValue('材料1')
      wrapper.findAllComponents(ElSelect).find(item => item.find('input[aria-label="第1行物料类型"]').exists())!.vm.$emit('update:modelValue', 'semi_finished')
      wrapper.findAllComponents(ElInputNumber)[0]!.vm.$emit('update:modelValue', 100)
      wrapper.findAllComponents(ElInputNumber)[1]!.vm.$emit('update:modelValue', 10)
      await flushPromises(); await click('确认初始库存登记')
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
    wrapper.findAllComponents(ElSelect).find(item => item.find('input[aria-label="第1行物料类型"]').exists())!.vm.$emit('update:modelValue', 'semi_finished')
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
    expect(calls[0]![1][0]).toMatchObject({ serial_no: '000012', quantity: 100, weight: 10.125, material_type: 'semi_finished', purpose_id: null })
    expect(calls[0]![2]).toBe(calls[1]![2])
    expect(wrapper.emitted('stocked')).toHaveLength(1)
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
    expect(localStorage.getItem('heatsink.opening-draft.v1:41:2')).toBeNull()
  })
  it('validates empty stock and restores only this account/team draft', async () => {
    localStorage.setItem('heatsink.opening-draft.v1:41:3', JSON.stringify([{ serial_no: 'FOREIGN', material_name: '铜' }]))
    await render(); await click('确认初始库存登记')
    expect(wrapper.text()).toContain('请输入流水号')
    expect(teamMaterialApi.createOpening).not.toHaveBeenCalled()
    expect(wrapper.text()).not.toContain('FOREIGN')
  })
  it('uses versioned own-team purpose saves without production registration', async () => {
    await render('purposes')
    await wrapper.get('input[aria-label="业务名称 1"]').setValue('去毛刺')
    await click('保存')
    expect(teamMaterialApi.savePurpose).toHaveBeenCalledWith(2, { name: '去毛刺', active: true, expected_version: 1 }, 1)
    await wrapper.get('input[aria-label="新增业务名称"]').setValue('发货')
    await click('新增业务')
    expect(teamMaterialApi.savePurpose).toHaveBeenLastCalledWith(2, { name: '发货', active: true }, undefined)
  })
})
