<script setup lang="ts">
import AppDialog from '@/components/AppDialog.vue'
import WeightInput from './WeightInput.vue'
import { useDialogValidation } from '@/composables/useDialogValidation'
import MaterialInput from './MaterialInput.vue'
import SpecificationInput from './SpecificationInput.vue'
import AutofillBadge from './AutofillBadge.vue'
import { useMaterialAutofill } from '@/composables/useMaterialAutofill'
import type { MaterialInputField } from '@/services/materialInputApi'

import SludgeWeightFields from './SludgeWeightFields.vue'
import { sludgePayload, sludgeWeight } from '@/utils/sludgeWeight'
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import {
  ElAlert,
  ElButton,
  ElForm,
  ElFormItem,
  ElInput,
  ElInputNumber,
  ElOption,
  ElSelect,
  ElSwitch,
  ElDatePicker,
} from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import MaterialDeliveryFields from './MaterialDeliveryFields.vue'
import WarehouseLocationSelect from './WarehouseLocationSelect.vue'
import { deliveryError } from '@/utils/materialDelivery'
import { useTeamDirectoryStore } from '@/stores/teamDirectory'
import { teamMaterialApi, TeamMaterialApiError } from '@/services/teamMaterialApi'
import {
  materialDocumentTextFields,
  isScrapType,
  isWeightOnlyType,
  materialTypeOptions,
  type MaterialTransfer,
  type MaterialTransferTextField,
  type MaterialType,
} from '@/types/materialTransfer'
import type { SharedMaterialSerial } from '@/types/sharedMaterial'
import type { CreateWarehouseReceipt } from '@/types/teamMaterials'

const props = defineProps<{ modelValue: boolean; teamId: number }>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  saved: [transfer: MaterialTransfer]
}>()
const auth = useAuthStore()
const directory = useTeamDirectoryStore()
const warehouse = computed(() =>
  directory.items.find(
    (team) =>
      Number(team.id) === props.teamId &&
      team.active &&
      team.code === 'FACTORY-WAREHOUSE' &&
      team.kind === 'warehouse',
  ),
)
const canWrite = computed(
  () =>
    Boolean(warehouse.value) &&
    directory.loaded &&
    !directory.error &&
    auth.isTeamAccount &&
    auth.currentUser?.active !== false &&
    auth.currentUser?.id != null &&
    Number(auth.currentUser.team_id) === props.teamId &&
    !auth.currentUserError,
)
const identity = computed(() => `${auth.currentUser?.id ?? ''}:${props.teamId}`)
const saving = ref(false),
  locationBusy = ref(false)
