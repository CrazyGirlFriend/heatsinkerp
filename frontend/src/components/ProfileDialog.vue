<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useDialogValidation } from '@/composables/useDialogValidation'
import {
  ElAlert,
  ElButton,
  ElDialog,
  ElForm,
  ElFormItem,
  ElInput,
  ElTabPane,
  ElTabs,
  type InputInstance,
} from 'element-plus'
import AccountAvatar from './AccountAvatar.vue'
import AvatarPicker from './AvatarPicker.vue'
import { useAuthStore } from '@/stores/auth'
import { appPinia } from '@/stores/access'
import { showToast } from '@/stores/toast'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [boolean] }>()
const auth = useAuthStore(appPinia)
const name = ref(''),
  avatar = ref(''),
  error = ref(''),
  saving = ref(false)
const nameInput = ref<InputInstance>()
const mode = ref<'profile' | 'password'>('profile')
const oldPassword = ref(''),
  newPassword = ref(''),
  confirmPassword = ref('')
const oldPasswordInput = ref<InputInstance>()
const validation = useDialogValidation(() => {
  const issues: Record<string, string> = {}
  if (mode.value === 'profile') {
    if (!name.value.trim()) issues.name = '请输入姓名'
  } else {
    if (!oldPassword.value) issues.oldPassword = '请输入旧密码'
    if (
      newPassword.value.length < 8 ||
      newPassword.value.length > 200 ||
      newPassword.value === oldPassword.value
    )
      issues.newPassword = '请填写有效的新密码'
    if (!confirmPassword.value || confirmPassword.value !== newPassword.value)
      issues.confirmPassword = '请确认新密码'
  }
  return issues
})
const { formRef, fieldErrors } = validation
function clearPasswords() {
  oldPassword.value = newPassword.value = confirmPassword.value = ''
}
function focusForm() {
  if (mode.value === 'password') oldPasswordInput.value?.focus()
  else nameInput.value?.focus()
}
watch(mode, async () => {
  validation.reset()
  clearPasswords()
  error.value = ''
  await nextTick()
  focusForm()
})
watch(
  () => props.modelValue,
  (open) => {
    clearPasswords()
    if (!open) return
    validation.reset()
    mode.value = 'profile'
    name.value = auth.currentUser?.display_name || ''
    avatar.value = auth.currentUser?.avatar_key || ''
    error.value = ''
  },
  { immediate: true },
)
watch(
  () => auth.session?.access_token,
  () => {
    clearPasswords()
    emit('update:modelValue', false)
  },
)
function close() {
  if (!saving.value) {
    clearPasswords()
    emit('update:modelValue', false)
  }
}
async function save() {
  if (saving.value || !auth.currentUser) return
  error.value = ''
  if (!validation.validate()) return
  if (mode.value === 'password') {
    await savePassword()
    return
  }
  saving.value = true
  error.value = ''
  try {
    const user = await auth.updateProfile({
      display_name: name.value.trim(),
      avatar_key: avatar.value,
    })
    if (!user) return
    emit('update:modelValue', false)
    showToast('个人信息已保存', 'success')
  } catch (e) {
    error.value = e instanceof Error ? e.message : '个人信息保存失败'
  } finally {
    saving.value = false
  }
}
async function savePassword() {
  saving.value = true
  try {
    const changed = await auth.changePassword({
      old_password: oldPassword.value,
      new_password: newPassword.value,
    })
    if (!changed) return
    clearPasswords()
    showToast('密码已修改，请重新登录', 'success')
  } catch (e) {
    error.value = e instanceof Error ? e.message : '密码修改失败'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <ElDialog
    :model-value="modelValue"
    title="个人信息"
    width="min(520px, 94vw)"
    class="profile-dialog"
    destroy-on-close
    :close-on-click-modal="!saving"
    :close-on-press-escape="!saving"
    :show-close="!saving"
    @close="close"
    @opened="focusForm"
  >
    <div class="profile-scroll">
      <div class="profile-identity">
        <AccountAvatar :avatar-key="avatar" :name="name" :size="64" />
        <div>
          <strong>{{ auth.currentUser?.username }}</strong
          ><span>{{ auth.isAdmin ? '系统管理员' : auth.currentUser?.team?.name || '班组长' }}</span>
        </div>
      </div>
      <ElTabs v-model="mode" class="profile-tabs">
        <ElTabPane label="个人资料" name="profile" :disabled="saving" />
        <ElTabPane label="修改密码" name="password" :disabled="saving" />
      </ElTabs>
      <ElForm ref="formRef" label-position="top" :show-message="false" @submit.prevent="save">
        <template v-if="mode === 'profile'">
          <ElFormItem label="姓名" :error="fieldErrors.name" required
            ><ElInput
              ref="nameInput"
              v-model="name"
              aria-label="姓名"
              maxlength="80"
              :disabled="saving"
          /></ElFormItem>
          <ElFormItem label="头像"
            ><AvatarPicker v-model="avatar" :name="name" :disabled="saving"
          /></ElFormItem>
        </template>
        <template v-else>
          <p class="password-notice">修改后需重新登录。</p>
          <input
            class="sr-only"
            type="text"
            name="username"
            :value="auth.currentUser?.username"
            autocomplete="username"
            readonly
            tabindex="-1"
            aria-hidden="true"
          />
          <ElFormItem label="旧密码" :error="fieldErrors.oldPassword" required>
            <ElInput
              ref="oldPasswordInput"
              v-model="oldPassword"
              aria-label="旧密码"
              type="password"
              show-password
              maxlength="200"
              autocomplete="current-password"
              :disabled="saving"
            />
          </ElFormItem>
          <ElFormItem label="新密码" :error="fieldErrors.newPassword" required>
            <ElInput
              v-model="newPassword"
              aria-label="新密码"
              type="password"
              show-password
              maxlength="200"
              autocomplete="new-password"
              placeholder="至少 8 位"
              :disabled="saving"
            />
          </ElFormItem>
          <ElFormItem label="确认新密码" :error="fieldErrors.confirmPassword" required>
            <ElInput
              v-model="confirmPassword"
              aria-label="确认新密码"
              type="password"
              show-password
              maxlength="200"
              autocomplete="new-password"
              placeholder="再次输入新密码"
              :disabled="saving"
            />
          </ElFormItem>
        </template>
        <ElAlert v-if="error" :title="error" type="error" :closable="false" show-icon />
        <button class="dialog-submit-proxy" type="submit" tabindex="-1" aria-hidden="true" />
      </ElForm>
    </div>
    <template #footer
      ><ElButton :disabled="saving" @click="close">取消</ElButton
      ><ElButton type="primary" :loading="saving" @click="save">{{
        mode === 'password' ? '确认修改' : '保存修改'
      }}</ElButton></template
    >
  </ElDialog>
</template>

<style scoped>
.profile-scroll {
  padding: 4px 2px;
}
.profile-identity {
  display: flex;
  gap: 16px;
  align-items: center;
  margin-bottom: 24px;
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: #f6f9f7;
}
.profile-identity div {
  display: grid;
  gap: 6px;
  min-width: 0;
}
.profile-identity strong {
  overflow: hidden;
  font-size: 18px;
  text-overflow: ellipsis;
}
.profile-identity span {
  color: var(--muted);
  font-size: 13px;
}
.profile-tabs :deep(.el-tabs__header) {
  margin-bottom: 20px;
}
.password-notice {
  margin: 0 0 18px;
  color: var(--muted);
  font-size: 13px;
}
</style>
