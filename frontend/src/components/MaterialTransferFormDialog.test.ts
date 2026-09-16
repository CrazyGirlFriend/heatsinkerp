// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { ElInputNumber, ElSelect } from 'element-plus'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MaterialTransferFormDialog from './MaterialTransferFormDialog.vue'
import { MaterialTransferApiError, materialTransferApi, normalizeMaterialTransfer } from '@/services/materialTransferApi'
import { materialDocumentTextFields, materialTypeOptions, type MaterialTransfer } from '@/types/materialTransfer'

vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ isTeamAccount: true, currentUser: { team_id: 2, team: { id: 2, name: '研磨' } } }) }))
vi.mock('@/stores/teamDirectory', () => ({ useTeamDirectoryStore: () => ({ items: [{ id: 2, name: '研磨', active: true }, { id: 3, name: '电镀', active: true }, { id: 1, name: '中央收发站', kind: 'warehouse', active: true }], loading: false, refreshTeamDirectory: vi.fn() }) }))
vi.mock('@/stores/toast', () => ({ showToast: vi.fn() }))

function fixture(overrides: Partial<MaterialTransfer> = {}): MaterialTransfer {
  return normalizeMaterialTransfer({ id: 1, batch_no: 'TL20260906000001', serial_no: 'HS-001', source_team: { id: 2, name: '研磨' }, next_team: { id: 3, name: '电镀' }, quantity: 120, weight: 24.5, material_type: 'finished', finished_quantity: 132, status: 'pending', locked: false, allowed_actions: ['edit', 'void'], version: 6, ...overrides })
}
let wrapper: VueWrapper
beforeEach(() => {
  vi.spyOn(materialTransferApi, 'create').mockResolvedValue(fixture())
  vi.spyOn(materialTransferApi, 'update').mockResolvedValue(fixture({ version: 7 }))
  vi.spyOn(materialTransferApi, 'get').mockResolvedValue(fixture({ version: 7 }))
})
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks() })
async function render(transfer: MaterialTransfer | null = null) {
  wrapper = mount(MaterialTransferFormDialog, { props: { modelValue: true, transfer }, global: { stubs: { ElDialog: { template: '<div><slot name="header"/><slot/><slot name="footer"/></div>' } } } })
  await flushPromises()
}
async function number(label: string, value: number | undefined) {
  const field = wrapper.findAllComponents(ElInputNumber).find(item => item.find(`input[aria-label="${label}"]`).exists())!
  expect(field, label).toBeTruthy()
  field.vm.$emit('update:modelValue', value)
  await flushPromises()
}
async function base(type: string | null = 'finished') {
  const selects = wrapper.findAllComponents(ElSelect)
  if (type !== null) selects[0]!.vm.$emit('update:modelValue', type)
  selects[1]!.vm.$emit('update:modelValue', 3)
  await wrapper.get('input[aria-label="流水号"]').setValue('HS-NEW')
  await number('转料件数', 0)
  await number('转料重量', 8.25)
}
async function submit() { await wrapper.get('form').trigger('submit'); await flushPromises() }

