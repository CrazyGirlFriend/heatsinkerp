<script setup lang="ts">
import FormPageNav from './FormPageNav.vue'
import FormValidationNotice from './FormValidationNotice.vue'
import MaterialInput from './MaterialInput.vue'
import SpecificationInput from './SpecificationInput.vue'
import AutofillBadge from './AutofillBadge.vue'
import { useMaterialAutofill } from '@/composables/useMaterialAutofill'
import type { MaterialInputField } from '@/services/materialInputApi'

import SludgeWeightFields from './SludgeWeightFields.vue'
import { sludgePayload, sludgeWeight } from '@/utils/sludgeWeight'
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { ElAlert, ElButton, ElDialog, ElForm, ElFormItem, ElInput, ElInputNumber, ElOption, ElSelect, ElTabPane, ElTabs } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import MaterialDeliveryFields from './MaterialDeliveryFields.vue'
import WarehouseLocationSelect from './WarehouseLocationSelect.vue'
import { deliveryError } from '@/utils/materialDelivery'
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
const saving = ref(false), locationBusy = ref(false)
const error = ref('')
const validationPage = ref<number | null>(null)
const activeTab = ref('receipt')
const specificationKeys = ['finished_specification', 'transfer_specification']
const documentPages = [
  { name: 'document', label: '物料资料', fields: materialDocumentTextFields.filter(field => field.group === 'basic' && !field.multiline && !specificationKeys.includes(field.key) && field.key !== 'material_name') },
  { name: 'specification', label: '规格要求', fields: materialDocumentTextFields.filter(field => specificationKeys.includes(field.key) || field.key === 'technical_requirements') },
  { name: 'extra', label: '补充资料', fields: materialDocumentTextFields.filter(field => ['product_code', 'part_no', 'material_shape', 'outsourced_unit'].includes(field.key)) },
  { name: 'category', label: '业务分类', fields: materialDocumentTextFields.filter(field => ['purpose_category', 'category_level3', 'order_category'].includes(field.key)) },
  { name: 'notes', label: '说明', fields: materialDocumentTextFields.filter(field => field.group === 'extra' && field.multiline) },
]
const pageLabels = ['入库信息', '数量与交期', ...documentPages.map(page => page.label)]
const formPages = ['receipt', 'amount', ...documentPages.map(page => page.name)]
const formPage = computed({ get: () => formPages.indexOf(activeTab.value), set: page => { activeTab.value = formPages[page]! } })

const attempt = ref<CreateWarehouseReceipt | null>(null)
const recoveryBlocked = ref(false)
const readonly = computed(() => !props.modelValue || !canWrite.value || saving.value || Boolean(attempt.value) || recoveryBlocked.value)
const form = reactive({
  gross: undefined as number | undefined, percent: undefined as number | undefined,
  receiptKind: 'external' as 'external' | 'return', externalSource: '', returnDispatchNo: '',
  warehouseLocation: '', warehouseLocationKey: '',
  serialNo: '', materialType: '' as MaterialType | '', quantity: 0 as number | undefined,
  deliveryDate: '', deliveryQuantity: undefined as number | undefined,
  weight: 0 as number | undefined, notes: '', finishedQuantity: undefined as number | undefined,
  document: Object.fromEntries(materialDocumentTextFields.map(field => [field.key, ''])) as Record<MaterialTransferTextField, string>,
})
const autofill = useMaterialAutofill(() => form.serialNo, form.document)
const specificationValidity = reactive<Record<string, boolean>>({ finished_specification: true, transfer_specification: true })
const suggestionFields = ['material_name', 'customer_code', 'product_code', 'part_no', 'outsourced_unit']
let generation = 0
const storageKey = (scope: string) => `heatsink-flow.pending-warehouse-receipt.v1:${scope}`

