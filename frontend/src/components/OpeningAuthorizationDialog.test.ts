// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { ElSwitch } from 'element-plus'
import { afterEach, describe, expect, it, vi } from 'vitest'
import OpeningAuthorizationDialog from './OpeningAuthorizationDialog.vue'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import { normalizeTeam } from '@/services/adminApi'
let wrapper: VueWrapper
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks() })
async function render(has_stock_history = false) {
  vi.spyOn(teamMaterialApi, 'openingState').mockResolvedValue({ enabled: false, completed: false, has_stock_history, can_submit: false, items: [] })
  vi.spyOn(teamMaterialApi, 'authorizeOpening').mockResolvedValue({ enabled: true })
  wrapper = mount(OpeningAuthorizationDialog, { props: { modelValue: true, team: normalizeTeam({ id: 3, name: '退火', active: true }) }, global: { stubs: { ElDialog: { template: '<div><slot/><slot name="footer"/></div>' } } } })
  await flushPromises()
}
describe('administrator opening-stock authorization', () => {
  it('saves only the authorization flag and never stock amounts', async () => {
    await render()
    wrapper.getComponent(ElSwitch).vm.$emit('update:modelValue', true)
    await wrapper.findAll('button').find(button => button.text() === '保存授权')!.trigger('click'); await flushPromises()
    expect(teamMaterialApi.authorizeOpening).toHaveBeenCalledWith(3, true)
    expect(wrapper.emitted('saved')).toHaveLength(1)
  })
  it('prevents enabling initialization for a team with posted history', async () => {
    await render(true)
    expect(wrapper.getComponent(ElSwitch).props('disabled')).toBe(true)
    expect(wrapper.text()).toContain('已有入账记录')
  })
})
