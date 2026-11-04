// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { reactive } from 'vue'
import { ElInputNumber, ElSelect } from 'element-plus'
import WarehouseLocationSelect from './WarehouseLocationSelect.vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WarehouseReceiptDialog from './WarehouseReceiptDialog.vue'
import MaterialInput from './MaterialInput.vue'
import ProcessRouteEditor from './ProcessRouteEditor.vue'
import PublishedProcessRoutePicker from './PublishedProcessRoutePicker.vue'
import WarehouseReceiptDocuments from './WarehouseReceiptDocuments.vue'
import { warehouseReceiptDocumentApi } from '@/services/warehouseReceiptDocumentApi'
import type { ReceiptDocument } from '@/types/warehouseReceiptDocuments'
import { processRouteApi } from '@/services/processRouteApi'
import { routeFixture } from '@/testFixtures/processRoute'
import type { ProcessRoute } from '@/types/processRoute'
import { normalizeMaterialTransfer } from '@/services/materialTransferApi'
import { teamMaterialApi, TeamMaterialApiError } from '@/services/teamMaterialApi'
const state = vi.hoisted(() => ({
  auth: {
    isTeamAccount: true,
    currentUser: { id: 41, team_id: 901, active: true },
    currentUserError: '',
    refreshCurrentUser: vi.fn(),
  },
  directory: {
    items: [{ id: 901, code: 'FACTORY-WAREHOUSE', kind: 'warehouse', name: '库房', active: true }],
    loaded: true,
    error: '',
    refreshTeamDirectory: vi.fn(),
  },
}))
vi.mock('@/services/materialInputApi', () => ({
  materialSuggestions: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => state.auth }))
vi.mock('@/stores/teamDirectory', () => ({ useTeamDirectoryStore: () => state.directory }))
const receipt = () =>
  normalizeMaterialTransfer({
    id: 51,
    batch_no: 'TL-RECEIPT',
    serial_no: 'QA-IN',
    entry_kind: 'warehouse_receipt',
    source_team: null,
    next_team: { id: 901, name: '库房', kind: 'warehouse' },
    status: 'received',
    locked: true,
    stock_tracked: true,
  })
let wrapper: VueWrapper
beforeEach(() => {
  vi.spyOn(teamMaterialApi, 'warehouseLocations').mockResolvedValue({ items: [] })
  vi.spyOn(warehouseReceiptDocumentApi, 'remove').mockResolvedValue(undefined)
  sessionStorage.clear()
  state.auth = reactive({
    isTeamAccount: true,
    currentUser: { id: 41, team_id: 901, active: true },
    currentUserError: '',
    refreshCurrentUser: vi.fn().mockResolvedValue(undefined),
  })
  state.directory = reactive({
    items: [{ id: 901, code: 'FACTORY-WAREHOUSE', kind: 'warehouse', name: '库房', active: true }],
    loaded: true,
    error: '',
    refreshTeamDirectory: vi.fn().mockResolvedValue(undefined),
  })
  vi.spyOn(teamMaterialApi, 'createReceipt').mockResolvedValue(receipt())
  vi.spyOn(processRouteApi, 'detail').mockResolvedValue(importedDocument())
  vi.spyOn(processRouteApi, 'list').mockResolvedValue({
    items: [importedDocument()],
    total: 1,
    page: 1,
    page_size: 20,
    enforced_after: null,
  })
  vi.spyOn(processRouteApi, 'options').mockResolvedValue({ tasks: [], purposes: [] })
})
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
  sessionStorage.clear()
})
async function render() {
  wrapper = mount(WarehouseReceiptDialog, {
    props: { modelValue: true, teamId: 901 },
    global: {
      stubs: {
        ElDialog: { template: '<div><slot name="header"/><slot/><slot name="footer"/></div>' },
        ProcessRouteEditor: true,
        WarehouseReceiptDocuments: true,
      },
    },
  })
  await flushPromises()
}
async function amount(label: string, value: number) {
  wrapper
    .findAllComponents(ElInputNumber)
    .find((item) => item.find(`input[aria-label="${label}"]`).exists())!
    .vm.$emit('update:modelValue', value)
  await flushPromises()
}
async function fill() {
  await wrapper.get('input[aria-label="外部来源单位"]').setValue(' 来料单位 ')
  await wrapper.get('input[aria-label="流水号"]').setValue('  QA-IN  ')
  await wrapper.get('input[aria-label="材质"]').setValue('  铜钼  ')
  wrapper
    .findAllComponents(ElSelect)
    .find((item) => item.find('input[aria-label="物料类型"]').exists())!
    .vm.$emit('update:modelValue', 'semi_finished')
  await amount('入库件数', 0)
  await amount('入库重量', 0.005)
  await wrapper.get('textarea[aria-label="入库说明"]').setValue('  实物到货登记  ')
}
async function submit() {
  await wrapper.get('form').trigger('submit')
  await flushPromises()
}

