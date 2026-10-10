<script setup lang="ts">
import WeightInput from './WeightInput.vue'
import FormValidationNotice from './FormValidationNotice.vue'
import MaterialInput from './MaterialInput.vue'
import SpecificationInput from './SpecificationInput.vue'
import AutofillBadge from './AutofillBadge.vue'
import { useMaterialAutofill } from '@/composables/useMaterialAutofill'
import type { MaterialInputField } from '@/services/materialInputApi'

import { ArrowRight } from '@element-plus/icons-vue'
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
} from 'element-plus'
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { MaterialTransferApiError, materialTransferApi } from '@/services/materialTransferApi'
import SludgeWeightFields from './SludgeWeightFields.vue'
import { sludgePayload, sludgeWeight } from '@/utils/sludgeWeight'
import { useAuthStore } from '@/stores/auth'
import { showToast } from '@/stores/toast'
import { useTeamPurposes } from '@/composables/useTeamPurposes'
import MaterialDeliveryFields from './MaterialDeliveryFields.vue'
import WarehouseLocationSelect from './WarehouseLocationSelect.vue'
import { deliveryError } from '@/utils/materialDelivery'
import { useTeamDirectoryStore } from '@/stores/teamDirectory'
import { canEditMaterialTransfer, externalActionLabel, isWeightOnlyType, isExternalTransfer, materialDocumentTextFields, materialTransferVersion, materialTypeOptions, type MaterialTransfer, type MaterialTransferTextField, type MaterialType } from '@/types/materialTransfer'

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
const saving = ref(false), locationBusy = ref(false)
const formError = ref('')
const transferForm = ref<InstanceType<typeof ElForm>>()
const validationAttempted = ref(false)
const specificationKeys = ['finished_specification', 'transfer_specification']
const documentSections = [
  { name: 'document', label: '物料资料', fields: materialDocumentTextFields.filter(field => !field.multiline && !specificationKeys.includes(field.key)) },
  { name: 'specification', label: '规格工艺', fields: materialDocumentTextFields.filter(field => specificationKeys.includes(field.key) || ['technical_requirements', 'special_process'].includes(field.key)) },
  { name: 'notes', label: '补充说明', fields: materialDocumentTextFields.filter(field => field.key === 'material_description') },
]

const editingSnapshot = ref<MaterialTransfer | null>(null)
const refreshFailed = ref(false)
const refreshing = ref(false)
const createRequestKey = ref('')
const createRequestFingerprint = ref('')
const openedSourceTeamId = ref<string | number | null>(null)
const form = reactive({
  serialNo: '', warehouseLocation: '', warehouseLocationKey: '',
  deliveryDate: '',
  deliveryQuantity: undefined as number | undefined,
  nextTeamId: '' as string | number,
  purposeId: null as number | null,
  quantity: undefined as number | undefined,
  weight: undefined as number | undefined,
  gross: undefined as number | undefined, percent: undefined as number | undefined,
  notes: '',
  materialType: '' as MaterialType | '',
  finishedQuantity: undefined as number | undefined,
  document: Object.fromEntries(materialDocumentTextFields.map(field => [field.key, ''])) as Record<MaterialTransferTextField, string>,
})