function fill(payload: CreateWarehouseReceipt | null = null) {
  autofill.reset(); specificationValidity.finished_specification = specificationValidity.transfer_specification = true
  form.warehouseLocation = payload?.warehouse_location || ''
  form.warehouseLocationKey = payload?.warehouse_location_reservation_key || ''
  form.receiptKind = payload?.receipt_kind || 'external'; form.externalSource = payload?.external_source || ''; form.returnDispatchNo = payload?.return_dispatch_no || ''
  form.serialNo = payload?.serial_no || ''; form.materialType = payload?.material_type || ''
  form.quantity = payload?.quantity ?? 0; form.weight = payload?.weight ?? 0; form.notes = payload?.notes || ''
  form.gross = payload?.sludge_gross_weight ?? undefined; form.percent = payload?.sludge_content_percent ?? undefined
  form.finishedQuantity = payload?.finished_quantity ?? undefined
  form.deliveryDate = payload?.delivery_date || ''; form.deliveryQuantity = payload?.delivery_quantity ?? undefined
  materialDocumentTextFields.forEach(field => { form.document[field.key] = payload?.[field.key] || '' })
}
function restoreAttempt() {
  attempt.value = null; recoveryBlocked.value = false; error.value = ''; activeTab.value = 'receipt'; validationPage.value = null
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
  validationPage.value = null
  if (!canWrite.value) error.value = '仅当前正式库房账号可以手工入库'
  else if (!form.externalSource.trim()) error.value = '请填写外部来源单位'
  else if (!form.serialNo.trim()) error.value = '请输入流水号'
  else if (form.serialNo.trim().length > 80) error.value = '流水号不能超过 80 个字符'
  else if (!form.document.material_name.trim()) error.value = '请输入材质'
  else if (!form.materialType) error.value = '请选择物料类型'
  else if (form.materialType === 'sludge' && !sludgeWeight(form.gross, form.percent)) error.value = '请填写废泥实重和有效材料占比，折算重量须达到 0.001 kg'
  else if (form.warehouseLocation.length > 80) error.value = '仓位不能超过 80 个字符'
  else if (form.quantity == null || !Number.isInteger(form.quantity) || form.quantity < 0 || form.quantity > 2147483647) error.value = '入库件数须为 0 至 2147483647 的整数'
  else if (form.weight == null || !Number.isFinite(form.weight) || form.weight < 0 || form.weight > 99999999999.999 || Math.abs(form.weight * 1000 - Math.round(form.weight * 1000)) > 0.0001) error.value = '入库重量须为非负数，最多保留 3 位小数'
  else if (form.quantity === 0 && form.weight === 0) error.value = '入库件数和重量至少一项大于 0'
  else if (form.notes.trim().length > 2000) error.value = '入库说明不能超过 2000 个字符'
  else error.value = ''
  activeTab.value = /实重|占比|件数|重量|仓位/.test(error.value) ? 'amount' : error.value.startsWith('入库说明') ? 'notes' : 'receipt'
  if (error.value) { validationPage.value = formPage.value; return false }
  if (form.receiptKind === 'external') {
    error.value = deliveryError(form.deliveryDate, form.deliveryQuantity)
    if (error.value) { activeTab.value = 'amount'; validationPage.value = formPage.value; return false }
  }
  if (Object.values(specificationValidity).includes(false)) { error.value = '请填完整规格尺寸'; activeTab.value = 'specification'; validationPage.value = formPage.value; return false }
  const invalid = materialDocumentTextFields.find(field => form.document[field.key].trim().length > field.maxLength)
  if (invalid) { error.value = `${invalid.label}不能超过 ${invalid.maxLength} 个字符`; activeTab.value = invalid.key === 'material_name' ? 'receipt' : documentPages.find(page => page.fields.some(field => field.key === invalid.key))!.name }
  else if (form.finishedQuantity != null && (!Number.isInteger(form.finishedQuantity) || form.finishedQuantity < 0 || form.finishedQuantity > 2147483647)) { error.value = '成品件数须为有效的非负整数'; activeTab.value = 'document' }
  if (error.value) validationPage.value = formPage.value
  return !error.value
}
function payload(): CreateWarehouseReceipt {
  return {
    ...Object.fromEntries(materialDocumentTextFields.map(field => [field.key, form.document[field.key].trim() || null])),
    serial_no: form.serialNo.trim(), material_name: form.document.material_name.trim(), material_type: form.materialType as MaterialType,
    receipt_kind: form.receiptKind, external_source: form.externalSource.trim(), return_dispatch_no: form.receiptKind === 'return' ? form.returnDispatchNo.trim() || null : null,
    warehouse_location: form.warehouseLocation.trim() || null,
    ...(form.warehouseLocationKey ? { warehouse_location_reservation_key: form.warehouseLocationKey } : {}),
    quantity: Number(form.quantity), weight: Number(form.weight), notes: form.notes.trim(), finished_quantity: form.finishedQuantity ?? null,
    ...(form.materialType === 'sludge' ? sludgePayload(form.materialType, form.gross, form.percent) : {}),
    ...(form.receiptKind === 'external' ? { delivery_date: form.deliveryDate || null, delivery_quantity: form.deliveryQuantity ?? null } : {}),
    idempotency_key: globalThis.crypto?.randomUUID?.() || `warehouse-receipt-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  }
}
async function submit() {
  if (locationBusy.value || saving.value || recoveryBlocked.value || !canWrite.value || (!attempt.value && !validate())) return
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
      const definitive = failure instanceof TeamMaterialApiError && ([400, 403, 404, 422].includes(failure.status) || failure.status === 409 && failure.message.includes('仓位'))
      if (definitive) sessionStorage.removeItem(storageKey(scope))
      if (current !== generation || scope !== identity.value || !props.modelValue) return
      if (definitive) { attempt.value = null; if (failure.message.includes('仓位')) { form.warehouseLocation = ''; form.warehouseLocationKey = '' } }
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
    <FormValidationNotice :message="error" :page="validationPage" :label="validationPage == null ? '' : pageLabels[validationPage]" @locate="validationPage != null && (formPage = validationPage)" />
    <div class="receipt-destination"><span>入库库房</span><strong>{{ warehouse?.name || '当前库房不可用' }}</strong><small>清点后确认入库，立即增加库房库存，无需再次签收</small></div>
    <ElAlert v-if="!canWrite" type="warning" :closable="false" title="仅绑定正式库房的有效班组账号可以手工入库" />
    <ElAlert v-if="attempt" class="receipt-retry" type="warning" :closable="false" title="上次提交结果待确认" description="请重试核对同一次入库。核对完成前保留原内容，避免重复登记。" show-icon />
    <ElForm label-position="top" @submit.prevent="submit">
      <ElTabs v-model="activeTab">
        <ElTabPane label="入库信息" name="receipt">
          <div class="receipt-grid dialog-form-grid">
            <ElFormItem label="入库来源" required><ElSelect v-model="form.receiptKind" aria-label="入库来源" :disabled="readonly"><ElOption value="external" label="外部来料" /><ElOption value="return" label="外部退回" /></ElSelect></ElFormItem>
            <ElFormItem label="外部来源单位" required><MaterialInput v-model="form.externalSource" field="external_source" label="外部来源单位" :maxlength="240" :disabled="readonly" placeholder="供应商、外委单位或退回单位" /></ElFormItem>
            <ElFormItem v-if="form.receiptKind === 'return'" label="原出库批次" class="dialog-field-wide"><ElInput v-model="form.returnDispatchNo" aria-label="原出库批次" maxlength="40" :disabled="readonly" placeholder="选填已确认的出库批次号；流水号沿用原号" /></ElFormItem>
            <ElFormItem label="流水号" required><MaterialInput v-model="form.serialNo" field="serial_no" label="流水号" :maxlength="80" :disabled="readonly" placeholder="输入或选择流水号" @selected="autofill.select" /></ElFormItem>
            <ElFormItem label="材质" required><template #label>材质<AutofillBadge :source="autofill.source('material_name')" /></template><MaterialInput v-model="form.document.material_name" field="material_name" label="材质" :disabled="readonly" placeholder="输入或选择材质" /></ElFormItem>
            <ElFormItem label="物料类型" required><ElSelect v-model="form.materialType" aria-label="物料类型" placeholder="选择物料类型" :disabled="readonly"><ElOption v-for="item in materialTypeOptions" :key="item.value" :label="item.label" :value="item.value" /></ElSelect></ElFormItem>
          </div>
        </ElTabPane>
        <ElTabPane label="数量与交期" name="amount">
          <MaterialDeliveryFields v-if="form.receiptKind === 'external'" v-model:date="form.deliveryDate" v-model:quantity="form.deliveryQuantity" :disabled="readonly" />
          <div class="receipt-grid dialog-form-grid">
            <ElFormItem label="入库件数" required><ElInputNumber v-model="form.quantity" aria-label="入库件数" :min="0" :max="2147483647" :precision="0" controls-position="right" :disabled="readonly"><template #suffix><span class="dialog-input-unit">件</span></template></ElInputNumber></ElFormItem>
            <ElFormItem v-if="form.materialType !== 'sludge'" label="入库重量" required><ElInputNumber v-model="form.weight" aria-label="入库重量" :min="0" :max="99999999999.999" :precision="3" :step="0.001" controls-position="right" :disabled="readonly"><template #suffix><span class="dialog-input-unit">kg</span></template></ElInputNumber></ElFormItem>
            <SludgeWeightFields v-else v-model:gross="form.gross" v-model:percent="form.percent" :disabled="readonly" @update:weight="form.weight = $event" />
            <ElFormItem label="入库仓位" class="dialog-field-wide"><WarehouseLocationSelect v-model="form.warehouseLocation" v-model:reservation-key="form.warehouseLocationKey" :team-id="teamId" :serial-no="form.serialNo" :material-name="form.document.material_name" :material-type="form.materialType" :active="modelValue" :disabled="readonly" @busy-change="locationBusy = $event" /></ElFormItem>
          </div>
          <p class="receipt-hint">{{ form.materialType === 'sludge' ? '废泥按实重与有效材料占比折算；仅按重量交接时，件数填 0。' : '件数和重量至少填写一项，另一项可填 0。' }}</p>

        </ElTabPane>
        <ElTabPane v-for="page in documentPages" :key="page.name" :label="page.label" :name="page.name">
          <div class="receipt-grid dialog-form-grid">
            <ElFormItem v-for="field in page.fields" :key="field.key" :label="field.label" :class="{ 'dialog-field-wide': field.multiline || specificationKeys.includes(field.key) }"><template #label>{{ field.label }}<AutofillBadge :source="autofill.source(field.key)" /></template><SpecificationInput v-if="specificationKeys.includes(field.key)" v-model="form.document[field.key]" :label="field.label" :disabled="readonly" @validity-change="specificationValidity[field.key] = $event" /><MaterialInput v-else-if="suggestionFields.includes(field.key)" v-model="form.document[field.key]" :field="field.key as MaterialInputField" :label="field.label" :maxlength="field.maxLength" :disabled="readonly" /><ElInput v-else v-model="form.document[field.key]" :aria-label="field.label" :type="field.multiline ? 'textarea' : 'text'" :rows="2" :maxlength="field.maxLength" :show-word-limit="field.multiline" :disabled="readonly" placeholder="选填" /></ElFormItem>
            <ElFormItem v-if="page.name === 'document'" label="成品件数"><ElInputNumber v-model="form.finishedQuantity" aria-label="成品件数" :min="0" :max="2147483647" :precision="0" controls-position="right" :disabled="readonly" placeholder="选填"><template #suffix><span class="dialog-input-unit">件</span></template></ElInputNumber></ElFormItem>
          </div>
          <template v-if="page.name === 'notes'">
          <ElFormItem label="入库说明"><ElInput v-model="form.notes" aria-label="入库说明" type="textarea" :rows="3" maxlength="2000" show-word-limit :disabled="readonly" placeholder="选填：说明来料来源及本次入库情况" /></ElFormItem>
          </template>
        </ElTabPane>
      </ElTabs>
    </ElForm>
    <template #footer><FormPageNav v-model="formPage" :total="formPages.length" :disabled="saving" /><ElButton :disabled="saving" @click="close">{{ attempt ? '稍后核对' : '取消' }}</ElButton><ElButton type="primary" :loading="saving" :disabled="!canWrite || saving || recoveryBlocked || locationBusy" @click="submit">{{ attempt ? '重试核对入库' : '确认入库' }}</ElButton></template>
  </ElDialog>
</template>

<style scoped>
.receipt-heading h2 { margin: 0; color: var(--text); font-size: 20px; font-weight: 550; }
.receipt-destination { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin: 0 0 12px; padding: 12px; border-radius: 6px; background: var(--surface-soft); font-size: 13px; }
.receipt-destination span, .receipt-destination small { color: var(--subtle); }
.receipt-destination strong { color: var(--text); font-weight: 500; }
.receipt-destination small { margin-left: auto; }
.receipt-retry { margin-bottom: 12px; }
.receipt-hint { margin: -5px 0 20px; font-size: 12px; color: var(--subtle); }
@media (max-width: 560px) { .receipt-destination small { margin-left: 0; flex-basis: 100%; } }
</style>
