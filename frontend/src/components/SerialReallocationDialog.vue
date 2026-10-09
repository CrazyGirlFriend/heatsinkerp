<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { ElButton, ElDialog, ElForm, ElFormItem, ElInput, ElInputNumber, ElTag } from 'element-plus'
import WarehouseLocationSelect from './WarehouseLocationSelect.vue'
import SludgeWeightFields from './SludgeWeightFields.vue'
import { useAuthStore } from '@/stores/auth'
import { useTeamDirectoryStore } from '@/stores/teamDirectory'
import { teamCanReallocate } from '@/config/teamWorkspaces'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import type { StockBatch, CreateSerialReallocation } from '@/types/teamMaterials'
import { materialTypeLabel, type MaterialTransfer } from '@/types/materialTransfer'
import { amountError, dispatchableAmounts, materialRequestKey } from '@/utils/materialStock'
import { sludgePayload } from '@/utils/sludgeWeight'
import { inventoryAmount } from '@/types/teamInventory'

const props = defineProps<{ modelValue: boolean; teamId: number; source: StockBatch | null }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; saved: [item: MaterialTransfer] }>()
const auth = useAuthStore(), directory = useTeamDirectoryStore()
const team = computed(() => directory.items.find(item => Number(item.id) === props.teamId))
const canWrite = computed(() => auth.isTeamAccount && auth.currentUser?.active !== false && !auth.currentUserError && Number(auth.currentUser?.team_id) === props.teamId && team.value?.active && teamCanReallocate(team.value))
const warehouse = computed(() => team.value?.kind === 'warehouse')
const measured = computed(() => props.source?.transfer.material_type === 'sludge' && props.source.transfer.sludge_content_percent != null)
const form = reactive({ serial: '', quantity: undefined as number | undefined, weight: undefined as number | undefined, gross: undefined as number | undefined, percent: undefined as number | undefined, reason: '', location: '', locationKey: '' })
const saving = ref(false), locationBusy = ref(false), error = ref('')
let generation = 0, requestKey = '', fingerprint = ''
watch([() => props.modelValue, () => props.source?.transfer.id, () => props.teamId], ([open]) => {
  ++generation; saving.value = false; error.value = ''; requestKey = fingerprint = ''
  if (!open) return
  const amounts = dispatchableAmounts(props.source)
  Object.assign(form, { serial: '', quantity: Math.max(0, amounts.quantity ?? 0), weight: Math.max(0, amounts.weight ?? 0), gross: props.source?.sludge_available_gross_weight ?? props.source?.transfer.sludge_gross_weight ?? undefined, percent: props.source?.transfer.sludge_content_percent ?? undefined, reason: '', location: '', locationKey: '' })
}, { immediate: true })
watch(() => `${auth.currentUser?.id ?? ''}:${auth.currentUser?.team_id ?? ''}`, () => { ++generation; emit('update:modelValue', false) })
onBeforeUnmount(() => { ++generation })
function close() { if (!saving.value) emit('update:modelValue', false) }
async function submit() {
  if (saving.value || locationBusy.value || !props.source) return
  error.value = ''
  if (!canWrite.value) { error.value = '仅库房、检验和电镀的本班组账号可以转投'; return }
  if (!form.serial.trim() || form.serial.trim().length > 80) { error.value = '请填写目标流水号，最多 80 个字符'; return }
  if (form.serial.trim() === props.source.transfer.serial_no) { error.value = '目标流水号不能与当前流水号相同'; return }
  if (!form.reason.trim() || form.reason.trim().length > 2000) { error.value = '请填写转投原因，最多 2000 个字符'; return }
  const invalid = amountError(form.quantity, form.weight, props.source)
  if (invalid) { error.value = invalid; return }
  const body: Omit<CreateSerialReallocation, 'idempotency_key'> = {
    source_transfer_id: Number(props.source.transfer.id), serial_no: form.serial.trim(), quantity: Number(form.quantity), weight: Number(form.weight), reason: form.reason.trim(),
    ...(form.location ? { warehouse_location: form.location, warehouse_location_reservation_key: form.locationKey } : {}),
    ...(measured.value ? sludgePayload('sludge', form.gross, form.percent) : {}),
  }
  const next = JSON.stringify({ team: props.teamId, body })
  if (!requestKey || fingerprint !== next) { requestKey = materialRequestKey(); fingerprint = next }
  const current = generation
  saving.value = true
  try {
    await auth.refreshCurrentUser()
    if (current !== generation || !props.modelValue) return
    if (!canWrite.value) { error.value = '账号所属班组已变更，请重新操作'; return }
    const result = await teamMaterialApi.reallocate(props.teamId, { ...body, idempotency_key: requestKey })
    if (current !== generation || !props.modelValue) return
    emit('saved', result); emit('update:modelValue', false)
  } catch (reason) { if (current === generation) error.value = reason instanceof Error ? reason.message : '转投失败，请重试' }
  finally { if (current === generation) saving.value = false }
}
</script>

