// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { reactive } from 'vue'
import { ElInputNumber, ElSelect, ElSwitch, ElDatePicker } from 'element-plus'
import WarehouseLocationSelect from './WarehouseLocationSelect.vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WarehouseReceiptDialog from './WarehouseReceiptDialog.vue'
import MaterialInput from './MaterialInput.vue'
import ProcessRouteEditor from './ProcessRouteEditor.vue'
import ImportedDocumentPreview from './ImportedDocumentPreview.vue'
import WordDocumentPreview from './WordDocumentPreview.vue'
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
        WordDocumentPreview: true,
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
  wrapper.findAllComponents(ElSelect)[1]!.vm.$emit('update:modelValue', 'semi_finished')
  await amount('入库件数', 0)
  await amount('入库重量', 0.005)
  await wrapper.get('textarea[aria-label="入库说明"]').setValue('  实物到货登记  ')
}
async function submit() {
  await wrapper.get('form').trigger('submit')
  await flushPromises()
}

describe('warehouse manual receipt', () => {
  it('submits one shared physical batch with distinct order requirements, validates duplicate identities and preserves retries', async () => {
    vi.mocked(teamMaterialApi.createReceipt).mockRejectedValueOnce(
      new TeamMaterialApiError('网络中断'),
    )
    await render()
    await fill()
    wrapper.getComponent(ElSwitch).vm.$emit('update:modelValue', true)
    await flushPromises()
    expect(wrapper.find('input[aria-label="流水号"]').exists()).toBe(false)
    await wrapper.get('input[aria-label="共投流水号1"]').setValue(' A ')
    await wrapper.get('input[aria-label="共投流水号2"]').setValue('a')
    await submit()
    expect(teamMaterialApi.createReceipt).not.toHaveBeenCalled()
    expect(
      wrapper
        .get('input[aria-label="共投流水号2"]')
        .element.closest('.el-form-item')
        ?.classList.contains('is-error'),
    ).toBe(true)
    await wrapper.get('input[aria-label="共投流水号2"]').setValue('B')
    await submit()
    expect(teamMaterialApi.createReceipt).not.toHaveBeenCalled()
    expect(
      wrapper
        .get('input[aria-label="共投计划重量1"]')
        .element.closest('.el-form-item')
        ?.classList.contains('is-error'),
    ).toBe(true)
    for (const index of [1, 2]) {
      await amount(`共投计划重量${index}`, 0.0025)
      await amount(`共投计划件数${index}`, 30)
      await wrapper.get(`input[aria-label="共投计划切割尺寸${index}"]`).setValue('25 × 12 × 2 mm')
    }
    await wrapper.get('input[aria-label="共投客户1"]').setValue('CA')
    await wrapper.get('input[aria-label="共投成品规格1"]').setValue('20 × 10 × 2 mm')
    wrapper.findAllComponents(ElDatePicker)[0]!.vm.$emit('update:modelValue', '2026-11-01')
    wrapper
      .findAllComponents(ElInputNumber)
      .find((input) => input.props('ariaLabel') === '共投应发件数1')!
      .vm.$emit('update:modelValue', 30)
    await submit()
    const original = vi.mocked(teamMaterialApi.createReceipt).mock.calls[0]![1]
    expect(original).toMatchObject({
      serial_no: '',
      quantity: 0,
      weight: 0.005,
      customer_code: null,
      finished_specification: null,
      delivery_date: null,
      delivery_quantity: null,
      shared_serials: [
        {
          serial_no: 'A',
          customer_code: 'CA',
          finished_specification: '20 × 10 × 2 mm',
          delivery_date: '2026-11-01',
          delivery_quantity: 30,
          planned_weight: 0.0025,
          planned_quantity: 30,
          planned_specification: '25 × 12 × 2 mm',
        },
        {
          serial_no: 'B',
          customer_code: null,
          finished_specification: null,
          delivery_date: null,
          delivery_quantity: null,
          planned_weight: 0.0025,
          planned_quantity: 30,
          planned_specification: '25 × 12 × 2 mm',
        },
      ],
    })
    wrapper.unmount()
    await render()
    await submit()
    expect(vi.mocked(teamMaterialApi.createReceipt).mock.calls[1]![1]).toEqual(original)
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
    wrapper.findAllComponents(ElSelect)[1]!.vm.$emit('update:modelValue', 'semi_finished')
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
    wrapper.findAllComponents(ElSelect)[1]!.vm.$emit('update:modelValue', 'sludge')
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
    wrapper.findAllComponents(ElSelect)[0]!.vm.$emit('update:modelValue', 'return')
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
    expect(wrapper.findAllComponents(ElSelect)).toHaveLength(5)
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
  wrapper.findAllComponents(ElSelect)[1]!.vm.$emit('update:modelValue', 'scrap_chips')
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
async function importFile(openPreview = false) {
  const input = wrapper.get('input[type="file"]')
  Object.defineProperty(input.element, 'files', {
    value: [new File(['word'], '生产工艺单.docx')],
    configurable: true,
  })
  await input.trigger('change')
  await flushPromises()
  if (openPreview) {
    const preview = wrapper.findAll('button').find((button) => button.text() === '查看原始 Word')
    if (preview) {
      await preview.trigger('click')
      await flushPromises()
    }
  }
}
async function originalButton(label: '查看原始 Word' | '收起原文') {
  await wrapper
    .findAll('button')
    .find((button) => button.text() === label)!
    .trigger('click')
  await flushPromises()
}
async function reviewImportedRoute() {
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '核对工艺')!
    .trigger('click')
  const editor = wrapper.getComponent(ProcessRouteEditor)
  expect(editor.props('intake')).toBe(true)
  editor.vm.$emit('reviewed', editor.props('route'))
  await flushPromises()
}

describe('库房创建流水号导入工艺单', () => {
  it('fills the receipt form with extracted data and keeps original values visible after manual edits', async () => {
    vi.spyOn(processRouteApi, 'import').mockResolvedValue(importedDocument())
    await render()
    await importFile(true)
    expect(wrapper.get('input[aria-label="流水号"]').element).toHaveProperty('value', 'IMPORT-01')
    expect(wrapper.get('input[aria-label="材质"]').element).toHaveProperty('value', '钼铜')
    expect(wrapper.get('input[aria-label="客户代码"]').element).toHaveProperty('value', 'C-11600')
    expect(wrapper.get('input[aria-label="编号"]').element).toHaveProperty('value', 'T4-03')
    expect(wrapper.get('input[aria-label="要求发货日期"]').element).toHaveProperty(
      'value',
      '2026-11-01',
    )
    expect(wrapper.getComponent(ImportedDocumentPreview).props('currentValues')).toMatchObject({
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
    const preview = wrapper.getComponent(ImportedDocumentPreview)
    expect(preview.props('route').source_data.receipt_fields!.material_name!.value).toBe('钼铜')
    expect(preview.props('currentValues')!.material_name).toBe('人工核对材质')
  })

  it('preserves manually filled fields while importing remaining blank fields', async () => {
    vi.spyOn(processRouteApi, 'import').mockResolvedValue(importedDocument())
    await render()
    await wrapper.get('input[aria-label="材质"]').setValue('手工材质')
    await wrapper.get('input[aria-label="客户代码"]').setValue('手工客户')
    await amount('入库重量', 99)
    await importFile(true)
    expect(wrapper.get('input[aria-label="材质"]').element).toHaveProperty('value', '手工材质')
    expect(wrapper.get('input[aria-label="客户代码"]').element).toHaveProperty('value', '手工客户')
    expect(wrapper.getComponent(ImportedDocumentPreview).props('currentValues')).toMatchObject({
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
    vi.spyOn(processRouteApi, 'import').mockResolvedValueOnce(first).mockResolvedValueOnce(next)
    await render()
    await importFile(true)
    await wrapper.get('input[aria-label="材质"]').setValue('手工核对材质')
    await importFile(true)
    expect(wrapper.get('input[aria-label="材质"]').element).toHaveProperty('value', '手工核对材质')
    expect(wrapper.get('input[aria-label="客户代码"]').element).toHaveProperty('value', 'C-NEW')
    const preview = wrapper.getComponent(ImportedDocumentPreview)
    expect(preview.props('route').id).toBe(99)
    expect(preview.props('currentValues')!.quantity).toBe(52)
    expect(preview.props('route').source_data.receipt_fields!.material_name!.value).toBe(
      '第二份材质',
    )
    expect(first.source_data.receipt_fields!.material_name!.value).toBe('钼铜')
  })

  it('never turns the order or planned production quantity into actual stock', async () => {
    const route = importedDocument()
    delete route.source_data.receipt_fields!.quantity
    delete route.source_data.receipt_fields!.weight
    vi.spyOn(processRouteApi, 'import').mockResolvedValue(route)
    await render()
    await importFile(true)
    expect(wrapper.getComponent(ImportedDocumentPreview).props('currentValues')).toMatchObject({
      quantity: 0,
      weight: 0,
      delivery_quantity: 18100,
    })
    expect(
      wrapper.getComponent(ImportedDocumentPreview).props('route').source_data.tables,
    ).toContainEqual([
      ['订单数量', '18100'],
      ['计划加工数量', '4008'],
    ])
  })

  it('creates shared serial rows but assigns customer and delivery information only to the main serial', async () => {
    const route = importedDocument()
    route.serial_nos = ['IMPORT-02', 'IMPORT-01', 'IMPORT-03']
    vi.spyOn(processRouteApi, 'import').mockResolvedValue(route)
    await render()
    await importFile(true)
    expect(wrapper.find('input[aria-label="流水号"]').exists()).toBe(false)
    expect(wrapper.get('input[aria-label="共投流水号1"]').element).toHaveProperty(
      'value',
      'IMPORT-02',
    )
    expect(wrapper.get('input[aria-label="共投流水号2"]').element).toHaveProperty(
      'value',
      'IMPORT-01',
    )
    expect(wrapper.get('input[aria-label="共投流水号3"]').element).toHaveProperty(
      'value',
      'IMPORT-03',
    )
    expect(wrapper.get('input[aria-label="共投客户2"]').element).toHaveProperty('value', 'C-11600')
    for (const index of [1, 3]) {
      expect(wrapper.get(`input[aria-label="共投客户${index}"]`).element).toHaveProperty(
        'value',
        '',
      )
    }
    const dates = wrapper.findAllComponents(ElDatePicker)
    expect(dates.map((date) => date.props('modelValue'))).toEqual([null, '2026-11-01', null])
    const quantities = wrapper
      .findAllComponents(ElInputNumber)
      .filter((field) => String(field.props('ariaLabel')).startsWith('共投应发件数'))
    expect(quantities.map((field) => field.props('modelValue'))).toEqual([null, 18100, null])
  })

  it('does not overwrite current fields or an earlier source document when import fails', async () => {
    const request = vi.spyOn(processRouteApi, 'import').mockResolvedValueOnce(importedDocument())
    await render()
    await importFile(true)
    await wrapper.get('input[aria-label="材质"]').setValue('已核对材质')
    request.mockRejectedValueOnce(new Error('文件不是支持的工艺表'))
    await importFile(true)
    expect(wrapper.text()).toContain('文件不是支持的工艺表')
    expect(wrapper.get('input[aria-label="材质"]').element).toHaveProperty('value', '已核对材质')
    expect(wrapper.getComponent(ImportedDocumentPreview).props('route').id).toBe(routeFixture.id)
    expect(wrapper.getComponent(ImportedDocumentPreview).props('currentValues')!.quantity).toBe(41)
  })

  it('blocks posting during upload and ignores a late import after closing and reopening', async () => {
    let finish!: (route: ProcessRoute) => void
    vi.spyOn(processRouteApi, 'import').mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    await render()
    await fill()
    await importFile(true)
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
    expect(wrapper.findComponent(ImportedDocumentPreview).exists()).toBe(false)
    expect(wrapper.get('input[aria-label="流水号"]').element).toHaveProperty('value', '')
    expect(wrapper.get('input[aria-label="材质"]').element).toHaveProperty('value', '')
  })

  it('marks unreviewed route red and carries the reviewed route into one idempotent receipt retry', async () => {
    vi.spyOn(processRouteApi, 'import').mockResolvedValue(importedDocument())
    vi.mocked(teamMaterialApi.createReceipt).mockRejectedValueOnce(
      new TeamMaterialApiError('网络中断'),
    )
    await render()
    await importFile(true)
    wrapper.findAllComponents(ElSelect)[1]!.vm.$emit('update:modelValue', 'raw_material')
    await flushPromises()
    await submit()
    expect(teamMaterialApi.createReceipt).not.toHaveBeenCalled()
    expect(wrapper.get('.receipt-route-review .el-form-item').classes()).toContain('is-error')
    await reviewImportedRoute()
    await submit()
    const original = vi.mocked(teamMaterialApi.createReceipt).mock.calls[0]![1]
    expect(original).toMatchObject({
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
    expect(processRouteApi.import).toHaveBeenCalledOnce()
  })

  it('clears a definitive route-version conflict, refreshes the draft and requires another review', async () => {
    const latest = importedDocument()
    latest.version = 2
    latest.steps[1]!.instructions = '更新后的工艺要求'
    vi.spyOn(processRouteApi, 'import').mockResolvedValue(importedDocument())
    vi.mocked(processRouteApi.detail).mockResolvedValue(latest)
    vi.mocked(teamMaterialApi.createReceipt).mockRejectedValueOnce(
      new TeamMaterialApiError('工艺版本已更新，请重新核对', 409),
    )
    await render()
    await importFile(true)
    wrapper.findAllComponents(ElSelect)[1]!.vm.$emit('update:modelValue', 'raw_material')
    await flushPromises()
    await reviewImportedRoute()
    await submit()
    const rejected = vi.mocked(teamMaterialApi.createReceipt).mock.calls[0]![1]
    expect(processRouteApi.detail).toHaveBeenCalledWith(routeFixture.id)
    expect(sessionStorage.length).toBe(0)
    expect(wrapper.get('input[aria-label="流水号"]').attributes('disabled')).toBeUndefined()
    expect(wrapper.getComponent(ImportedDocumentPreview).props('route').version).toBe(2)
    expect(wrapper.text()).toContain('请核对执行班组、任务和工艺要求')
    await submit()
    expect(teamMaterialApi.createReceipt).toHaveBeenCalledOnce()
    expect(wrapper.get('.receipt-route-review .el-form-item').classes()).toContain('is-error')
    await reviewImportedRoute()
    await submit()
    const corrected = vi.mocked(teamMaterialApi.createReceipt).mock.calls[1]![1]
    expect(corrected.process_route?.version).toBe(2)
    expect(corrected.process_route?.steps[1]!.instructions).toBe('更新后的工艺要求')
    expect(corrected.idempotency_key).not.toBe(rejected.idempotency_key)
  })

  it('keeps source comparison and focus attached to the main shared row after renaming its serial', async () => {
    const route = importedDocument()
    route.serial_nos = ['IMPORT-02', 'IMPORT-01']
    vi.spyOn(processRouteApi, 'import').mockResolvedValue(route)
    await render()
    await importFile(true)
    await wrapper.get('input[aria-label="共投流水号2"]').setValue('CORRECTED-01')
    const customer = wrapper.get('input[aria-label="共投客户2"]')
    await customer.setValue('C-CORRECTED')
    wrapper.findAllComponents(ElDatePicker)[1]!.vm.$emit('update:modelValue', '2026-12-01')
    await flushPromises()
    const preview = wrapper.getComponent(ImportedDocumentPreview)
    expect(preview.props('currentValues')).toMatchObject({
      serial_no: 'CORRECTED-01',
      customer_code: 'C-CORRECTED',
      delivery_date: '2026-12-01',
    })
    expect(preview.props('route').source_data.receipt_fields).toMatchObject({
      serial_no: { value: 'IMPORT-01' },
      customer_code: { value: 'C-11600' },
      delivery_date: { value: '2026-11-01' },
    })
    expect(
      customer.element.closest('.el-form-item')!.classList.contains('document-field--edited'),
    ).toBe(true)
    expect(wrapper.get('input[aria-label="共投客户1"]').element).toHaveProperty('value', '')
    const scroll = vi.fn()
    Object.defineProperty(customer.element, 'scrollIntoView', { value: scroll, configurable: true })
    const focus = vi.spyOn(customer.element as HTMLInputElement, 'focus')
    preview.vm.$emit('focus-field', 'customer_code')
    await flushPromises()
    expect(scroll).toHaveBeenCalledOnce()
    expect(focus).toHaveBeenCalledOnce()
  })

  it('invalidates reviewed route serials after a receipt edit and submits the reviewed receipt identities', async () => {
    vi.spyOn(processRouteApi, 'import').mockResolvedValue(importedDocument())
    await render()
    await importFile(true)
    wrapper.findAllComponents(ElSelect)[1]!.vm.$emit('update:modelValue', 'raw_material')
    await flushPromises()
    await reviewImportedRoute()
    expect(wrapper.text()).toContain('已核对，将与本次入库一起保存')
    await wrapper.get('input[aria-label="流水号"]').setValue('CORRECTED-SERIAL')
    await submit()
    expect(teamMaterialApi.createReceipt).not.toHaveBeenCalled()
    expect(wrapper.get('.receipt-route-review .el-form-item').classes()).toContain('is-error')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '核对工艺')!
      .trigger('click')
    const editor = wrapper.getComponent(ProcessRouteEditor)
    expect(editor.props('route').serial_nos).toEqual(['CORRECTED-SERIAL'])
    editor.vm.$emit('reviewed', editor.props('route'))
    await flushPromises()
    await submit()
    const body = vi.mocked(teamMaterialApi.createReceipt).mock.calls[0]![1]
    expect(body.serial_no).toBe('CORRECTED-SERIAL')
    expect(body.process_route?.serial_nos).toEqual([body.serial_no])
  })

  it.each([false, true])(
    'clears removed automatic fields while retaining manual weight edits: %s',
    async (editedWeight) => {
      const next = importedDocument()
      next.id = 100
      delete next.source_data.receipt_fields!.customer_code
      delete next.source_data.receipt_fields!.weight
      delete next.source_data.receipt_fields!.material_name
      vi.spyOn(processRouteApi, 'import')
        .mockResolvedValueOnce(importedDocument())
        .mockResolvedValueOnce(next)
      await render()
      await importFile(true)
      await wrapper.get('input[aria-label="材质"]').setValue('保留手工材质')
      if (editedWeight) await amount('入库重量', 99)
      await importFile(true)
      expect(wrapper.get('input[aria-label="客户代码"]').element).toHaveProperty('value', '')
      expect(wrapper.get('input[aria-label="材质"]').element).toHaveProperty(
        'value',
        '保留手工材质',
      )
      expect(wrapper.getComponent(ImportedDocumentPreview).props('currentValues')!.weight).toBe(
        editedWeight ? 99 : 0,
      )
      expect(
        wrapper.get('input[aria-label="客户代码"]').element.closest('.el-form-item')!.textContent,
      ).not.toContain('文件带入')
    },
  )

  it.each([false, true])(
    'updates untouched shared members on file replacement and preserves manually edited plans: %s',
    async (editedPlan) => {
      const first = importedDocument()
      first.serial_nos = ['IMPORT-01', 'IMPORT-02']
      const next = importedDocument()
      next.id = 101
      next.serial_nos = ['NEXT-01', 'NEXT-02', 'NEXT-03']
      next.source_data.receipt_fields!.serial_no!.value = 'NEXT-01'
      next.source_data.receipt_fields!.customer_code!.value = 'C-NEXT'
      vi.spyOn(processRouteApi, 'import').mockResolvedValueOnce(first).mockResolvedValueOnce(next)
      await render()
      await importFile(true)
      if (editedPlan) await amount('共投计划重量1', 120)
      await importFile(true)
      const serials = wrapper
        .findAll('input[aria-label^="共投流水号"]')
        .map((input) => (input.element as HTMLInputElement).value)
      expect(serials).toEqual(
        editedPlan ? ['IMPORT-01', 'IMPORT-02'] : ['NEXT-01', 'NEXT-02', 'NEXT-03'],
      )
      if (editedPlan) {
        const planned = wrapper
          .findAllComponents(ElInputNumber)
          .find((input) => input.props('ariaLabel') === '共投计划重量1')!
        expect(planned.props('modelValue')).toBe(120)
        expect(wrapper.get('input[aria-label="共投客户1"]').element).toHaveProperty(
          'value',
          'C-11600',
        )
      } else {
        expect(wrapper.get('input[aria-label="共投客户1"]').element).toHaveProperty(
          'value',
          'C-NEXT',
        )
      }
      expect(wrapper.getComponent(ImportedDocumentPreview).props('route').id).toBe(101)
    },
  )

  it('fills the form without a Word preview or split layout until the original is requested', async () => {
    vi.spyOn(processRouteApi, 'import').mockResolvedValue(importedDocument())
    await render()
    await importFile()
    expect(wrapper.get('input[aria-label="流水号"]').element).toHaveProperty('value', 'IMPORT-01')
    expect(wrapper.get('input[aria-label="材质"]').element).toHaveProperty('value', '钼铜')
    expect(
      wrapper
        .findAllComponents(ElInputNumber)
        .find((input) => input.props('ariaLabel') === '入库件数')!
        .props('modelValue'),
    ).toBe(41)
    expect(wrapper.findComponent(ImportedDocumentPreview).exists()).toBe(false)
    expect(wrapper.findComponent(WordDocumentPreview).exists()).toBe(false)
    expect(wrapper.get('.receipt-document-layout').classes()).not.toContain(
      'receipt-document-layout--preview',
    )
    expect(wrapper.text()).toContain('文件带入')
    await originalButton('查看原始 Word')
    expect(wrapper.get('.receipt-document-layout').classes()).toContain(
      'receipt-document-layout--preview',
    )
    expect(wrapper.getComponent(ImportedDocumentPreview).props('route').id).toBe(routeFixture.id)
    expect(wrapper.findAllComponents(WordDocumentPreview)).toHaveLength(1)
    expect(
      wrapper
        .findAll('[role="tab"]')
        .find((tab) => tab.text() === '原文件')!
        .attributes('aria-selected'),
    ).toBe('true')
  })

  it('preserves manually corrected values when the original is collapsed and reopened', async () => {
    vi.spyOn(processRouteApi, 'import').mockResolvedValue(importedDocument())
    await render()
    await importFile(true)
    await wrapper.get('input[aria-label="材质"]').setValue('人工核对材质')
    await amount('入库重量', 99)
    await originalButton('收起原文')
    expect(wrapper.findComponent(WordDocumentPreview).exists()).toBe(false)
    expect(wrapper.get('.receipt-document-layout').classes()).not.toContain(
      'receipt-document-layout--preview',
    )
    expect(wrapper.get('input[aria-label="材质"]').element).toHaveProperty('value', '人工核对材质')
    await originalButton('查看原始 Word')
    const preview = wrapper.getComponent(ImportedDocumentPreview)
    expect(preview.props('currentValues')).toMatchObject({
      material_name: '人工核对材质',
      weight: 99,
    })
    expect(preview.props('route').source_data.receipt_fields!.material_name!.value).toBe('钼铜')
    expect(processRouteApi.import).toHaveBeenCalledOnce()
  })

  it('starts collapsed again after closing and reopening the intake dialog', async () => {
    vi.spyOn(processRouteApi, 'import').mockResolvedValue(importedDocument())
    await render()
    await importFile(true)
    expect(wrapper.findComponent(WordDocumentPreview).exists()).toBe(true)
    await wrapper.setProps({ modelValue: false })
    await wrapper.setProps({ modelValue: true })
    await flushPromises()
    expect(wrapper.findComponent(WordDocumentPreview).exists()).toBe(false)
    expect(wrapper.get('.receipt-document-layout').classes()).not.toContain(
      'receipt-document-layout--preview',
    )
    await importFile()
    expect(wrapper.get('input[aria-label="流水号"]').element).toHaveProperty('value', 'IMPORT-01')
    expect(wrapper.findComponent(ImportedDocumentPreview).exists()).toBe(false)
    expect(wrapper.text()).toContain('查看原始 Word')
  })

  it('collapses the original when a replacement file fills the form and preserves hand corrections', async () => {
    const next = importedDocument()
    next.id = 102
    next.source_data.receipt_fields!.quantity!.value = 52
    vi.spyOn(processRouteApi, 'import')
      .mockResolvedValueOnce(importedDocument())
      .mockResolvedValueOnce(next)
    await render()
    await importFile(true)
    await wrapper.get('input[aria-label="材质"]').setValue('保留手工材质')
    await importFile()
    expect(wrapper.findComponent(WordDocumentPreview).exists()).toBe(false)
    expect(wrapper.get('.receipt-document-layout').classes()).not.toContain(
      'receipt-document-layout--preview',
    )
    expect(wrapper.get('input[aria-label="材质"]').element).toHaveProperty('value', '保留手工材质')
    expect(
      wrapper
        .findAllComponents(ElInputNumber)
        .find((input) => input.props('ariaLabel') === '入库件数')!
        .props('modelValue'),
    ).toBe(52)
    await originalButton('查看原始 Word')
    expect(wrapper.getComponent(ImportedDocumentPreview).props('route').id).toBe(102)
    expect(
      wrapper.getComponent(ImportedDocumentPreview).props('currentValues')!.material_name,
    ).toBe('保留手工材质')
  })
})

describe('入库导入定位与共投整体校验', () => {
  it.each([
    ['finished_specification', '成品规格'],
    ['transfer_specification', '转料规格'],
  ] as const)(
    'locates the interactive shape control for imported %s dimensions',
    async (key, label) => {
      const route = importedDocument()
      route.source_data.receipt_fields![key] = {
        value: '100 × 80 × 5 mm',
        label,
        source_row: '1:1',
        source_label: label,
      }
      vi.spyOn(processRouteApi, 'import').mockResolvedValue(route)
      await render()
      await importFile(true)
      expect(wrapper.find(`input[aria-label="${label}"]`).exists()).toBe(false)
      const shape = wrapper.get(`input[aria-label="${label}形状"]`).element as HTMLInputElement
      const scroll = vi.fn()
      Object.defineProperty(shape, 'scrollIntoView', { value: scroll, configurable: true })
      const focus = vi.spyOn(shape, 'focus')
      wrapper.getComponent(ImportedDocumentPreview).vm.$emit('focus-field', key)
      await flushPromises()
      expect(scroll).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' })
      expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    },
  )

  it('marks and locates an oversized imported shared group until excess serials are removed', async () => {
    const route = importedDocument()
    route.serial_nos = Array.from(
      { length: 21 },
      (_, index) => `IMPORT-${String(index + 1).padStart(2, '0')}`,
    )
    vi.spyOn(processRouteApi, 'import').mockResolvedValue(route)
    await render()
    await importFile()
    wrapper.findAllComponents(ElSelect)[1]!.vm.$emit('update:modelValue', 'semi_finished')
    await flushPromises()
    const amounts = new Map(
      wrapper.findAllComponents(ElInputNumber).map((input) => [input.props('ariaLabel'), input]),
    )
    for (let index = 1; index <= 21; index += 1) {
      amounts.get(`共投计划重量${index}`)!.vm.$emit('update:modelValue', 1)
      amounts.get(`共投计划件数${index}`)!.vm.$emit('update:modelValue', 1)
    }
    await flushPromises()
    await Promise.all(
      Array.from({ length: 21 }, (_, index) =>
        wrapper.get(`input[aria-label="共投计划切割尺寸${index + 1}"]`).setValue('按图纸切割'),
      ),
    )
    await reviewImportedRoute()
    const serial = wrapper.get('input[aria-label="共投流水号1"]').element as HTMLInputElement
    const scroll = vi.fn()
    Object.defineProperty(serial, 'scrollIntoView', { value: scroll, configurable: true })
    const focus = vi.spyOn(serial, 'focus')
    await submit()
    expect(teamMaterialApi.createReceipt).not.toHaveBeenCalled()
    const group = wrapper.get('[data-validation-field="members"]')
    expect(group.classes()).toContain('dialog-field')
    expect(group.classes()).toContain('is-error')
    expect(group.attributes('aria-invalid')).toBe('true')
    expect(scroll).toHaveBeenCalledWith({ block: 'center', inline: 'nearest' })
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    await wrapper.get('button[aria-label="移除共投流水号21"]').trigger('click')
    expect(group.classes()).not.toContain('is-error')
    expect(group.attributes('aria-invalid')).toBe('false')
    await reviewImportedRoute()
    await submit()
    expect(teamMaterialApi.createReceipt).toHaveBeenCalledOnce()
    expect(vi.mocked(teamMaterialApi.createReceipt).mock.calls[0]![1].shared_serials).toHaveLength(
      20,
    )
  }, 15000)
})

describe('入库基础资料与共投计划顺序', () => {
  it('keeps receipt amounts and material specifications before allocation without removing fields', async () => {
    const route = importedDocument()
    route.serial_nos = ['IMPORT-01', 'IMPORT-02', 'IMPORT-03']
    vi.spyOn(processRouteApi, 'import').mockResolvedValue(route)
    await render()
    await importFile()
    const allocation = wrapper.get('[aria-label="共投流水号安排"]').element
    for (const label of [
      '入库件数',
      '入库重量',
      '原单批号',
      '编号',
      '件号',
      '形状',
      '外委单位',
      '用途分类',
      '三级类别',
      '订单分类',
      '成品件数',
      '转料规格',
    ]) {
      const field = wrapper.get(`[aria-label="${label}"]`).element
      expect(
        field.compareDocumentPosition(allocation) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
    }
    const requirements = wrapper.get('textarea[aria-label="技术要求"]').element
    expect(
      requirements.compareDocumentPosition(allocation) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    const notes = wrapper.get('textarea[aria-label="入库说明"]').element
    expect(
      allocation.compareDocumentPosition(notes) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(wrapper.get('input[aria-label="共投客户1"]').element).toHaveProperty('value', 'C-11600')
    expect(wrapper.get('input[aria-label="共投流水号3"]').element).toHaveProperty(
      'value',
      'IMPORT-03',
    )
    expect(wrapper.text()).toContain('共投 · 3 个流水号')
    await wrapper.get('input[aria-label="编号"]').setValue('核对后的编号')
    await amount('入库重量', 180)
    expect(wrapper.get('input[aria-label="编号"]').element).toHaveProperty('value', '核对后的编号')
    expect(wrapper.findComponent(ImportedDocumentPreview).exists()).toBe(false)
  })
})
