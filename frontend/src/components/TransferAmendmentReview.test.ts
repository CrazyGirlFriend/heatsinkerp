// @vitest-environment jsdom
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TransferAmendmentReview from './TransferAmendmentReview.vue'
import { transferAmendmentApi, type TransferAmendment } from '@/services/transferAmendmentApi'
import { HttpRequestError } from '@/services/httpClient'

function fixture(overrides: Partial<TransferAmendment> = {}): TransferAmendment {
  return {
    id: 11,
    batch_no: 'TL-001',
    serial_no: 'HS-001',
    status: 'pending',
    reason: '重新核对件数',
    requester_team_id: 1,
    requester_team_name: '轧制',
    counterparty_team_id: 2,
    counterparty_team_name: '研磨',
    requested_by: '张师傅',
    created_at: '2026-11-03T00:00:00Z',
    resolved_at: null,
    resolved_by: null,
    response_reason: null,
    before: { quantity: 100, weight: 10, notes: null },
    after: { quantity: 95, weight: 9.5, notes: '复核后件数' },
    allowed_actions: ['approve', 'reject'],
    ...overrides,
  }
}
let wrapper: VueWrapper
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
})
async function render(value = fixture()) {
  vi.spyOn(transferAmendmentApi, 'get').mockResolvedValue(value)
  wrapper = mount(TransferAmendmentReview, {
    props: { amendmentId: value.id, showTransferLink: true },
    global: { stubs: { PersonName: { props: ['name'], template: '<span>{{ name }}</span>' } } },
  })
  await flushPromises()
}
function button(text: string) {
  return wrapper.findAll('button').find((item) => item.text() === text)!
}

describe('transfer amendment review', () => {
  it('opens a proposal without approving it and shows precise before/after values', async () => {
    const approve = vi.spyOn(transferAmendmentApi, 'approve')
    await render()
    expect(wrapper.get('table').text()).toContain('100')
    expect(wrapper.get('table').text()).toContain('95')
    expect(wrapper.text()).toContain('重新核对件数')
    expect(wrapper.text()).toContain('对方确认后生效')
    expect(approve).not.toHaveBeenCalled()
    await button('查看转料单').trigger('click')
    expect(wrapper.emitted('view-transfer')).toEqual([['TL-001']])
  })
  it('only exposes withdrawal to the requester and no decisions to a read-only account', async () => {
    await render(fixture({ allowed_actions: ['cancel'] }))
    expect(button('撤回申请')).toBeTruthy()
    expect(button('确认修改')).toBeUndefined()
    expect(button('拒绝')).toBeUndefined()
    vi.mocked(transferAmendmentApi.get).mockResolvedValue(fixture({ id: 12, allowed_actions: [] }))
    await wrapper.setProps({ amendmentId: 12 })
    await flushPromises()
    expect(button('撤回申请')).toBeUndefined()
  })
  it('prevents double approval, then replaces actions with the resolved record', async () => {
    let resolve!: (result: TransferAmendment) => void
    const approve = vi.spyOn(transferAmendmentApi, 'approve').mockReturnValue(
      new Promise((done) => {
        resolve = done
      }),
    )
    await render()
    await button('确认修改').trigger('click')
    await button('确认修改').trigger('click')
    expect(approve).toHaveBeenCalledTimes(1)
    const result = fixture({
      status: 'approved',
      allowed_actions: [],
      resolved_by: '王师傅',
      resolved_at: '2026-11-03T01:00:00Z',
    })
    resolve(result)
    await flushPromises()
    expect(wrapper.emitted('resolved')).toEqual([[result]])
    expect(wrapper.text()).toContain('已生效')
    expect(button('确认修改')).toBeUndefined()
  })
  it('requires a rejection reason, preserves errors and allows a deliberate retry', async () => {
    const reject = vi
      .spyOn(transferAmendmentApi, 'reject')
      .mockRejectedValueOnce(new Error('暂时无法连接'))
    await render()
    await button('拒绝').trigger('click')
    await button('确认拒绝').trigger('click')
    expect(wrapper.text()).toContain('请填写拒绝原因')
    expect(reject).not.toHaveBeenCalled()
    await wrapper.get('textarea').setValue('已核对原数量正确')
    await button('确认拒绝').trigger('click')
    await flushPromises()
    expect(reject).toHaveBeenCalledWith(11, '已核对原数量正确')
    expect(wrapper.get('textarea').element.value).toBe('已核对原数量正确')
    expect(wrapper.text()).toContain('暂时无法连接')
    expect(wrapper.emitted('resolved')).toBeUndefined()
  })
  it('refreshes decisions after a conflict without automatically applying anything', async () => {
    vi.spyOn(transferAmendmentApi, 'approve').mockRejectedValue(
      new HttpRequestError('申请已由其他人处理', 409),
    )
    await render()
    vi.mocked(transferAmendmentApi.get).mockResolvedValue(
      fixture({ status: 'cancelled', allowed_actions: [] }),
    )
    await button('确认修改').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('已撤回')
    expect(wrapper.text()).toContain('申请已由其他人处理')
    expect(button('确认修改')).toBeUndefined()
    expect(transferAmendmentApi.approve).toHaveBeenCalledTimes(1)
  })
  it('ignores a response for a proposal the user has already left', async () => {
    let resolve!: (result: TransferAmendment) => void
    await render()
    vi.mocked(transferAmendmentApi.get).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done
      }),
    )
    await wrapper.setProps({ amendmentId: 12 })
    vi.mocked(transferAmendmentApi.get).mockResolvedValue(fixture({ id: 13, reason: '当前申请' }))
    await wrapper.setProps({ amendmentId: 13 })
    await flushPromises()
    resolve(fixture({ id: 12, reason: '已离开的申请' }))
    await flushPromises()
    expect(wrapper.text()).toContain('当前申请')
    expect(wrapper.text()).not.toContain('已离开的申请')
  })
})
