// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { ElInputNumber, ElPagination, ElSelect } from 'element-plus'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }))
const live = vi.hoisted(() => ({ refresh: async () => {} }))
vi.mock('@/composables/useLiveRefresh', async () => {
  const { ref } = await import('vue')
  return { useLiveRefresh: (refresh: () => Promise<void>) => { live.refresh = refresh; return { message: ref(''), request: vi.fn() } } }
})
vi.mock('@/stores/teamDirectory', () => ({ refreshTeamDirectory: mocks.refresh }))

import TeamsPage from './TeamsPage.vue'
import { adminApi, type Team } from '@/services/adminApi'
import { authState, clearSession } from '@/stores/auth'

let wrappers: VueWrapper[] = []
const team: Team = { id: 7, code: 'CUSTOM', name: '自定义组', active: true, kind: 'production', sort_order: 20 }

beforeEach(() => {
  mocks.refresh.mockReset().mockResolvedValue(undefined)
  authState.session = { access_token: 'admin-test', token_type: 'Bearer', user: { id: 1, username: 'admin-test', display_name: 'Admin', role: 'ADMIN', team_id: null, team: null, active: true } }
  vi.spyOn(adminApi, 'listTeams').mockResolvedValue([team])
  vi.spyOn(adminApi, 'currentUser').mockResolvedValue(authState.currentUser!)
})
afterEach(() => { wrappers.forEach((wrapper) => wrapper.unmount()); wrappers = []; clearSession(); vi.restoreAllMocks() })

