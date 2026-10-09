// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ProfileDialog from './ProfileDialog.vue'
import { adminApi, AUTH_SESSION_STORAGE_KEY, type Account } from '@/services/adminApi'
import { authState, clearSession } from '@/stores/auth'

const user: Account = {
  id: 7,
  username: 'leader07',
  display_name: '张师傅',
  role: 'TEAM',
  team_id: 2,
  team: { id: 2, name: '轧制', code: 'FACTORY-ROLL', active: true },
  active: true,
  avatar_key: 'portrait-1',
}
let wrapper: VueWrapper
beforeEach(() => {
  clearSession()
  authState.session = { access_token: 'profile-token', token_type: 'Bearer', user: { ...user } }
})
afterEach(() => {
  wrapper?.unmount()
  clearSession()
  vi.restoreAllMocks()
})
async function render() {
  wrapper = mount(ProfileDialog, {
    props: { modelValue: true },
    global: { stubs: { ElDialog: { template: '<div><slot /><slot name="footer" /></div>' } } },
  })
  await flushPromises()
}
async function save() {
  await wrapper
    .findAll('button')
    .find((item) => item.text() === '保存修改')!
    .trigger('click')
  await flushPromises()
}

describe('own profile editing', () => {
  it.each(['ADMIN', 'TEAM'] as const)(
    'saves the %s name and preset, and persists the session identity',
    async (role) => {
      authState.session!.user.role = role
      const update = vi
        .spyOn(adminApi, 'updateProfile')
        .mockResolvedValue({ ...user, role, display_name: '李师傅', avatar_key: 'portrait-5' })
      await render()
      expect(wrapper.findAll('.avatar-choice')).toHaveLength(8)
      expect(wrapper.get('[aria-label="头像 1"]').attributes('aria-pressed')).toBe('true')
      await wrapper.get('input[aria-label="姓名"]').setValue(' 李师傅 ')
      await wrapper.get('[aria-label="头像 5"]').trigger('click')
      await save()
      expect(update).toHaveBeenCalledOnce()
      expect(update).toHaveBeenCalledWith({ display_name: '李师傅', avatar_key: 'portrait-5' })
      expect(authState.currentUser).toMatchObject({
        username: 'leader07',
        role,
        display_name: '李师傅',
        avatar_key: 'portrait-5',
      })
      expect(JSON.parse(localStorage.getItem(AUTH_SESSION_STORAGE_KEY)!)).toMatchObject({
        user: { avatar_key: 'portrait-5' },
      })
      expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
      expect(wrapper.find('input[aria-label="登录账号"]').exists()).toBe(false)
    },
  )

  it('validates the name and keeps drafts after a failed save without mutating the account', async () => {
    const update = vi.spyOn(adminApi, 'updateProfile').mockRejectedValue(new Error('网络异常'))
    await render()
    await wrapper.get('input[aria-label="姓名"]').setValue('   ')
    await save()
    expect(update).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('请输入姓名')
    await wrapper.get('input[aria-label="姓名"]').setValue('新的姓名')
    await wrapper.get('[aria-label="头像 2"]').trigger('click')
    await save()
    expect(wrapper.text()).toContain('网络异常')
    expect(authState.currentUser?.display_name).toBe(user.display_name)
    expect(wrapper.get('[aria-label="头像 2"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('does not restore a logged-out session when a delayed save finishes', async () => {
    let resolve!: (account: Account) => void
    vi.spyOn(adminApi, 'updateProfile').mockReturnValue(
      new Promise((done) => {
        resolve = done
      }),
    )
    await render()
    await save()
    clearSession()
    await flushPromises()
    resolve({ ...user, avatar_key: 'portrait-3' })
    await flushPromises()
    expect(authState.session).toBeNull()
    expect(localStorage.getItem(AUTH_SESSION_STORAGE_KEY)).toBeNull()
  })

  it('discards a profile read started before the save and offers the initial avatar', async () => {
    let resolve!: (account: Account) => void
    vi.spyOn(adminApi, 'currentUser').mockReturnValue(
      new Promise((done) => {
        resolve = done
      }),
    )
    vi.spyOn(adminApi, 'updateProfile').mockResolvedValue({
      ...user,
      display_name: '已保存',
      avatar_key: '',
    })
    const reading = authState.refreshCurrentUser()
    await render()
    await wrapper.get('.avatar-default').trigger('click')
    await wrapper.get('input[aria-label="姓名"]').setValue('已保存')
    await save()
    resolve(user)
    await reading
    await flushPromises()
    expect(authState.currentUser).toMatchObject({ display_name: '已保存', avatar_key: '' })
  })
})