const autofill = useMaterialAutofill(() => form.serialNo, form.document)
const specificationValidity = reactive<Record<string, boolean>>({ finished_specification: true, transfer_specification: true })
const suggestionFields = ['material_name', 'customer_code', 'product_code', 'part_no', 'outsourced_unit']
let formGeneration = 0
const external = computed(() => Boolean(editingSnapshot.value && isExternalTransfer(editingSnapshot.value)))
const weightOnly = computed(() => isWeightOnlyType(form.materialType))
const retainedWeightOnly = computed(() => weightOnly.value && editingSnapshot.value?.material_type === form.materialType)
const enteredQuantity = computed(() => weightOnly.value ? retainedWeightOnly.value ? editingSnapshot.value?.quantity ?? 0 : 0 : form.quantity)
const useSludge = computed(() => form.materialType === 'sludge' && !(editingSnapshot.value?.material_type === 'sludge' && editingSnapshot.value.sludge_content_percent == null))
const purposes = useTeamPurposes(() => props.modelValue && !external.value && form.nextTeamId ? Number(form.nextTeamId) : null)
watch(() => form.nextTeamId, value => { if (String(value) !== String(editingSnapshot.value?.next_team.id)) { form.purposeId = null; form.warehouseLocation = ''; form.warehouseLocationKey = '' } })
const actionLabel = computed(() => externalActionLabel(editingSnapshot.value?.entry_kind))
const isEditing = computed(() => Boolean(props.transfer))
const linkedSource = computed(() => Boolean(editingSnapshot.value?.source_transfer_id))
const groupedDispatch = computed(() => Boolean(editingSnapshot.value?.dispatch_no))
const sourceTeam = computed(() => editingSnapshot.value?.source_team ?? authStore.currentUser?.team ?? null)
const teamActorReady = computed(() => authStore.isTeamAccount && authStore.currentUser?.team_id != null && authStore.currentUser?.active !== false && !authStore.currentUserError)
const editable = computed(() => !editingSnapshot.value || (teamActorReady.value && String(authStore.currentUser?.team_id) === String(editingSnapshot.value.source_team.id) && canEditMaterialTransfer(editingSnapshot.value)))
const sourceChanged = computed(() => !isEditing.value && String(openedSourceTeamId.value) !== String(authStore.currentUser?.team_id ?? null))
const canSubmit = computed(() => props.modelValue && teamActorReady.value && Boolean(sourceTeam.value) && !sourceChanged.value && editable.value && !saving.value && !locationBusy.value && !refreshing.value && !refreshFailed.value)
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
const validationIssues = computed(() => {
  const issues: { field: string; message: string }[] = []
  const add = (field: string, message: string) => issues.push({ field, message })
  const serialNo = form.serialNo.trim(), quantity = Number(enteredQuantity.value), weight = Number(form.weight)
  if (!serialNo) add('serialNo', '请输入流水号')
  else if (serialNo.length > 80) add('serialNo', '流水号不能超过 80 个字符')
  if ((!isEditing.value || toWarehouse.value) && !form.materialType) add('materialType', toWarehouse.value ? '转入库房前请选择物料类型' : '请选择物料类型')
  if (!external.value) {
    if (form.nextTeamId === '') add('nextTeamId', '请选择接收班组')
    else if (String(form.nextTeamId) === String(sourceTeam.value?.id)) add('nextTeamId', '接收班组不能与转出班组相同')
    if (purposes.loading.value || purposes.error.value) add('purposeId', purposes.error.value || '请等待业务加载完成')
    else if (purposes.items.value.length && form.purposeId !== editingSnapshot.value?.purpose_id && !purposes.items.value.some(item => item.active && item.id === form.purposeId)) add('purposeId', '请选择下序班组的接收业务')
  }
  if (enteredQuantity.value == null) add('quantity', `请输入${external.value ? actionLabel.value : '转料'}件数`)
  else if (!Number.isInteger(quantity) || quantity < 0 || quantity > 2147483647) add('quantity', '转料件数须为 0 至 2147483647 的整数')
  if (useSludge.value && !sludgeWeight(form.gross, form.percent)) {
    const invalidGross = !sludgeWeight(form.gross, 100), invalidPercent = !sludgeWeight(1, form.percent)
    if (invalidGross) add('gross', form.gross == null ? '请填写废泥实重' : '请填写有效的废泥实重')
    if (invalidPercent) add('percent', form.percent == null ? '请填写有效材料占比' : '请填写有效材料占比（0.01% 至 100%）')
    if (!invalidGross && !invalidPercent) add('gross', '折算重量须达到 0.000001 kg')
  } else if (form.weight == null) add('weight', `请输入${external.value ? actionLabel.value : '转料'}重量`)
  else if (!Number.isFinite(weight) || weight < 0 || weight > 99999999999.999) add('weight', '请输入有效的非负转料重量')
  else if (weightOnly.value && weight <= 0) add('weight', '请填写大于 0 的转料重量')
  else if (quantity === 0 && weight === 0) {
    add('quantity', '转料件数和重量至少一项大于 0')
    add('weight', '转料件数和重量至少一项大于 0')
  }
  if (!linkedSource.value && !external.value && !weightOnly.value) {
    const message = deliveryError(form.deliveryDate, form.deliveryQuantity)
    if (message) add(!form.deliveryDate || message.includes('有效的要求发货日期') ? 'deliveryDate' : 'deliveryQuantity', message)
  }
  if (!weightOnly.value && form.finishedQuantity != null && (!Number.isInteger(form.finishedQuantity) || form.finishedQuantity < 0 || form.finishedQuantity > 2147483647)) add('finishedQuantity', '成品件数须为非负整数，不能超过 2147483647')
  for (const section of documentSections) for (const field of section.fields) {
    if (!external.value && specificationValidity[field.key] === false) add(field.key, '请填完整规格尺寸')
    else if (form.document[field.key].trim().length > field.maxLength) add(field.key, `${field.label}不能超过 ${field.maxLength} 个字符`)
  }
  if (form.notes.trim().length > 2000) add('notes', `${notesLabel.value}不能超过 2000 个字符`)
  return issues
})
const fieldErrors = computed<Record<string, string>>(() => validationAttempted.value ? Object.fromEntries(validationIssues.value.map(issue => [issue.field, issue.message])) : {})
const firstValidationIssue = computed(() => validationAttempted.value ? validationIssues.value[0] : undefined)

