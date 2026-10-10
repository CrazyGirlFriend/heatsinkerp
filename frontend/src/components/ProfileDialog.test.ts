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
    expect(
      wrapper
        .get('input[aria-label="姓名"]')
        .element.closest('.el-form-item')!
        .classList.contains('is-error'),
    ).toBe(true)
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

async function openPassword() {
  await wrapper.get('#tab-password').trigger('click')
  await flushPromises()
}
async function fillPasswords(
  oldPassword = 'Current123!',
  newPassword = 'Changed123!',
  confirmation = newPassword,
) {
  await wrapper.get('input[aria-label="旧密码"]').setValue(oldPassword)
  await wrapper.get('input[aria-label="新密码"]').setValue(newPassword)
  await wrapper.get('input[aria-label="确认新密码"]').setValue(confirmation)
}
async function changePassword() {
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '确认修改')!
    .trigger('click')
  await flushPromises()
}

describe('own password changes', () => {
  it.each(['ADMIN', 'TEAM'] as const)(
    'changes the %s password separately from the profile and logs out',
    async (role) => {
      authState.session!.user.role = role
      const update = vi.spyOn(adminApi, 'updateProfile')
      const change = vi.spyOn(adminApi, 'changePassword').mockResolvedValue(undefined)
      await render()
      await openPassword()
      await fillPasswords('Current123!', ' New password 123! ')
      await changePassword()
      expect(change).toHaveBeenCalledOnce()
      expect(change).toHaveBeenCalledWith({
        old_password: 'Current123!',
        new_password: ' New password 123! ',
      })
      expect(update).not.toHaveBeenCalled()
      expect(authState.session).toBeNull()
      expect(localStorage.getItem(AUTH_SESSION_STORAGE_KEY)).toBeNull()
      expect(wrapper.emitted('update:modelValue')).toContainEqual([false])
    },
  )

  it.each([
    ['', 'Changed123!', 'Changed123!', '请输入旧密码'],
    ['Current123!', 'short', 'short', '新密码至少为 8 位'],
    ['Current123!', 'Current123!', 'Current123!', '新密码不能与旧密码相同'],
    ['Current123!', 'Changed123!', 'Different123!', '两次输入的新密码不一致'],
  ])(
    'rejects invalid fields before sending a request (%s)',
    async (old, password, confirmation) => {
      const change = vi.spyOn(adminApi, 'changePassword')
      await render()
      await openPassword()
      await fillPasswords(old, password, confirmation)
      await changePassword()
      expect(wrapper.findAll('.is-error').length).toBeGreaterThan(0)
      expect(wrapper.find('[role="alert"]').exists()).toBe(false)
      expect(change).not.toHaveBeenCalled()
      expect(authState.session?.access_token).toBe('profile-token')
    },
  )

  it('keeps the session after an incorrect old password and permits a retry', async () => {
    const change = vi
      .spyOn(adminApi, 'changePassword')
      .mockRejectedValueOnce(new Error('旧密码不正确'))
      .mockResolvedValueOnce(undefined)
    await render()
    await openPassword()
    await fillPasswords()
    await changePassword()
    expect(wrapper.text()).toContain('旧密码不正确')
    expect(authState.session?.access_token).toBe('profile-token')
    await wrapper.get('input[aria-label="旧密码"]').setValue('Correct123!')
    await changePassword()
    expect(change).toHaveBeenCalledTimes(2)
    expect(authState.session).toBeNull()
  })

  it('clears passwords on tab changes and closing, without persisting credentials', async () => {
    await render()
    await openPassword()
    await fillPasswords()
    expect(localStorage.getItem(AUTH_SESSION_STORAGE_KEY)).toBeNull()
    await wrapper.get('#tab-profile').trigger('click')
    await flushPromises()
    await openPassword()
    expect(wrapper.get('input[aria-label="旧密码"]').element).toHaveProperty('value', '')
    await fillPasswords()
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '取消')!
      .trigger('click')
    expect(wrapper.get('input[aria-label="旧密码"]').element).toHaveProperty('value', '')
  })

  it('prevents duplicate submission and does not log out a later login', async () => {
    let resolve!: () => void
    const change = vi.spyOn(adminApi, 'changePassword').mockReturnValue(
      new Promise((done) => {
        resolve = done
      }),
    )
    await render()
    await openPassword()
    await fillPasswords()
    await changePassword()
    await changePassword()
    expect(change).toHaveBeenCalledOnce()
    authState.session = { access_token: 'another-session', token_type: 'Bearer', user }
    await flushPromises()
    resolve()
    await flushPromises()
    expect(authState.session?.access_token).toBe('another-session')
  })
})
