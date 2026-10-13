<script setup lang="ts">
import AppDialog from '@/components/AppDialog.vue'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElAlert, ElButton, ElInput } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import { HttpRequestError, httpRequest } from '@/services/httpClient'
import type { SerialUrgency } from '@/types/recordFilters'
const props = defineProps<{ modelValue: boolean; serialNo: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; changed: [] }>()
const auth = useAuthStore(),
  state = ref<SerialUrgency | null>(null),
  reason = ref(''),
  error = ref(''),
  busy = ref(false)
const canManage = computed(
  () => auth.isAdmin && auth.currentUser?.active !== false && !auth.currentUserError,
)
let version = 0
async function load() {
  const current = ++version
  error.value = ''
  state.value = null
  busy.value = true
  try {
    const result = await httpRequest<SerialUrgency>(
      `/serial-urgency?serial_no=${encodeURIComponent(props.serialNo)}`,
    )
    if (current === version) {
      state.value = result
      reason.value = result.reason || ''
    }
  } catch {
    if (current === version) error.value = '加急状态读取失败，请重试'
  } finally {
    if (current === version) busy.value = false
  }
}
async function save() {
  if (!state.value || busy.value || !canManage.value) return
  busy.value = true
  error.value = ''
  const current = version
  try {
    await httpRequest('/serial-urgency', {
      method: 'PUT',
      body: {
        serial_no: props.serialNo,
        urgent: !state.value.urgent,
        reason: reason.value.trim() || null,
        expected_version: state.value.version,
      },
    })
    if (current === version) {
      emit('changed')
      emit('update:modelValue', false)
    }
  } catch (e) {
    if (current === version) {
      if (e instanceof HttpRequestError && e.status === 409) {
        await load()
        error.value = '加急状态已被其他管理员更新，已重新读取，请确认后操作'
      } else
        error.value =
          e instanceof HttpRequestError && e.status === 403
            ? '仅管理员可以修改加急状态'
            : '保存失败，请重试'
    }
  } finally {
    if (current === version) busy.value = false
  }
}
watch(
  () => [props.modelValue, props.serialNo],
  () => {
    if (props.modelValue && props.serialNo) void load()
    else ++version
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  ++version
})
</script>
<template>
  <AppDialog
    :model-value="modelValue"
    :title="state?.urgent ? '取消加急' : '标记加急'"
    class="serial-urgency-dialog"
    width="340px"
    align-center
    :close-on-click-modal="false"
    :show-close="!busy"
    :close-on-press-escape="!busy"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <ElAlert v-if="error" :title="error" type="error" :closable="false" show-icon />
    <form class="urgency-form" @submit.prevent="save">
      <div class="urgency-serial">
        <span>流水号</span><strong>{{ serialNo }}</strong>
      </div>
      <label v-if="!state?.urgent" class="urgency-reason">
        <span>加急原因 <small>选填</small></span>
        <ElInput
          v-model="reason"
          aria-label="加急原因（选填）"
          type="textarea"
          :rows="2"
          maxlength="500"
          :disabled="busy || !state"
          placeholder="如：交期提前"
          resize="none"
        />
      </label>
      <div v-else class="urgency-cancel">
        <p v-if="state.reason" class="urgency-current-reason">{{ state.reason }}</p>
        <p>取消此流水号的加急标记？</p>
      </div>
    </form>
    <template #footer>
      <ElButton :disabled="busy" @click="emit('update:modelValue', false)">返回</ElButton>
      <ElButton v-if="!state && !busy" @click="load">重试</ElButton>
      <ElButton type="primary" :loading="busy" :disabled="!canManage || !state" @click="save">{{
        state?.urgent ? '确认取消加急' : '确认加急'
      }}</ElButton>
    </template>
  </AppDialog>
</template>
<style>
.serial-urgency-dialog.el-dialog {
  --el-component-size: 32px;
  padding: 18px;
  --glass-surface-radius: 16px;
}
.serial-urgency-dialog .el-dialog__header {
  padding-bottom: 12px;
}
.serial-urgency-dialog .el-dialog__title {
  font-size: 16px;
}
.serial-urgency-dialog .el-dialog__headerbtn {
  top: 12px;
  right: 12px;
  width: 28px;
  height: 28px;
}
.serial-urgency-dialog .el-dialog__body {
  padding: 14px 0;
}
.serial-urgency-dialog .el-dialog__footer {
  padding-top: 12px;
  gap: 8px;
}
.serial-urgency-dialog .el-alert {
  margin-bottom: 12px;
}
.serial-urgency-dialog .urgency-form {
  display: grid;
  gap: 14px;
  font-size: 13px;
}
.serial-urgency-dialog .urgency-serial {
  display: flex;
  align-items: baseline;
  gap: 12px;
}
.serial-urgency-dialog .urgency-serial > span {
  flex-shrink: 0;
  color: var(--muted);
}
.serial-urgency-dialog .urgency-serial strong {
  color: var(--text);
  font-size: 15px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.serial-urgency-dialog .urgency-reason {
  display: grid;
  gap: 6px;
  color: var(--muted);
}
.serial-urgency-dialog .urgency-reason small {
  margin-left: 4px;
  color: var(--subtle);
  font-size: 12px;
}
.serial-urgency-dialog .el-textarea__inner {
  padding: 8px 10px;
}
.serial-urgency-dialog .urgency-cancel p {
  margin: 0;
  color: var(--muted);
}
.serial-urgency-dialog .urgency-cancel .urgency-current-reason {
  margin-bottom: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--surface-soft);
  color: var(--text);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