async function mountTeams() {
  const wrapper = mount(TeamsPage)
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

describe('team management directory ordering', () => {
  it('does not let a delayed background response overwrite a just-saved team', async () => {
    const wrapper = await mountTeams()
    let finish!: (teams: Team[]) => void
    vi.mocked(adminApi.listTeams).mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const reading = live.refresh(); await flushPromises()
    const saved = { ...team, name: '刚保存的名称' }
    vi.spyOn(adminApi, 'updateTeam').mockResolvedValue(saved)
    await wrapper.get('tbody tr').findAll('button').find(button => button.text().includes('编辑'))!.trigger('click')
    await wrapper.get('input[aria-label="班组名称"]').setValue(saved.name)
    await wrapper.get('form').trigger('submit'); await flushPromises()
    finish([team]); await reading; await flushPromises()
    expect(wrapper.get('tbody').text()).toContain(saved.name)
  })
  it('refreshes directory rows without replacing an edit draft and retains rows on failure', async () => {
    const wrapper = await mountTeams()
    const table = wrapper.get('.el-table').element
    await wrapper.get('tbody tr').findAll('button').find(button => button.text().includes('编辑'))!.trigger('click')
    await wrapper.get('input[aria-label="班组名称"]').setValue('未保存的班组名')
    vi.mocked(adminApi.listTeams).mockResolvedValue([{ ...team, name: '服务器新名称' }])
    await live.refresh(); await flushPromises()
    expect(wrapper.get('.el-table').element).toBe(table)
    expect(wrapper.get('tbody').text()).toContain('服务器新名称')
    expect(wrapper.get('input[aria-label="班组名称"]').element).toHaveProperty('value', '未保存的班组名')
    vi.mocked(adminApi.listTeams).mockRejectedValueOnce(new Error('offline'))
    await expect(live.refresh()).rejects.toThrow()
    await flushPromises()
    expect(wrapper.get('.el-table').element).toBe(table)
  })
  it('uses ten natural-height rows and expands to twenty without summary cards', async () => {
    vi.mocked(adminApi.listTeams).mockResolvedValue(Array.from({ length: 25 }, (_, i) => ({ ...team, id: i + 1, code: `TEAM-${i}` })))
    const wrapper = await mountTeams()
    expect(wrapper.classes()).toContain('reading-workspace')
    expect(wrapper.find('.metric-strip').exists()).toBe(false)
    expect(wrapper.findAll('tbody tr')).toHaveLength(10)
    expect(wrapper.getComponent({ name: 'ElTable' }).props('height')).toBeUndefined()
    const pager = wrapper.getComponent(ElPagination)
    expect(pager.props('pageSizes')).toEqual([10, 20, 50, 100])
    pager.vm.$emit('update:page-size', 20); await flushPromises()
    expect(wrapper.findAll('tbody tr')).toHaveLength(20)
    pager.vm.$emit('update:current-page', 2); await flushPromises()
    expect(wrapper.findAll('tbody tr')).toHaveLength(5)
  })
  it('displays groups in server order and supports editing the display position', async () => {
    vi.mocked(adminApi.listTeams).mockResolvedValue([team, { ...team, id: 3, name: '更靠前的组', code: 'FIRST', sort_order: 10 }])
    const update = vi.spyOn(adminApi, 'updateTeam').mockResolvedValue({ ...team, sort_order: 5 })
    const wrapper = await mountTeams()
    expect(wrapper.findAll('tbody tr')[0]?.text()).toContain('更靠前的组')
    expect(wrapper.findAll('tbody tr')[0]?.text()).toContain('普通班组')
    const edit = wrapper.findAll('tbody tr')[1]!.findAll('button').find((button) => button.text().includes('编辑'))
    await edit!.trigger('click')
    expect(wrapper.findAllComponents(ElSelect).some((select) => select.attributes('aria-label') === '班组类型')).toBe(false)
    wrapper.getComponent(ElInputNumber).vm.$emit('update:modelValue', 5)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(update).toHaveBeenCalledWith(7, expect.objectContaining({ kind: 'production', sort_order: 5 }))
    expect(mocks.refresh).toHaveBeenCalledOnce()
    expect(adminApi.currentUser).toHaveBeenCalledOnce()
    expect(wrapper.findAll('tbody tr')[0]?.text()).toContain('自定义组')
  })

  it('sends the new group kind and order and refreshes the dynamic directory', async () => {
    const create = vi.spyOn(adminApi, 'createTeam').mockResolvedValue({ ...team, id: 8, name: '新组', code: 'NEW', kind: 'production', sort_order: 30 })
    const wrapper = await mountTeams()
    await wrapper.findAll('button').find((button) => button.text().includes('新增班组'))!.trigger('click')
    await wrapper.get('input[aria-label="班组编码"]').setValue('new')
    await wrapper.get('input[aria-label="班组名称"]').setValue('新组')
    expect((wrapper.get('input[aria-label="显示顺序"]').element as HTMLInputElement).value).toBe('30')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ code: 'NEW', name: '新组', kind: 'production', sort_order: 30 }))
    expect(mocks.refresh).toHaveBeenCalledOnce()
  })

  it('shows production teams without offering a separate scrap-team type', async () => {
    const productionTeam: Team = { ...team, id: 9, code: 'FACTORY-QC', name: '检验', kind: 'production' }
    vi.mocked(adminApi.listTeams).mockResolvedValue([productionTeam])
    const update = vi.spyOn(adminApi, 'updateTeam').mockResolvedValue(productionTeam)
    const wrapper = await mountTeams()
    expect(wrapper.get('tbody tr').text()).toContain('普通班组')
    expect(wrapper.text()).not.toContain('转废班组')
    await wrapper.get('tbody tr').findAll('button').find((button) => button.text().includes('编辑'))!.trigger('click')
    expect(wrapper.find('input[aria-label="班组类型"]').exists()).toBe(false)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(update).toHaveBeenCalledWith(9, expect.objectContaining({ kind: 'production' }))
  })

  it('rejects an invalid sort position before saving', async () => {
    const update = vi.spyOn(adminApi, 'updateTeam')
    const wrapper = await mountTeams()
    await wrapper.get('tbody tr').findAll('button').find((button) => button.text().includes('编辑'))!.trigger('click')
    await wrapper.get('input[aria-label="显示顺序"]').setValue('1.5')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('[role="alert"]').text()).toContain('显示顺序必须')
    expect(update).not.toHaveBeenCalled()
  })

  it('does not expose management actions to a team account', async () => {
    authState.session!.user = { ...authState.session!.user, role: 'TEAM', team_id: 7, team }
    const wrapper = await mountTeams()
    expect(adminApi.listTeams).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('仅系统管理员可维护班组')
    expect(wrapper.findAll('button').find((button) => button.text().includes('新增班组'))!.attributes('disabled')).toBeDefined()
    expect(wrapper.find('tbody').exists()).toBe(false)
  })

  it('shows the system warehouse as a protected directory item', async () => {
    vi.mocked(adminApi.listTeams).mockResolvedValue([
      { id: 99, code: 'FACTORY-WAREHOUSE', name: '库房', active: true, kind: 'warehouse', sort_order: 0 },
      team,
    ])
    const wrapper = await mountTeams()
    const warehouseRow = wrapper.findAll('tbody tr').find((row) => row.text().includes('FACTORY-WAREHOUSE'))
    expect(warehouseRow?.text()).toContain('系统项')
    expect(warehouseRow?.text()).not.toContain('停用')
    expect(warehouseRow?.text()).not.toContain('删除')
  })
})