const error = ref('')
const specificationKeys = ['finished_specification', 'transfer_specification']
const documentSections = [
  {
    name: 'document',
    label: '物料资料',
    fields: materialDocumentTextFields.filter(
      (field) =>
        !field.multiline && !specificationKeys.includes(field.key) && field.key !== 'material_name',
    ),
  },
  {
    name: 'specification',
    label: '规格工艺',
    fields: materialDocumentTextFields.filter(
      (field) =>
        specificationKeys.includes(field.key) ||
        ['technical_requirements', 'special_process'].includes(field.key),
    ),
  },
  {
    name: 'notes',
    label: '补充说明',
    fields: materialDocumentTextFields.filter((field) => field.key === 'material_description'),
  },
]
const attempt = ref<CreateWarehouseReceipt | null>(null)
const recoveryBlocked = ref(false)
const readonly = computed(
  () =>
    !props.modelValue ||
    !canWrite.value ||
    saving.value ||
    Boolean(attempt.value) ||
    recoveryBlocked.value,
)
const form = reactive({
  gross: undefined as number | undefined,
  percent: undefined as number | undefined,
  receiptKind: 'external' as 'external' | 'return',
  externalSource: '',
  returnDispatchNo: '',
  warehouseLocation: '',
  warehouseLocationKey: '',
  serialNo: '',
  materialType: '' as MaterialType | '',
  quantity: 0 as number | undefined,
  deliveryDate: '',
  deliveryQuantity: undefined as number | undefined,
  weight: 0 as number | undefined,
  notes: '',
  finishedQuantity: undefined as number | undefined,
  document: Object.fromEntries(
    materialDocumentTextFields.map((field) => [field.key, '']),
  ) as Record<MaterialTransferTextField, string>,
})
const shared = ref(false)
type MemberDraft = SharedMaterialSerial & {
  planned_specification: string
  specificationValid?: boolean
}
const members = ref<MemberDraft[]>([])
const newMember = (): MemberDraft => ({
  serial_no: '',
  customer_code: '',
  finished_specification: '',
  delivery_date: null,
  delivery_quantity: null,
  planned_weight: null,
  planned_quantity: null,
  planned_specification: '',
})
const plannedWeight = computed(
  () =>
    Math.round(
      members.value.reduce((sum, member) => sum + (member.planned_weight || 0), 0) * 1000000,
    ) / 1000000,
)
const plannedQuantity = computed(() =>
  members.value.reduce((sum, member) => sum + (member.planned_quantity || 0), 0),
)
const planWeightDifference = computed(
  () => Math.round((plannedWeight.value - (form.weight || 0)) * 1000000) / 1000000,
)
const sharedEntry = computed(() => shared.value && form.receiptKind === 'external')
const visibleSections = computed(() =>
  documentSections.map((section) => ({
    ...section,
    fields: section.fields.filter(
      (field) =>
        !sharedEntry.value || !['customer_code', 'finished_specification'].includes(field.key),
    ),
  })),
)
watch(sharedEntry, (active) => {
  if (active && members.value.length < 2) members.value = [newMember(), newMember()]
})
const weightOnly = computed(() => isWeightOnlyType(form.materialType))
const enteredQuantity = computed(() => (weightOnly.value ? 0 : form.quantity))
const autofill = useMaterialAutofill(() => (sharedEntry.value ? '' : form.serialNo), form.document)
const specificationValidity = reactive<Record<string, boolean>>({
  finished_specification: true,
  transfer_specification: true,
})
const suggestionFields = [
  'material_name',
  'customer_code',
  'product_code',
  'part_no',
  'outsourced_unit',
]
let generation = 0
const storageKey = (scope: string) => `heatsink-flow.pending-warehouse-receipt.v1:${scope}`

