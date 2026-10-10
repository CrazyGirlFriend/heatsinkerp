// @vitest-environment jsdom
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { ElInputNumber } from 'element-plus'
import { afterEach, describe, expect, it, vi } from 'vitest'
import MaterialDeliveryDialog from './MaterialDeliveryDialog.vue'
import {
  MaterialTransferApiError,
  materialTransferApi,
  normalizeMaterialTransfer,
} from '@/services/materialTransferApi'
let wrapper: VueWrapper
const fixture = (version = 4) =>
  normalizeMaterialTransfer({
    id: 1,
    batch_no: 'TL20260927000001',
    serial_no: 'A',
    status: 'received',
    locked: true,
    version,
    can_edit_delivery: true,
    delivery_date: '2026-10-01',
    delivery_quantity: 80,
    quantity: 100,
    weight: 10,
  })
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
})
function render() {
  wrapper = mount(MaterialDeliveryDialog, {
    props: { modelValue: true, transfer: fixture() },
    global: { stubs: { ElDialog: { template: '<div><slot/><slot name="footer"/></div>' } } },
  })
}
describe('batch document delivery maintenance', () => {
  it('changes only requirement fields, suppresses double submission and emits the new document', async () => {
    let resolve!: (value: ReturnType<typeof fixture>) => void
    const update = vi.spyOn(materialTransferApi, 'updateDelivery').mockReturnValue(
      new Promise((done) => {
        resolve = done
      }),
    )
    render()
    await wrapper.get('input[aria-label="要求发货日期"]').setValue('2026-10-03')
    wrapper.getComponent(ElInputNumber).vm.$emit('update:modelValue', 90)
    await wrapper.get('form').trigger('submit')
    await wrapper.get('form').trigger('submit')
    expect(update).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith('TL20260927000001', {
      delivery_date: '2026-10-03',
      delivery_quantity: 90,
      expected_version: 4,
    })
    resolve(fixture(5))
    await flushPromises()
    expect(wrapper.emitted('saved')).toEqual([[fixture(5)]])
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
  })
  it('marks an incomplete requirement in place without a validation banner', async () => {
    const update = vi.spyOn(materialTransferApi, 'updateDelivery')
    render()
    await wrapper.get('input[aria-label="要求发货日期"]').setValue('')
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(wrapper.get('[data-validation-field="deliveryDate"]').classes()).toContain('is-error')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(update).not.toHaveBeenCalled()
    await wrapper.get('input[aria-label="要求发货日期"]').setValue('2026-10-05')
    expect(wrapper.get('[data-validation-field="deliveryDate"]').classes()).not.toContain('is-error')
  })
  it('requires review of current fields after a version conflict', async () => {
    vi.spyOn(materialTransferApi, 'updateDelivery').mockRejectedValue(
      new MaterialTransferApiError('冲突', 409),
    )
    vi.spyOn(materialTransferApi, 'get').mockResolvedValue({
      ...fixture(5),
      delivery_date: '2026-10-05',
    })
    render()
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('已载入最新交期')
    expect(
      (wrapper.get('input[aria-label="要求发货日期"]').element as HTMLInputElement).value,
    ).toBe('2026-10-05')
    expect(materialTransferApi.updateDelivery).toHaveBeenCalledTimes(1)
  })
})