describe('warehouse manual receipt', () => {
  it.each(['成品规格', '转料规格'])('retains %s validation on physical receipts', async (label) => {
    await render()
    await fill()
    const shape = wrapper
      .findAllComponents(ElSelect)
      .find((item) => item.find(`input[aria-label="${label}形状"]`).exists())!
    shape.vm.$emit('update:modelValue', 'rectangle')
    shape.vm.$emit('change', 'rectangle')
    await flushPromises()
    await submit()
    expect(teamMaterialApi.createReceipt).not.toHaveBeenCalled()
    expect(wrapper.find('[aria-label="共投流水号安排"]').exists()).toBe(false)
  })
  it('accepts raw intake without a serial number or route', async () => {
    await render()
    await fill()
    await wrapper.get('input[aria-label="流水号"]').setValue('')
    await submit()
    expect(teamMaterialApi.createReceipt).toHaveBeenCalledWith(
      901,
      expect.objectContaining({ serial_no: '' }),
    )
    expect(vi.mocked(teamMaterialApi.createReceipt).mock.calls[0]![1].process_route).toBeUndefined()
  })
  it('does not offer joint production when registering physical receipts', async () => {
    await render()
    await fill()
    expect(wrapper.find('[role="switch"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('共投')
    await submit()
    expect(teamMaterialApi.createReceipt).toHaveBeenCalledOnce()
    expect(vi.mocked(teamMaterialApi.createReceipt).mock.calls[0]![1]).not.toHaveProperty(
      'shared_serials',
    )
  })

  it('marks selected metadata, preserves manual edits and keeps receipt amounts independent', async () => {
    await render()
    await wrapper.get('input[aria-label="流水号"]').setValue('YS-007')
    const serial = wrapper
      .findAllComponents(MaterialInput)
      .find((item) => item.props('field') === 'serial_no')!
    serial.vm.$emit('selected', {
      value: 'YS-007',
      source_batch_no: 'TL-7',
      details: {
        material_name: '材料2',
        customer_code: 'C-7',
        finished_specification: '100 × 80 × 5 mm',
      },
    })
    await flushPromises()
    expect(wrapper.get('input[aria-label="材质"]').element).toHaveProperty('value', '材料2')
    expect(wrapper.text()).toContain('已带入')
    expect(
      wrapper
        .findAllComponents(ElInputNumber)
        .find((item) => item.find('input[aria-label="入库件数"]').exists())!
        .props('modelValue'),
    ).toBe(0)
    await wrapper.get('input[aria-label="材质"]').setValue('手填材料')
    serial.vm.$emit('selected', {
      value: 'YS-007',
      source_batch_no: 'TL-8',
      details: {
        material_name: '材料3',
        customer_code: 'C-8',
        finished_specification: '100 × 80 × 5 mm',
      },
    })
    await flushPromises()
    expect(wrapper.get('input[aria-label="材质"]').element).toHaveProperty('value', '手填材料')
    await wrapper.get('input[aria-label="外部来源单位"]').setValue('供应商')
    wrapper
      .findAllComponents(ElSelect)
      .find((item) => item.find('input[aria-label="物料类型"]').exists())!
      .vm.$emit('update:modelValue', 'semi_finished')
    await amount('入库件数', 3)
    await amount('入库重量', 1.5)
    await wrapper.get('textarea[aria-label="入库说明"]').setValue('实物到货')
    await submit()
    expect(teamMaterialApi.createReceipt).toHaveBeenCalledWith(
      901,
      expect.objectContaining({
        serial_no: 'YS-007',
        material_name: '手填材料',
        customer_code: 'C-8',
        finished_specification: '100 × 80 × 5 mm',
        quantity: 3,
        weight: 1.5,
      }),
    )
  })

  it('keeps measured sludge and percentage in a retried receipt without double conversion', async () => {
    vi.mocked(teamMaterialApi.createReceipt).mockRejectedValueOnce(
      new TeamMaterialApiError('网络中断'),
    )
    await render()
    await fill()
    wrapper
      .findAllComponents(ElSelect)
      .find((item) => item.find('input[aria-label="物料类型"]').exists())!
      .vm.$emit('update:modelValue', 'sludge')
    await flushPromises()
    await amount('废泥实重', 10)
    await amount('有效材料占比', 30)
    await submit()
    const original = vi.mocked(teamMaterialApi.createReceipt).mock.calls[0]![1]
    expect(original).toMatchObject({
      material_type: 'sludge',
      weight: 3,
      sludge_gross_weight: 10,
      sludge_content_percent: 30,
    })
    wrapper.unmount()
    await render()
    await submit()
    expect(vi.mocked(teamMaterialApi.createReceipt).mock.calls[1]![1]).toEqual(original)
  })
  it('keeps a manually selected location in the persisted retry payload', async () => {
    vi.mocked(teamMaterialApi.createReceipt).mockRejectedValueOnce(
      new TeamMaterialApiError('网络中断'),
    )
    await render()
    await fill()
    wrapper.getComponent(WarehouseLocationSelect).vm.$emit('update:modelValue', 'A区-03')
    wrapper
      .getComponent(WarehouseLocationSelect)
      .vm.$emit('update:reservationKey', 'test-lease-key-for-intake')
    await submit()
    const original = vi.mocked(teamMaterialApi.createReceipt).mock.calls[0]![1]
    expect(original.warehouse_location).toBe('A区-03')
    expect(original.warehouse_location_reservation_key).toBe('test-lease-key-for-intake')
    expect(wrapper.getComponent(WarehouseLocationSelect).props('disabled')).toBe(true)
    wrapper.unmount()
    await render()
    await submit()
    expect(vi.mocked(teamMaterialApi.createReceipt).mock.calls[1]![1]).toEqual(original)
  })
  it('saves the origin requirement together with the receipt and preserves it in an uncertain retry', async () => {
    vi.mocked(teamMaterialApi.createReceipt).mockRejectedValueOnce(
      new TeamMaterialApiError('网络中断'),
    )
    await render()
    await fill()
    await wrapper.get('input[aria-label="要求发货日期"]').setValue('2026-10-01')
    await amount('应发成品件数', 80)
    await submit()
    const body = vi.mocked(teamMaterialApi.createReceipt).mock.calls[0]![1]
    expect(body).toMatchObject({ delivery_date: '2026-10-01', delivery_quantity: 80 })
    wrapper.unmount()
    await render()
    expect(
      (wrapper.get('input[aria-label="要求发货日期"]').element as HTMLInputElement).value,
    ).toBe('2026-10-01')
    await submit()
    expect(vi.mocked(teamMaterialApi.createReceipt).mock.calls[1]![1]).toEqual(body)
  })

  it('records an external return against the existing serial and optional CK', async () => {
    await render()
    await fill()
    wrapper
      .findAllComponents(ElSelect)
      .find((item) => item.find('input[aria-label="入库来源"]').exists())!
      .vm.$emit('update:modelValue', 'return')
    await flushPromises()
    await wrapper.get('input[aria-label="原出库批次"]').setValue(' CK-ORIGINAL ')
    await submit()
    expect(teamMaterialApi.createReceipt).toHaveBeenCalledWith(
      901,
      expect.objectContaining({
        receipt_kind: 'return',
        serial_no: 'QA-IN',
        external_source: '来料单位',
        return_dispatch_no: 'CK-ORIGINAL',
      }),
    )
  })
  it('requires the external source unit', async () => {
    await render()
    await fill()
    await wrapper.get('input[aria-label="外部来源单位"]').setValue(' ')
    await submit()
    expect(teamMaterialApi.createReceipt).not.toHaveBeenCalled()
    expect(
      wrapper
        .get('input[aria-label="外部来源单位"]')
        .element.closest('.el-form-item')!
        .classList.contains('is-error'),
    ).toBe(true)
  })
  it('creates a root receipt for the bound warehouse with no transfer destination or status fields', async () => {
    await render()
    await fill()
    expect(wrapper.get('.receipt-heading strong').text()).toBe('库房')
    expect(wrapper.find('nav[aria-label="表单分页"]').exists()).toBe(false)
    expect(wrapper.findAllComponents(ElSelect)).toHaveLength(6)
    expect(wrapper.find('input[aria-label="入库重量单位"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('接收班组')
    await wrapper.get('input[aria-label="原单批号"]').setValue('RAW-91')
    await submit()
    const [id, body] = vi.mocked(teamMaterialApi.createReceipt).mock.calls[0]!
    expect(id).toBe(901)
    expect(body).toMatchObject({
      receipt_kind: 'external',
      external_source: '来料单位',
      return_dispatch_no: null,
    })
    expect(body).toMatchObject({
      serial_no: 'QA-IN',
      material_name: '铜钼',
      material_type: 'semi_finished',
      quantity: 0,
      weight: 0.005,
      notes: '实物到货登记',
      source_batch_no: 'RAW-91',
      idempotency_key: expect.any(String),
    })
    expect(body).not.toHaveProperty('next_team_id')
    expect(body).not.toHaveProperty('source_team_id')
    expect(body).not.toHaveProperty('status')
    expect(state.auth.refreshCurrentUser).toHaveBeenCalledOnce()
    expect(state.directory.refreshTeamDirectory).toHaveBeenCalledOnce()
    expect(wrapper.emitted('saved')).toEqual([[receipt()]])
    expect(sessionStorage.length).toBe(0)
  })
  it('requires material and a positive amount and accepts small measured weights', async () => {
    await render()
    await fill()
    await wrapper.get('input[aria-label="材质"]').setValue(' ')
    await submit()
    expect(
      wrapper
        .get('input[aria-label="材质"]')
        .element.closest('.el-form-item')!
        .classList.contains('is-error'),
    ).toBe(true)
    await wrapper.get('input[aria-label="材质"]').setValue('铜钼')
    await amount('入库重量', 0)
    await submit()
    expect(
      wrapper
        .get('input[aria-label="入库重量"]')
        .element.closest('.el-form-item')!
        .classList.contains('is-error'),
    ).toBe(true)
    expect(teamMaterialApi.createReceipt).not.toHaveBeenCalled()
    await amount('入库重量', 0.0005)
    await submit()
    expect(teamMaterialApi.createReceipt).toHaveBeenCalledWith(
      901,
      expect.objectContaining({ weight: 0.0005 }),
    )
  })
  it('accepts an empty optional intake explanation', async () => {
    await render()
    await fill()
    await wrapper.get('textarea[aria-label="入库说明"]').setValue(' ')
    await submit()
    expect(teamMaterialApi.createReceipt).toHaveBeenCalledWith(
      901,
      expect.objectContaining({ notes: '' }),
    )
    expect(wrapper.text()).not.toContain('请填写入库说明')
  })
  it.each(['admin', 'other-team', 'inactive', 'inactive-account', 'wrong-code', 'wrong-kind'])(
    'blocks %s from creating a warehouse receipt',
    async (kind) => {
      if (kind === 'admin') state.auth.isTeamAccount = false
      if (kind === 'other-team') state.auth.currentUser.team_id = 2
      if (kind === 'inactive') state.directory.items[0]!.active = false
      if (kind === 'inactive-account') state.auth.currentUser.active = false
      if (kind === 'wrong-code') state.directory.items[0]!.code = 'OLD-WAREHOUSE'
      if (kind === 'wrong-kind') state.directory.items[0]!.kind = 'production'
      await render()
      await submit()
      expect(teamMaterialApi.createReceipt).not.toHaveBeenCalled()
      expect(
        wrapper
          .findAll('button')
          .find((button) => button.text() === '确认入库')!
          .attributes('disabled'),
      ).toBeDefined()
    },
  )
  it('reuses an uncertain request after reopening, freezes its content and suppresses double submission', async () => {
    let fail!: (failure: Error) => void
    vi.mocked(teamMaterialApi.createReceipt).mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        fail = reject
      }),
    )
    await render()
    await fill()
    await submit()
    await submit()
    expect(teamMaterialApi.createReceipt).toHaveBeenCalledTimes(1)
    const original = vi.mocked(teamMaterialApi.createReceipt).mock.calls[0]![1]
    fail(new TeamMaterialApiError('网络中断'))
    await flushPromises()
    expect(wrapper.get('input[aria-label="流水号"]').attributes('disabled')).toBeDefined()
    wrapper.unmount()
    await render()
    expect(wrapper.text()).toContain('上次提交结果待确认')
    await submit()
    expect(vi.mocked(teamMaterialApi.createReceipt).mock.calls[1]![1]).toEqual(original)
    expect(sessionStorage.length).toBe(0)
  })
  it('permits correction after a definitive validation failure', async () => {
    vi.mocked(teamMaterialApi.createReceipt).mockRejectedValueOnce(
      new TeamMaterialApiError('说明不完整', 422),
    )
    await render()
    await fill()
    await submit()
    expect(wrapper.get('input[aria-label="流水号"]').attributes('disabled')).toBeUndefined()
    expect(sessionStorage.length).toBe(0)
    await wrapper.get('textarea[aria-label="入库说明"]').setValue('补充完整到货说明')
    await submit()
    expect(vi.mocked(teamMaterialApi.createReceipt).mock.calls[1]![1].notes).toBe(
      '补充完整到货说明',
    )
    expect(wrapper.emitted('saved')).toHaveLength(1)
  })
  it('does not replace an unreadable pending entry with a new posting', async () => {
    sessionStorage.setItem('heatsink-flow.pending-warehouse-receipt.v1:41:901', '{broken')
    await render()
    await submit()
    expect(wrapper.text()).toContain('上次入库草稿读取失败')
    expect(teamMaterialApi.createReceipt).not.toHaveBeenCalled()
    expect(sessionStorage.getItem('heatsink-flow.pending-warehouse-receipt.v1:41:901')).toBe(
      '{broken',
    )
  })
  it('makes no write when account binding changes during server verification', async () => {
    await render()
    await fill()
    state.auth.refreshCurrentUser.mockImplementation(async () => {
      state.auth.currentUser.team_id = 2
    })
    await submit()
    expect(teamMaterialApi.createReceipt).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('当前不能入库')
  })
  it('does not apply a late receipt to another workspace and clears the confirmed retry only for its original identity', async () => {
    let finish!: (value: ReturnType<typeof receipt>) => void
    vi.mocked(teamMaterialApi.createReceipt).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    await render()
    await fill()
    await submit()
    await wrapper.setProps({ teamId: 2, modelValue: false })
    finish(receipt())
    await flushPromises()
    expect(wrapper.emitted('saved')).toBeUndefined()
    expect(sessionStorage.length).toBe(0)
  })
})

it('replaces old piece fields with weight-only intake and rejects an empty weight', async () => {
  await render()
  await fill()
  await amount('入库件数', 50)
  await amount('成品件数', 40)
  wrapper
    .findAllComponents(ElSelect)
    .find((item) => item.find('input[aria-label="物料类型"]').exists())!
    .vm.$emit('update:modelValue', 'scrap_chips')
  await flushPromises()
  expect(wrapper.find('input[aria-label="入库件数"]').exists()).toBe(false)
  expect(wrapper.find('input[aria-label="成品件数"]').exists()).toBe(false)
  expect(wrapper.find('input[aria-label="应发成品件数"]').exists()).toBe(false)
  await amount('入库重量', 0)
  await submit()
  expect(teamMaterialApi.createReceipt).not.toHaveBeenCalled()
  expect(
    wrapper
      .get('input[aria-label="入库重量"]')
      .element.closest('.el-form-item')!
      .classList.contains('is-error'),
  ).toBe(true)
  await amount('入库重量', 5)
  await submit()
  expect(teamMaterialApi.createReceipt).toHaveBeenCalledWith(
    901,
    expect.objectContaining({ quantity: 0, weight: 5, finished_quantity: null }),
  )
})

function importedDocument(): ProcessRoute {
  const route = structuredClone(routeFixture)
  route.state = 'published'
  const values: Record<string, string | number> = {
    serial_no: 'IMPORT-01',
    material_name: '钼铜',
    quantity: 41,
    weight: 171.6,
    customer_code: 'C-11600',
    product_code: 'T4-03',
    finished_specification: '100 × 80 × 5 mm',
    delivery_date: '2026-11-01',
    delivery_quantity: 18100,
    external_source: '供应单位',
  }
  route.serial_nos = ['IMPORT-01']
  route.filename = '生产工艺单.docx'
  route.source_data.receipt_fields = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      { value, label: key, source_row: '1:1', source_label: key },
    ]),
  )
  route.source_data.tables = [
    [
      ['订单数量', '18100'],
      ['计划加工数量', '4008'],
    ],
  ]
  return route
}
async function importFile() {
  const trigger = wrapper
    .findAll('button')
    .find((button) => ['选择工艺', '更换工艺'].includes(button.text()))!
  await trigger.trigger('click')
  await flushPromises()
  const picker = wrapper.getComponent(PublishedProcessRoutePicker)
  await picker
    .findAll('button')
    .find((button) => button.text() === '选择')!
    .trigger('click')
  await flushPromises()
  if (picker.emitted('selected')?.length) {
    picker.vm.$emit('close')
    await flushPromises()
  }
}
async function confirmImported() {
  await wrapper.get('[aria-label="确认文件带入信息"] input').setValue(true)
  await flushPromises()
}
function currentValues() {
  const text = (label: string) =>
    (wrapper.get(`input[aria-label="${label}"]`).element as HTMLInputElement).value
  const number = (label: string) =>
    wrapper
      .findAllComponents(ElInputNumber)
      .find((item) => item.find(`input[aria-label="${label}"]`).exists())!
      .props('modelValue')
  return {
    serial_no: text('流水号'),
    material_name: text('材质'),
    customer_code: text('客户代码'),
    product_code: text('编号'),
    quantity: number('入库件数'),
    weight: number('入库重量'),
    delivery_quantity: number('应发成品件数'),
  }
}
async function reviewImportedRoute() {
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '查看工艺')!
    .trigger('click')
  const editor = wrapper.getComponent(ProcessRouteEditor)
  expect(editor.props('viewOnly')).toBe(true)
  editor.vm.$emit('close')
  await flushPromises()
}

