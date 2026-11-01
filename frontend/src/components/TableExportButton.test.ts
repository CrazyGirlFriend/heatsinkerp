// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { h, reactive, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TableExportButton from './TableExportButton.vue'
import TableExportDialog from './TableExportDialog.vue'
import TeamWorkspaceShell from './TeamWorkspaceShell.vue'
import WorkspaceDataToolbar from './WorkspaceDataToolbar.vue'

const state = vi.hoisted(() => ({ auth: {} as Record<string, unknown> }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => state.auth }))
let wrapper: VueWrapper
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
})
describe('shared export entry', () => {
  it('keeps detail exports local instead of replacing the workbench header action', async () => {
    state.auth = reactive({ currentUser: { id: 1, active: true } })
    const source = { title: '批次详情', total: 1, fields: [], load: vi.fn() }
    wrapper = mount(TeamWorkspaceShell, {
      props: { title: '轧制', modelValue: 'processing' },
      global: { stubs: { TableExportDialog: true, PageBackButton: true } },
      slots: { default: () => h(TableExportButton, { source: () => source }) },
    })
    expect(wrapper.find('.team-workspace__navigation-bar .team-workspace__export').exists()).toBe(
      false,
    )
    await wrapper.get('.team-workspace__content .table-export-button').trigger('click')
    expect(wrapper.getComponent(TableExportDialog).props('source')).toEqual(source)
  })
  it('uses the shared toolbar entry, preserves export variants and removes stale callbacks when changing tabs', async () => {
    state.auth = reactive({ currentUser: { id: 1, active: true } })
    const source = { title: '加工记录', total: 1, fields: [], load: vi.fn() }
    const grouped = { ...source, title: '加工人汇总' }
    const disabled = ref(false),
      visible = ref(true)
    wrapper = mount(TeamWorkspaceShell, {
      props: { title: '轧制', modelValue: 'processing' },
      global: { stubs: { TableExportDialog: true, PageBackButton: true } },
      slots: {
        default: () =>
          visible.value
            ? h(
                WorkspaceDataToolbar,
                {},
                {
                  tools: () =>
                    h(TableExportButton, {
                      source: () => source,
                      variants: () => [grouped],
                      disabled: disabled.value,
                    }),
                },
              )
            : null,
      },
    })
    await flushPromises()
    expect(wrapper.findAll('.table-export-button')).toHaveLength(1)
    await wrapper.get('.workspace-data-toolbar .table-export-button').trigger('click')
    expect(wrapper.getComponent(TableExportDialog).props()).toMatchObject({
      source,
      variants: [grouped],
    })
    disabled.value = true
    await flushPromises()
    expect(wrapper.get('.team-workspace__export').attributes('disabled')).toBeDefined()
    visible.value = false
    await flushPromises()
    expect(wrapper.find('.team-workspace__export').exists()).toBe(false)
  })
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
    expect(wrapper.emitted('visible-change')).toEqual([[true]])
    expect(wrapper.getComponent(TableExportDialog).props()).toMatchObject({
      source,
      appendTo: root,
    })
    await wrapper.setProps({ context: 'OTHER' })
    expect(wrapper.emitted('visible-change')).toEqual([[true], [false]])
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

it('captures alternate export formats and discards them when the context changes', async () => {
  const source = {
    title: '逐笔明细',
    total: 3,
    fields: [{ key: 'id', label: '记录编号' }],
    load: vi.fn(),
  }
  const grouped = {
    title: '按加工人汇总',
    total: 1,
    fields: [{ key: 'person', label: '加工人' }],
    load: vi.fn(),
  }
  const variants = vi.fn(() => [grouped])
  wrapper = mount(TableExportButton, {
    props: { source: () => source, variants, context: 'one' },
    global: { stubs: { TableExportDialog: true } },
  })
  expect(variants).not.toHaveBeenCalled()
  await wrapper.get('button').trigger('click')
  expect(wrapper.getComponent(TableExportDialog).props('variants')).toEqual([grouped])
  await wrapper.setProps({ context: 'two' })
  expect(wrapper.getComponent(TableExportDialog).props('variants')).toEqual([])
})