function fill(payload: CreateWarehouseReceipt | null = null) {
  autofill.reset()
  specificationValidity.finished_specification = specificationValidity.transfer_specification = true
  form.warehouseLocation = payload?.warehouse_location || ''
  form.warehouseLocationKey = payload?.warehouse_location_reservation_key || ''
  form.receiptKind = payload?.receipt_kind || 'external'
  form.externalSource = payload?.external_source || ''
  form.returnDispatchNo = payload?.return_dispatch_no || ''
  shared.value = Boolean(payload?.shared_serials?.length)
  members.value = payload?.shared_serials?.map((member) => ({
    ...member,
    planned_specification: member.planned_specification || '',
  })) || [newMember(), newMember()]
  form.serialNo = payload?.serial_no || ''
  form.materialType = payload?.material_type || ''
  form.quantity = payload?.quantity ?? 0
  form.weight = payload?.weight ?? 0
  form.notes = payload?.notes || ''
  form.gross = payload?.sludge_gross_weight ?? undefined
  form.percent = payload?.sludge_content_percent ?? undefined
  form.finishedQuantity = payload?.finished_quantity ?? undefined
  form.deliveryDate = payload?.delivery_date || ''
  form.deliveryQuantity = payload?.delivery_quantity ?? undefined
  materialDocumentTextFields.forEach((field) => {
    form.document[field.key] = payload?.[field.key] || ''
  })
}
function restoreAttempt() {
  attempt.value = null
  recoveryBlocked.value = false
  error.value = ''
  validation.reset()
  try {
    const saved = sessionStorage.getItem(storageKey(identity.value))
    if (saved) {
      const payload = JSON.parse(saved) as CreateWarehouseReceipt
      if (
        !payload ||
        typeof payload.idempotency_key !== 'string' ||
        !payload.idempotency_key ||
        typeof payload.serial_no !== 'string' ||
        typeof payload.material_name !== 'string'
      )
        throw new Error('Invalid draft')
      attempt.value = payload
    }
  } catch {
    recoveryBlocked.value = true
    error.value = '上次入库草稿读取失败，请先在入库记录中核对，避免重复登记。'
  }
  fill(attempt.value)
}
function close() {
  if (!saving.value) emit('update:modelValue', false)
}
const validation = useDialogValidation(() => {
  const issues: Record<string, string> = {}
  if (!form.externalSource.trim() || form.externalSource.trim().length > 240)
    issues.externalSource = '请填写外部来源单位'
  if (!sharedEntry.value && (!form.serialNo.trim() || form.serialNo.trim().length > 80))
    issues.serialNo = '请输入有效流水号'
  if (sharedEntry.value) {
    const serials = members.value.map((member) => member.serial_no.trim().toLocaleLowerCase())
    members.value.forEach((member, index) => {
      if (
        !member.serial_no.trim() ||
        member.serial_no.length > 80 ||
        serials.indexOf(serials[index]!) !== index ||
        member.serial_no.startsWith('共投-')
      )
        issues[`member${index}serial`] = '流水号不能为空或重复'
      if (
        member.planned_weight == null ||
        !Number.isFinite(member.planned_weight) ||
        member.planned_weight <= 0 ||
        member.planned_weight > 99999999999.999 ||
        Math.abs(member.planned_weight * 1000000 - Math.round(member.planned_weight * 1000000)) >
          0.0001
      )
        issues[`member${index}weight`] = '请填写计划用料重量'
      if (
        !Number.isSafeInteger(member.planned_quantity) ||
        Number(member.planned_quantity) <= 0 ||
        Number(member.planned_quantity) > 2147483647
      )
        issues[`member${index}quantity`] = '请填写计划切出件数'
      if (
        !member.planned_specification.trim() ||
        member.planned_specification.length > 240 ||
        member.specificationValid === false
      )
        issues[`member${index}cutting`] = '请填写完整的计划切割尺寸'
      if ((member.customer_code?.length || 0) > 80) issues[`member${index}customer`] = '内容过长'
      if ((member.finished_specification?.length || 0) > 240)
        issues[`member${index}specification`] = '内容过长'
      const message = deliveryError(
        member.delivery_date || '',
        member.delivery_quantity ?? undefined,
      )
      if (message) issues[`member${index}delivery`] = message
    })
    if (members.value.length < 2 || members.value.length > 20)
      issues.members = '请选择 2 至 20 个流水号'
    if (isScrapType(form.materialType || null)) issues.materialType = '共投入库请选择正常物料'
  }
  if (!form.document.material_name.trim()) issues.material_name = '请输入材质'
  if (!form.materialType) issues.materialType = '请选择物料类型'
  if (form.materialType === 'sludge' && !sludgeWeight(form.gross, form.percent)) {
    if (!sludgeWeight(form.gross, 100)) issues.gross = '请填写有效废泥实重'
    if (!sludgeWeight(1, form.percent)) issues.percent = '请填写有效材料占比'
    if (!issues.gross && !issues.percent) issues.gross = '折算重量须达到 0.000001 kg'
  }
  if (form.warehouseLocation.length > 80) issues.warehouseLocation = '仓位不能超过 80 个字符'
  if (
    enteredQuantity.value == null ||
    !Number.isInteger(enteredQuantity.value) ||
    enteredQuantity.value < 0 ||
    enteredQuantity.value > 2147483647
  )
    issues.quantity = '请填写有效非负整数'
  if (
    form.materialType !== 'sludge' &&
    (form.weight == null ||
      !Number.isFinite(form.weight) ||
      form.weight < 0 ||
      form.weight > 99999999999.999 ||
      Math.abs(form.weight * 1000000 - Math.round(form.weight * 1000000)) > 0.0001)
  )
    issues.weight = '请填写有效非负重量'
  else if (weightOnly.value && !form.weight) issues.weight = '请填写大于 0 的重量'
  else if (enteredQuantity.value === 0 && form.weight === 0) {
    issues.quantity = issues.weight = '件数和重量至少一项大于 0'
  }
  if (form.receiptKind === 'external' && !weightOnly.value && !sharedEntry.value) {
    const message = deliveryError(form.deliveryDate, form.deliveryQuantity)
    if (message)
      issues[
        !form.deliveryDate || message.includes('有效的要求发货日期')
          ? 'deliveryDate'
          : 'deliveryQuantity'
      ] = message
  }
  for (const field of materialDocumentTextFields) {
    if (specificationValidity[field.key] === false) issues[field.key] = '请填完整规格尺寸'
    else if (form.document[field.key].trim().length > field.maxLength)
      issues[field.key] = '内容过长'
  }
  if (
    !weightOnly.value &&
    form.finishedQuantity != null &&
    (!Number.isInteger(form.finishedQuantity) ||
      form.finishedQuantity < 0 ||
      form.finishedQuantity > 2147483647)
  )
    issues.finishedQuantity = '请填写有效非负整数'
  if (form.notes.trim().length > 2000) issues.notes = '内容过长'
  return issues
})
const { formRef, fieldErrors } = validation
function payload(): CreateWarehouseReceipt {
  return {
    ...Object.fromEntries(
      materialDocumentTextFields.map((field) => [
        field.key,
        form.document[field.key].trim() || null,
      ]),
    ),
    serial_no: sharedEntry.value ? '' : form.serialNo.trim(),
    material_name: form.document.material_name.trim(),
    material_type: form.materialType as MaterialType,
    receipt_kind: form.receiptKind,
    external_source: form.externalSource.trim(),
    return_dispatch_no: form.receiptKind === 'return' ? form.returnDispatchNo.trim() || null : null,
    warehouse_location: form.warehouseLocation.trim() || null,
    ...(form.warehouseLocationKey
      ? { warehouse_location_reservation_key: form.warehouseLocationKey }
      : {}),
    quantity: Number(enteredQuantity.value),
    weight: Number(form.weight),
    notes: form.notes.trim(),
    finished_quantity: weightOnly.value ? null : (form.finishedQuantity ?? null),
    ...(form.materialType === 'sludge'
      ? sludgePayload(form.materialType, form.gross, form.percent)
      : {}),
    ...(form.receiptKind === 'external'
      ? {
          delivery_date: weightOnly.value ? null : form.deliveryDate || null,
          delivery_quantity: weightOnly.value ? null : (form.deliveryQuantity ?? null),
        }
      : {}),
    ...(sharedEntry.value
      ? {
          customer_code: null,
          finished_specification: null,
          delivery_date: null,
          delivery_quantity: null,
          shared_serials: members.value.map((member) => ({
            serial_no: member.serial_no.trim(),
            customer_code: member.customer_code?.trim() || null,
            finished_specification: member.finished_specification?.trim() || null,
            delivery_date: member.delivery_date || null,
            delivery_quantity: member.delivery_quantity ?? null,
            planned_weight: member.planned_weight,
            planned_quantity: member.planned_quantity,
            planned_specification: member.planned_specification.trim(),
          })),
        }
      : {}),
    idempotency_key:
      globalThis.crypto?.randomUUID?.() ||
      `warehouse-receipt-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  }
}
async function submit() {
  if (
    locationBusy.value ||
    saving.value ||
    recoveryBlocked.value ||
    !canWrite.value ||
    (!attempt.value && !validation.validate())
  )
    return
  const scope = identity.value,
    teamId = props.teamId,
    current = ++generation
  saving.value = true
  error.value = ''
  try {
    await auth.refreshCurrentUser()
    await directory.refreshTeamDirectory()
    if (current !== generation || scope !== identity.value || !props.modelValue) return
    if (!canWrite.value) {
      error.value = '账号或库房信息已变更，当前不能入库'
      return
    }
    const body = attempt.value || payload()
    // Persist before sending: a lost response or reopened dialog must retry the same entry.
    try {
      sessionStorage.setItem(storageKey(scope), JSON.stringify(body))
    } catch {
      error.value = '无法保存本次入库的重试信息，请检查浏览器存储后重试'
      return
    }
    attempt.value = body
    try {
      const saved = await teamMaterialApi.createReceipt(teamId, body)
      sessionStorage.removeItem(storageKey(scope))
      if (current !== generation || scope !== identity.value || !props.modelValue) return
      attempt.value = null
      emit('saved', saved)
      emit('update:modelValue', false)
    } catch (failure) {
      const definitive =
        failure instanceof TeamMaterialApiError &&
        ([400, 403, 404, 422].includes(failure.status) ||
          (failure.status === 409 && failure.message.includes('仓位')))
      if (definitive) sessionStorage.removeItem(storageKey(scope))
      if (current !== generation || scope !== identity.value || !props.modelValue) return
      if (definitive) {
        attempt.value = null
        if (failure.message.includes('仓位')) {
          form.warehouseLocation = ''
          form.warehouseLocationKey = ''
        }
      }
      error.value = failure instanceof Error ? failure.message : '入库提交失败，请重试核对'
    }
  } catch (failure) {
    if (current === generation && scope === identity.value)
      error.value = failure instanceof Error ? failure.message : '账号信息核验失败，请重试'
  } finally {
    if (current === generation) saving.value = false
  }
}
watch(
  () => props.modelValue,
  (open) => {
    ++generation
    saving.value = false
    if (open) restoreAttempt()
  },
  { immediate: true },
)
watch(identity, () => {
  ++generation
  saving.value = false
  attempt.value = null
  fill()
  emit('update:modelValue', false)
})
onBeforeUnmount(() => {
  ++generation
})
</script>

<template>
  <AppDialog
    :model-value="modelValue"
    title="库房手工入库"
    width="min(1180px, 96vw)"
    top="16px"
    class="warehouse-receipt-dialog"
    :close-on-click-modal="!saving"
    :close-on-press-escape="!saving"
    :show-close="!saving"
    @close="close"
  >
    <template #header
      ><div class="receipt-heading">
        <h2>手工入库</h2>
        <span
          >入库库房 · <strong>{{ warehouse?.name || '当前库房不可用' }}</strong></span
        >
      </div></template
    >
    <ElAlert v-if="error" :title="error" type="error" :closable="false" />
    <ElAlert
      v-if="!canWrite"
      type="warning"
      :closable="false"
      title="仅绑定正式库房的有效班组账号可以手工入库"
    />
    <ElAlert
      v-if="attempt"
      class="receipt-retry"
      type="warning"
      :closable="false"
      title="上次提交结果待确认"
      description="请重试核对同一次入库。核对完成前保留原内容，避免重复登记。"
      show-icon
    />
    <ElForm
      ref="formRef"
      class="dialog-form-compact"
      label-position="top"
      :show-message="false"
      @submit.prevent="submit"
    >
      <section class="dialog-form-section receipt-primary-section">
        <h3>入库信息</h3>
        <div class="receipt-grid dialog-form-grid">
          <ElFormItem label="入库来源" :error="fieldErrors.receiptKind" required
            ><ElSelect v-model="form.receiptKind" aria-label="入库来源" :disabled="readonly"
              ><ElOption value="external" label="外部来料" /><ElOption
                value="return"
                label="外部退回" /></ElSelect
          ></ElFormItem>
          <ElFormItem label="外部来源单位" :error="fieldErrors.externalSource" required
            ><MaterialInput
              v-model="form.externalSource"
              field="external_source"
              label="外部来源单位"
              :maxlength="240"
              :disabled="readonly"
              placeholder="供应商、外委单位或退回单位"
          /></ElFormItem>
          <ElFormItem
            v-if="form.receiptKind === 'return'"
            label="原出库批次"
            :error="fieldErrors.returnDispatchNo"
            class="dialog-field-wide"
            ><ElInput
              v-model="form.returnDispatchNo"
              aria-label="原出库批次"
              maxlength="40"
              :disabled="readonly"
              placeholder="选填已确认的出库批次号；流水号沿用原号"
          /></ElFormItem>
          <ElFormItem v-if="!sharedEntry" label="流水号" :error="fieldErrors.serialNo" required
            ><MaterialInput
              v-model="form.serialNo"
              field="serial_no"
              label="流水号"
              :maxlength="80"
              :disabled="readonly"
              placeholder="输入或选择流水号"
              @selected="autofill.select"
          /></ElFormItem>
          <ElFormItem label="材质" :error="fieldErrors.material_name" required
            ><template #label
              >材质<AutofillBadge :source="autofill.source('material_name')" /></template
            ><MaterialInput
              v-model="form.document.material_name"
              field="material_name"
              label="材质"
              :disabled="readonly"
              placeholder="输入或选择材质"
          /></ElFormItem>
          <ElFormItem label="物料类型" :error="fieldErrors.materialType" required
            ><ElSelect
              v-model="form.materialType"
              aria-label="物料类型"
              placeholder="选择物料类型"
              :disabled="readonly"
              ><ElOption
                v-for="item in materialTypeOptions"
                :key="item.value"
                :label="item.label"
                :value="item.value" /></ElSelect
          ></ElFormItem>
        </div>
      </section>
      <section v-if="form.receiptKind === 'external'" class="shared-entry-section">
        <div class="shared-entry-heading">
          <ElSwitch
            v-model="shared"
            :disabled="readonly"
            active-text="共投入库"
            aria-label="共投入库"
          /><span v-if="sharedEntry">先填写各流水号用料计划；整块料库存只记一次</span>
        </div>
        <div v-if="sharedEntry" class="shared-member-scroll">
          <table class="shared-member-table" aria-label="共投流水号安排">
            <thead>
              <tr>
                <th>流水号 *</th>
                <th>计划用料 (kg) *</th>
                <th>计划切出 (件) *</th>
                <th>客户代码</th>
                <th>成品规格</th>
                <th>要求发货日期</th>
                <th>应发件数</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <template v-for="(member, index) in members" :key="index"
                ><tr>
                  <td>
                    <ElFormItem :error="fieldErrors[`member${index}serial`]"
                      ><MaterialInput
                        v-model="member.serial_no"
                        field="serial_no"
                        :label="`共投流水号${index + 1}`"
                        :maxlength="80"
                        :disabled="readonly"
                    /></ElFormItem>
                  </td>
                  <td>
                    <ElFormItem :error="fieldErrors[`member${index}weight`]"
                      ><ElInputNumber
                        v-model="member.planned_weight"
                        :aria-label="`共投计划重量${index + 1}`"
                        :disabled="readonly"
                        :min="0.000001"
                        :max="99999999999.999"
                        :controls="false"
                    /></ElFormItem>
                  </td>
                  <td>
                    <ElFormItem :error="fieldErrors[`member${index}quantity`]"
                      ><ElInputNumber
                        v-model="member.planned_quantity"
                        :aria-label="`共投计划件数${index + 1}`"
                        :disabled="readonly"
                        :min="1"
                        :max="2147483647"
                        :precision="0"
                        :controls="false"
                    /></ElFormItem>
                  </td>
                  <td>
                    <ElFormItem :error="fieldErrors[`member${index}customer`]"
                      ><ElInput
                        v-model="member.customer_code"
                        :aria-label="`共投客户${index + 1}`"
                        :disabled="readonly"
                        maxlength="80"
                        placeholder="选填"
                    /></ElFormItem>
                  </td>
                  <td>
                    <ElFormItem :error="fieldErrors[`member${index}specification`]"
                      ><ElInput
                        v-model="member.finished_specification"
                        :aria-label="`共投成品规格${index + 1}`"
                        :disabled="readonly"
                        maxlength="240"
                        placeholder="选填"
                    /></ElFormItem>
                  </td>
                  <td>
                    <ElFormItem :error="fieldErrors[`member${index}delivery`]"
                      ><ElDatePicker
                        v-model="member.delivery_date"
                        type="date"
                        value-format="YYYY-MM-DD"
                        :aria-label="`共投交期${index + 1}`"
                        :disabled="readonly"
                        placeholder="选填"
                    /></ElFormItem>
                  </td>
                  <td>
                    <ElFormItem :error="fieldErrors[`member${index}delivery`]"
                      ><ElInputNumber
                        v-model="member.delivery_quantity"
                        :aria-label="`共投应发件数${index + 1}`"
                        :disabled="readonly"
                        :min="1"
                        :max="2147483647"
                        :precision="0"
                        :controls="false"
                    /></ElFormItem>
                  </td>
                  <td>
                    <ElButton
                      text
                      :disabled="readonly || members.length <= 2"
                      :aria-label="`移除共投流水号${index + 1}`"
                      @click="members.splice(index, 1)"
                      >移除</ElButton
                    >
                  </td>
                </tr>
                <tr class="shared-cutting-row">
                  <td colspan="8">
                    <ElFormItem
                      :label="'计划切割尺寸 · ' + (member.serial_no || `流水号 ${index + 1}`)"
                      :error="fieldErrors[`member${index}cutting`]"
                      required
                      ><SpecificationInput
                        v-model="member.planned_specification"
                        :label="`共投计划切割尺寸${index + 1}`"
                        :disabled="readonly"
                        @validity-change="member.specificationValid = $event"
                    /></ElFormItem>
                  </td></tr
              ></template>
            </tbody>
          </table>
          <div class="shared-plan-summary">
            <span
              >计划合计 <b>{{ plannedWeight }} kg</b><b>{{ plannedQuantity }} 件</b></span
            ><span
              v-if="form.weight && planWeightDifference !== 0"
              :class="{ 'shared-plan-warning': planWeightDifference > 1 }"
              >{{ planWeightDifference > 0 ? '计划超出入库重量' : '未规划重量' }}
              {{ Math.abs(planWeightDifference) }} kg</span
            >
          </div>
          <ElButton
            class="action-cool"
            :disabled="readonly || members.length >= 20"
            @click="members.push(newMember())"
            >添加流水号</ElButton
          >
        </div>
      </section>
      <section class="dialog-form-section dialog-section-quantities">
        <h3>数量与交期</h3>
        <div class="receipt-grid dialog-form-grid">
          <MaterialDeliveryFields
            v-if="form.receiptKind === 'external' && !weightOnly && !sharedEntry"
            v-model:date="form.deliveryDate"
            v-model:quantity="form.deliveryQuantity"
            :disabled="readonly"
            :date-error="fieldErrors.deliveryDate"
            :quantity-error="fieldErrors.deliveryQuantity"
          />
          <ElFormItem v-if="!weightOnly" label="入库件数" :error="fieldErrors.quantity" required
            ><ElInputNumber
              v-model="form.quantity"
              aria-label="入库件数"
              :min="0"
              :max="2147483647"
              :precision="0"
              controls-position="right"
              :disabled="readonly"
              ><template #suffix><span class="dialog-input-unit">件</span></template></ElInputNumber
            ></ElFormItem
          >
          <ElFormItem
            v-if="form.materialType !== 'sludge'"
            label="入库重量"
            :error="fieldErrors.weight"
            required
            ><WeightInput
              v-model="form.weight"
              ariaLabel="入库重量"
              :max="99999999999.999"
              :disabled="readonly"
          /></ElFormItem>
          <SludgeWeightFields
            v-else
            v-model:gross="form.gross"
            v-model:percent="form.percent"
            :disabled="readonly"
            :gross-error="fieldErrors.gross"
            :percent-error="fieldErrors.percent"
            @update:weight="form.weight = $event"
          />
          <ElFormItem
            label="入库仓位"
            :error="fieldErrors.warehouseLocation"
            class="dialog-field-wide"
            ><WarehouseLocationSelect
              v-model="form.warehouseLocation"
              v-model:reservation-key="form.warehouseLocationKey"
              :team-id="teamId"
              :serial-no="sharedEntry ? '' : form.serialNo"
              :material-name="form.document.material_name"
              :material-type="form.materialType"
              :active="modelValue"
              :disabled="readonly"
              @busy-change="locationBusy = $event"
          /></ElFormItem>
        </div>
      </section>
      <section
        v-for="section in visibleSections"
        :key="section.name"
        class="dialog-form-section"
        :class="{
          'dialog-section-long': section.name !== 'document',
          'dialog-section-details': section.name === 'document',
        }"
      >
        <h3>{{ section.label }}</h3>
        <div class="receipt-grid dialog-form-grid">
          <ElFormItem
            v-for="field in section.fields"
            :key="field.key"
            :label="field.label"
            :error="fieldErrors[field.key]"
            :class="{ 'dialog-specification-field': specificationKeys.includes(field.key) }"
            ><template #label
              >{{ field.label }}<AutofillBadge :source="autofill.source(field.key)" /></template
            ><SpecificationInput
              v-if="specificationKeys.includes(field.key)"
              v-model="form.document[field.key]"
              :label="field.label"
              :disabled="readonly"
              @validity-change="specificationValidity[field.key] = $event" /><MaterialInput
              v-else-if="suggestionFields.includes(field.key)"
              v-model="form.document[field.key]"
              :field="field.key as MaterialInputField"
              :label="field.label"
              :maxlength="field.maxLength"
              :disabled="readonly" /><ElInput
              v-else
              v-model="form.document[field.key]"
              :aria-label="field.label"
              :type="field.multiline ? 'textarea' : 'text'"
              :rows="2"
              :maxlength="field.maxLength"
              :show-word-limit="field.multiline"
              :disabled="readonly"
              placeholder="选填"
          /></ElFormItem>
          <ElFormItem
            v-if="section.name === 'document' && !weightOnly"
            label="成品件数"
            :error="fieldErrors.finishedQuantity"
            ><ElInputNumber
              v-model="form.finishedQuantity"
              aria-label="成品件数"
              :min="0"
              :max="2147483647"
              :precision="0"
              controls-position="right"
              :disabled="readonly"
              placeholder="选填"
              ><template #suffix><span class="dialog-input-unit">件</span></template></ElInputNumber
            ></ElFormItem
          >
          <template v-if="section.name === 'notes'">
            <ElFormItem label="入库说明" :error="fieldErrors.notes"
              ><ElInput
                v-model="form.notes"
                aria-label="入库说明"
                type="textarea"
                :rows="2"
                maxlength="2000"
                show-word-limit
                :disabled="readonly"
                placeholder="选填：说明来料来源及本次入库情况"
            /></ElFormItem>
          </template>
        </div>
      </section>
    </ElForm>
    <template #footer
      ><ElButton :disabled="saving" @click="close">{{ attempt ? '稍后核对' : '取消' }}</ElButton
      ><ElButton
        type="primary"
        :loading="saving"
        :disabled="!canWrite || saving || recoveryBlocked || locationBusy"
        @click="submit"
        >{{ attempt ? '重试核对入库' : '确认入库' }}</ElButton
      ></template
    >
  </AppDialog>
</template>

<style scoped>
.shared-entry-section {
  padding: 12px 0;
  border-bottom: 1px solid var(--line);
}
.shared-entry-heading {
  display: flex;
  align-items: center;
  gap: 20px;
  font-size: 12px;
  color: var(--muted);
}
.shared-member-scroll {
  overflow-x: auto;
}
.shared-member-table {
  width: 100%;
  min-width: 900px;
  table-layout: fixed;
  border-collapse: collapse;
}
.shared-member-table th {
  text-align: center;
  font-size: 12px;
  font-weight: 500;
  color: var(--muted);
  padding: 8px;
}
.shared-member-table td {
  padding: 4px 8px;
  vertical-align: top;
}
.shared-member-table :deep(.el-form-item) {
  margin-bottom: 0;
}
.shared-member-table :deep(.el-input-number),
.shared-member-table :deep(.el-date-editor) {
  width: 100%;
}
.shared-member-table th:nth-child(5) {
  width: 18%;
}
.shared-member-table th:last-child {
  width: 60px;
}
.receipt-heading h2 {
  margin: 0;
  color: var(--text);
  font-size: 20px;
  font-weight: 550;
}
.receipt-heading {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 24px;
  align-items: center;
}
.receipt-heading > span {
  color: var(--subtle);
  font-size: 12px;
}
.receipt-heading strong {
  color: var(--primary);
  font-weight: 500;
}
.receipt-primary-section {
  padding: 12px;
  margin-bottom: 4px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--workspace-bg);
}
.receipt-retry {
  margin-bottom: 12px;
}
.shared-cutting-row td {
  padding-bottom: 16px;
  border-bottom: 1px solid var(--line);
}
.shared-cutting-row :deep(.el-form-item) {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 12px;
}
.shared-cutting-row :deep(.el-form-item__label) {
  margin-bottom: 0;
  flex-shrink: 0;
}
.shared-cutting-row :deep(.el-form-item__content) {
  flex: 1;
  min-width: 0;
}
.shared-plan-summary,
.shared-plan-summary > span {
  display: flex;
  align-items: baseline;
  gap: 16px;
}
.shared-plan-summary {
  padding: 12px 8px 4px;
  flex-wrap: wrap;
  justify-content: space-between;
  font-size: 12px;
  color: var(--muted);
}
.shared-plan-summary b {
  font-weight: 550;
  color: var(--text);
}
.shared-plan-warning {
  color: var(--el-color-warning);
}
</style>
