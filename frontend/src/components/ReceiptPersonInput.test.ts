// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ReceiptPersonInput from './ReceiptPersonInput.vue'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import type { TeamEmployee } from '@/types/teamBusiness'

const person = { id: 1, team_id: 2, name: '王师傅', active: true, version: 1 }
let wrapper: VueWrapper
beforeEach(() => {
  vi.spyOn(teamMaterialApi, 'employees').mockResolvedValue([
    person,
    { ...person, id: 2, name: '停用员工', active: false },
  ])
})
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})
async function render(value: TeamEmployee | null = null) {
  wrapper = mount(ReceiptPersonInput, {
    attachTo: document.body,
    props: {
      teamId: 2,
      modelValue: value,
      'onUpdate:modelValue': (value) => wrapper.setProps({ modelValue: value }),
    },
    global: { stubs: { teleport: true } },
  })
  await flushPromises()
}
describe('receiving employee roster', () => {
  it('shows enabled employees in a searchable dialog and returns their stable identity', async () => {
    await render()
    await wrapper.get('button[aria-label="接收人"]').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.person-choice')).toHaveLength(1)
    await wrapper.get('input[aria-label="搜索接收人"]').setValue('王')
    await wrapper.get('.person-choice').trigger('click')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([person])
    expect(wrapper.get('button[aria-label="接收人"]').text()).toContain('王师傅')
  })
  it('preserves a reviewed employee on remount and clears them when the team changes', async () => {
    await render(person)
    expect(wrapper.props()).toMatchObject({ modelValue: person })
    vi.mocked(teamMaterialApi.employees).mockResolvedValue([])
    await wrapper.setProps({ teamId: 3 })
    await flushPromises()
    expect(wrapper.props()).toMatchObject({ modelValue: null })
    await wrapper.get('button[aria-label="接收人"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('请先在班组设置中添加员工')
  })
  it('discards stale responses for an earlier team', async () => {
    let resolve!: (people: TeamEmployee[]) => void
    vi.mocked(teamMaterialApi.employees).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    await render()
    vi.mocked(teamMaterialApi.employees).mockResolvedValue([
      { ...person, id: 3, team_id: 3, name: '李师傅' },
    ])
    await wrapper.setProps({ teamId: 3 })
    await flushPromises()
    resolve([person])
    await flushPromises()
    await wrapper.get('button[aria-label="接收人"]').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.person-choice').map((button) => button.text())).toEqual(['李师傅'])
  })
  it('refreshes the roster when reopened after employee maintenance', async () => {
    await render()
    let resolve!: (people: TeamEmployee[]) => void
    vi.mocked(teamMaterialApi.employees).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    await wrapper.get('button[aria-label="接收人"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('.person-panel').attributes('aria-busy')).toBe('true')
    expect(wrapper.findAll('.person-choice')).toHaveLength(0)
    resolve([{ ...person, id: 3, name: '新员工' }])
    await flushPromises()
    expect(wrapper.findAll('.person-choice').map((button) => button.text())).toEqual(['新员工'])
  })
  it('allows retry after a roster load error', async () => {
    vi.mocked(teamMaterialApi.employees).mockRejectedValueOnce(new Error('名单读取失败'))
    await render()
    expect(wrapper.get('[role="alert"]').text()).toContain('名单读取失败')
    expect(wrapper.get('button[aria-label="接收人"]').attributes('disabled')).toBeDefined()
    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(wrapper.get('button[aria-label="接收人"]').attributes('disabled')).toBeUndefined()
  })
})