<template>
  <ElDialog :model-value="modelValue" title="流水号转投" width="min(620px, calc(100vw - 32px))" align-center append-to-body :close-on-click-modal="!saving" :close-on-press-escape="!saving" :show-close="!saving" @close="close">
    <div v-if="source" class="reallocation-source">
      <header><strong>{{ source.transfer.serial_no }}</strong><span>{{ source.transfer.material_name || '—' }}</span><ElTag effect="light">{{ materialTypeLabel(source.transfer.material_type) }}</ElTag></header>
      <div><span>{{ source.transfer.batch_no }}</span><span>{{ inventoryAmount(dispatchableAmounts(source).quantity) }} 件 · {{ inventoryAmount(dispatchableAmounts(source).weight) }} kg</span></div>
    </div>
    <ElForm label-position="top" :disabled="saving || !canWrite" @submit.prevent="submit">
      <ElFormItem label="目标流水号" required><ElInput v-model="form.serial" aria-label="转投目标流水号" maxlength="80" placeholder="填写转投后的流水号" /></ElFormItem>
      <div class="reallocation-amounts">
        <ElFormItem label="转投件数" required><ElInputNumber v-model="form.quantity" aria-label="转投件数" :min="0" :precision="0" controls-position="right" /><span>件</span></ElFormItem>
        <ElFormItem v-if="!measured" label="转投重量" required><ElInputNumber v-model="form.weight" aria-label="转投重量" :min="0" :precision="3" controls-position="right" /><span>kg</span></ElFormItem>
      </div>
      <SludgeWeightFields v-if="measured" v-model:gross="form.gross" v-model:percent="form.percent" label="转投" locked :disabled="saving || !canWrite" @update:weight="form.weight = $event" />
      <ElFormItem v-if="warehouse" label="目标仓位"><WarehouseLocationSelect v-model="form.location" v-model:reservation-key="form.locationKey" :team-id="teamId" :serial-no="form.serial.trim()" :material-name="source?.transfer.material_name || ''" :material-type="source?.transfer.material_type || ''" :active="modelValue && !!form.serial.trim()" :disabled="saving || !canWrite || !form.serial.trim()" @busy-change="locationBusy = $event" /></ElFormItem>
      <ElFormItem label="转投原因" required><ElInput v-model="form.reason" aria-label="转投原因" type="textarea" :rows="2" maxlength="2000" placeholder="填写本次转投原因" /></ElFormItem>
    </ElForm>
    <p v-if="error" role="alert" class="reallocation-error">{{ error }}</p>
    <template #footer><ElButton :disabled="saving" @click="close">取消</ElButton><ElButton type="primary" :loading="saving" :disabled="saving || locationBusy || !canWrite" @click="submit">确认转投</ElButton></template>
  </ElDialog>
</template>

<style scoped>
.reallocation-source { padding: 16px; margin-bottom: 20px; border: 1px solid var(--line); border-radius: 10px; background: var(--workspace-bg); }
.reallocation-source header, .reallocation-source > div { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; }
.reallocation-source header strong { font-size: 18px; color: var(--text); }.reallocation-source header span { color: var(--subtle); }
.reallocation-source > div { justify-content: space-between; margin-top: 12px; color: var(--subtle); font-size: 13px; }
.reallocation-amounts { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }.reallocation-amounts :deep(.el-form-item__content) { flex-wrap: nowrap; gap: 8px; }.reallocation-amounts :deep(.el-input-number) { width: 100%; }
.reallocation-error { color: var(--danger); margin: 12px 0 0; }
@media (max-width: 480px) { .reallocation-amounts { grid-template-columns: 1fr; gap: 0; } }
</style>