function resetForm(transfer: MaterialTransfer | null = props.transfer): void {
  autofill.reset(); specificationValidity.finished_specification = specificationValidity.transfer_specification = true
  openedSourceTeamId.value = authStore.currentUser?.team_id ?? null
  editingSnapshot.value = transfer
  form.warehouseLocation = transfer?.warehouse_location || ''; form.warehouseLocationKey = ''
  form.serialNo = transfer?.serial_no ?? ''
  form.deliveryDate = transfer?.delivery_date ?? ''
  form.deliveryQuantity = transfer?.delivery_quantity ?? undefined
  form.nextTeamId = transfer?.next_team.id ?? ''
  form.purposeId = transfer?.purpose_id ?? null
  form.quantity = transfer?.quantity
  form.weight = transfer?.weight
  form.gross = transfer?.sludge_gross_weight ?? undefined; form.percent = transfer?.sludge_content_percent ?? undefined
  form.notes = transfer?.notes ?? ''
  form.materialType = transfer?.material_type ?? ''
  form.finishedQuantity = transfer?.finished_quantity ?? undefined
  materialDocumentTextFields.forEach(field => { form.document[field.key] = transfer?.[field.key] ?? '' })
  validationAttempted.value = false
  refreshFailed.value = false
  formError.value = ''
  createRequestKey.value = ''
  createRequestFingerprint.value = ''
}

function close(): void {
  if (!saving.value && !refreshing.value) emit('update:modelValue', false)
}

function validate(): boolean {
  if (!authStore.isTeamAccount) formError.value = '管理员仅可查看转料记录'
  else if (!teamActorReady.value) formError.value = '当前账号不可操作，请重新登录后核对'
  else if (!sourceTeam.value) formError.value = '当前账号未绑定班组，请联系管理员'
  else if (sourceChanged.value) formError.value = '账号所属班组已变更，请关闭后重新新建转料'
  else if (!editable.value) formError.value = '此转料单已锁定或无编辑权限'
  else if (refreshFailed.value) formError.value = '请先重新读取最新单据'
  else formError.value = ''
  if (formError.value) return false
  validationAttempted.value = true
  return !validationIssues.value.length
}

