// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { httpRequest, HttpRequestError } from '@/services/httpClient'
import SerialUrgencyDialog from './SerialUrgencyDialog.vue'
const state = vi.hoisted(() => ({ auth: { isAdmin: true, currentUser: { active: true }, currentUserError: '' } }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => state.auth }))
vi.mock('@/services/httpClient', async importOriginal => ({ ...await importOriginal<object>(), httpRequest: vi.fn() }))
let wrapper: VueWrapper
const ordinary = { urgent: false, version: 0, reason: null, updated_by: null, updated_at: null }
beforeEach(() => { state.auth = reactive({ isAdmin: true, currentUser: { active: true }, currentUserError: '' }); vi.mocked(httpRequest).mockResolvedValue(ordinary) })
afterEach(() => { wrapper?.unmount(); vi.resetAllMocks() })
async function render() {
  wrapper = mount(SerialUrgencyDialog, { props: { modelValue: true, serialNo: 'SERIAL/001' }, global: { stubs: { ElDialog: { template: '<div><slot/><slot name="footer"/></div>' } } } }); await flushPromises()
}
async function save(label = '确认加急') { await wrapper.findAll('button').find(b => b.text() === label)!.trigger('click'); await flushPromises() }
describe('administrator serial urgency', () => {
  it('loads the latest version, submits the reason and signals linked lists to refresh', async () => {
    await render(); expect(httpRequest).toHaveBeenCalledWith('/serial-urgency?serial_no=SERIAL%2F001')
    await wrapper.get('textarea').setValue('  交期提前  '); await save()
    expect(httpRequest).toHaveBeenLastCalledWith('/serial-urgency', { method: 'PUT', body: { serial_no: 'SERIAL/001', urgent: true, reason: '交期提前', expected_version: 0 } })
    expect(wrapper.emitted('changed')).toHaveLength(1)
  })
  it('allows cancellation without altering stock document fields', async () => {
    vi.mocked(httpRequest).mockResolvedValue({ ...ordinary, urgent: true, version: 3 })
    await render(); await save('确认取消加急')
    expect(httpRequest).toHaveBeenLastCalledWith('/serial-urgency', { method: 'PUT', body: { serial_no: 'SERIAL/001', urgent: false, reason: null, expected_version: 3 } })
  })
  it('does not allow a team account to submit even when a dialog is directly mounted', async () => {
    state.auth.isAdmin = false; await render(); await save()
    expect(httpRequest).toHaveBeenCalledTimes(1)
    expect(wrapper.emitted('changed')).toBeUndefined()
  })
  it('reloads after a version conflict and requires another deliberate confirmation', async () => {
    await render()
    vi.mocked(httpRequest).mockRejectedValueOnce(new HttpRequestError('conflict', 409)).mockResolvedValueOnce({ ...ordinary, urgent: true, version: 2 })
    await save()
    expect(wrapper.text()).toContain('已被其他管理员更新')
    expect(wrapper.emitted('changed')).toBeUndefined()
    expect(wrapper.findAll('button').find(b => b.text() === '确认取消加急')?.attributes('disabled')).toBeUndefined()
  })
})
