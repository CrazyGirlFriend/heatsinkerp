// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { reactive } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TableExportButton from './TableExportButton.vue'
import TableExportDialog from './TableExportDialog.vue'

const state = vi.hoisted(() => ({ auth: {} as Record<string, unknown> }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => state.auth }))
let wrapper: VueWrapper
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
})
describe('shared export entry', () => {
  it('captures the applied source on click, and cancels it on filter or account changes', async () => {
    state.auth = reactive({
      currentUser: { id: 1, team_id: 2, role: 'TEAM', active: true },
      currentUserError: '',
    })
    const source = {
      title: '库存',
      total: 105,
      fields: [{ key: 'serial', label: '流水号' }],
      load: vi.fn(),
    }
    const makeSource = vi.fn(() => source)
    const root = document.createElement('section')
    wrapper = mount(TableExportButton, {
      props: { source: makeSource, context: 'APPLIED', appendTo: root },
      global: { stubs: { TableExportDialog: true } },
    })
    expect(makeSource).not.toHaveBeenCalled()
    await wrapper.get('button').trigger('click')
    expect(wrapper.getComponent(TableExportDialog).props()).toMatchObject({
      source,
      appendTo: root,
    })
    await wrapper.setProps({ context: 'OTHER' })
    expect(wrapper.getComponent(TableExportDialog).props('source')).toBeNull()
    await wrapper.get('button').trigger('click')
    ;(state.auth.currentUser as { team_id: number }).team_id = 3
    await flushPromises()
    expect(wrapper.getComponent(TableExportDialog).props('source')).toBeNull()
    await wrapper.setProps({ disabled: true })
    await wrapper.get('button').trigger('click')
    expect(makeSource).toHaveBeenCalledTimes(2)
  })
})
