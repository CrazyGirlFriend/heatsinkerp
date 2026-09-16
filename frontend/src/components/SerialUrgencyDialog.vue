<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElAlert, ElButton, ElDialog, ElForm, ElFormItem, ElInput } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import { HttpRequestError, httpRequest } from '@/services/httpClient'
import type { SerialUrgency } from '@/types/recordFilters'
const props = defineProps<{ modelValue: boolean; serialNo: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; changed: [] }>()
const auth = useAuthStore(), state = ref<SerialUrgency | null>(null), reason = ref(''), error = ref(''), busy = ref(false)
const canManage = computed(() => auth.isAdmin && auth.currentUser?.active !== false && !auth.currentUserError)
let version = 0
async function load() {
  const current = ++version; error.value = ''; state.value = null; busy.value = true
  try {
    const result = await httpRequest<SerialUrgency>(`/serial-urgency?serial_no=${encodeURIComponent(props.serialNo)}`)
    if (current === version) { state.value = result; reason.value = result.reason || '' }
  } catch { if (current === version) error.value = '加急状态读取失败，请重试' }
  finally { if (current === version) busy.value = false }
}
async function save() {
  if (!state.value || busy.value || !canManage.value) return
  busy.value = true; error.value = ''
  const current = version
  try {
    await httpRequest('/serial-urgency', { method: 'PUT', body: { serial_no: props.serialNo, urgent: !state.value.urgent, reason: reason.value.trim() || null, expected_version: state.value.version } })
    if (current === version) { emit('changed'); emit('update:modelValue', false) }
  } catch (e) {
    if (current === version) {
      if (e instanceof HttpRequestError && e.status === 409) { await load(); error.value = '加急状态已被其他管理员更新，已重新读取，请确认后操作' }
      else error.value = e instanceof HttpRequestError && e.status === 403 ? '仅管理员可以修改加急状态' : '保存失败，请重试'
    }
  } finally { if (current === version) busy.value = false }
}
watch(() => [props.modelValue, props.serialNo], () => { if (props.modelValue && props.serialNo) void load(); else ++version }, { immediate: true })
onBeforeUnmount(() => { ++version })
</script>
<template>
  <ElDialog :model-value="modelValue" :title="state?.urgent ? '取消加急' : '标记加急'" width="420px" :close-on-click-modal="false" :show-close="!busy" :close-on-press-escape="!busy" @update:model-value="emit('update:modelValue', $event)">
    <ElAlert v-if="error" :title="error" type="error" :closable="false" show-icon />
    <ElForm label-position="top" @submit.prevent="save"><ElFormItem label="流水号"><strong>{{ serialNo }}</strong></ElFormItem><ElFormItem v-if="!state?.urgent" label="加急原因（选填）"><ElInput v-model="reason" type="textarea" :rows="3" maxlength="500" show-word-limit :disabled="busy || !state" placeholder="填写加急原因" /></ElFormItem><p v-else>取消后，关联班组和批次将不再显示加急标记。</p></ElForm>
    <template #footer><ElButton :disabled="busy" @click="emit('update:modelValue', false)">返回</ElButton><ElButton v-if="!state && !busy" @click="load">重试</ElButton><ElButton type="primary" :loading="busy" :disabled="!canManage || !state" @click="save">{{ state?.urgent ? '确认取消加急' : '确认加急' }}</ElButton></template>
  </ElDialog>
</template>
