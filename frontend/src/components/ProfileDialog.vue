<script setup lang="ts">
import { ref, watch } from 'vue'
import {
  ElAlert,
  ElButton,
  ElDialog,
  ElForm,
  ElFormItem,
  ElInput,
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
watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    name.value = auth.currentUser?.display_name || ''
    avatar.value = auth.currentUser?.avatar_key || ''
    error.value = ''
  },
  { immediate: true },
)
watch(
  () => auth.session?.access_token,
  () => emit('update:modelValue', false),
)
function close() {
  if (!saving.value) emit('update:modelValue', false)
}
async function save() {
  if (saving.value || !auth.currentUser) return
  if (!name.value.trim()) {
    error.value = '请输入姓名'
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
    @opened="nameInput?.focus()"
  >
    <div class="profile-scroll">
      <div class="profile-identity">
        <AccountAvatar :avatar-key="avatar" :name="name" :size="64" />
        <div>
          <strong>{{ auth.currentUser?.username }}</strong
          ><span>{{ auth.isAdmin ? '系统管理员' : auth.currentUser?.team?.name || '班组长' }}</span>
        </div>
      </div>
      <ElForm label-position="top" @submit.prevent="save">
        <ElFormItem label="姓名" required
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
        <ElAlert v-if="error" :title="error" type="error" :closable="false" show-icon />
        <button class="dialog-submit-proxy" type="submit" tabindex="-1" aria-hidden="true" />
      </ElForm>
    </div>
    <template #footer
      ><ElButton :disabled="saving" @click="close">取消</ElButton
      ><ElButton type="primary" :loading="saving" @click="save">保存修改</ElButton></template
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
</style>
