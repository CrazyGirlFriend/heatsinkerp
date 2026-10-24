// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { reactive } from 'vue'
import { ElMessageBox } from 'element-plus'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MaterialTransferDrawer from './MaterialTransferDrawer.vue'
import MaterialTransferDetailFrame from './MaterialTransferDetailFrame.vue'
import WarehouseLocationSelect from './WarehouseLocationSelect.vue'
import ReceiptPersonInput from './ReceiptPersonInput.vue'
const person = { id: 31, team_id: 3, name: '李师傅', active: true, version: 1 }
import {
  MaterialTransferApiError,
  materialTransferApi,
  normalizeMaterialTransfer,
} from '@/services/materialTransferApi'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import type { MaterialTransfer } from '@/types/materialTransfer'
import type { TeamEmployee } from '@/types/teamBusiness'
import { showToast } from '@/stores/toast'
const live = vi.hoisted(() => ({
  refresh: async () => {},
  busy: (): boolean => false,
  request: vi.fn(),
}))
vi.mock('@/composables/useLiveRefresh', async () => {
  const { ref } = await import('vue')
  return {
    useLiveRefresh: (refresh: () => Promise<void>, options: { busy: () => boolean }) => {
      live.refresh = refresh
      live.busy = options.busy
      return { message: ref(''), request: live.request }
    },
  }
})

const state = vi.hoisted(() => ({
  auth: {
    isAdmin: false,
    isTeamAccount: true,
    currentUser: { id: 30, team_id: 3, active: true },
    currentUserError: '',
    refreshCurrentUser: vi.fn().mockResolvedValue(undefined),
  },
}))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => state.auth }))
vi.mock('@/stores/toast', () => ({ showToast: vi.fn() }))
vi.mock('@/stores/teamDirectory', () => ({
  useTeamDirectoryStore: () => ({ items: [], loading: false, refreshTeamDirectory: vi.fn() }),
}))

function fixture(overrides: Partial<MaterialTransfer> = {}) {
  return normalizeMaterialTransfer({
    id: 1,
    batch_no: 'TL20260906000001',
    serial_no: 'HS-001',
    source_team: { id: 2, name: '研磨' },
    next_team: { id: 3, name: '电镀' },
    quantity: 0,
    weight: 8.25,
    finished_quantity: 132,
    material_type: 'sludge',
    source_batch_no: 'RAW-01',
    material_name: '材质A',
    technical_requirements: '技术要求\n完整第二行',
    status: 'pending',
    locked: false,
    allowed_actions: ['confirm'],
    version: 4,
    ...overrides,
  })
}
let wrapper: VueWrapper
beforeEach(() => {
  state.auth = reactive({
    isAdmin: false,
    isTeamAccount: true,
    currentUser: { id: 30, team_id: 3, active: true },
    currentUserError: '',
    refreshCurrentUser: vi.fn().mockResolvedValue(undefined),
  })
  vi.spyOn(teamMaterialApi, 'employees').mockResolvedValue([person])
  vi.spyOn(teamMaterialApi, 'warehouseLocations').mockResolvedValue({ items: [] })
  vi.spyOn(materialTransferApi, 'get').mockResolvedValue(fixture())
  vi.spyOn(materialTransferApi, 'confirm').mockResolvedValue(
    fixture({ status: 'received', locked: true, version: 5, allowed_actions: [] }),
  )
  vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue(
    'confirm' as Awaited<ReturnType<typeof ElMessageBox.confirm>>,
  )
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
  selectReceiver = true,
) {
  wrapper = mount(MaterialTransferDrawer, {
    props: { modelValue: true, batchNo: 'TL20260906000001', ...props },
    global: {
      stubs: {
        MaterialTransferDetailFrame: {
          template: '<div><slot name="header"/><slot/><slot name="footer"/></div>',
        },
        MaterialDispatchDrawer: true,
        MaterialTransferFormDialog: true,
        MaterialTransferPrintSheet: true,
        BarcodeCard: true,
        RouterLink: { props: ['to'], template: '<a :href="to"><slot/></a>' },
      },
    },
  })
  await flushPromises()
  if (selectReceiver && wrapper.findComponent(ReceiptPersonInput).exists()) {
    wrapper.getComponent(ReceiptPersonInput).vm.$emit('update:modelValue', person)
    await flushPromises()
  }
}
async function confirm() {
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '确认签收')!
    .trigger('click')
  await flushPromises()
}