describe('库房关联已发布工艺', () => {
  it('inherits confirmed engineering metadata but leaves actual batch quantity and weight for receipt', async () => {
    const route = importedDocument()
    route.source_data.review_required = true
    route.source_data.material_confirmation = {
      fingerprint: 'reviewed',
      by: '张工',
      at: '2026-10-28T00:00:00Z',
    }
    route.source_data.receipt_fields!.delivery_quantity!.source_filename = '订单.xlsx'
    vi.spyOn(processRouteApi, 'detail').mockResolvedValue(route)
    await render()
    await importFile()
    expect(currentValues()).toMatchObject({
      serial_no: 'IMPORT-01',
      customer_code: 'C-11600',
      product_code: 'T4-03',
      delivery_quantity: 18100,
      quantity: 0,
      weight: 0,
    })
    expect(wrapper.get('input[aria-label="材质"]').element).toHaveProperty('value', '钼铜')
    expect(wrapper.get('input[aria-label="要求发货日期"]').element).toHaveProperty(
      'value',
      '2026-11-01',
    )
  })
  it('fills the receipt form with extracted data and keeps original values visible after manual edits', async () => {
    vi.spyOn(processRouteApi, 'detail').mockResolvedValue(importedDocument())
    await render()
    await importFile()
    expect(wrapper.get('input[aria-label="流水号"]').element).toHaveProperty('value', 'IMPORT-01')
    expect(wrapper.get('input[aria-label="材质"]').element).toHaveProperty('value', '钼铜')
    expect(wrapper.get('input[aria-label="客户代码"]').element).toHaveProperty('value', 'C-11600')
    expect(wrapper.get('input[aria-label="编号"]').element).toHaveProperty('value', 'T4-03')
    expect(wrapper.get('input[aria-label="要求发货日期"]').element).toHaveProperty(
      'value',
      '2026-11-01',
    )
    expect(currentValues()).toMatchObject({
      serial_no: 'IMPORT-01',
      quantity: 41,
      weight: 171.6,
      delivery_quantity: 18100,
    })
    const material = wrapper.get('input[aria-label="材质"]').element.closest('.el-form-item')!
    expect(material.classList.contains('document-field--imported')).toBe(true)
    expect(material.textContent).toContain('文件带入')
    await wrapper.get('input[aria-label="材质"]').setValue('人工核对材质')
    expect(material.classList.contains('document-field--edited')).toBe(true)
    expect(material.textContent).toContain('已修改')
    const preview = wrapper.getComponent(WarehouseReceiptDocuments)
    expect(preview.props('route')!.source_data.receipt_fields!.material_name!.value).toBe('钼铜')
    expect(currentValues().material_name).toBe('人工核对材质')
  })

  it('preserves manually filled fields while importing remaining blank fields', async () => {
    vi.spyOn(processRouteApi, 'detail').mockResolvedValue(importedDocument())
    await render()
    await wrapper.get('input[aria-label="材质"]').setValue('手工材质')
    await wrapper.get('input[aria-label="客户代码"]').setValue('手工客户')
    await amount('入库重量', 99)
    await importFile()
    expect(wrapper.get('input[aria-label="材质"]').element).toHaveProperty('value', '手工材质')
    expect(wrapper.get('input[aria-label="客户代码"]').element).toHaveProperty('value', '手工客户')
    expect(currentValues()).toMatchObject({
      quantity: 41,
      weight: 99,
      serial_no: 'IMPORT-01',
    })
  })

  it('replaces untouched imported values on a new document while preserving subsequent manual edits', async () => {
    const first = importedDocument()
    const next = importedDocument()
    next.id = 99
    next.source_data.receipt_fields!.material_name!.value = '第二份材质'
    next.source_data.receipt_fields!.customer_code!.value = 'C-NEW'
    next.source_data.receipt_fields!.quantity!.value = 52
    vi.spyOn(processRouteApi, 'detail').mockResolvedValueOnce(first).mockResolvedValueOnce(next)
    await render()
    await importFile()
    await wrapper.get('input[aria-label="材质"]').setValue('手工核对材质')
    await importFile()
    expect(wrapper.get('input[aria-label="材质"]').element).toHaveProperty('value', '手工核对材质')
    expect(wrapper.get('input[aria-label="客户代码"]').element).toHaveProperty('value', 'C-NEW')
    const preview = wrapper.getComponent(WarehouseReceiptDocuments)
    expect(preview.props('route')!.id).toBe(99)
    expect(currentValues().quantity).toBe(52)
    expect(preview.props('route')!.source_data.receipt_fields!.material_name!.value).toBe(
      '第二份材质',
    )
    expect(first.source_data.receipt_fields!.material_name!.value).toBe('钼铜')
  })

  it('never turns the order or planned production quantity into actual stock', async () => {
    const route = importedDocument()
    delete route.source_data.receipt_fields!.quantity
    delete route.source_data.receipt_fields!.weight
    vi.spyOn(processRouteApi, 'detail').mockResolvedValue(route)
    await render()
    await importFile()
    expect(currentValues()).toMatchObject({
      quantity: 0,
      weight: 0,
      delivery_quantity: 18100,
    })
    expect(
      wrapper.getComponent(WarehouseReceiptDocuments).props('route')!.source_data.tables,
    ).toContainEqual([
      ['订单数量', '18100'],
      ['计划加工数量', '4008'],
    ])
  })

  it('keeps the document primary serial and order details when a historical route names several serials', async () => {
    const route = importedDocument()
    route.serial_nos = ['IMPORT-02', 'IMPORT-01', 'IMPORT-03']
    vi.mocked(processRouteApi.detail).mockResolvedValue(route)
    await render()
    await importFile()
    expect(wrapper.get('input[aria-label="流水号"]').element).toHaveProperty('value', 'IMPORT-01')
    expect(wrapper.get('input[aria-label="客户代码"]').element).toHaveProperty('value', 'C-11600')
    expect(currentValues().delivery_quantity).toBe(18100)
    expect(wrapper.find('[aria-label="共投流水号安排"]').exists()).toBe(false)
  })

  it('does not overwrite current fields or an earlier source document when import fails', async () => {
    const request = vi.spyOn(processRouteApi, 'detail').mockResolvedValueOnce(importedDocument())
    await render()
    await importFile()
    await wrapper.get('input[aria-label="材质"]').setValue('已核对材质')
    request.mockRejectedValueOnce(new Error('文件不是支持的工艺表'))
    await importFile()
    expect(wrapper.text()).toContain('文件不是支持的工艺表')
    expect(wrapper.get('input[aria-label="材质"]').element).toHaveProperty('value', '已核对材质')
    expect(wrapper.getComponent(WarehouseReceiptDocuments).props('route')!.id).toBe(routeFixture.id)
    expect(currentValues()!.quantity).toBe(41)
  })

  it('blocks posting during upload and ignores a late import after closing and reopening', async () => {
    let finish!: (route: ProcessRoute) => void
    vi.spyOn(processRouteApi, 'detail').mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    await render()
    await fill()
    await importFile()
    await submit()
    expect(teamMaterialApi.createReceipt).not.toHaveBeenCalled()
    expect(
      wrapper
        .findAll('button')
        .find((button) => button.text() === '确认入库')!
        .attributes('disabled'),
    ).toBeDefined()
    await wrapper.setProps({ modelValue: false })
    await wrapper.setProps({ modelValue: true })
    finish(importedDocument())
    await flushPromises()
    expect(wrapper.getComponent(WarehouseReceiptDocuments).props('route')).toBeUndefined()
    expect(wrapper.get('input[aria-label="流水号"]').element).toHaveProperty('value', '')
    expect(wrapper.get('input[aria-label="材质"]').element).toHaveProperty('value', '')
  })

  it('carries the explicitly reviewed route into one idempotent receipt retry', async () => {
    vi.spyOn(processRouteApi, 'detail').mockResolvedValue(importedDocument())
    vi.mocked(teamMaterialApi.createReceipt).mockRejectedValueOnce(
      new TeamMaterialApiError('网络中断'),
    )
    await render()
    await importFile()
    wrapper
      .findAllComponents(ElSelect)
      .find((item) => item.find('input[aria-label="物料类型"]').exists())!
      .vm.$emit('update:modelValue', 'raw_material')
    await flushPromises()
    await confirmImported()
    await submit()
    const original = vi.mocked(teamMaterialApi.createReceipt).mock.calls[0]![1]
    expect(original).toMatchObject({
      confirmed_imports: true,
      serial_no: 'IMPORT-01',
      material_name: '钼铜',
      quantity: 41,
      weight: 171.6,
      customer_code: 'C-11600',
      process_route: {
        id: routeFixture.id,
        version: 1,
        title: '首批派工',
        serial_nos: ['IMPORT-01'],
        review_note: '已核对原文及重复行',
        steps: routeFixture.steps,
      },
      idempotency_key: expect.any(String),
    })
    wrapper.unmount()
    await render()
    await submit()
    expect(vi.mocked(teamMaterialApi.createReceipt).mock.calls[1]![1]).toEqual(original)
    expect(wrapper.find('input[type="file"]').exists()).toBe(false)
  })

  it('clears a definitive route-version conflict, refreshes the draft and requires another review', async () => {
    const latest = importedDocument()
    latest.version = 2
    latest.steps[1]!.instructions = '更新后的工艺要求'
    vi.spyOn(processRouteApi, 'detail').mockResolvedValue(importedDocument())
    vi.mocked(processRouteApi.detail).mockResolvedValue(latest)
    vi.mocked(teamMaterialApi.createReceipt).mockRejectedValueOnce(
      new TeamMaterialApiError('工艺版本已更新，请重新核对', 409),
    )
    await render()
    await importFile()
    wrapper
      .findAllComponents(ElSelect)
      .find((item) => item.find('input[aria-label="物料类型"]').exists())!
      .vm.$emit('update:modelValue', 'raw_material')
    await flushPromises()
    await reviewImportedRoute()
    await confirmImported()
    await submit()
    const rejected = vi.mocked(teamMaterialApi.createReceipt).mock.calls[0]![1]
    expect(processRouteApi.detail).toHaveBeenCalledWith(routeFixture.id)
    expect(sessionStorage.length).toBe(0)
    expect(wrapper.get('input[aria-label="流水号"]').attributes('disabled')).toBeUndefined()
    expect(wrapper.getComponent(WarehouseReceiptDocuments).props('route')!.version).toBe(2)
    expect(wrapper.get('.receipt-route-choice').text()).toContain('IMPORT-01')
    await submit()
    expect(teamMaterialApi.createReceipt).toHaveBeenCalledOnce()
    expect(wrapper.get('.receipt-route-choice').classes()).toContain('is-error')
    await importFile()
    await confirmImported()
    await submit()
    const corrected = vi.mocked(teamMaterialApi.createReceipt).mock.calls[1]![1]
    expect(corrected.process_route?.version).toBe(2)
    expect(corrected.process_route?.steps[1]!.instructions).toBe('更新后的工艺要求')
    expect(corrected.idempotency_key).not.toBe(rejected.idempotency_key)
  })

  it('keeps source provenance attached to the receipt after renaming its serial', async () => {
    const route = importedDocument()
    route.serial_nos = ['IMPORT-02', 'IMPORT-01']
    vi.spyOn(processRouteApi, 'detail').mockResolvedValue(route)
    await render()
    await importFile()
    await wrapper.get('input[aria-label="流水号"]').setValue('CORRECTED-01')
    const customer = wrapper.get('input[aria-label="客户代码"]')
    await customer.setValue('C-CORRECTED')
    await wrapper.get('input[aria-label="要求发货日期"]').setValue('2026-12-01')
    await flushPromises()
    const preview = wrapper.getComponent(WarehouseReceiptDocuments)
    expect(wrapper.get('input[aria-label="流水号"]').element).toHaveProperty(
      'value',
      'CORRECTED-01',
    )
    expect(customer.element).toHaveProperty('value', 'C-CORRECTED')
    expect(wrapper.get('input[aria-label="要求发货日期"]').element).toHaveProperty(
      'value',
      '2026-12-01',
    )
    expect(preview.props('route')!.source_data.receipt_fields).toMatchObject({
      serial_no: { value: 'IMPORT-01' },
      customer_code: { value: 'C-11600' },
      delivery_date: { value: '2026-11-01' },
    })
    expect(
      customer.element.closest('.el-form-item')!.classList.contains('document-field--edited'),
    ).toBe(true)
  })

  it('keeps the order serial independent without modifying the published process serial', async () => {
    await render()
    await importFile()
    wrapper
      .findAllComponents(ElSelect)
      .find((item) => item.find('input[aria-label="物料类型"]').exists())!
      .vm.$emit('update:modelValue', 'raw_material')
    await wrapper.get('input[aria-label="流水号"]').setValue('ORDER-01')
    await confirmImported()
    await submit()
    expect(teamMaterialApi.createReceipt).toHaveBeenCalledOnce()
    expect(vi.mocked(teamMaterialApi.createReceipt).mock.calls[0]![1].serial_no).toBe('ORDER-01')
    expect(
      vi.mocked(teamMaterialApi.createReceipt).mock.calls[0]![1].process_route?.serial_nos,
    ).toEqual(['IMPORT-01'])
  })

  it.each([false, true])(
    'clears removed automatic fields while retaining manual weight edits: %s',
    async (editedWeight) => {
      const next = importedDocument()
      next.id = 100
      delete next.source_data.receipt_fields!.customer_code
      delete next.source_data.receipt_fields!.weight
      delete next.source_data.receipt_fields!.material_name
      vi.spyOn(processRouteApi, 'detail')
        .mockResolvedValueOnce(importedDocument())
        .mockResolvedValueOnce(next)
      await render()
      await importFile()
      await wrapper.get('input[aria-label="材质"]').setValue('保留手工材质')
      if (editedWeight) await amount('入库重量', 99)
      await importFile()
      expect(wrapper.get('input[aria-label="客户代码"]').element).toHaveProperty('value', '')
      expect(wrapper.get('input[aria-label="材质"]').element).toHaveProperty(
        'value',
        '保留手工材质',
      )
      expect(currentValues()!.weight).toBe(editedWeight ? 99 : 0)
      expect(
        wrapper.get('input[aria-label="客户代码"]').element.closest('.el-form-item')!.textContent,
      ).not.toContain('文件带入')
    },
  )

  it('keeps inherited attachments on the left without an extra original-file toggle', async () => {
    await render()
    const rail = wrapper.getComponent(WarehouseReceiptDocuments)
    expect(rail.props()).toMatchObject({
      teamId: 901,
      documents: [],
      editable: true,
      disabled: false,
    })
    const aside = wrapper.get('.form-workspace-documents [aria-label="入库附件"]').element
    expect(
      aside.compareDocumentPosition(wrapper.get('form').element) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    await importFile()
    expect(rail.props('route')?.id).toBe(routeFixture.id)
    expect(rail.props('serialNo')).toBe('IMPORT-01')
    expect(wrapper.text()).not.toContain('查看原始 Word')
    expect(wrapper.get('[aria-label="确认文件带入信息"] input').element).toHaveProperty(
      'checked',
      false,
    )
  })

  it('clears the selected route and supplemental documents after closing and reopening', async () => {
    await render()
    await importFile()
    wrapper
      .getComponent(WarehouseReceiptDocuments)
      .vm.$emit('uploaded', supplementalDocument('drawing'))
    await flushPromises()
    await uploadDocument(supplementalDocument('drawing'))
    expect(wrapper.getComponent(WarehouseReceiptDocuments).props('documents')).toHaveLength(1)
    await wrapper.setProps({ modelValue: false })
    expect(wrapper.findComponent(WarehouseReceiptDocuments).exists()).toBe(false)
    await wrapper.setProps({ modelValue: true })
    await flushPromises()
    expect(wrapper.getComponent(WarehouseReceiptDocuments).props('route')).toBeUndefined()
    expect(wrapper.getComponent(WarehouseReceiptDocuments).props('documents')).toEqual([])
    expect(wrapper.find('[aria-label="确认文件带入信息"] input').exists()).toBe(false)
  })
})

it('does not turn a historical multi-serial route into a shared receipt', async () => {
  const route = importedDocument()
  route.serial_nos = ['IMPORT-01', 'IMPORT-02', 'IMPORT-03']
  vi.mocked(processRouteApi.detail).mockResolvedValue(route)
  await render()
  await importFile()
  expect(wrapper.find('[aria-label="共投流水号安排"]').exists()).toBe(false)
  expect(wrapper.get('input[aria-label="流水号"]').element).toHaveProperty('value', 'IMPORT-01')
  for (const label of ['入库件数', '入库重量', '编号', '转料规格'])
    expect(wrapper.find(`[aria-label="${label}"]`).exists()).toBe(true)
})

it('associates a manually created published route without requesting a missing Word source', async () => {
  const route = {
    ...importedDocument(),
    filename: '',
    serial_nos: ['MANUAL-ROUTE'],
    source_data: { tables: [], issues: [] },
  }
  vi.mocked(processRouteApi.detail).mockResolvedValue(route)
  await render()
  await importFile()
  expect(wrapper.get('input[aria-label="流水号"]').element).toHaveProperty('value', 'MANUAL-ROUTE')
  expect(wrapper.findAll('button').some((button) => button.text().includes('查看原始 Word'))).toBe(
    false,
  )
  expect(wrapper.text()).toContain('MANUAL-ROUTE')
  expect(wrapper.getComponent(WarehouseReceiptDocuments).props('route')?.filename).toBe('')
})

function supplementalDocument(
  kind: ReceiptDocument['kind'],
  fields: Record<string, string | number> = {},
  id = kind === 'process' ? 701 : kind === 'order' ? 702 : 703,
): ReceiptDocument {
  return {
    id,
    kind,
    filename:
      kind === 'process' ? '补传工艺.docx' : kind === 'order' ? '补传订单.xlsx' : '补传图纸.pdf',
    size_bytes: 1024,
    sha256: 'a'.repeat(64),
    parsed: {
      receipt_fields: Object.fromEntries(
        Object.entries(fields).map(([key, value]) => [
          key,
          {
            value,
            label: key,
            source_row: '1:1',
            source_label: key,
          },
        ]),
      ),
    },
  }
}
async function uploadDocument(document: ReceiptDocument) {
  wrapper.getComponent(WarehouseReceiptDocuments).vm.$emit('uploaded', document)
  await flushPromises()
}

describe('库房补充附件与导入确认', () => {
  it('fills supplemental process and order fields, marks their origin and preserves manual corrections', async () => {
    await render()
    await wrapper.get('input[aria-label="材质"]').setValue('已核对材质')
    await uploadDocument(
      supplementalDocument('process', {
        serial_no: 'SUPPLEMENT-01',
        material_name: '工艺材质',
        product_code: 'P-01',
        quantity: 8,
      }),
    )
    await uploadDocument(
      supplementalDocument('order', {
        customer_code: 'C-ORDER',
        delivery_date: '2026-11-12',
        delivery_quantity: 80,
      }),
    )
    expect(
      wrapper
        .getComponent(WarehouseReceiptDocuments)
        .props('documents')
        .map((document) => document.id),
    ).toEqual([701, 702])
    expect(wrapper.get('input[aria-label="流水号"]').element).toHaveProperty(
      'value',
      'SUPPLEMENT-01',
    )
    expect(wrapper.get('input[aria-label="材质"]').element).toHaveProperty('value', '已核对材质')
    expect(wrapper.get('input[aria-label="客户代码"]').element).toHaveProperty('value', 'C-ORDER')
    expect(wrapper.get('input[aria-label="编号"]').element).toHaveProperty('value', 'P-01')
    expect(
      wrapper.get('input[aria-label="编号"]').element.closest('.el-form-item')?.textContent,
    ).toContain('文件带入')
    expect(
      wrapper.get('input[aria-label="客户代码"]').element.closest('.el-form-item')?.textContent,
    ).toContain('文件带入')
    expect(
      wrapper.get('input[aria-label="材质"]').element.closest('.el-form-item')?.textContent,
    ).toContain('已修改')
    await wrapper.get('input[aria-label="客户代码"]').setValue('C-MANUAL')
    await uploadDocument(supplementalDocument('order', { customer_code: 'C-REPLACEMENT' }, 704))
    expect(wrapper.get('input[aria-label="客户代码"]').element).toHaveProperty('value', 'C-MANUAL')
    expect(
      wrapper
        .getComponent(WarehouseReceiptDocuments)
        .props('documents')
        .map((document) => document.id),
    ).toEqual([701, 704])
  })

  it('does not treat parsed planning quantities as measured intake for unconfirmed source documents', async () => {
    await render()
    const document = supplementalDocument('process', {
      material_name: '钼铜',
      quantity: 100,
      weight: 20,
      finished_quantity: 100,
    })
    document.parsed.review_required = true
    await uploadDocument(document)
    expect(currentValues()).toMatchObject({ quantity: 0, weight: 0, material_name: '钼铜' })
    expect(
      wrapper
        .findAllComponents(ElInputNumber)
        .find((item) => item.props('ariaLabel') === '成品件数')!
        .props('modelValue'),
    ).toBeUndefined()
  })

  it('requires explicit confirmation and scrolls to the unchecked field before posting', async () => {
    await render()
    await fill()
    await uploadDocument(supplementalDocument('drawing'))
    const checkbox = wrapper.get('[aria-label="确认文件带入信息"] input')
      .element as HTMLInputElement
    const scroll = vi.fn()
    Object.defineProperty(checkbox, 'scrollIntoView', { value: scroll, configurable: true })
    const focus = vi.spyOn(checkbox, 'focus')
    await submit()
    expect(teamMaterialApi.createReceipt).not.toHaveBeenCalled()
    expect(wrapper.get('.receipt-import-confirmation').classes()).toContain('is-error')
    expect(wrapper.text()).toContain('请核对文件带入的信息，并勾选确认')
    expect(scroll).toHaveBeenCalledWith({ block: 'center', inline: 'nearest' })
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    await confirmImported()
    await submit()
    expect(teamMaterialApi.createReceipt).toHaveBeenCalledWith(
      901,
      expect.objectContaining({
        document_ids: [703],
        confirmed_imports: true,
      }),
    )
  })

  it.each(['材质', '数量'])(
    'invalidates confirmation when %s changes after review',
    async (field) => {
      await render()
      await fill()
      await uploadDocument(supplementalDocument('process', { material_name: '工艺材质' }))
      await confirmImported()
      if (field === '材质') await wrapper.get('input[aria-label="材质"]').setValue('复核材质')
      else await amount('入库件数', 10)
      expect(wrapper.get('[aria-label="确认文件带入信息"] input').element).toHaveProperty(
        'checked',
        false,
      )
      await submit()
      expect(teamMaterialApi.createReceipt).not.toHaveBeenCalled()
    },
  )

  it('blocks submission while an attachment is uploading and shows attachment errors', async () => {
    await render()
    await fill()
    const rail = wrapper.getComponent(WarehouseReceiptDocuments)
    rail.vm.$emit('busy', true)
    await flushPromises()
    await submit()
    expect(teamMaterialApi.createReceipt).not.toHaveBeenCalled()
    expect(
      wrapper
        .findAll('button')
        .find((button) => button.text() === '确认入库')!
        .attributes('disabled'),
    ).toBeDefined()
    rail.vm.$emit('error', '图纸文件无法读取')
    rail.vm.$emit('busy', false)
    await flushPromises()
    expect(wrapper.text()).toContain('图纸文件无法读取')
    await submit()
    expect(teamMaterialApi.createReceipt).toHaveBeenCalledOnce()
  })

  it('keeps exact attachment IDs and review confirmation across an uncertain retry', async () => {
    const process = supplementalDocument('process', { product_code: 'P-01' })
    const drawing = supplementalDocument('drawing')
    const detail = vi
      .spyOn(warehouseReceiptDocumentApi, 'detail')
      .mockImplementation(async (id) => (id === process.id ? process : drawing))
    vi.mocked(teamMaterialApi.createReceipt).mockRejectedValueOnce(
      new TeamMaterialApiError('网络中断'),
    )
    await render()
    await fill()
    await wrapper.get('input[aria-label="流水号"]').setValue('')
    await uploadDocument(process)
    await uploadDocument(drawing)
    await confirmImported()
    await submit()
    const original = vi.mocked(teamMaterialApi.createReceipt).mock.calls[0]![1]
    expect(original).toMatchObject({
      serial_no: '',
      document_ids: [701, 703],
      confirmed_imports: true,
    })
    wrapper.unmount()
    await render()
    expect(detail).toHaveBeenCalledWith(701)
    expect(detail).toHaveBeenCalledWith(703)
    expect(wrapper.getComponent(WarehouseReceiptDocuments).props('documents')).toEqual([
      process,
      drawing,
    ])
    expect(wrapper.getComponent(WarehouseReceiptDocuments).props('disabled')).toBe(true)
    await submit()
    expect(vi.mocked(teamMaterialApi.createReceipt).mock.calls[1]![1]).toEqual(original)
  })

  it('uses matching order information only for missing process fields and preserves manual corrections', async () => {
    const route = importedDocument()
    delete route.source_data.receipt_fields!.product_code
    vi.mocked(processRouteApi.detail).mockResolvedValue(route)
    await render()
    await importFile()
    const rail = wrapper.getComponent(WarehouseReceiptDocuments)
    const order = {
      filename: '订单.xlsx',
      sheet: '订单',
      headers: [],
      values: [],
      warnings: [],
      serial_no: 'IMPORT-01',
      receipt_fields: {
        customer_code: {
          value: 'C-INHERITED',
          label: '客户',
          source_row: '1:1',
          source_label: '客户',
        },
        product_code: {
          value: 'P-INHERITED',
          label: '编号',
          source_row: '1:2',
          source_label: '编号',
        },
      },
    }
    rail.vm.$emit('inherited-order', order)
    await flushPromises()
    expect(wrapper.get('input[aria-label="客户代码"]').element).toHaveProperty('value', 'C-11600')
    expect(wrapper.get('input[aria-label="编号"]').element).toHaveProperty('value', 'P-INHERITED')
    rail.vm.$emit('inherited-order', {
      ...order,
      serial_no: 'OTHER-01',
      receipt_fields: {
        customer_code: { ...order.receipt_fields.customer_code, value: 'C-OTHER' },
        product_code: { ...order.receipt_fields.product_code, value: 'P-OTHER' },
      },
    })
    await flushPromises()
    expect(wrapper.get('input[aria-label="客户代码"]').element).toHaveProperty('value', 'C-11600')
    expect(wrapper.get('input[aria-label="编号"]').element).toHaveProperty('value', '')
    rail.vm.$emit('inherited-order', order)
    await flushPromises()
    await wrapper.get('input[aria-label="客户代码"]').setValue('C-MANUAL')
    await wrapper.get('input[aria-label="编号"]').setValue('P-MANUAL')
    rail.vm.$emit('inherited-order', {
      ...order,
      receipt_fields: {
        customer_code: { ...order.receipt_fields.customer_code, value: 'C-UPDATED' },
        product_code: { ...order.receipt_fields.product_code, value: 'P-UPDATED' },
      },
    })
    await flushPromises()
    expect(wrapper.get('input[aria-label="客户代码"]').element).toHaveProperty('value', 'C-MANUAL')
    expect(wrapper.get('input[aria-label="编号"]').element).toHaveProperty('value', 'P-MANUAL')
    await wrapper.get('input[aria-label="流水号"]').setValue('')
    await wrapper.get('input[aria-label="客户代码"]').setValue('')
    rail.vm.$emit('inherited-order', undefined)
    await flushPromises()
    expect(wrapper.get('input[aria-label="流水号"]').element).toHaveProperty('value', '')
    expect(wrapper.get('input[aria-label="客户代码"]').element).toHaveProperty('value', '')
  })

  it('removes unattached parsed values but retains manually corrected values when an attachment is removed', async () => {
    await render()
    await uploadDocument(
      supplementalDocument('order', { customer_code: 'C-ORDER', product_code: 'P-ORDER' }),
    )
    await wrapper.get('input[aria-label="客户代码"]').setValue('C-MANUAL')
    wrapper.getComponent(WarehouseReceiptDocuments).vm.$emit('remove', 702)
    await flushPromises()
    expect(wrapper.getComponent(WarehouseReceiptDocuments).props('documents')).toEqual([])
    expect(wrapper.get('input[aria-label="客户代码"]').element).toHaveProperty('value', 'C-MANUAL')
    expect(wrapper.get('input[aria-label="编号"]').element).toHaveProperty('value', '')
    expect(wrapper.find('[aria-label="确认文件带入信息"] input').exists()).toBe(false)
  })
})
