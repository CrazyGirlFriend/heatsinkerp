<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { ElAlert, ElButton, ElDialog, ElForm, ElFormItem, ElInput, ElInputNumber, ElOption, ElSelect, ElTabPane, ElTabs } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import { useTeamDirectoryStore } from '@/stores/teamDirectory'
import { teamMaterialApi, TeamMaterialApiError } from '@/services/teamMaterialApi'
import { materialDocumentTextFields, materialTypeOptions, type MaterialTransfer, type MaterialTransferTextField, type MaterialType } from '@/types/materialTransfer'
import type { CreateWarehouseReceipt } from '@/types/teamMaterials'

const props = defineProps<{ modelValue: boolean; teamId: number }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; saved: [transfer: MaterialTransfer] }>()
const auth = useAuthStore()
const directory = useTeamDirectoryStore()
const warehouse = computed(() => directory.items.find(team => Number(team.id) === props.teamId && team.active && team.code === 'FACTORY-WAREHOUSE' && team.kind === 'warehouse'))
const canWrite = computed(() => Boolean(warehouse.value) && directory.loaded && !directory.error && auth.isTeamAccount && auth.currentUser?.active !== false && auth.currentUser?.id != null && Number(auth.currentUser.team_id) === props.teamId && !auth.currentUserError)
const identity = computed(() => `${auth.currentUser?.id ?? ''}:${props.teamId}`)
const saving = ref(false)
const error = ref('')
const activeTab = ref('receipt')
const attempt = ref<CreateWarehouseReceipt | null>(null)
const recoveryBlocked = ref(false)
const readonly = computed(() => !canWrite.value || saving.value || Boolean(attempt.value) || recoveryBlocked.value)
const form = reactive({
  serialNo: '', materialType: '' as MaterialType | '', quantity: 0 as number | undefined,
  weight: 0 as number | undefined, notes: '', finishedQuantity: undefined as number | undefined,
  document: Object.fromEntries(materialDocumentTextFields.map(field => [field.key, ''])) as Record<MaterialTransferTextField, string>,
})
let generation = 0
const storageKey = (scope: string) => `heatsink-flow.pending-warehouse-receipt.v1:${scope}`