describe('material transfer receipt review', () => {
  it('uses the page receiver without a second picker and shows the saved receipt afterwards', async () => {
    await render({ receiptOnly: true, receiptReceiver: person }, false)
    expect(wrapper.findComponent(ReceiptPersonInput).exists()).toBe(false)
    expect(wrapper.get('table[aria-label="转料单据资料"]').text()).toContain(person.name)
    vi.mocked(materialTransferApi.confirm).mockResolvedValueOnce(
      fixture({
        status: 'received',
        locked: true,
        allowed_actions: [],
        received_employee_id: person.id,
        received_employee_name: person.name,
        received_at: '2026-10-13T04:30:00Z',
      }),
    )
    await confirm()
    expect(materialTransferApi.confirm).toHaveBeenCalledWith(
      'TL20260906000001',
      expect.objectContaining({ received_employee_id: person.id }),
    )
    await wrapper.setProps({ receiptReceiver: { ...person, id: 32, name: '王师傅' } })
    expect(wrapper.get('table[aria-label="转料单据资料"]').text()).toContain(person.name)
    expect(wrapper.get('table[aria-label="转料单据资料"]').text()).not.toContain('王师傅')
  })

  it.each([null, { ...person, team_id: 99 }, { ...person, active: false }])(
    'blocks receipt without an active page receiver from this team: %s',
    async (receiptReceiver) => {
      await render({ receiptOnly: true, receiptReceiver }, false)
      expect(wrapper.findComponent(ReceiptPersonInput).exists()).toBe(false)
      const button = wrapper.findAll('button').find((button) => button.text() === '确认签收')!
      expect(button.attributes('disabled')).toBeDefined()
      await button.trigger('click')
      expect(ElMessageBox.confirm).not.toHaveBeenCalled()
      expect(materialTransferApi.confirm).not.toHaveBeenCalled()
    },
  )

  it('uses a changed page receiver and disables receipt when the selection is cleared', async () => {
    await render({ receiptOnly: true, receiptReceiver: person }, false)
    await wrapper.setProps({ receiptReceiver: null })
    await confirm()
    expect(materialTransferApi.confirm).not.toHaveBeenCalled()
    await wrapper.setProps({ receiptReceiver: { ...person, id: 32, name: '王师傅' } })
    await confirm()
    expect(materialTransferApi.confirm).toHaveBeenCalledWith(
      'TL20260906000001',
      expect.objectContaining({ received_employee_id: 32 }),
    )
  })

  it('does not submit if the page selection changes during confirmation', async () => {
    let finish!: (value: Awaited<ReturnType<typeof ElMessageBox.confirm>>) => void
    vi.mocked(ElMessageBox.confirm).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    await render({ receiptOnly: true, receiptReceiver: person }, false)
    await confirm()
    await wrapper.setProps({ receiptReceiver: null })
    finish('confirm' as Awaited<ReturnType<typeof ElMessageBox.confirm>>)
    await flushPromises()
    expect(materialTransferApi.confirm).not.toHaveBeenCalled()
  })

  it('selects the receiver in its document cell and replaces the picker with the saved receipt', async () => {
    await render({}, false)
    const table = wrapper.get('table[aria-label="转料单据资料"]')
    const receiverCell = () =>
      table.findAll('th').find((cell) => cell.text() === '接收人')!.element.nextElementSibling!
    expect(receiverCell().querySelector('button[aria-label="接收人"]')).not.toBeNull()
    expect(wrapper.findAll('button[aria-label="接收人"]')).toHaveLength(1)

    await wrapper.get('button[aria-label="接收人"]').trigger('click')
    await flushPromises()
    const choice = [...document.body.querySelectorAll<HTMLButtonElement>('.person-choice')].find(
      (button) => button.textContent?.trim() === person.name,
    )!
    choice.click()
    await flushPromises()
    expect(receiverCell().textContent).toContain(person.name)
    expect(materialTransferApi.confirm).not.toHaveBeenCalled()
    expect(table.text()).not.toContain('接收时间2026-10-13')

    vi.mocked(materialTransferApi.confirm).mockResolvedValueOnce(
      fixture({
        status: 'received',
        locked: true,
        allowed_actions: [],
        received_employee_id: person.id,
        received_employee_name: person.name,
        received_by: '签收操作账号',
        received_at: '2026-10-13T04:30:00Z',
        version: 5,
      }),
    )
    await confirm()
    expect(materialTransferApi.confirm).toHaveBeenCalledWith(
      'TL20260906000001',
      expect.objectContaining({ received_employee_id: person.id }),
    )
    expect(receiverCell().textContent).toBe(person.name)
    expect(wrapper.findComponent(ReceiptPersonInput).exists()).toBe(false)
    expect(table.text()).toContain('2026-10-13')
  })

  it('keeps the inline choice after cancelling confirmation without saving a receipt', async () => {
    await render()
    vi.mocked(ElMessageBox.confirm).mockRejectedValueOnce('cancel')
    await confirm()
    expect(materialTransferApi.confirm).not.toHaveBeenCalled()
    const table = wrapper.get('table[aria-label="转料单据资料"]')
    expect(table.get('button[aria-label="接收人"]').text()).toContain(person.name)
    expect(wrapper.emitted('confirmed')).toBeUndefined()
  })

  it('requires an employee and marks just the picker before any receipt confirmation', async () => {
    await render({}, false)
    const receiver = wrapper.get<HTMLButtonElement>('button[aria-label="接收人"]').element
    receiver.animate = vi.fn()
    const focus = vi.spyOn(receiver, 'focus')
    await confirm()
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(receiver.animate).toHaveBeenCalledOnce()
    expect(materialTransferApi.confirm).not.toHaveBeenCalled()
    expect(ElMessageBox.confirm).not.toHaveBeenCalled()
    expect(wrapper.get('button[aria-label="接收人"]').attributes('aria-invalid')).toBe('true')
    wrapper.getComponent(ReceiptPersonInput).vm.$emit('update:modelValue', person)
    await flushPromises()
    await confirm()
    expect(materialTransferApi.confirm).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ received_employee_id: person.id }),
    )
  })
  it('separates actual receiver from operator and labels legacy receipts without inventing a name', async () => {
    vi.mocked(materialTransferApi.get).mockResolvedValueOnce(
      fixture({
        status: 'received',
        received_at: '2026-10-12T10:00:00Z',
        received_by: '班组长账号',
        received_employee_name: '李师傅',
        allowed_actions: [],
      }),
    )
    await render()
    const text = wrapper.get('table[aria-label="转料单据资料"]').text()
    expect(text).toContain('接收人李师傅')
    expect(text).toContain('签收操作账号班组长账号')
    vi.mocked(materialTransferApi.get).mockResolvedValueOnce(
      fixture({
        status: 'received',
        received_by: '旧账号',
        received_employee_name: null,
        allowed_actions: [],
      }),
    )
    await live.refresh()
    expect(wrapper.get('table[aria-label="转料单据资料"]').text()).toContain('接收人未登记')
  })

  it('presents a completed local processing output without edit, void or receipt actions', async () => {
    vi.mocked(materialTransferApi.get).mockResolvedValueOnce(
      fixture({
        entry_kind: 'processing_output',
        processing_role: 'produced',
        status: 'received',
        locked: true,
        allowed_actions: [],
        source_team: { id: 3, name: '电镀', code: '' },
        source_transfer_batch_no: 'TL-PARENT',
      }),
    )
    await render()
    expect(wrapper.text()).toContain('加工实物登记单')
    expect(wrapper.text()).toContain('本班组加工实物已登记')
    expect(wrapper.text()).toContain('TL-PARENT')
    expect(
      wrapper
        .findAll('button')
        .some((button) => ['编辑', '作废', '确认签收'].includes(button.text())),
    ).toBe(false)
  })
  it('allows the receiver to sign, but never edit or void even if action flags are stale', async () => {
    vi.mocked(materialTransferApi.get).mockResolvedValueOnce(
      fixture({ allowed_actions: ['edit', 'void', 'confirm'], can_edit_delivery: true }),
    )
    await render()
    expect(
      wrapper
        .findAll('button')
        .some((button) => ['编辑', '作废', '维护交期'].includes(button.text())),
    ).toBe(false)
    await confirm()
    expect(materialTransferApi.confirm).toHaveBeenCalledOnce()
  })

  it('keeps source-only actions in outbound review and excludes them from incoming review', async () => {
    state.auth.currentUser.team_id = 2
    vi.mocked(materialTransferApi.get).mockResolvedValue(
      fixture({ allowed_actions: ['edit', 'void', 'confirm'], can_edit_delivery: true }),
    )
    await render()
    const buttons = () => wrapper.findAll('button').map((button) => button.text())
    expect(buttons()).toEqual(expect.arrayContaining(['编辑', '作废', '维护交期']))
    expect(buttons()).not.toContain('确认签收')
    await wrapper.setProps({ receiptOnly: true })
    await flushPromises()
    for (const label of ['编辑', '作废', '维护交期', '确认签收'])
      expect(buttons()).not.toContain(label)
  })

  it.each(['other-team', 'admin', 'inactive', 'auth-error'] as const)(
    'blocks all transfer mutations for %s despite stale flags',
    async (actor) => {
      if (actor === 'other-team') state.auth.currentUser.team_id = 99
      if (actor === 'admin') {
        state.auth.isAdmin = true
        state.auth.isTeamAccount = false
      }
      if (actor === 'inactive') state.auth.currentUser.active = false
      if (actor === 'auth-error') state.auth.currentUserError = '登录状态读取失败'
      vi.mocked(materialTransferApi.get).mockResolvedValueOnce(
        fixture({
          allowed_actions: ['edit', 'void', 'confirm', 'reject'],
          can_edit_delivery: true,
        }),
      )
      await render()
      expect(
        wrapper
          .findAll('button')
          .some((button) =>
            ['编辑', '作废', '维护交期', '确认签收', '退回核对'].includes(button.text()),
          ),
      ).toBe(false)
    },
  )

  it('does not void after the source account becomes inactive while the prompt is open', async () => {
    state.auth.currentUser.team_id = 2
    vi.mocked(materialTransferApi.get).mockResolvedValueOnce(
      fixture({ allowed_actions: ['edit', 'void'] }),
    )
    const voidApi = vi
      .spyOn(materialTransferApi, 'void')
      .mockResolvedValue(fixture({ status: 'voided', locked: true, allowed_actions: [] }))
    let accept!: () => void
    vi.mocked(ElMessageBox.confirm).mockReturnValueOnce(
      new Promise((resolve) => {
        accept = () => resolve('confirm' as Awaited<ReturnType<typeof ElMessageBox.confirm>>)
      }),
    )
    await render()
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '作废')!
      .trigger('click')
    state.auth.currentUser.active = false
    accept()
    await flushPromises()
    expect(voidApi).not.toHaveBeenCalled()
  })

  it('records a warehouse receipt location and protects the unsaved choice from live updates', async () => {
    vi.mocked(materialTransferApi.get).mockResolvedValueOnce(
      fixture({ next_team: { id: '3', code: 'FACTORY-WAREHOUSE', name: '库房' } }),
    )
    await render()
    wrapper.getComponent(WarehouseLocationSelect).vm.$emit('update:modelValue', 'B区-02')
    wrapper
      .getComponent(WarehouseLocationSelect)
      .vm.$emit('update:reservationKey', 'test-lease-key-for-confirm')
    await flushPromises()
    expect(live.busy()).toBe(true)
    await confirm()
    expect(materialTransferApi.confirm).toHaveBeenCalledWith('TL20260906000001', {
      idempotency_key: expect.any(String),
      received_employee_id: person.id,
      expected_version: 4,
      warehouse_location: 'B区-02',
      warehouse_location_reservation_key: 'test-lease-key-for-confirm',
    })
  })
  it('hides printing in receipt review, including historical groups, without removing receipt actions', async () => {
    vi.mocked(materialTransferApi.get).mockResolvedValueOnce(
      fixture({ dispatch_no: 'CK-PENDING', allowed_actions: ['confirm', 'reject'] }),
    )
    await render({ allowPrint: false, receiptOnly: true })
    expect(wrapper.findAll('button').some((button) => button.text().includes('打印'))).toBe(false)
    expect(wrapper.findAll('button').some((button) => button.text() === '退回核对')).toBe(true)
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('历史合并记录'))!
      .trigger('click')
    expect(wrapper.getComponent({ name: 'MaterialDispatchDrawer' }).props()).toMatchObject({
      modelValue: true,
      allowPrint: false,
      receiptOnly: true,
    })
    await confirm()
    expect(materialTransferApi.confirm).toHaveBeenCalledOnce()
    expect(wrapper.findAll('button').some((button) => button.text().includes('打印'))).toBe(false)
  })

  it('returns a receipt for correction without a reason and keeps the pending-review notice', async () => {
    vi.mocked(materialTransferApi.get).mockResolvedValueOnce(
      fixture({
        next_team: { id: '3', code: 'FACTORY-WAREHOUSE', name: '库房' },
        allowed_actions: ['reject', 'confirm'],
      }),
    )
    const reject = vi
      .spyOn(materialTransferApi, 'reject')
      .mockResolvedValue(fixture({ rejection_reason: '', allowed_actions: ['reject'] }))
    vi.spyOn(ElMessageBox, 'prompt').mockResolvedValue({ value: '', action: 'confirm' } as Awaited<
      ReturnType<typeof ElMessageBox.prompt>
    >)
    await render()
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '退回核对')!
      .trigger('click')
    await flushPromises()
    expect(reject).toHaveBeenCalledWith('TL20260906000001', '', 4)
    const options = vi.mocked(ElMessageBox.prompt).mock.calls[0]![2]!
    expect((options.inputValidator as (value: string) => boolean)('')).toBe(true)
    expect(wrapper.text()).toContain('已退回核对，待上序修正')
    expect(wrapper.findAll('button').some((button) => button.text() === '确认签收')).toBe(false)
  })
  it('keeps pending outbound documents printable by default', async () => {
    vi.mocked(materialTransferApi.get).mockResolvedValueOnce(
      fixture({
        source_team: { id: 3, code: 'FACTORY-PLATE', name: '电镀' },
        next_team: { id: 4, code: 'FACTORY-QC', name: '检验' },
        allowed_actions: ['edit', 'void'],
      }),
    )
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    await render()
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '打印转料单')!
      .trigger('click')
    await flushPromises()
    expect(print).toHaveBeenCalledOnce()
    expect(document.body.classList.contains('material-transfer-printing')).toBe(false)
  })

  it('prints the latest single-batch values after refreshing the document', async () => {
    await render()
    vi.mocked(materialTransferApi.get).mockResolvedValueOnce(
      fixture({ weight: 12.345678, version: 5 }),
    )
    const print = vi.spyOn(window, 'print').mockImplementation(() => {
      expect(
        wrapper.getComponent({ name: 'MaterialTransferPrintSheet' }).props('transfer').weight,
      ).toBe(12.345678)
      expect(document.body.classList.contains('material-transfer-printing')).toBe(true)
    })
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '打印转料单')!
      .trigger('click')
    await flushPromises()
    expect(print).toHaveBeenCalledOnce()
    expect(document.body.classList.contains('material-transfer-printing')).toBe(false)
  })

  it('does not print stale single-batch data if its refresh fails', async () => {
    await render()
    vi.mocked(materialTransferApi.get).mockRejectedValueOnce(new Error('最新批次读取失败'))
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '打印转料单')!
      .trigger('click')
    await flushPromises()
    expect(print).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith('最新批次读取失败', 'error')
    expect(document.body.classList.contains('material-transfer-printing')).toBe(false)
  })

  it('cancels a pending single-batch print when its drawer closes', async () => {
    await render()
    let finish!: (row: MaterialTransfer) => void
    vi.mocked(materialTransferApi.get).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '打印转料单')!
      .trigger('click')
    await wrapper.setProps({ modelValue: false })
    finish(fixture())
    await flushPromises()
    expect(print).not.toHaveBeenCalled()
    expect(document.body.classList.contains('material-transfer-printing')).toBe(false)
  })

  it.each(['warehouse_outbound', 'inspection_shipment'] as const)(
    'explains that %s remains owned until confirmation',
    async (entry_kind) => {
      vi.mocked(materialTransferApi.get).mockResolvedValueOnce(
        fixture({
          entry_kind,
          source_team: { id: 3, code: 'FACTORY-QC', name: '本班组' },
          external_destination: '外部单位',
          allowed_actions: ['confirm_outbound'],
        }),
      )
      await render()
      expect(wrapper.text()).toContain('确认后扣减库存')
      expect(wrapper.text()).not.toContain('已扣减库存')
      vi.mocked(ElMessageBox.confirm).mockRejectedValueOnce('cancel')
      await wrapper
        .findAll('button')
        .find((button) => /^(确认出库|确认发货)$/.test(button.text()))!
        .trigger('click')
      await flushPromises()
      expect(ElMessageBox.confirm).toHaveBeenCalledWith(
        expect.stringContaining('确认后扣减本班组库存，单据不可再修改'),
        expect.any(String),
        expect.any(Object),
      )
    },
  )

  it('updates read-only fields, but keeps the reviewed version during a confirmation', async () => {
    await render()
    const table = wrapper.get('table[aria-label="转料单据资料"]').element
    vi.mocked(materialTransferApi.get).mockResolvedValueOnce(fixture({ quantity: 77, version: 5 }))
    await live.refresh()
    await flushPromises()
    expect(wrapper.get('table[aria-label="转料单据资料"]').element).toBe(table)
    expect(wrapper.text()).toContain('77 件')
    let finish!: (result: MaterialTransfer) => void
    vi.mocked(materialTransferApi.get).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const reading = live.refresh()
    let cancel!: (reason: string) => void
    vi.mocked(ElMessageBox.confirm).mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        cancel = reject
      }),
    )
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '确认签收')!
      .trigger('click')
    expect(live.busy()).toBe(true)
    finish(fixture({ quantity: 99, version: 6 }))
    await reading
    await flushPromises()
    expect(wrapper.text()).toContain('77 件')
    expect(live.request).toHaveBeenCalled()
    cancel('cancel')
    await flushPromises()
    expect(live.busy()).toBe(false)
  })
  it('puts the whole document and history in tables without summary cards or tabs', async () => {
    vi.mocked(materialTransferApi.get).mockResolvedValueOnce(
      fixture({
        product_code: 'P-001',
        material_description: '完整物料说明',
        notes: '本批说明',
        history: [
          {
            id: 11,
            action: 'created',
            actor: '登记员',
            occurred_at: '2026-09-07T00:00:00Z',
            changes: {},
          },
        ],
      }),
    )
    await render()
    const document = wrapper.get('table[aria-label="转料单据资料"]')
    for (const value of [
      'HS-001',
      '研磨',
      '电镀',
      '0 件',
      '8.25 kg',
      'P-001',
      '完整物料说明',
      '本批说明',
    ])
      expect(document.text()).toContain(value)
    expect(wrapper.findAll('[role="tab"]')).toHaveLength(0)
    expect(wrapper.find('.handoff-panel, .transfer-amounts, .barcode-panel').exists()).toBe(false)
    expect(wrapper.get('table.document-history').text()).toContain('登记员')
  })
  it('shows warehouse intake origin and audit without a second receipt or mutation action', async () => {
    vi.mocked(materialTransferApi.get).mockResolvedValueOnce(
      fixture({
        entry_kind: 'warehouse_receipt',
        source_team: { id: '', code: '', name: '库房手工入库' },
        status: 'received',
        locked: true,
        history: [
          {
            id: 10,
            action: 'stocked',
            actor: '库管',
            occurred_at: '2026-09-07T00:00:00Z',
            changes: {},
          },
        ],
        allowed_actions: ['edit', 'void', 'confirm'],
      }),
    )
    await render()
    expect(wrapper.text()).toContain('入库来源')
    expect(wrapper.text()).toContain('已入库')
    expect(wrapper.text()).toContain('登记人')
    expect(wrapper.text()).toContain('手工入库已完成')
    expect(
      wrapper
        .findAll('button')
        .some((button) => ['确认签收', '编辑', '作废'].includes(button.text())),
    ).toBe(false)
    expect(wrapper.findAll('button').some((button) => button.text() === '打印入库单')).toBe(true)
    expect(wrapper.get('table[aria-label="转料单据资料"]').text()).toContain('外部来源未登记')
  })
  it('preserves source requirement maintenance for the warehouse that registered an external receipt', async () => {
    vi.mocked(materialTransferApi.get).mockResolvedValueOnce(
      fixture({
        entry_kind: 'warehouse_receipt',
        source_team: { id: '', code: '', name: '外部来料' },
        status: 'received',
        locked: true,
        allowed_actions: [],
        can_edit_delivery: true,
      }),
    )
    await render()
    const buttons = wrapper.findAll('button').map((button) => button.text())
    expect(buttons).toContain('维护交期')
    for (const label of ['编辑', '作废', '确认签收']) expect(buttons).not.toContain(label)
  })
  it('allows receipt of a legacy warehouse transfer with no material classification', async () => {
    vi.mocked(materialTransferApi.get).mockResolvedValueOnce(
      fixture({
        material_type: null,
        next_team: { id: 3, code: 'DEPOT', name: '库房', kind: 'warehouse' },
      }),
    )
    await render()
    expect(wrapper.text()).toContain('未填写')
    expect(wrapper.text()).toContain('入库说明')
    await confirm()
    expect(materialTransferApi.confirm).toHaveBeenCalledOnce()
    expect(vi.mocked(materialTransferApi.confirm).mock.calls[0]![1]).not.toHaveProperty(
      'material_type',
    )
  })

  it('keeps team accounts on their own receipt history, including global transfer details', async () => {
    await render()
    expect(wrapper.get('a').attributes('href')).toBe(
      '/team-workspaces/3?serial_no=HS-001&tab=history&direction=all',
    )
    await wrapper.setProps({ traceScope: { team_id: 3, direction: 'incoming' } })
    expect(wrapper.get('a').attributes('href')).toBe(
      '/team-workspaces/3?serial_no=HS-001&tab=history&direction=incoming',
    )
  })

  it('displays the complete scanned document and confirms only the reviewed version without amount input', async () => {
    await render()
    expect(wrapper.text()).toContain('废泥')
    expect(wrapper.text()).toContain('RAW-01')
    expect(wrapper.text()).toContain('132 件')
    expect(wrapper.text()).toContain('技术要求\n完整第二行')
    expect(wrapper.find('input[type="number"]').exists()).toBe(false)
    expect(wrapper.get('table[aria-label="转料单据资料"]').text()).toContain('待签收')
    await confirm()
    expect(materialTransferApi.confirm).toHaveBeenCalledWith('TL20260906000001', {
      idempotency_key: expect.any(String),
      received_employee_id: person.id,
      expected_version: 4,
    })
    expect(wrapper.get('table[aria-label="转料单据资料"]').text()).toContain('已接收')
    expect(
      wrapper
        .findAll('button')
        .some((button) => ['编辑', '作废', '确认签收'].includes(button.text())),
    ).toBe(false)
  })

  it('refreshes a conflicting receipt, shows the changed document and waits for a second confirmation', async () => {
    await render()
    vi.mocked(materialTransferApi.confirm).mockRejectedValueOnce(
      new MaterialTransferApiError('单据已更新', 409),
    )
    vi.mocked(materialTransferApi.get).mockResolvedValueOnce(
      fixture({ version: 5, material_name: '更新后的材质', weight: 9 }),
    )
    await confirm()
    expect(materialTransferApi.confirm).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('更新后的材质')
    expect(wrapper.text()).toContain('请重新核对最新内容后接收')
    expect(wrapper.get('table[aria-label="转料单据资料"]').text()).toContain('待签收')
    await confirm()
    expect(materialTransferApi.confirm).toHaveBeenLastCalledWith('TL20260906000001', {
      idempotency_key: expect.any(String),
      received_employee_id: person.id,
      expected_version: 5,
    })
  })

  it('blocks another confirmation while the updated record cannot be loaded', async () => {
    await render()
    vi.mocked(materialTransferApi.confirm).mockRejectedValueOnce(
      new MaterialTransferApiError('单据已更新', 409),
    )
    vi.mocked(materialTransferApi.get).mockRejectedValueOnce(new Error('offline'))
    await confirm()
    expect(wrapper.findAll('button').some((button) => button.text() === '确认签收')).toBe(false)
    expect(wrapper.findAll('button').some((button) => button.text() === '重新读取')).toBe(true)
    expect(wrapper.get('table[aria-label="转料单据资料"]').text()).toContain('待签收')
  })

  it('does not invent a version for old responses and renders real history only', async () => {
    vi.mocked(materialTransferApi.get).mockResolvedValue(
      fixture({
        version: null,
        history: [
          {
            id: 9,
            action: 'updated',
            actor: '李师傅',
            occurred_at: '2026-09-06T01:20:00Z',
            changes: {
              finished_quantity: { before: null, after: 132 },
              customer_code: { before: '001440', after: null },
            },
          },
        ],
      }),
    )
    await render()
    expect(wrapper.text()).toContain('李师傅')
    expect(wrapper.text()).toContain('成品件数')
    expect(wrapper.text()).toContain('001440')
    await confirm()
    expect(vi.mocked(materialTransferApi.confirm).mock.calls[0]![1]).not.toHaveProperty(
      'expected_version',
    )
  })

  it('keeps detail history when a same-version list refresh contains an empty history array', async () => {
    const event = {
      id: 12,
      action: 'updated' as const,
      actor: '保留的历史操作者',
      occurred_at: '2026-09-06T01:20:00Z',
      changes: { quantity: { before: 1, after: 0 } },
    }
    vi.mocked(materialTransferApi.get).mockResolvedValue(fixture({ history: [event] }))
    await render()
    await wrapper.setProps({ transfer: fixture({ history: [] }) })
    await flushPromises()
    expect(wrapper.text()).toContain('保留的历史操作者')
    expect(materialTransferApi.get).toHaveBeenCalledTimes(1)
  })

  it('loads canonical detail when a list refresh reports a newer version', async () => {
    await render()
    vi.mocked(materialTransferApi.get).mockResolvedValueOnce(
      fixture({
        version: 5,
        history: [
          {
            id: 15,
            action: 'updated',
            actor: '新版本操作者',
            occurred_at: '2026-09-06T01:30:00Z',
            changes: { weight: { before: 8.25, after: 9 } },
          },
        ],
      }),
    )
    await wrapper.setProps({ transfer: fixture({ version: 5, history: [] }) })
    await flushPromises()
    expect(materialTransferApi.get).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('新版本操作者')
  })
})

it('reports completed exit only when the material document has actually closed', async () => {
  await render()
  const frame = wrapper.getComponent(MaterialTransferDetailFrame)
  frame.vm.$emit('closed')
  await flushPromises()
  expect(wrapper.emitted('closed')).toBeUndefined()
  frame.vm.$emit('closed')
  await wrapper.setProps({ modelValue: false })
  await flushPromises()
  expect(wrapper.emitted('closed')).toEqual([[]])
})
