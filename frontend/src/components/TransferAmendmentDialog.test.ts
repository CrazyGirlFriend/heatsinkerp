// @vitest-environment jsdom
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { ElInputNumber } from 'element-plus'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TransferAmendmentDialog from './TransferAmendmentDialog.vue'
import { materialTransferApi, normalizeMaterialTransfer } from '@/services/materialTransferApi'
import { transferAmendmentApi, type TransferAmendment } from '@/services/transferAmendmentApi'
import { HttpRequestError } from '@/services/httpClient'

const transfer = () =>
  normalizeMaterialTransfer({
    id: 1,
    batch_no: 'TL-001',
    serial_no: 'HS-001',
    quantity: 100,
    weight: 10,
    status: 'received',
    version: 4,
    material_type: 'semi_finished',
  })
let wrapper: VueWrapper
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
})
async function render(editable = true, latest = transfer()) {
  vi.spyOn(materialTransferApi, 'get').mockResolvedValue(latest)
  vi.spyOn(transferAmendmentApi, 'list').mockResolvedValue({
    items: [],
    remaining_quantity: 40,
    remaining_weight: 4,
    editable,
  })
  wrapper = mount(TransferAmendmentDialog, {
    props: { modelValue: true, transfer: transfer() },
    global: { stubs: { ElDialog: { template: '<div><slot/><slot name="footer"/></div>' } } },
  })
  await flushPromises()
}
async function updateQuantity(quantity: number) {
  wrapper.findAllComponents(ElInputNumber)[0]!.vm.$emit('update:modelValue', quantity)
  await flushPromises()
}
describe('received transfer amendment request', () => {
  it('loads the latest remaining limit and blocks decreasing consumed quantities', async () => {
    const create = vi.spyOn(transferAmendmentApi, 'create')
    await render()
    expect(wrapper.text()).toContain('40 件 / 4 kg')
    expect(wrapper.text()).toContain('最少 60')
    await updateQuantity(59)
    expect(wrapper.findAllComponents(ElInputNumber)[0]!.props('min')).toBe(60)
    expect(wrapper.findAllComponents(ElInputNumber)[0]!.props('modelValue')).toBe(60)
    expect(create).not.toHaveBeenCalled()
  })
  it('focuses missing reason and never calls the ordinary transfer update API', async () => {
    const create = vi.spyOn(transferAmendmentApi, 'create')
    const update = vi.spyOn(materialTransferApi, 'update')
    await render()
    await updateQuantity(95)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    await vi.waitFor(() => expect(wrapper.text()).toContain('请填写修改原因'))
    expect(create).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })
  it('sends a versioned proposal once and leaves the original document unchanged', async () => {
    let resolve!: (value: TransferAmendment) => void
    const create = vi.spyOn(transferAmendmentApi, 'create').mockReturnValue(
      new Promise((done) => {
        resolve = done
      }),
    )
    await render()
    await updateQuantity(95)
    await wrapper.get('textarea[aria-label="修改原因"]').setValue('  复核件数  ')
    await wrapper.get('form').trigger('submit')
    await wrapper.get('form').trigger('submit')
    expect(create).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledWith('TL-001', {
      expected_version: 4,
      quantity: 95,
      weight: 10,
      notes: null,
      reason: '复核件数',
    })
    expect((wrapper.props() as { transfer: ReturnType<typeof transfer> }).transfer.quantity).toBe(
      100,
    )
    const result = { id: 11, status: 'pending' } as TransferAmendment
    resolve(result)
    await flushPromises()
    expect(wrapper.emitted('submitted')).toEqual([[result]])
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
  })
  it('requires rereading after stock changes and preserves the draft for diagnosis', async () => {
    vi.spyOn(transferAmendmentApi, 'create').mockRejectedValue(
      new HttpRequestError('剩余物料已变化', 409),
    )
    await render()
    await updateQuantity(95)
    await wrapper.get('textarea[aria-label="修改原因"]').setValue('复核件数')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('请重新读取后核对')
    expect(
      wrapper
        .findAll('button')
        .find((button) => button.text() === '发送确认申请')!
        .attributes('disabled'),
    ).toBeDefined()
    expect(wrapper.emitted('submitted')).toBeUndefined()
  })
  it('does not reinitialize the draft when the parent accepts its refreshed snapshot', async () => {
    await render()
    await updateQuantity(95)
    await wrapper.setProps({ transfer: { ...transfer() } })
    await flushPromises()
    expect(materialTransferApi.get).toHaveBeenCalledTimes(1)
    expect(wrapper.findAllComponents(ElInputNumber)[0]!.props('modelValue')).toBe(95)
  })
  it('preserves a six-decimal original weight when only editing notes', async () => {
    const create = vi
      .spyOn(transferAmendmentApi, 'create')
      .mockResolvedValue({ id: 11, status: 'pending' } as TransferAmendment)
    await render(true, { ...transfer(), weight: 10.123456 })
    await wrapper.get('textarea[aria-label="修改后备注"]').setValue('补充包装情况')
    await wrapper.get('textarea[aria-label="修改原因"]').setValue('补记签收时包装情况')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(create).toHaveBeenCalledWith(
      'TL-001',
      expect.objectContaining({ quantity: 100, weight: 10.123456, notes: '补充包装情况' }),
    )
  })
})
