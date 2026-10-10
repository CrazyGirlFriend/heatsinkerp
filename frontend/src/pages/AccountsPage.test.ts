// @vitest-environment jsdom
vi.mock('@/components/PageBackButton.vue', () => ({ default: { template: '<span />' } }))
import { ElPagination, ElSelect } from 'element-plus'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AccountsPage from './AccountsPage.vue'
import TableExportButton from '@/components/TableExportButton.vue'
import { adminApi, type Account, type Team } from '@/services/adminApi'
import { authState, clearSession } from '@/stores/auth'
const live = vi.hoisted(() => ({ refresh: async () => {} }))
vi.mock('@/composables/useLiveRefresh', async () => {
  const { ref } = await import('vue')
  return { useLiveRefresh: (refresh: () => Promise<void>) => { live.refresh = refresh; return { message: ref(''), request: vi.fn() } } }
})

const team: Team = { id: 2, code: 'ZB', name: '扎板', active: true, kind: 'production', sort_order: 10 }
const leader: Account = {
  id: 7,
  username: 'leader01',
  display_name: '扎板班组长',
  role: 'TEAM',
  team_id: 2,
  team,
  active: true,
}
const systemAdmin: Account = {
  id: 1,
  username: 'admin',
  display_name: '系统管理员',
  role: 'ADMIN',
  team_id: null,
  team: null,
  active: true,
}
let wrappers: VueWrapper[] = []

beforeEach(() => {
  authState.session = {
    access_token: 'admin-test',
    token_type: 'Bearer',
    user: systemAdmin,
  }
  vi.spyOn(adminApi, 'listAccounts').mockResolvedValue([systemAdmin, leader])
  vi.spyOn(adminApi, 'listTeams').mockResolvedValue([team])
  vi.spyOn(adminApi, 'currentUser').mockResolvedValue(systemAdmin)
})

afterEach(() => {
  wrappers.forEach((wrapper) => wrapper.unmount())
  wrappers = []
  clearSession()
  vi.restoreAllMocks()
})

