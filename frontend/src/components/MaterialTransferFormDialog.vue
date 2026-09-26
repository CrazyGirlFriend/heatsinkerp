<script setup lang="ts">
import { ArrowRight, DocumentAdd, EditPen } from '@element-plus/icons-vue'
import {
  ElAlert,
  ElButton,
  ElDialog,
  ElForm,
  ElFormItem,
  ElIcon,
  ElInput,
  ElInputNumber,
  ElOption,
  ElSelect,
  ElTabs,
  ElTabPane,
} from 'element-plus'
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { MaterialTransferApiError, materialTransferApi } from '@/services/materialTransferApi'
import { useAuthStore } from '@/stores/auth'
import { showToast } from '@/stores/toast'
import { useTeamPurposes } from '@/composables/useTeamPurposes'
import { useTeamDirectoryStore } from '@/stores/teamDirectory'
import { canEditMaterialTransfer, externalActionLabel, isExternalTransfer, materialDocumentTextFields, materialTransferVersion, materialTypeOptions, type MaterialTransfer, type MaterialTransferTextField, type MaterialType } from '@/types/materialTransfer'

const props = withDefaults(defineProps<{
  modelValue: boolean
  transfer?: MaterialTransfer | null
}>(), { transfer: null })

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  saved: [transfer: MaterialTransfer]
  refreshed: [transfer: MaterialTransfer]
}>()

const authStore = useAuthStore()
const teamStore = useTeamDirectoryStore()
const saving = ref(false)
const formError = ref('')
const activeTab = ref('handoff')
const editingSnapshot = ref<MaterialTransfer | null>(null)
const refreshFailed = ref(false)
const refreshing = ref(false)
const createRequestKey = ref('')
const createRequestFingerprint = ref('')
const openedSourceTeamId = ref<string | number | null>(null)
const form = reactive({
  serialNo: '',
  nextTeamId: '' as string | number,
  purposeId: null as number | null,
  quantity: undefined as number | undefined,
  weight: undefined as number | undefined,
  notes: '',
  materialType: '' as MaterialType | '',
  finishedQuantity: undefined as number | undefined,
  document: Object.fromEntries(materialDocumentTextFields.map(field => [field.key, ''])) as Record<MaterialTransferTextField, string>,
})

let formGeneration = 0
const external = computed(() => Boolean(editingSnapshot.value && isExternalTransfer(editingSnapshot.value)))
const purposes = useTeamPurposes(() => props.modelValue && !external.value && form.nextTeamId ? Number(form.nextTeamId) : null)
watch(() => form.nextTeamId, value => { if (String(value) !== String(editingSnapshot.value?.next_team.id)) form.purposeId = null })
const actionLabel = computed(() => externalActionLabel(editingSnapshot.value?.entry_kind))
const isEditing = computed(() => Boolean(props.transfer))
const linkedSource = computed(() => Boolean(editingSnapshot.value?.source_transfer_id))
const groupedDispatch = computed(() => Boolean(editingSnapshot.value?.dispatch_no))
const sourceTeam = computed(() => editingSnapshot.value?.source_team ?? authStore.currentUser?.team ?? null)
const editable = computed(() => !editingSnapshot.value || canEditMaterialTransfer(editingSnapshot.value))
const sourceChanged = computed(() => !isEditing.value && String(openedSourceTeamId.value) !== String(authStore.currentUser?.team_id ?? null))
const canSubmit = computed(() => authStore.isTeamAccount && Boolean(sourceTeam.value) && !sourceChanged.value && editable.value && !saving.value && !refreshing.value && !refreshFailed.value)
const destinationTeams = computed(() => {
  const sourceId = String(sourceTeam.value?.id ?? '')
  const items = teamStore.items.filter((team) => team.active && String(team.id) !== sourceId)
  const selected = editingSnapshot.value?.next_team
  if (selected && !items.some((team) => String(team.id) === String(selected.id))) {
    return [...items, { ...selected, active: true }]
  }
  return items
})
const destination = computed(() => destinationTeams.value.find(team => String(team.id) === String(form.nextTeamId)))
const toWarehouse = computed(() => destination.value?.kind === 'warehouse')
const notesLabel = computed(() => external.value ? `${actionLabel.value}说明` : toWarehouse.value ? '入库说明' : '备注')

