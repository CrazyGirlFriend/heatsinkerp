<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { ElAlert, ElButton, ElDialog, ElSwitch } from 'element-plus'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import type { Team } from '@/services/adminApi'
import type { OpeningState } from '@/types/teamBusiness'
const props = defineProps<{ modelValue: boolean; team: Team | null }>()
const emit = defineEmits<{ 'update:modelValue': [boolean]; saved: [] }>()
const state = ref<OpeningState | null>(null), enabled = ref(false), loading = ref(false), saving = ref(false), error = ref('')
let epoch = 0
watch(() => [props.modelValue, props.team?.id], async () => {
  const current = ++epoch
  if (!props.modelValue || !props.team) return
  loading.value = true; error.value = ''; state.value = null
  try { const result = await teamMaterialApi.openingState(Number(props.team.id)); if (current === epoch) { state.value = result; enabled.value = result.enabled } }
  catch (e) { if (current === epoch) error.value = e instanceof Error ? e.message : '授权状态读取失败' }
  finally { if (current === epoch) loading.value = false }
}, { immediate: true })
onBeforeUnmount(() => { ++epoch })
async function save() {
  if (!props.team || !state.value || loading.value || saving.value) return
  const current = epoch
  saving.value = true; error.value = ''
  try { await teamMaterialApi.authorizeOpening(Number(props.team.id), enabled.value); if (current === epoch) { emit('saved'); emit('update:modelValue', false) } }
  catch (e) { if (current === epoch) error.value = e instanceof Error ? e.message : '授权保存失败' }
  finally { if (current === epoch) saving.value = false }
}
</script>
<template>
  <ElDialog :model-value="modelValue" :title="`${team?.name || ''} · 期初库存授权`" width="min(520px, 94vw)" :show-close="!saving" :close-on-click-modal="!saving" :close-on-press-escape="!saving" @close="emit('update:modelValue', false)">
    <p v-if="loading">正在读取授权状态…</p>
    <ElAlert v-if="error" :title="error" type="error" :closable="false" />
    <template v-if="state"><p>授权后，本班组长可在“班组设置 → 期初库存”中录入启用系统前的库存。</p><ElAlert v-if="state.completed || state.has_stock_history" :title="state.completed ? '已完成期初入账，不能重复初始化。' : '已有入账记录，不能再次叠加期初库存。'" type="info" :closable="false" /><ElSwitch v-model="enabled" aria-label="允许录入期初库存" active-text="允许录入期初库存" :disabled="saving || state.completed || state.has_stock_history || !team?.active" /><p>确认入账后自动关闭权限。不会清空或覆盖现有数据。</p></template>
    <template #footer><ElButton :disabled="saving" @click="emit('update:modelValue', false)">取消</ElButton><ElButton type="primary" :disabled="!state || loading" :loading="saving" @click="save">保存授权</ElButton></template>
  </ElDialog>
</template>
<style scoped>p { font-size: 15px; line-height: 1.8; color: var(--muted); }.el-switch { margin-top: 20px; }</style>
