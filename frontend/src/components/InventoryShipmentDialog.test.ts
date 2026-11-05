// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { ElInputNumber, ElSelect } from 'element-plus'
import InventoryShipmentDialog from './InventoryShipmentDialog.vue'
import TeamEmployeeInput from './TeamEmployeeInput.vue'
import WeightInput from './WeightInput.vue'
import AppDisclosure from './AppDisclosure.vue'
import { teamMaterialApi, TeamMaterialApiError } from '@/services/teamMaterialApi'

vi.mock('@/services/materialInputApi', () => ({
  materialSuggestions: vi.fn().mockResolvedValue([]),
}))
afterEach(() => vi.restoreAllMocks())
const available = {
  revision: 'a'.repeat(64),
  quantity: 30,
  weight: 7,
  items: [
    { id: 1, batch_no: 'A', quantity: 10, weight: 2 },
    { id: 2, batch_no: 'B', quantity: 20, weight: 5 },
  ],
}
let wrapper: ReturnType<typeof mount> | undefined
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
})
async function render() {
  const load = vi
    .spyOn(teamMaterialApi, 'shipmentStock')
    .mockResolvedValue(structuredClone(available))
  vi.spyOn(teamMaterialApi, 'employees').mockResolvedValue([])
  const save = vi.spyOn(teamMaterialApi, 'createDispatch').mockResolvedValue({ items: [] })
  wrapper = mount(InventoryShipmentDialog, {
    props: { teamId: 3, groupId: 1, serialNo: '001' },
    global: {
      stubs: {
        ElDialog: { template: '<section><slot/><slot name="footer"/></section>' },
        WorkspaceTable: true,
      },
    },
  })
  await flushPromises()
  return { load, save }
}
async function fill(quantity = 15, weight = 3) {
  wrapper!.getComponent(TeamEmployeeInput).vm.$emit('update:modelValue', { id: 2, name: '李工' })
  wrapper!
    .findAllComponents(ElSelect)
    .find((select) => select.find('input[aria-label="发货去向"]').exists())!
    .vm.$emit('update:modelValue', '对外转料')
  wrapper!.findAllComponents(ElInputNumber)[0]!.vm.$emit('update:modelValue', quantity)
  wrapper!.getComponent(WeightInput).vm.$emit('update:modelValue', weight)
  await flushPromises()
}
async function click(label: string) {
  await wrapper!
    .findAll('button')
    .find((button) => button.text().includes(label))!
    .trigger('click')
  await flushPromises()
}
describe('inventory total shipment', () => {
  it('uses the shared disclosure and shows FIFO allocation without extra inputs', async () => {
    await render()
    await fill()
    const disclosure = wrapper!.getComponent(AppDisclosure)
    expect(disclosure.get('button').attributes('aria-expanded')).toBe('false')
    await disclosure.get('button').trigger('click')
    expect(disclosure.get('button').attributes('aria-expanded')).toBe('true')
    expect(wrapper!.getComponent({ name: 'WorkspaceTable' }).props('data')).toEqual([
      { id: 1, batch_no: 'A', quantity: 10, weight: 2 },
      { id: 2, batch_no: 'B', quantity: 5, weight: 1 },
    ])
  })
  it.each([
    [31, 3],
    [15, 8],
  ])('blocks totals above available inventory (%s pieces, %s kg)', async (quantity, weight) => {
    const { save } = await render()
    await fill(quantity, weight)
    await click('确认发货')
    expect(save).not.toHaveBeenCalled()
    expect(wrapper!.text()).toContain('发货量超过可发库存')
    expect(wrapper!.emitted('close')).toBeUndefined()
  })
  it('requires positive totals and the sending person and destination', async () => {
    const { save } = await render()
    await click('确认发货')
    expect(wrapper!.text()).toContain('请选择发货人和去向')
    await fill(0, 0)
    await click('确认发货')
    expect(wrapper!.text()).toContain('请填写有效发货件数或重量')
    expect(save).not.toHaveBeenCalled()
  })
  it('disables shipment when refresh fails and recovers after retry', async () => {
    const { load, save } = await render()
    await fill()
    load.mockRejectedValueOnce(new Error('库存加载失败'))
    await click('刷新库存')
    expect(wrapper!.text()).toContain('库存加载失败')
    await click('确认发货')
    expect(save).not.toHaveBeenCalled()
    await click('刷新库存')
    await click('确认发货')
    expect(save).toHaveBeenCalledTimes(1)
  })
  it('retries a lost response with the same body and key and forbids refresh or edits', async () => {
    const { load, save } = await render()
    await fill()
    save.mockRejectedValueOnce(new Error('网络连接中断'))
    await click('确认发货')
    const original = structuredClone(save.mock.calls[0]![1])
    expect(wrapper!.emitted('close')).toBeUndefined()
    await click('刷新库存')
    expect(load).toHaveBeenCalledTimes(1)
    await fill(16, 3)
    await click('确认发货')
    expect(save).toHaveBeenCalledTimes(1)
    expect(wrapper!.text()).toContain('请先重试原提交')
    await fill()
    await click('确认发货')
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1]![1]).toEqual(original)
    expect(wrapper!.emitted('saved')).toHaveLength(1)
  })
  it('refreshes a stock conflict with a new revision and request key before retrying', async () => {
    const { load, save } = await render()
    await fill()
    save.mockRejectedValueOnce(new TeamMaterialApiError('库存已变化', 409))
    await click('确认发货')
    const originalKey = save.mock.calls[0]![1].idempotency_key
    expect(wrapper!.text()).toContain('库存已变化')
    load.mockResolvedValueOnce({ ...available, revision: 'b'.repeat(64) })
    await click('刷新库存')
    await click('确认发货')
    expect(save.mock.calls[1]![1].idempotency_key).not.toBe(originalKey)
    expect(save.mock.calls[1]![1].inventory_total?.revision).toBe('b'.repeat(64))
  })
  it('blocks duplicate clicks and closing while a shipment request is running', async () => {
    const { save } = await render()
    await fill()
    let finish!: (value: { items: [] }) => void
    save.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    await click('确认发货')
    await click('确认发货')
    await click('取消')
    expect(save).toHaveBeenCalledTimes(1)
    expect(wrapper!.emitted('close')).toBeUndefined()
    finish({ items: [] })
    await flushPromises()
    expect(wrapper!.emitted('close')).toHaveLength(1)
  })
  it('submits one total and closes after success without asking for per-batch input', async () => {
    vi.spyOn(teamMaterialApi, 'shipmentStock').mockResolvedValue({
      revision: 'a'.repeat(64),
      quantity: 30,
      weight: 7,
      items: [
        { id: 1, batch_no: 'A', quantity: 10, weight: 2 },
        { id: 2, batch_no: 'B', quantity: 20, weight: 5 },
      ],
    })
    vi.spyOn(teamMaterialApi, 'employees').mockResolvedValue([])
    const save = vi.spyOn(teamMaterialApi, 'createDispatch').mockResolvedValue({ items: [] })
    const wrapper = mount(InventoryShipmentDialog, {
      props: { teamId: 3, groupId: 1, serialNo: '001' },
      global: {
        stubs: {
          ElDialog: { template: '<section><slot/><slot name="footer"/></section>' },
          WorkspaceTable: true,
        },
      },
    })
    try {
      await flushPromises()
      wrapper.getComponent(TeamEmployeeInput).vm.$emit('update:modelValue', { id: 2, name: '李工' })
      wrapper
        .findAllComponents(ElSelect)
        .find((select) => select.find('input[aria-label="发货去向"]').exists())!
        .vm.$emit('update:modelValue', '对外转料')
      wrapper.findAllComponents(ElInputNumber)[0]!.vm.$emit('update:modelValue', 15)
      wrapper.getComponent(WeightInput).vm.$emit('update:modelValue', 3)
      await flushPromises()
      await wrapper
        .findAll('button')
        .find((button) => button.text().includes('确认发货'))!
        .trigger('click')
      await flushPromises()
      expect(save).toHaveBeenCalledWith(
        3,
        expect.objectContaining({
          lines: [],
          inventory_total: {
            group_id: 1,
            revision: 'a'.repeat(64),
            quantity: 15,
            weight: 3,
          },
        }),
      )
      expect(wrapper.emitted('saved')).toHaveLength(1)
      expect(wrapper.emitted('close')).toHaveLength(1)
    } finally {
      wrapper.unmount()
    }
  })
})