function resetForm(transfer: MaterialTransfer | null = props.transfer): void {
  openedSourceTeamId.value = authStore.currentUser?.team_id ?? null
  editingSnapshot.value = transfer
  form.serialNo = transfer?.serial_no ?? ''
  form.nextTeamId = transfer?.next_team.id ?? ''
  form.purposeId = transfer?.purpose_id ?? null
  form.quantity = transfer?.quantity
  form.weight = transfer?.weight
  form.notes = transfer?.notes ?? ''
  form.materialType = transfer?.material_type ?? ''
  form.finishedQuantity = transfer?.finished_quantity ?? undefined
  materialDocumentTextFields.forEach(field => { form.document[field.key] = transfer?.[field.key] ?? '' })
  activeTab.value = 'handoff'
  refreshFailed.value = false
  formError.value = ''
  createRequestKey.value = ''
  createRequestFingerprint.value = ''
}

function close(): void {
  if (!saving.value && !refreshing.value) emit('update:modelValue', false)
}

function validate(): boolean {
  const serialNo = form.serialNo.trim()
  const quantity = Number(form.quantity)
  const weight = Number(form.weight)
  if (!authStore.isTeamAccount) formError.value = '管理员仅可查看转料记录'
  else if (!sourceTeam.value) formError.value = '当前账号未绑定班组，请联系管理员'
  else if (sourceChanged.value) formError.value = '账号所属班组已变更，请关闭后重新新建转料'
  else if (!editable.value) formError.value = '此转料单已锁定或无编辑权限'
  else if (refreshFailed.value) formError.value = '请先重新读取最新单据'
  else if ((!isEditing.value || toWarehouse.value) && !form.materialType) formError.value = toWarehouse.value ? '转入库房前请选择物料类型' : '请选择物料类型'
  else if (!serialNo) formError.value = '请输入流水号'
  else if (serialNo.length > 80) formError.value = '流水号不能超过 80 个字符'
  else if (!external.value && form.nextTeamId === '') formError.value = '请选择接收班组'
  else if (!external.value && (purposes.loading.value || purposes.error.value)) formError.value = purposes.error.value || '请等待用途加载完成'
  else if (!external.value && purposes.items.value.length && form.purposeId !== editingSnapshot.value?.purpose_id && !purposes.items.value.some(item => item.active && item.id === form.purposeId)) formError.value = '请选择下序班组的转料用途'
  else if (!external.value && String(form.nextTeamId) === String(sourceTeam.value.id)) formError.value = '接收班组不能与转出班组相同'
  else if (form.quantity == null || !Number.isInteger(quantity) || quantity < 0 || quantity > 2147483647) formError.value = '转料件数须为 0 至 2147483647 的整数'
  else if (form.weight == null || !Number.isFinite(weight) || weight < 0 || weight > 99999999999.999) formError.value = '请输入有效的非负转料重量'
  else if (quantity === 0 && weight === 0) formError.value = '转料件数和重量至少一项大于 0'
  else if (form.notes.trim().length > 2000) formError.value = `${notesLabel.value}不能超过 2000 个字符`
  else formError.value = ''
  if (formError.value) { activeTab.value = 'handoff'; return false }
  if (form.finishedQuantity != null && (!Number.isInteger(form.finishedQuantity) || form.finishedQuantity < 0 || form.finishedQuantity > 2147483647)) {
    formError.value = '成品件数须为非负整数，不能超过 2147483647'
    activeTab.value = 'document'
  }
  const invalidField = materialDocumentTextFields.find(field => form.document[field.key].trim().length > field.maxLength)
  if (invalidField) {
    formError.value = `${invalidField.label}不能超过 ${invalidField.maxLength} 个字符`
    activeTab.value = invalidField.group === 'basic' ? 'document' : 'extra'
  }
  return !formError.value
}

async function refreshAfterConflict(): Promise<void> {
  const batchNo = editingSnapshot.value?.batch_no
  if (!batchNo || refreshing.value) return
  refreshing.value = true
  try {
    const latest = await materialTransferApi.get(batchNo)
    resetForm(latest)
    emit('refreshed', latest)
    formError.value = editable.value ? '单据已更新，已载入最新内容，请重新核对后修改。' : '单据已更新并锁定，不能再修改。'
  } catch {
    refreshFailed.value = true
    formError.value = '单据已更新，最新内容读取失败，请重新读取后再修改。'
  } finally { refreshing.value = false }
}

function idempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() || `material-transfer-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

async function submit(): Promise<void> {
  if (!validate() || saving.value) return
  const epoch = formGeneration
  saving.value = true
  formError.value = ''
  const payload = {
    serial_no: form.serialNo.trim(),
    next_team_id: form.nextTeamId,
    ...(!external.value && (form.purposeId || editingSnapshot.value?.purpose_id) ? { purpose_id: form.purposeId } : {}),
    quantity: Number(form.quantity),
    weight: Number(form.weight),
    notes: form.notes.trim() || null,
    material_type: form.materialType || null,
    finished_quantity: form.finishedQuantity ?? null,
    ...Object.fromEntries(materialDocumentTextFields.map(field => [field.key, form.document[field.key].trim() || null])),
  }
  const requestFingerprint = JSON.stringify(payload)
  if (!props.transfer && (
    !createRequestKey.value
    || createRequestFingerprint.value !== requestFingerprint
  )) {
    createRequestKey.value = idempotencyKey()
    createRequestFingerprint.value = requestFingerprint
  }
  try {
    if (external.value) {
      await authStore.refreshCurrentUser()
      if (epoch !== formGeneration || !props.modelValue) return
      if (!authStore.isTeamAccount || String(authStore.currentUser?.team_id) !== String(editingSnapshot.value?.source_team.id)) { formError.value = '账号所属班组已变更，请关闭后重新操作'; return }
    }
    const saved = editingSnapshot.value
      ? await materialTransferApi.update(editingSnapshot.value.batch_no, { ...(external.value ? { quantity: payload.quantity, weight: payload.weight, notes: payload.notes } : { ...payload, ...(linkedSource.value ? { serial_no: undefined, material_name: undefined } : {}), ...(groupedDispatch.value ? { next_team_id: undefined } : {}) }), ...materialTransferVersion(editingSnapshot.value) })
      : await materialTransferApi.create({ ...payload, idempotency_key: createRequestKey.value })
    if (epoch !== formGeneration || !props.modelValue) return
    createRequestKey.value = ''
    createRequestFingerprint.value = ''
    emit('saved', saved)
    emit('update:modelValue', false)
    showToast(isEditing.value ? `转料单 ${saved.batch_no} 已更新` : `转料单 ${saved.batch_no} 已创建`, 'success')
  } catch (error) {
    if (epoch !== formGeneration || !props.modelValue) return
    formError.value = error instanceof Error ? error.message : '转料单保存失败'
    if (error instanceof MaterialTransferApiError && error.status === 409 && editingSnapshot.value) await refreshAfterConflict()
  } finally {
    if (epoch === formGeneration) saving.value = false
  }
}

watch(() => props.modelValue, (open) => {
  ++formGeneration; saving.value = false
  if (!open) return
  resetForm()
  if (!teamStore.items.length && !teamStore.loading) void teamStore.refreshTeamDirectory()
}, { immediate: true })
watch(() => `${authStore.currentUser?.id ?? ''}:${authStore.currentUser?.team_id ?? ''}:${authStore.isTeamAccount}`, () => { ++formGeneration; saving.value = false; emit('update:modelValue', false) })
onBeforeUnmount(() => { ++formGeneration })
</script>

<template>
  <ElDialog
    :model-value="modelValue"
    width="min(760px, 94vw)"
    class="material-transfer-form-dialog"
    :title="external ? `编辑${actionLabel}单` : isEditing ? '编辑转料单' : '新建转料单'"
    :close-on-click-modal="!saving"
    :close-on-press-escape="!saving"
    :show-close="!saving"
    @close="close"
  >
    <template #header>
      <div class="form-heading">
        <ElIcon><EditPen v-if="isEditing" /><DocumentAdd v-else /></ElIcon>
        <div><h2>{{ external ? `编辑${actionLabel}单` : isEditing ? '编辑转料单' : '新建转料单' }}</h2><span>{{ external ? '修改本次数量、重量与说明' : '每张转料单仅记录一次班组交接' }}</span></div>
      </div>
    </template>

    <ElAlert v-if="!authStore.isTeamAccount" type="info" :closable="false" title="管理员仅可查看转料记录" show-icon />
    <ElAlert v-else-if="!sourceTeam" type="error" :closable="false" title="当前账号未绑定班组" show-icon />
    <ElAlert v-else-if="!editable" type="info" :closable="false" title="此转料单已锁定或无编辑权限" show-icon />
    <ElAlert v-else-if="sourceChanged" type="warning" :closable="false" title="账号所属班组已变更，请关闭后重新新建转料" show-icon />
    <ElAlert v-if="linkedSource" type="info" :closable="false" :title="`来源批次 ${editingSnapshot?.source_transfer_batch_no || '已关联'} · 流水号与材质继承自来料`" />

    <div v-if="sourceTeam" class="handoff-preview" aria-label="转料方向">
      <div><span>转出班组</span><strong>{{ sourceTeam.name }}</strong><small>由当前账号自动确定</small></div>
      <ElIcon><ArrowRight /></ElIcon>
      <div v-if="external"><span>{{ actionLabel }}去向</span><strong>{{ editingSnapshot?.external_destination }}</strong><small>由本班组确认</small></div>
      <div v-else><span>接收班组</span><strong>{{ destinationTeams.find((team) => String(team.id) === String(form.nextTeamId))?.name || '待选择' }}</strong><small>由转出方指定</small></div>
    </div>

    <ElAlert v-if="external" type="info" :closable="false" title="去向和来源批次已固定；如需更换去向，请作废后重新创建。" />
    <ElForm class="transfer-form" label-position="top" @submit.prevent="submit">
      <ElTabs v-model="activeTab">
      <ElTabPane label="交接信息" name="handoff">
      <div class="document-grid">
      <ElFormItem label="物料类型" :required="!isEditing || toWarehouse">
        <ElSelect v-model="form.materialType" aria-label="物料类型" placeholder="请选择物料类型" :disabled="!canSubmit || external" :clearable="isEditing">
          <ElOption v-for="option in materialTypeOptions" :key="option.value" :label="option.label" :value="option.value" />
        </ElSelect>
      </ElFormItem>
      <ElFormItem v-if="!external" label="接收班组" required>
        <ElSelect
          v-model="form.nextTeamId"
          filterable
          placeholder="选择接收班组"
          aria-label="接收班组"
          :loading="teamStore.loading"
          :disabled="!canSubmit || groupedDispatch"
          style="width: 100%"
        >
          <ElOption v-for="team in destinationTeams" :key="team.id" :label="team.name" :value="team.id" />
        </ElSelect>
      </ElFormItem>
      <ElFormItem v-if="!external" label="转料用途" :required="purposes.items.value.length > 0">
        <ElSelect v-model="form.purposeId" aria-label="转料用途" :loading="purposes.loading.value" :disabled="!canSubmit || !form.nextTeamId" :placeholder="form.nextTeamId && !purposes.loading.value && !purposes.items.value.length ? '下序未配置用途' : '请选择转料用途'">
          <ElOption v-for="purpose in purposes.items.value.filter(item => item.active)" :key="purpose.id" :value="purpose.id" :label="purpose.name" />
          <ElOption v-if="editingSnapshot?.purpose_id && String(form.nextTeamId) === String(editingSnapshot.next_team.id) && !purposes.items.value.some(item => item.active && item.id === editingSnapshot?.purpose_id)" :value="editingSnapshot.purpose_id" :label="`${editingSnapshot.purpose_name}（原单用途）`" />
        </ElSelect>
        <ElButton v-if="purposes.error.value" link type="danger" @click="purposes.refresh">用途加载失败，点击重试</ElButton>
      </ElFormItem>
      </div>
      <ElFormItem label="流水号" required>
        <ElInput v-model="form.serialNo" aria-label="流水号" maxlength="80" show-word-limit clearable :disabled="!canSubmit || linkedSource || external" placeholder="输入工件流水号" />
      </ElFormItem>
      <div class="quantity-grid">
        <ElFormItem :label="external ? `${actionLabel}件数` : '转料件数'" required>
          <ElInputNumber v-model="form.quantity" :aria-label="external ? `${actionLabel}件数` : '转料件数'" :min="0" :max="2147483647" :step="1" :precision="0" controls-position="right" :disabled="!canSubmit" />
          <span class="unit-suffix">件</span>
        </ElFormItem>
        <ElFormItem :label="external ? `${actionLabel}重量` : '转料重量'" required>
          <ElInputNumber v-model="form.weight" :aria-label="external ? `${actionLabel}重量` : '转料重量'" :min="0" :max="99999999999.999" :step="0.1" :precision="3" controls-position="right" :disabled="!canSubmit" />
          <span class="unit-suffix">kg</span>
        </ElFormItem>
      </div>
      <p class="quantity-hint">按实际件数、重量填写，至少一项大于 0。</p>
      <ElFormItem :label="notesLabel">
        <ElInput v-model="form.notes" :aria-label="notesLabel" type="textarea" :rows="2" maxlength="2000" show-word-limit :disabled="!canSubmit" :placeholder="toWarehouse ? '选填：说明当前物料情况或转回库房的原因' : '选填'" />
      </ElFormItem>
      </ElTabPane>
      <ElTabPane label="物料明细" name="document">
        <div class="document-grid">
          <ElFormItem v-for="field in materialDocumentTextFields.filter(item => item.group === 'basic' && !item.multiline)" :key="field.key" :label="field.label">
            <ElInput v-model="form.document[field.key]" :aria-label="field.label" :maxlength="field.maxLength" :disabled="!canSubmit || external || (linkedSource && field.key === 'material_name')" placeholder="选填" />
          </ElFormItem>
          <ElFormItem label="成品件数">
            <ElInputNumber v-model="form.finishedQuantity" aria-label="成品件数" :min="0" :max="2147483647" :precision="0" controls-position="right" :disabled="!canSubmit || external" placeholder="选填" />
          </ElFormItem>
          <ElFormItem v-for="field in materialDocumentTextFields.filter(item => item.group === 'basic' && item.multiline)" :key="field.key" :label="field.label" class="document-wide">
            <ElInput v-model="form.document[field.key]" :aria-label="field.label" type="textarea" :rows="3" :maxlength="field.maxLength" show-word-limit :disabled="!canSubmit || external" placeholder="选填" />
          </ElFormItem>
        </div>
      </ElTabPane>
      <ElTabPane label="补充信息" name="extra">
        <div class="document-grid">
          <ElFormItem v-for="field in materialDocumentTextFields.filter(item => item.group === 'extra')" :key="field.key" :label="field.label" :class="{ 'document-wide': field.multiline }">
            <ElInput v-model="form.document[field.key]" :aria-label="field.label" :type="field.multiline ? 'textarea' : 'text'" :rows="3" :maxlength="field.maxLength" :show-word-limit="field.multiline" :disabled="!canSubmit || external" placeholder="选填" />
          </ElFormItem>
        </div>
      </ElTabPane>
      </ElTabs>
      <p v-if="formError" class="form-error" role="alert">{{ formError }}</p>
      <ElButton v-if="refreshFailed" :loading="refreshing" @click="refreshAfterConflict">重新读取</ElButton>
    </ElForm>

    <template #footer>
      <ElButton :disabled="saving" @click="close">取消</ElButton>
      <ElButton type="primary" :loading="saving" :disabled="!canSubmit" @click="submit">{{ isEditing ? '保存修改' : '生成转料单' }}</ElButton>
    </template>
  </ElDialog>
</template>

<style scoped>
.form-heading { display: flex; align-items: center; gap: 11px; }
.form-heading > .el-icon { display: none; }
.form-heading h2 { margin: 0; color: var(--text); font-size: 20px; }
.form-heading span { display: block; margin-top: 2px; color: var(--muted); font-size: 13px; }
.handoff-preview { display: grid; grid-template-columns: minmax(0, 1fr) 34px minmax(0, 1fr); align-items: center; margin-bottom: 8px; padding: 0 0 16px; border-bottom: 1px solid var(--line); }
.handoff-preview > div { display: grid; min-width: 0; gap: 3px; }
.handoff-preview > div:last-child { text-align: right; }
.handoff-preview span, .handoff-preview small { color: var(--muted); font-size: 13px; }
.handoff-preview strong { overflow: hidden; color: var(--text); text-overflow: ellipsis; white-space: nowrap; }
.handoff-preview > .el-icon { justify-self: center; color: var(--subtle); }
.transfer-form { margin-top: 0; }
.quantity-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.document-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 18px; }
.document-grid :deep(.el-select), .document-grid :deep(.el-input-number) { width: 100%; }
.document-wide { grid-column: 1 / -1; }
.quantity-hint { margin: -5px 0 18px; color: var(--subtle); font-size: 12px; }
.quantity-grid :deep(.el-input-number) { width: calc(100% - 42px); }
.quantity-grid :deep(.el-form-item__content) { flex-wrap: nowrap; }
.unit-suffix { display: grid; width: 42px; height: 40px; place-items: center; border: 1px solid var(--el-border-color); border-left: 0; border-radius: 0 4px 4px 0; color: var(--muted); background: var(--workspace-bg); }
.form-error { margin: -2px 0 0; color: var(--danger); font-size: 13px; }
@media (max-width: 560px) {
  .quantity-grid, .document-grid { grid-template-columns: 1fr; gap: 0; }
  .handoff-preview { padding-inline: 12px; }
}
:global(.material-transfer-form-dialog) { display: flex; max-height: min(86dvh, 720px); margin-block: 7dvh !important; flex-direction: column; }
:global(.material-transfer-form-dialog .el-dialog__header),
:global(.material-transfer-form-dialog .el-dialog__footer) { flex: 0 0 auto; }
:global(.material-transfer-form-dialog .el-dialog__body) { min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
@media (prefers-reduced-motion: reduce) { .form-heading > .el-icon { transition: none; } }
</style>
