// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import MaterialDispatchDrawer from './MaterialDispatchDrawer.vue'
import MaterialBatchPrintDialog from './MaterialBatchPrintDialog.vue'
import { materialDispatchApi } from '@/services/materialDispatchApi'
import { dispatchFixture } from '@/testFixtures/materialDispatch'
import type { MaterialDispatchDocument } from '@/types/teamMaterials'
import type { TeamEmployee } from '@/types/teamBusiness'
vi.mock('@/stores/auth', async () => {
  const { computed, reactive } = await import('vue')
  const auth = reactive({
    currentUser: { id: 1, team_id: 1, active: true },
    isAuthenticated: computed(() => true),
  })
  return { useAuthStore: () => auth }
})
vi.mock('@/composables/useLiveRefresh', async () => {
  const { ref } = await import('vue')
  return { useLiveRefresh: () => ({ message: ref(''), request: vi.fn() }) }
})
let wrapper: VueWrapper
beforeEach(() => {
  vi.spyOn(materialDispatchApi, 'get').mockResolvedValue(dispatchFixture())
  vi.spyOn(materialDispatchApi, 'confirm')
})
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
})
async function render(
  props: {
    allowPrint?: boolean
    receiptOnly?: boolean
    receiptReceiver?: TeamEmployee | null
  } = {},
) {
  wrapper = mount(MaterialDispatchDrawer, {
    props: { modelValue: true, dispatchNo: 'CK-GROUP', ...props },
    global: {
      stubs: {
        MaterialTransferDetailFrame: {
          template: '<div><slot name="header"/><slot/><slot name="footer"/></div>',
        },
        MaterialTransferDrawer: {
          name: 'MaterialTransferDrawer',
          props: [
            'modelValue',
            'batchNo',
            'showHistoryGroup',
            'allowPrint',
            'receiptOnly',
            'receiptReceiver',
          ],
          template: '<div />',
        },
        MaterialBatchPrintDialog: true,
      },
    },
  })
  await flushPromises()
}
it('keeps legacy lookup but shows each batch and never offers whole-group confirmation', async () => {
  await render()
  expect(materialDispatchApi.get).toHaveBeenCalledWith('CK-GROUP')
  expect(wrapper.findAll('tbody tr')).toHaveLength(2)
  expect(wrapper.findAll('thead th').map((cell) => cell.text())).toEqual([
    '批次号',
    '流水号',
    '材质',
    '物料类型',
    '件数',
    '重量 (kg)',
    '状态',
    '操作',
  ])
  expect(wrapper.get('tbody tr').findAll('td')).toHaveLength(8)
  expect(wrapper.find('tbody small').exists()).toBe(false)
  expect(wrapper.text()).toContain('TL-GROUP-1')
  expect(wrapper.text()).toContain('TL-GROUP-2')
  expect(wrapper.text()).not.toContain('确认整批')
  await wrapper.get('button[aria-label="查看批次 TL-GROUP-2"]').trigger('click')
  await flushPromises()
  expect(wrapper.findComponent({ name: 'MaterialTransferDrawer' }).props()).toMatchObject({
    modelValue: true,
    batchNo: 'TL-GROUP-2',
    showHistoryGroup: false,
    receiptOnly: false,
  })
  expect(materialDispatchApi.confirm).not.toHaveBeenCalled()
})
it('co-prints actual batches without restoring a group barcode', async () => {
  await render()
  await wrapper
    .findAll('button')
    .find((b) => b.text() === '合并打印')!
    .trigger('click')
  expect(wrapper.getComponent(MaterialBatchPrintDialog).props()).toMatchObject({
    modelValue: true,
    items: dispatchFixture().items,
  })
})
it('keeps nested batches in receipt-only mode without printing when opened from incoming receipts', async () => {
  const person = { id: 31, team_id: 3, name: '李师傅', active: true, version: 1 }
  await render({ allowPrint: false, receiptOnly: true, receiptReceiver: person })
  expect(wrapper.findAll('button').some((button) => button.text().includes('打印'))).toBe(false)
  expect(wrapper.findComponent(MaterialBatchPrintDialog).exists()).toBe(false)
  await wrapper.get('button[aria-label="查看批次 TL-GROUP-2"]').trigger('click')
  await flushPromises()
  expect(wrapper.getComponent({ name: 'MaterialTransferDrawer' }).props()).toMatchObject({
    modelValue: true,
    batchNo: 'TL-GROUP-2',
    allowPrint: false,
    receiptOnly: true,
    receiptReceiver: person,
  })
})
it('ignores an old lookup after changing the historical identifier', async () => {
  let finish!: (value: MaterialDispatchDocument) => void
  vi.mocked(materialDispatchApi.get).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  await render()
  await wrapper.setProps({ dispatchNo: 'CK-OTHER' })
  await flushPromises()
  finish(dispatchFixture(25))
  await flushPromises()
  expect(wrapper.findAll('tbody tr')).toHaveLength(2)
})
it('blocks printing if the historical lookup fails', async () => {
  vi.mocked(materialDispatchApi.get).mockRejectedValue(new Error('历史记录读取失败'))
  await render()
  expect(wrapper.text()).toContain('历史记录读取失败')
  expect(
    wrapper
      .findAll('button')
      .find((b) => b.text() === '合并打印')!
      .attributes('disabled'),
  ).toBeDefined()
})