function locateError() {
  const issue = firstValidationIssue.value
  if (!issue) return
  const item = (transferForm.value?.$el as HTMLElement | undefined)?.querySelector<HTMLElement>(`[data-validation-field="${issue.field}"]`)
  if (!item) return
  item.scrollIntoView?.({ block: 'center' })
  const emptyDimension = Array.from(item.querySelectorAll<HTMLInputElement>('.specification-dimensions input:not([disabled])')).find(input => !input.value)
  const input = emptyDimension || item.querySelector<HTMLElement>('input:not([disabled]):not([type="hidden"]), textarea:not([disabled])')
  input?.focus({ preventScroll: true })
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
  if (!validate()) { await nextTick(); locateError(); return }
  if (saving.value || locationBusy.value) return
  const epoch = formGeneration
  saving.value = true
  formError.value = ''
  const payload = {
    serial_no: form.serialNo.trim(),
    ...(toWarehouse.value ? { warehouse_location: form.warehouseLocation || null, ...(form.warehouseLocationKey ? { warehouse_location_reservation_key: form.warehouseLocationKey } : {}) } : {}),
    ...(!linkedSource.value && !external.value ? { delivery_date: weightOnly.value ? retainedWeightOnly.value ? editingSnapshot.value?.delivery_date ?? null : null : form.deliveryDate || null, delivery_quantity: weightOnly.value ? retainedWeightOnly.value ? editingSnapshot.value?.delivery_quantity ?? null : null : form.deliveryQuantity ?? null } : {}),
    next_team_id: form.nextTeamId,
    ...(!external.value && (form.purposeId || editingSnapshot.value?.purpose_id) ? { purpose_id: form.purposeId } : {}),
    quantity: Number(enteredQuantity.value),
    weight: Number(form.weight),
    ...(useSludge.value || editingSnapshot.value?.sludge_content_percent != null ? sludgePayload(form.materialType, form.gross, form.percent) : {}),
    notes: form.notes.trim() || null,
    material_type: form.materialType || null,
    finished_quantity: weightOnly.value ? retainedWeightOnly.value ? editingSnapshot.value?.finished_quantity ?? null : null : form.finishedQuantity ?? null,
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
      ? await materialTransferApi.update(editingSnapshot.value.batch_no, { ...(external.value ? { quantity: payload.quantity, weight: payload.weight, notes: payload.notes, ...(useSludge.value ? sludgePayload(form.materialType, form.gross, form.percent) : {}) } : { ...payload, ...(linkedSource.value ? { serial_no: undefined, material_name: undefined } : {}), ...(groupedDispatch.value ? { next_team_id: undefined } : {}) }), ...materialTransferVersion(editingSnapshot.value) })
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
watch(() => `${authStore.currentUser?.id ?? ''}:${authStore.currentUser?.team_id ?? ''}:${authStore.isTeamAccount}:${authStore.currentUser?.active}:${authStore.currentUserError}`, () => { ++formGeneration; saving.value = false; emit('update:modelValue', false) })
onBeforeUnmount(() => { ++formGeneration })
</script>

<template>
  <ElDialog
    :model-value="modelValue"
    width="min(1180px, 96vw)"
    top="16px"
    class="material-transfer-form-dialog"
    :title="external ? `编辑${actionLabel}单` : isEditing ? '编辑转料单' : '新建转料单'"
    :close-on-click-modal="!saving"
    :close-on-press-escape="!saving"
    :show-close="!saving"
    @close="close"
  >
    <template #header>
      <div class="form-heading">
        <h2>{{ external ? `编辑${actionLabel}单` : isEditing ? '编辑转料单' : '新建转料单' }}</h2>
        <div v-if="sourceTeam" class="handoff-preview" aria-label="转料方向">
          <span>{{ sourceTeam.name }}</span><ElIcon><ArrowRight /></ElIcon>
          <strong>{{ external ? editingSnapshot?.external_destination : destination?.name || '选择接收班组' }}</strong>
        </div>
      </div>
    </template>

    <FormValidationNotice :message="formError" />
    <ElAlert v-if="!authStore.isTeamAccount" type="info" :closable="false" title="管理员仅可查看转料记录" show-icon />
    <ElAlert v-else-if="!sourceTeam" type="error" :closable="false" title="当前账号未绑定班组" show-icon />
    <ElAlert v-else-if="!editable" type="info" :closable="false" title="此转料单已锁定或无编辑权限" show-icon />
    <ElAlert v-else-if="sourceChanged" type="warning" :closable="false" title="账号所属班组已变更，请关闭后重新新建转料" show-icon />
    <ElAlert v-if="linkedSource" type="info" :closable="false" :title="`上一批次 ${editingSnapshot?.source_transfer_batch_no || '已关联'} · 流水号与材质继承自来料`" />
    <ElAlert v-if="external" type="info" :closable="false" title="去向和来源批次已固定；如需更换去向，请作废后重新创建。" />

    <ElForm ref="transferForm" class="transfer-form" label-position="left" label-width="120px" :show-message="false" @submit.prevent="submit">
      <section class="transfer-section" data-form-section="handoff" aria-labelledby="transfer-handoff-heading">
        <h3 id="transfer-handoff-heading">转料信息</h3>
        <div class="transfer-section-fields">
          <ElFormItem label="流水号" required :error="fieldErrors.serialNo" data-validation-field="serialNo">
            <MaterialInput v-model="form.serialNo" field="serial_no" label="流水号" :maxlength="80" :disabled="!canSubmit || linkedSource || external" placeholder="输入或选择流水号" @selected="autofill.select" />
          </ElFormItem>
          <ElFormItem label="物料类型" :required="!isEditing || toWarehouse" :error="fieldErrors.materialType" data-validation-field="materialType">
            <ElSelect v-model="form.materialType" aria-label="物料类型" placeholder="请选择物料类型" :disabled="!canSubmit || external || editingSnapshot?.sludge_percent_locked" :clearable="isEditing">
              <ElOption v-for="option in materialTypeOptions" :key="option.value" :label="option.label" :value="option.value" />
            </ElSelect>
          </ElFormItem>
          <ElFormItem v-if="!external" label="接收班组" required :error="fieldErrors.nextTeamId" data-validation-field="nextTeamId">
            <ElSelect v-model="form.nextTeamId" filterable placeholder="选择接收班组" aria-label="接收班组" :loading="teamStore.loading" :disabled="!canSubmit || groupedDispatch">
              <ElOption v-for="team in destinationTeams" :key="team.id" :label="team.name" :value="team.id" />
            </ElSelect>
          </ElFormItem>
          <ElFormItem v-if="!external" label="接收业务" :required="purposes.items.value.length > 0" :error="fieldErrors.purposeId" data-validation-field="purposeId">
            <ElSelect v-model="form.purposeId" aria-label="接收业务" :loading="purposes.loading.value" :disabled="!canSubmit || !form.nextTeamId" :placeholder="!form.nextTeamId ? '先选择接收班组' : !purposes.items.value.length ? '接收班组尚未配置业务' : purposes.items.value.some(item => item.active) ? '请选择接收业务' : '接收班组暂无启用业务'">
              <ElOption v-for="purpose in purposes.items.value.filter(item => item.active)" :key="purpose.id" :value="purpose.id" :label="purpose.name" />
              <ElOption v-if="editingSnapshot?.purpose_id && String(form.nextTeamId) === String(editingSnapshot.next_team.id) && !purposes.items.value.some(item => item.active && item.id === editingSnapshot?.purpose_id)" :value="editingSnapshot.purpose_id" :label="`${editingSnapshot.purpose_name}（原单业务）`" />
            </ElSelect>
            <p v-if="purposes.items.value.length && !purposes.items.value.some(item => item.active)" class="dialog-field-hint">接收班组暂无启用业务，新转料前需由该班组在工作台中启用。</p>
            <ElButton v-if="purposes.error.value" link type="danger" @click="purposes.refresh">业务加载失败，点击重试</ElButton>
          </ElFormItem>
          <ElFormItem v-if="!weightOnly" :label="external ? `${actionLabel}件数` : '转料件数'" required :error="fieldErrors.quantity" data-validation-field="quantity">
            <ElInputNumber v-model="form.quantity" :aria-label="external ? `${actionLabel}件数` : '转料件数'" :min="0" :max="2147483647" :step="1" :precision="0" controls-position="right" :disabled="!canSubmit"><template #suffix><span class="dialog-input-unit">件</span></template></ElInputNumber>
          </ElFormItem>
          <ElFormItem v-if="!useSludge" :label="external ? `${actionLabel}重量` : '转料重量'" required :error="fieldErrors.weight" data-validation-field="weight">
            <WeightInput v-model="form.weight" :ariaLabel="external ? `${actionLabel}重量` : '转料重量'" :max="99999999999.999" :disabled="!canSubmit" />
          </ElFormItem>
          <div v-if="useSludge" class="dialog-field-wide"><SludgeWeightFields :existing="editingSnapshot || undefined" v-model:gross="form.gross" v-model:percent="form.percent" :locked="editingSnapshot?.sludge_percent_locked" :disabled="!canSubmit" :gross-error="fieldErrors.gross" :percent-error="fieldErrors.percent" @update:weight="form.weight = $event" /></div>
          <MaterialDeliveryFields v-if="!external && !weightOnly" v-model:date="form.deliveryDate" v-model:quantity="form.deliveryQuantity" :disabled="!canSubmit || linkedSource" :date-error="fieldErrors.deliveryDate" :quantity-error="fieldErrors.deliveryQuantity" />
          <p v-if="linkedSource && form.deliveryDate" class="dialog-field-wide delivery-origin">交期沿用源头批次 {{ editingSnapshot?.delivery_origin_batch_no }}</p>
          <p v-if="form.materialType === 'sludge' && !useSludge" class="dialog-field-wide quantity-hint">历史废泥未记录比例，沿用原账重，不自动折算。</p>
          <ElFormItem v-if="toWarehouse" label="入库仓位" class="dialog-field-wide"><strong v-if="editingSnapshot?.warehouse_location">{{ editingSnapshot.warehouse_location }}</strong><WarehouseLocationSelect v-else v-model="form.warehouseLocation" v-model:reservation-key="form.warehouseLocationKey" :team-id="Number(form.nextTeamId)" :serial-no="form.serialNo" :material-name="form.document.material_name" :material-type="form.materialType" :active="modelValue" :disabled="saving || refreshing" @busy-change="locationBusy = $event" /></ElFormItem>
        </div>
      </section>

      <section v-for="section in documentSections" :key="section.name" class="transfer-section" :data-form-section="section.name" :aria-labelledby="`transfer-${section.name}-heading`">
        <h3 :id="`transfer-${section.name}-heading`">{{ section.label }}</h3>
        <div class="transfer-section-fields">
          <ElFormItem v-for="field in section.fields" :key="field.key" :label="field.label" :error="fieldErrors[field.key]" :data-validation-field="field.key" :class="{ 'transfer-specification-field': specificationKeys.includes(field.key) }">
            <template #label>{{ field.label }}<AutofillBadge :source="autofill.source(field.key)" /></template>
            <SpecificationInput v-if="specificationKeys.includes(field.key)" v-model="form.document[field.key]" :label="field.label" :disabled="!canSubmit || external" @validity-change="specificationValidity[field.key] = $event" />
            <MaterialInput v-else-if="suggestionFields.includes(field.key)" v-model="form.document[field.key]" :field="field.key as MaterialInputField" :label="field.label" :maxlength="field.maxLength" :disabled="!canSubmit || external || (linkedSource && field.key === 'material_name')" />
            <ElInput v-else v-model="form.document[field.key]" :aria-label="field.label" :type="field.multiline ? 'textarea' : 'text'" :rows="2" :maxlength="field.maxLength" :show-word-limit="field.multiline" :disabled="!canSubmit || external" placeholder="选填" />
          </ElFormItem>
          <ElFormItem v-if="section.name === 'document' && !weightOnly" label="成品件数" :error="fieldErrors.finishedQuantity" data-validation-field="finishedQuantity"><ElInputNumber v-model="form.finishedQuantity" aria-label="成品件数" :min="0" :max="2147483647" :precision="0" controls-position="right" :disabled="!canSubmit || external" placeholder="选填"><template #suffix><span class="dialog-input-unit">件</span></template></ElInputNumber></ElFormItem>
          <ElFormItem v-if="section.name === 'notes'" :label="notesLabel" :error="fieldErrors.notes" data-validation-field="notes">
            <ElInput v-model="form.notes" :aria-label="notesLabel" type="textarea" :rows="2" maxlength="2000" show-word-limit :disabled="!canSubmit" :placeholder="toWarehouse ? '选填：说明当前物料情况或转回库房的原因' : '选填'" />
          </ElFormItem>
        </div>
      </section>
      <ElButton v-if="refreshFailed" :loading="refreshing" @click="refreshAfterConflict">重新读取</ElButton>
    </ElForm>

    <template #footer>
      <ElButton :disabled="saving" @click="close">取消</ElButton>
      <ElButton type="primary" :loading="saving" :disabled="!canSubmit" @click="submit">{{ isEditing ? '保存修改' : '生成转料单' }}</ElButton>
    </template>
  </ElDialog>
</template>

<style scoped>
:global(.material-transfer-form-dialog.el-dialog) { --el-component-size: 32px; margin-block: 16px; max-height: calc(100dvh - 32px); }
:global(.material-transfer-form-dialog .el-dialog__body) { padding-block: 16px 20px; scroll-padding-bottom: 20px; }
.form-heading { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 28px; }
.form-heading h2 { margin: 0; color: var(--text); font-size: 20px; font-weight: 550; }
.handoff-preview { display: flex; align-items: center; min-width: 0; gap: 10px; color: var(--muted); font-size: 13px; }
.handoff-preview strong { color: var(--primary); font-weight: 500; overflow-wrap: anywhere; }
.handoff-preview > .el-icon { color: var(--subtle); }
.transfer-form { margin-top: 0; }
.transfer-section { display: grid; grid-template-columns: 100px minmax(0, 1fr); column-gap: 24px; padding-block: 8px; border-bottom: 1px solid var(--line-light); }
.transfer-section:first-child { padding-top: 0; }
.transfer-section:last-of-type { padding-bottom: 0; border-bottom: 0; }
.transfer-section h3 { margin: 6px 0 0; color: var(--text); font-size: 14px; font-weight: 550; line-height: 20px; }
.transfer-section-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 24px; min-width: 0; align-items: start; }
.transfer-section-fields :deep(.el-form-item) { margin-bottom: 0; min-width: 0; }
.transfer-section-fields :deep(.el-form-item__label) { align-items: center; flex-wrap: nowrap; gap: 4px; min-height: 32px; height: auto; padding-right: 12px; line-height: 20px; font-size: 13px; }
.transfer-section-fields :deep(.el-form-item__content) { min-width: 0; }
.transfer-section-fields :deep(.el-input__wrapper), .transfer-section-fields :deep(.el-select__wrapper) { min-height: 32px; }
.transfer-section-fields :deep(.delivery-fields) { display: contents; }
.transfer-section-fields :deep(.el-input-number) { width: 100%; }
.transfer-section-fields :deep(.autofill-badge) { padding: 0 4px; font-size: 10px; }
.transfer-specification-field :deep(.el-form-item__label) { align-content: start; padding-top: 10px; }
.transfer-specification-field :deep(.specification-dimensions label > span) { line-height: 18px; }
.quantity-hint, .delivery-origin { margin: 0; color: var(--subtle); font-size: 12px; }
@media (max-width: 900px) {
  :global(.material-transfer-form-dialog.el-dialog) { --el-component-size: 36px; }
  .transfer-section { grid-template-columns: 88px minmax(0, 1fr); column-gap: 16px; }
  .transfer-section-fields { grid-template-columns: minmax(0, 1fr); }
  .transfer-section-fields :deep(.el-form-item__label) { min-height: 36px; }
  .transfer-section-fields :deep(.el-input__wrapper), .transfer-section-fields :deep(.el-select__wrapper) { min-height: 36px; }
}
@media (max-width: 560px) {
  :global(.material-transfer-form-dialog.el-dialog) { --el-component-size: 40px; }
  .form-heading { gap: 6px; flex-direction: column; align-items: flex-start; }
  .form-heading h2 { font-size: 18px; }
  .transfer-section { grid-template-columns: minmax(0, 1fr); gap: 12px; padding-block: 18px; }
  .transfer-section h3 { margin: 0; color: var(--primary); }
  .transfer-section-fields { row-gap: 14px; }
  .transfer-section-fields :deep(.el-form-item) { display: block; }
  .transfer-section-fields :deep(.el-form-item__label) { width: 100% !important; min-height: 20px; margin-bottom: 6px; padding: 0; justify-content: flex-start; }
  .transfer-section-fields :deep(.el-form-item__content) { margin-left: 0 !important; }
  .transfer-section-fields :deep(.el-input__wrapper), .transfer-section-fields :deep(.el-select__wrapper) { min-height: 40px; }
}
</style>