function fill(payload: CreateWarehouseReceipt | null = null) {
  form.serialNo = payload?.serial_no || ''; form.materialType = payload?.material_type || ''
  form.quantity = payload?.quantity ?? 0; form.weight = payload?.weight ?? 0; form.notes = payload?.notes || ''
  form.finishedQuantity = payload?.finished_quantity ?? undefined
  materialDocumentTextFields.forEach(field => { form.document[field.key] = payload?.[field.key] || '' })
}
function restoreAttempt() {
  attempt.value = null; recoveryBlocked.value = false; error.value = ''; activeTab.value = 'receipt'
  try {
    const saved = sessionStorage.getItem(storageKey(identity.value))
    if (saved) {
      const payload = JSON.parse(saved) as CreateWarehouseReceipt
      if (!payload || typeof payload.idempotency_key !== 'string' || !payload.idempotency_key || typeof payload.serial_no !== 'string' || typeof payload.material_name !== 'string') throw new Error('Invalid draft')
      attempt.value = payload
    }
  } catch { recoveryBlocked.value = true; error.value = '上次入库草稿读取失败，请先在入库记录中核对，避免重复登记。' }
  fill(attempt.value)
}
function close() { if (!saving.value) emit('update:modelValue', false) }
function validate(): boolean {
  if (!canWrite.value) error.value = '仅当前正式库房账号可以手工入库'
  else if (!form.serialNo.trim()) error.value = '请输入流水号'
  else if (form.serialNo.trim().length > 80) error.value = '流水号不能超过 80 个字符'
  else if (!form.document.material_name.trim()) error.value = '请输入材质'
  else if (!form.materialType) error.value = '请选择物料类型'
  else if (form.quantity == null || !Number.isInteger(form.quantity) || form.quantity < 0 || form.quantity > 2147483647) error.value = '入库件数须为 0 至 2147483647 的整数'
  else if (form.weight == null || !Number.isFinite(form.weight) || form.weight < 0 || form.weight > 99999999999.999 || Math.abs(form.weight * 1000 - Math.round(form.weight * 1000)) > 0.0001) error.value = '入库重量须为非负数，最多保留 3 位小数'
  else if (form.quantity === 0 && form.weight === 0) error.value = '入库件数和重量至少一项大于 0'
  else if (!form.notes.trim()) error.value = '请填写入库说明'
  else if (form.notes.trim().length > 2000) error.value = '入库说明不能超过 2000 个字符'
  else error.value = ''
  activeTab.value = 'receipt'
  if (error.value) return false
  const invalid = materialDocumentTextFields.find(field => form.document[field.key].trim().length > field.maxLength)
  if (invalid) { error.value = `${invalid.label}不能超过 ${invalid.maxLength} 个字符`; activeTab.value = invalid.key === 'material_name' ? 'receipt' : 'document' }
  else if (form.finishedQuantity != null && (!Number.isInteger(form.finishedQuantity) || form.finishedQuantity < 0 || form.finishedQuantity > 2147483647)) { error.value = '成品件数须为有效的非负整数'; activeTab.value = 'document' }
  return !error.value
}
function payload(): CreateWarehouseReceipt {
  return {
    ...Object.fromEntries(materialDocumentTextFields.map(field => [field.key, form.document[field.key].trim() || null])),
    serial_no: form.serialNo.trim(), material_name: form.document.material_name.trim(), material_type: form.materialType as MaterialType,
    quantity: Number(form.quantity), weight: Number(form.weight), notes: form.notes.trim(), finished_quantity: form.finishedQuantity ?? null,
    idempotency_key: globalThis.crypto?.randomUUID?.() || `warehouse-receipt-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  }
}
async function submit() {
  if (saving.value || recoveryBlocked.value || !canWrite.value || (!attempt.value && !validate())) return
  const scope = identity.value, teamId = props.teamId, current = ++generation
  saving.value = true; error.value = ''
  try {
    await auth.refreshCurrentUser()
    await directory.refreshTeamDirectory()
    if (current !== generation || scope !== identity.value || !props.modelValue) return
    if (!canWrite.value) { error.value = '账号或库房信息已变更，当前不能入库'; return }
    const body = attempt.value || payload()
    // Persist before sending: a lost response or reopened dialog must retry the same entry.
    try { sessionStorage.setItem(storageKey(scope), JSON.stringify(body)) }
    catch { error.value = '无法保存本次入库的重试信息，请检查浏览器存储后重试'; return }
    attempt.value = body
    try {
      const saved = await teamMaterialApi.createReceipt(teamId, body)
      sessionStorage.removeItem(storageKey(scope))
      if (current !== generation || scope !== identity.value || !props.modelValue) return
      attempt.value = null
      emit('saved', saved)
      emit('update:modelValue', false)
    } catch (failure) {
      const definitive = failure instanceof TeamMaterialApiError && [400, 403, 404, 422].includes(failure.status)
      if (definitive) sessionStorage.removeItem(storageKey(scope))
      if (current !== generation || scope !== identity.value || !props.modelValue) return
      if (definitive) attempt.value = null
      error.value = failure instanceof Error ? failure.message : '入库提交失败，请重试核对'
    }
  } catch (failure) {
    if (current === generation && scope === identity.value) error.value = failure instanceof Error ? failure.message : '账号信息核验失败，请重试'
  } finally { if (current === generation) saving.value = false }
}
watch(() => props.modelValue, open => { ++generation; saving.value = false; if (open) restoreAttempt() }, { immediate: true })
watch(identity, () => { ++generation; saving.value = false; attempt.value = null; fill(); emit('update:modelValue', false) })
onBeforeUnmount(() => { ++generation })
</script>

<template>
  <ElDialog :model-value="modelValue" title="库房手工入库" width="min(740px, 94vw)" class="warehouse-receipt-dialog" :close-on-click-modal="!saving" :close-on-press-escape="!saving" :show-close="!saving" @close="close">
    <template #header><div class="receipt-heading"><h2>手工入库</h2></div></template>
    <div class="receipt-destination"><span>入库库房</span><strong>{{ warehouse?.name || '当前库房不可用' }}</strong><small>确认后立即入账，单据将锁定</small></div>
    <ElAlert v-if="!canWrite" type="warning" :closable="false" title="仅绑定正式库房的有效班组账号可以手工入库" />
    <ElAlert v-if="attempt" class="receipt-retry" type="warning" :closable="false" title="上次提交结果待确认" description="请重试核对同一次入库。核对完成前保留原内容，避免重复登记。" show-icon />
    <ElForm label-position="top" @submit.prevent="submit">
      <ElTabs v-model="activeTab">
        <ElTabPane label="入库信息" name="receipt">
          <div class="receipt-grid">
            <ElFormItem label="流水号" required><ElInput v-model="form.serialNo" aria-label="流水号" maxlength="80" :disabled="readonly" placeholder="填写物料流水号" /></ElFormItem>
            <ElFormItem label="材质" required><ElInput v-model="form.document.material_name" aria-label="材质" maxlength="160" :disabled="readonly" placeholder="填写实际材质" /></ElFormItem>
            <ElFormItem label="物料类型" required class="receipt-wide"><ElSelect v-model="form.materialType" aria-label="物料类型" placeholder="选择物料类型" :disabled="readonly"><ElOption v-for="item in materialTypeOptions" :key="item.value" :label="item.label" :value="item.value" /></ElSelect></ElFormItem>
            <ElFormItem label="入库件数" required><ElInputNumber v-model="form.quantity" aria-label="入库件数" :min="0" :max="2147483647" :precision="0" controls-position="right" :disabled="readonly" /><span class="receipt-unit">件</span></ElFormItem>
            <ElFormItem label="入库重量" required><ElInputNumber v-model="form.weight" aria-label="入库重量" :min="0" :max="99999999999.999" :precision="3" :step="0.001" controls-position="right" :disabled="readonly" /><span class="receipt-unit">kg</span></ElFormItem>
          </div>
          <p class="receipt-hint">件数和重量至少填写一项，另一项可填 0。</p>
          <ElFormItem label="入库说明" required><ElInput v-model="form.notes" aria-label="入库说明" type="textarea" :rows="3" maxlength="2000" show-word-limit :disabled="readonly" placeholder="说明来料来源及本次入库情况" /></ElFormItem>
        </ElTabPane>
        <ElTabPane label="物料明细与补充信息" name="document">
          <div class="receipt-grid">
            <ElFormItem v-for="field in materialDocumentTextFields.filter(item => item.key !== 'material_name')" :key="field.key" :label="field.label" :class="{ 'receipt-wide': field.multiline }"><ElInput v-model="form.document[field.key]" :aria-label="field.label" :type="field.multiline ? 'textarea' : 'text'" :rows="2" :maxlength="field.maxLength" :disabled="readonly" placeholder="选填" /></ElFormItem>
            <ElFormItem label="成品件数"><ElInputNumber v-model="form.finishedQuantity" aria-label="成品件数" :min="0" :max="2147483647" :precision="0" controls-position="right" :disabled="readonly" placeholder="选填" /></ElFormItem>
          </div>
        </ElTabPane>
      </ElTabs>
      <p v-if="error" class="receipt-error" role="alert">{{ error }}</p>
    </ElForm>
    <template #footer><ElButton :disabled="saving" @click="close">{{ attempt ? '稍后核对' : '取消' }}</ElButton><ElButton type="primary" :loading="saving" :disabled="!canWrite || saving || recoveryBlocked" @click="submit">{{ attempt ? '重试核对入库' : '确认入库' }}</ElButton></template>
  </ElDialog>
</template>

<style scoped>
.receipt-heading h2 { margin: 0; color: var(--text); font-size: 20px; font-weight: 600; }
.receipt-destination { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin: 0 0 12px; padding: 12px; border-radius: 6px; background: #f4f6fb; font-size: 13px; }
.receipt-destination span, .receipt-destination small { color: var(--subtle); }
.receipt-destination strong { color: var(--text); font-weight: 500; }
.receipt-destination small { margin-left: auto; }
.receipt-retry { margin-bottom: 12px; }
.receipt-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 20px; }
.receipt-wide { grid-column: 1 / -1; }
.receipt-grid :deep(.el-select) { width: 100%; }
.receipt-grid :deep(.el-input-number) { flex: 1; width: 100%; }
.receipt-grid :deep(.el-form-item__content) { flex-wrap: nowrap; }
.receipt-unit { margin-left: 10px; color: var(--subtle); }
.receipt-hint { margin: -5px 0 20px; font-size: 12px; color: var(--subtle); }
.receipt-error { color: var(--danger); font-size: 13px; }
:global(.warehouse-receipt-dialog) { display: flex; max-height: 88dvh; margin-block: 6dvh !important; flex-direction: column; }
:global(.warehouse-receipt-dialog .el-dialog__body) { min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
:global(.warehouse-receipt-dialog .el-dialog__header), :global(.warehouse-receipt-dialog .el-dialog__footer) { flex-shrink: 0; }
@media (max-width: 560px) { .receipt-grid { grid-template-columns: 1fr; }.receipt-destination small { margin-left: 0; flex-basis: 100%; } }
</style>