async function mountPage(): Promise<VueWrapper> {
  const wrapper = mount(AccountsPage, { attachTo: document.body })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

function buttonByText(wrapper: VueWrapper, text: string) {
  return wrapper.findAll('button').find((button) => button.text().trim() === text)
}

describe('team leader management workspace', () => {
  it('shows account fields and avatar together and marks missing inputs directly', async () => {
    const create = vi.spyOn(adminApi, 'createAccount')
    const wrapper = await mountPage()
    await wrapper.findAll('button').find(button => button.text().includes('新增班组长'))!.trigger('click')
    expect(wrapper.find('nav[aria-label="表单分页"]').exists()).toBe(false)
    expect(wrapper.get('[aria-label="参考头像"]').isVisible()).toBe(true)
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(wrapper.findAll('.el-form-item.is-error')).toHaveLength(4)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(create).not.toHaveBeenCalled()
  })
  it('exports every matching account with chosen public fields and no password data', async () => {
    vi.mocked(adminApi.listAccounts).mockResolvedValue([
      systemAdmin,
      ...Array.from({ length: 25 }, (_, index) => ({ ...leader, id: 10 + index, username: `demo-${index + 1}` })),
    ])
    const wrapper = await mountPage()
    await wrapper.get('input[aria-label="搜索班组长"]').setValue('demo-1')
    const source = wrapper.getComponent(TableExportButton).props('source')()!
    const rows = await source.load(new AbortController().signal, () => undefined)
    expect(rows).toHaveLength(11)
    expect(rows.every(row => String(row.username).includes('demo-1'))).toBe(true)
    expect(source.fields.map(field => field.key)).toEqual(['username', 'display_name', 'team', 'active'])
  })
  it('lets the administrator choose an avatar when editing a team leader', async () => {
    const update = vi.spyOn(adminApi, 'updateAccount').mockResolvedValue({ ...leader, avatar_key: 'portrait-6' })
    const wrapper = await mountPage()
    await buttonByText(wrapper, '编辑')!.trigger('click')
    await wrapper.get('[aria-label="头像 6"]').trigger('click')
    await buttonByText(wrapper, '保存修改')!.trigger('click'); await flushPromises()
    expect(update).toHaveBeenCalledWith(leader.id, expect.objectContaining({ avatar_key: 'portrait-6', display_name: leader.display_name }))
    expect(wrapper.find('tbody .account-avatar svg').exists()).toBe(true)
  })
  it('preserves paging and an unsaved account while synchronizing existing accounts', async () => {
    const leaders = Array.from({ length: 25 }, (_, i) => ({ ...leader, id: i + 10, username: `leader${i}` }))
    vi.mocked(adminApi.listAccounts).mockResolvedValue(leaders)
    const wrapper = await mountPage()
    wrapper.getComponent(ElPagination).vm.$emit('update:current-page', 2); await flushPromises()
    const table = wrapper.get('.el-table').element
    await buttonByText(wrapper, '新增班组长')!.trigger('click')
    await wrapper.get('input[placeholder="请输入姓名"]').setValue('未保存姓名')
    vi.mocked(adminApi.listAccounts).mockResolvedValue(leaders.map(account => ({ ...account, display_name: '已更新姓名' })))
    await live.refresh(); await flushPromises()
    expect(wrapper.get('.el-table').element).toBe(table)
    expect(wrapper.getComponent(ElPagination).props('currentPage')).toBe(2)
    expect(wrapper.get('tbody').text()).toContain('已更新姓名')
    expect(wrapper.get('input[placeholder="请输入姓名"]').element).toHaveProperty('value', '未保存姓名')
  })
  it('uses ten natural-height rows and retains larger page sizes', async () => {
    vi.mocked(adminApi.listAccounts).mockResolvedValue([systemAdmin, ...Array.from({ length: 25 }, (_, i) => ({ ...leader, id: i + 10, username: `leader${i}` }))])
    const wrapper = await mountPage()
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
  it('shows team leaders only and keeps the system administrator outside maintenance', async () => {
    const wrapper = await mountPage()
    expect(wrapper.get('h1').text()).toBe('班组长管理')
    expect(wrapper.find('.el-table').exists()).toBe(true)
    expect(wrapper.text()).toContain('leader01')
    expect(wrapper.text()).toContain('扎板班组长')
    expect(wrapper.find('.system-admin-notice').exists()).toBe(false)
    expect(wrapper.get('h1').classes()).toContain('sr-only')
    expect(wrapper.get('.filter-bar').text()).toContain('新增班组长')
    expect(wrapper.findAll('tbody tr')).toHaveLength(1)

    await buttonByText(wrapper, '编辑')!.trigger('click')
    expect(wrapper.get('[role="dialog"]').attributes('aria-label')).toBe('编辑班组长')
    expect(wrapper.get('input[aria-label="所属班组"]').attributes('role')).toBe('combobox')
    expect(wrapper.find('input[aria-label="账号角色"]').exists()).toBe(false)
  })

  it('creates only a team-bound TEAM account', async () => {
    const created = { ...leader, id: 8, username: 'leader02', display_name: '李师傅' }
    const create = vi.spyOn(adminApi, 'createAccount').mockResolvedValue(created)
    const wrapper = await mountPage()

    await buttonByText(wrapper, '新增班组长')!.trigger('click')
    await wrapper.get('input[placeholder="例如 roll_leader"]').setValue('leader02')
    await wrapper.get('input[placeholder="请输入姓名"]').setValue('李师傅')
    await wrapper.get('input[type="password"]').setValue('Password123!')
    const teamSelect = wrapper.findAllComponents(ElSelect)
      .find((component) => component.find('input[aria-label="所属班组"]').exists())
    expect(teamSelect).toBeTruthy()
    teamSelect!.vm.$emit('update:modelValue', team.id)
    await nextTick()
    await buttonByText(wrapper, '创建账号')!.trigger('click')
    await flushPromises()

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      username: 'leader02',
      display_name: '李师傅',
      role: 'TEAM',
      team_id: 2,
      active: true,
    }))
    expect(adminApi.currentUser).toHaveBeenCalledOnce()
  })

  it('does not request administrator data for a team leader', async () => {
    authState.session!.user = { ...leader }
    const wrapper = await mountPage()
    expect(adminApi.listAccounts).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('仅系统管理员可维护班组长')
    expect(wrapper.find('tbody').exists()).toBe(false)
  })
})