describe('material transfer document form', () => {
  it('keeps linked source identity and group destination fixed while allowing amount and notes changes', async () => {
    await render(fixture({ source_transfer_id: 12, source_transfer_batch_no: 'TL-SOURCE', dispatch_no: 'CK-GROUP', material_name: '铜钼' }))
    expect(wrapper.get('input[aria-label="流水号"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('input[aria-label="材质"]').attributes('disabled')).toBeDefined()
    expect(wrapper.findAllComponents(ElSelect)[1]!.props('disabled')).toBe(true)
    await number('转料件数', 12)
    await wrapper.get('textarea[aria-label="备注"]').setValue('补充交接说明')
    await submit()
    const payload = vi.mocked(materialTransferApi.update).mock.calls[0]![1]
    expect(payload).toMatchObject({ quantity: 12, notes: '补充交接说明', expected_version: 6 })
    expect(payload.serial_no).toBeUndefined(); expect(payload.material_name).toBeUndefined(); expect(payload.next_team_id).toBeUndefined()
  })

  it('uses warehouse kind for an optional inbound explanation and requires an explicit type on warehouse edits', async () => {
    await render(fixture({ material_type: null }))
    wrapper.findAllComponents(ElSelect)[1]!.vm.$emit('update:modelValue', 1)
    await flushPromises()
    expect(wrapper.get('textarea[aria-label="入库说明"]').attributes('placeholder')).toContain('转回库房')
    await submit()
    expect(materialTransferApi.update).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('转入库房前请选择物料类型')
    wrapper.findAllComponents(ElSelect)[0]!.vm.$emit('update:modelValue', 'semi_finished')
    await submit()
    expect(materialTransferApi.update).toHaveBeenCalledWith('TL20260906000001', expect.objectContaining({ material_type: 'semi_finished', next_team_id: 1, notes: null }))
  })

  it.each(materialTypeOptions)('creates $label with independent weight and quantity', async ({ value }) => {
    await render()
    await base(value)
    await number('成品件数', 0)
    await wrapper.get('input[aria-label="原单批号"]').setValue('RAW-001')
    await wrapper.get('input[aria-label="客户代码"]').setValue('001440')
    await submit()
    expect(materialTransferApi.create).toHaveBeenCalledWith(expect.objectContaining({ material_type: value, quantity: 0, weight: 8.25, finished_quantity: 0, source_batch_no: 'RAW-001', customer_code: '001440' }))
    expect(vi.mocked(materialTransferApi.create).mock.calls[0]![0]).not.toHaveProperty('batch_no')
  })

  it('requires an explicit type and both amounts, with at least one positive', async () => {
    await render()
    expect(wrapper.findAllComponents(ElSelect)[0]!.props('modelValue')).toBe('')
    await base(null); await submit()
    expect(wrapper.get('[role="alert"]').text()).toContain('请选择物料类型')
    wrapper.findAllComponents(ElSelect)[0]!.vm.$emit('update:modelValue', 'sludge')
    await number('转料重量', 0); await submit()
    expect(wrapper.get('[role="alert"]').text()).toContain('至少一项大于 0')
    await number('转料件数', undefined); await number('转料重量', 5); await submit()
    expect(wrapper.get('[role="alert"]').text()).toContain('转料件数')
    expect(materialTransferApi.create).not.toHaveBeenCalled()
  })

  it('refills and explicitly clears all optional document fields without mixing either quantity or batch', async () => {
    const document = Object.fromEntries(materialDocumentTextFields.map(field => [field.key, `旧${field.label}`]))
    await render(fixture({ ...document, finished_quantity: 132 }))
    expect(wrapper.get('input[aria-label="成品件数"]').element).toHaveProperty('value', '132')
    expect(wrapper.get('input[aria-label="转料件数"]').element).toHaveProperty('value', '120')
    for (const field of materialDocumentTextFields) {
      const input = wrapper.get(`${field.multiline ? 'textarea' : 'input'}[aria-label="${field.label}"]`)
      expect(input.element).toHaveProperty('value', `旧${field.label}`)
      await input.setValue('')
    }
    await number('成品件数', undefined); await submit()
    const payload = vi.mocked(materialTransferApi.update).mock.calls[0]![1]
    expect(payload).toMatchObject({ expected_version: 6, quantity: 120, finished_quantity: null })
    materialDocumentTextFields.forEach(field => expect(payload[field.key]).toBeNull())
    expect(payload).not.toHaveProperty('batch_no')
  })

  it('reloads a version conflict and requires another deliberate save of the refreshed record', async () => {
    await render(fixture({ material_name: '旧材质' }))
    const latest = fixture({ version: 8, material_name: '新材质', quantity: 99 })
    vi.mocked(materialTransferApi.update).mockRejectedValueOnce(new MaterialTransferApiError('单据已更新', 409))
    vi.mocked(materialTransferApi.get).mockResolvedValueOnce(latest)
    await submit()
    expect(materialTransferApi.update).toHaveBeenCalledTimes(1)
    expect(wrapper.get('input[aria-label="材质"]').element).toHaveProperty('value', '新材质')
    expect(wrapper.get('[role="alert"]').text()).toContain('已载入最新内容')
    expect(wrapper.emitted('refreshed')?.[0]).toEqual([latest])
    await submit()
    expect(materialTransferApi.update).toHaveBeenLastCalledWith(latest.batch_no, expect.objectContaining({ expected_version: 8, quantity: 99, material_name: '新材质' }))
  })

  it('blocks saving when a conflict cannot be refreshed and permits a read retry', async () => {
    await render(fixture())
    vi.mocked(materialTransferApi.update).mockRejectedValueOnce(new MaterialTransferApiError('单据已更新', 409))
    vi.mocked(materialTransferApi.get).mockRejectedValueOnce(new Error('offline'))
    await submit(); await submit()
    expect(materialTransferApi.update).toHaveBeenCalledTimes(1)
    const retry = wrapper.findAll('button').find(button => button.text() === '重新读取')!
    await retry.trigger('click'); await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('已载入最新内容')
  })

  it('locks received records and leaves missing legacy fields blank', async () => {
    await render(fixture({ status: 'received', locked: true, allowed_actions: [], material_type: null, version: null }))
    expect(wrapper.get('input[aria-label="原单批号"]').element).toHaveProperty('value', '')
    await submit()
    expect(materialTransferApi.update).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('已锁定')
  })
})
