<script setup lang="ts">
import ProcessingParameterFields from './ProcessingParameterFields.vue'
import ProcessingInspectionFields from './ProcessingInspectionFields.vue'
import ProcessingSelfCheckFields from './ProcessingSelfCheckFields.vue'
import {
  processingParameterErrors,
  processingParameterPayload,
  type ProcessingParameters,
} from '@/config/processingParameters'
import { processingParameterFields, formatProcessingParameter } from '@/config/processingParameters'
import StatePanel from './StatePanel.vue'
import AppDetailTable from './AppDetailTable.vue'
import ElAlert from '@/components/AppAlert.vue'
import ElInput from '@/components/AppInput.vue'
import ElSelect from '@/components/AppSelect.vue'
import ElSwitch from '@/components/AppSwitch.vue'
import ElDatePicker from '@/components/AppDatePicker.vue'
import WorkspacePagination from '@/components/WorkspacePagination.vue'
import ProcessingPeople from './ProcessingPeople.vue'
import SerialRouteAttachments from './SerialRouteAttachments.vue'
import FormWorkspace from './FormWorkspace.vue'
import CompactFormSection from './CompactFormSection.vue'
import AppDialog from '@/components/AppDialog.vue'
import { materialWeightToleranceKg } from '@/config/materialRules'

import { sharedSerialLabel } from '@/types/sharedMaterial'
import SharedMaterialInfo from './SharedMaterialInfo.vue'
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useProcessRouteView } from '@/composables/useProcessRouteView'
import { focusFirstInvalidField } from '@/composables/useDialogValidation'
import {
  ElDescriptions,
  ElDescriptionsItem,
  ElForm,
  ElFormItem,
  ElOption,
  ElTableColumn,
} from 'element-plus'
import ElInputNumber from '@/components/AppNumberInput.vue'
import ElTable from '@/components/watermelon/WatermelonDataTable.vue'
import ElButton from '@/components/AppButton.vue'
import SpecificationInput from './SpecificationInput.vue'
import ProcessingPersonInput from './ProcessingPersonInput.vue'
import TeamEmployeeInput from './TeamEmployeeInput.vue'
import ProcessingDurationInput from './ProcessingDurationInput.vue'
import { formatProcessingMinutes, validProcessingMinutes } from '@/utils/processingDuration'
import ProcessingTaskFields from './ProcessingTaskFields.vue'
import ProcessExecutionPanel from './ProcessExecutionPanel.vue'
import { processRouteApi } from '@/services/processRouteApi'
import type { TeamEmployee } from '@/types/teamBusiness'
import WeightInput from './WeightInput.vue'
import SludgeWeightFields from './SludgeWeightFields.vue'
import {
  processingProgressLabels,
  processingRoleLabels,
  type ProcessingRole,
} from '@/types/materialProcessing'
import { useAuthStore } from '@/stores/auth'
import { teamMaterialApi, TeamMaterialApiError } from '@/services/teamMaterialApi'
import type {
  CreateProcessingOutput,
  CreateQuantityAdjustment,
  QuantityAdjustment,
  QuantityAdjustmentContext,
} from '@/types/teamMaterials'
import { materialRequestKey, createMaterialSubmissionKey } from '@/utils/materialStock'
import { factoryToday, formatAmount, formatDateTime } from '@/utils/format'
import { formatScheduleBatch } from '@/utils/scheduleBatch'
import {
  isScrapType,
  isWeightOnlyType,
  materialTypeLabel,
  materialTypeOptions,
  type MaterialType,
} from '@/types/materialTransfer'
import { sludgePayload, sludgeWeight } from '@/utils/sludgeWeight'

const props = defineProps<{
  modelValue: boolean
  teamId: number
  sourceId: number | null
  canWrite?: boolean
  processing?: boolean
  rework?: boolean
  reworkRecordId?: number | null
}>()
const emit = defineEmits<{
  'update:modelValue': [boolean]
  saved: [QuantityAdjustment]
  changed: []
}>()
const auth = useAuthStore()
const ProcessRouteEditor = defineAsyncComponent(() => import('./ProcessRouteEditor.vue'))
const {
  route: viewedRoute,
  loading: routeLoading,
  open: viewRoute,
  close: closeRoute,
} = useProcessRouteView()
const formRef = ref<InstanceType<typeof ElForm>>()
const snapshot = ref<QuantityAdjustmentContext | null>(null)
const records = ref<QuantityAdjustment[]>([]),
  total = ref(0),
  page = ref(1)
const historyRecords = computed(() =>
  snapshot.value?.origin_processing_record
    ? [snapshot.value.origin_processing_record, ...records.value]
    : records.value,
)
const quantity = ref<number | undefined>(),
  processorName = ref(''),
  reason = ref(''),
  error = ref('')
const progress = ref<'partial' | 'complete'>('partial'),
  specification = ref(''),
  specificationValid = ref(true),
  submitted = ref(false)
const loading = ref(false),
  saving = ref(false),
  conflict = ref(false)
type OutputDraft = {
  serialNo?: string
  key: string
  role: ProcessingRole
  material_type: MaterialType
  quantity?: number
  weight?: number
  failedQuantity?: number
  gross?: number
  percent?: number
  specification: string
  specificationValid: boolean
}
const employees = ref<TeamEmployee[]>([])
const processingMinutes = ref<number>()
const processingMinutesValid = computed(
  () =>
    (!structured.value || processingMinutes.value != null) &&
    validProcessingMinutes(processingMinutes.value),
)
const parameters = ref<ProcessingParameters>({})
const parameterFields = computed(() => processingParameterFields(snapshot.value?.parameter_fields))
const parameterErrors = computed(() =>
  processingParameterErrors(
    parameters.value,
    snapshot.value?.parameter_fields || [],
    processingMinutes.value,
  ),
)
const processingDate = ref(factoryToday())
const editingProcessingDate = ref(false)
const inputQuantity = ref<number>()
const completedWeight = ref<number>()
const reportTemplate = ref<'FACTORY-QC' | 'QC-SANDBLAST' | 'QC-DEBURR'>()
const selfCheck = ref<CreateQuantityAdjustment['self_check'] | null>()
const inspection = ref<CreateQuantityAdjustment['inspection'] | null>(null)
const inspectionEnabled = computed(
  () => unitProcessing.value && snapshot.value?.inspection_enabled === true,
)
const taskId = ref<number | null>(null),
  purposeId = ref<number | null>(null)
const scheduleId = ref<number | null>(null)
const selectedSchedule = computed(() =>
  snapshot.value?.processing_schedules?.find((item) => item.id === scheduleId.value),
)
const scheduleMissing = computed(
  () => !!snapshot.value?.processing_schedules?.length && !scheduleId.value,
)
const taskFieldsValid = ref(true),
  originalRecordId = ref<number | null>(null)
const isRework = computed(
  () =>
    props.rework ||
    snapshot.value?.rework_pending === true ||
    snapshot.value?.process_route?.route_kind === 'rework',
)
const structured = computed(() => props.processing && !!snapshot.value?.processing_mode)
const unitProcessing = computed(
  () => structured.value && snapshot.value?.processing_mode === 'unit',
)
watch(employees, (value) => {
  processorName.value = value[0]?.name || ''
})
const detailed = ref(false),
  outputs = ref<OutputDraft[]>([])
const activeOutputs = computed(() =>
  outputs.value.filter(
    (line) =>
      Number(outputQuantity(line)) ||
      Number(line.weight) ||
      (line.material_type === 'sludge' && Number(line.gross)),
  ),
)
const outputQuantity = (line: OutputDraft) =>
  isWeightOnlyType(line.material_type) ? 0 : line.quantity
const outputTotal = computed(() =>
  activeOutputs.value.reduce((sum, line) => sum + (outputQuantity(line) || 0), 0),
)
const outputWeight = computed(
  () =>
    Math.round(activeOutputs.value.reduce((sum, line) => sum + (line.weight || 0), 0) * 1000000) /
    1000000,
)
const measuredOutputs = computed(
  () =>
    activeOutputs.value.length > 0 &&
    activeOutputs.value.every((line) => line.weight != null && Number.isFinite(line.weight)),
)
const weightDifference = computed(() => {
  const after = unitProcessing.value
    ? quantity.value === snapshot.value?.quantity
      ? completedWeight.value
      : snapshot.value?.weight
    : outputWeight.value
  return Math.round(((after || 0) - (snapshot.value?.weight || 0)) * 1000000) / 1000000
})
const cumulativeWeightDifference = computed(
  () =>
    Math.round(((snapshot.value?.weight_difference || 0) + weightDifference.value) * 1000000) /
    1000000,
)
const selfCheckEnabled = computed(() => structured.value && snapshot.value?.self_check_enabled)
const selfCheckTotals = computed(() => {
  if (unitProcessing.value || !detailed.value)
    return {
      producedQuantity: quantity.value,
      producedWeight: unitProcessing.value ? completedWeight.value : snapshot.value?.weight,
      separatedQuantity: 0,
      separatedWeight: 0,
    }
  const totals = {
    producedQuantity: 0,
    producedWeight: 0,
    separatedQuantity: 0,
    separatedWeight: 0,
  }
  for (const line of activeOutputs.value) {
    if (line.role === 'produced') {
      totals.producedQuantity += line.quantity || 0
      totals.producedWeight += line.weight || 0
    } else if (line.role === 'scrap' && line.material_type === 'defective') {
      totals.separatedQuantity += line.quantity || 0
      totals.separatedWeight += line.weight || 0
    }
  }
  return totals
})
const checkedOutputs = computed(() =>
  activeOutputs.value.filter((line) => line.role === 'produced' && (line.quantity || 0) > 0),
)
const perOutputCheck = computed(
  () => selfCheckEnabled.value && detailed.value && checkedOutputs.value.length > 1,
)
const outputFailedQuantity = computed(() => {
  if (!perOutputCheck.value) return undefined
  let total = selfCheckTotals.value.separatedQuantity
  for (const line of checkedOutputs.value) {
    if (
      line.failedQuantity == null ||
      !Number.isSafeInteger(line.failedQuantity) ||
      line.failedQuantity < 0 ||
      line.failedQuantity > line.quantity!
    )
      return null
    total += line.failedQuantity
  }
  return total
})
const progressInvalid = computed(
  () =>
    !progress.value ||
    (detailed.value &&
      progress.value === 'complete' &&
      activeOutputs.value.some((line) => line.role === 'remaining')),
)
function addOutput(role: 'remaining' | 'produced' = 'produced') {
  outputs.value.push({
    key: materialRequestKey(),
    role,
    material_type:
      snapshot.value?.material_type && !isScrapType(snapshot.value.material_type)
        ? snapshot.value.material_type
        : 'semi_finished',
    specification: role === 'remaining' ? snapshot.value?.transfer_specification || '' : '',
    specificationValid: true,
  })
}
function outputRoleChanged(line: OutputDraft) {
  if (line.role === 'remaining') line.specification = snapshot.value?.transfer_specification || ''
  if (line.role === 'scrap') line.specification = ''
  if (
    line.role === 'remaining' &&
    snapshot.value?.material_type &&
    line.material_type !== snapshot.value.material_type
  ) {
    line.material_type = snapshot.value.material_type
    outputTypeChanged(line)
  }
  if (isScrapType(line.material_type) !== (line.role === 'scrap')) {
    line.material_type = line.role === 'scrap' ? 'waste' : 'semi_finished'
    outputTypeChanged(line)
  }
}
function outputTypeChanged(line: OutputDraft) {
  line.failedQuantity = undefined
  line.quantity = isWeightOnlyType(line.material_type) ? 0 : undefined
  line.weight = line.gross = line.percent = undefined
}
function outputError(line: OutputDraft, field: 'quantity' | 'weight' | 'specification' | 'serial') {
  if (!submitted.value || !activeOutputs.value.includes(line)) return false
  if (field === 'serial')
    return (
      snapshot.value?.shared_unallocated &&
      (!snapshot.value.process_route || snapshot.value.process_route.split_here) &&
      line.role === 'produced' &&
      !snapshot.value.shared_serials?.some((member) => member.serial_no === line.serialNo)
    )
  if (field === 'quantity')
    return (
      !Number.isSafeInteger(outputQuantity(line)) ||
      outputQuantity(line)! < 0 ||
      outputQuantity(line)! > 2147483647
    )
  if (field === 'specification')
    return (
      line.role === 'produced' &&
      (!line.specificationValid || (structured.value && !line.specification.trim()))
    )
  return line.material_type === 'sludge'
    ? !sludgeWeight(line.gross, line.percent)
    : line.weight == null ||
        !Number.isFinite(line.weight) ||
        line.weight < 0 ||
        line.weight > 99999999999.999
}
watch(detailed, (value) => {
  submitted.value = false
  if (value && !outputs.value.length) {
    addOutput('remaining')
    addOutput('produced')
  }
})
const editable = computed(
  () =>
    props.canWrite &&
    (auth.isAdmin || auth.isTeamAccount) &&
    auth.currentUser?.active !== false &&
    !auth.currentUserError &&
    (auth.isAdmin || Number(auth.currentUser?.team_id) === props.teamId),
)
const hasStock = computed(
  () =>
    !!snapshot.value &&
    (isRework.value ||
      snapshot.value.process_route?.available === true ||
      snapshot.value.processing_status !== 'complete' ||
      !!snapshot.value.allowed_task_ids?.length) &&
    (snapshot.value.quantity > 0 || snapshot.value.weight > 0),
)
let generation = 0
const submission = createMaterialSubmissionKey()

async function load(refreshSnapshot = false) {
  if (!props.modelValue || props.sourceId == null || saving.value) return
  const current = ++generation
  loading.value = true
  error.value = ''
  try {
    const result = await teamMaterialApi.quantityContext(props.teamId, props.sourceId, page.value)
    if (current !== generation) return
    if (!snapshot.value) {
      quantity.value = result.quantity
      inputQuantity.value = result.quantity
      completedWeight.value = result.weight
      progress.value = result.processing_status || 'partial'
      specification.value = result.transfer_specification || ''
      purposeId.value = result.purpose_id || null
      originalRecordId.value = props.reworkRecordId || result.rework_of_id || null
      taskFieldsValid.value = result.task_required == null
      if (isRework.value || result.rework_pending) {
        const original = result.rework_task_records?.find(
          (item) => item.rework_of_id === originalRecordId.value,
        )
        taskId.value = original?.processing_task_id || null
        purposeId.value = original?.purpose_id ?? purposeId.value
      }
    }
    if (!snapshot.value || refreshSnapshot) {
      snapshot.value = result
      scheduleId.value = result.production_schedule_id ?? null
      conflict.value = false
    }
    if (
      props.processing &&
      (result.processing_mode === 'split' || (!result.processing_mode && result.shared_unallocated))
    )
      detailed.value = true
    records.value = result.items
    total.value = result.total
  } catch (e) {
    if (current === generation) error.value = e instanceof Error ? e.message : '件数记录读取失败'
  } finally {
    if (current === generation) loading.value = false
  }
}
function reworkChanged() {
  emit('changed')
  emit('update:modelValue', false)
}
async function resumeRework() {
  if (!snapshot.value || saving.value || !props.sourceId) return
  saving.value = true
  error.value = ''
  try {
    await processRouteApi.resumeRework(props.sourceId, snapshot.value.revision)
    reworkChanged()
  } catch (e) {
    error.value = e instanceof Error ? e.message : '返回正常工序失败'
  } finally {
    saving.value = false
  }
}
function close() {
  if (!saving.value) emit('update:modelValue', false)
}
async function save() {
  if (
    !editable.value ||
    loading.value ||
    saving.value ||
    conflict.value ||
    !snapshot.value ||
    props.sourceId == null
  )
    return
  error.value = ''
  submitted.value = true
  const byOutput = props.processing && detailed.value && !unitProcessing.value
  const count = byOutput ? outputTotal.value : quantity.value
  const invalidOutputs =
    byOutput &&
    (!activeOutputs.value.length ||
      activeOutputs.value.some((line) =>
        ['quantity', 'weight', 'specification', 'serial'].some((field) =>
          outputError(line, field as 'quantity' | 'weight' | 'specification' | 'serial'),
        ),
      ))
  if (
    (props.processing && (!taskFieldsValid.value || scheduleMissing.value)) ||
    (structured.value &&
      (!employees.value.length ||
        !processingDate.value ||
        processingDate.value > factoryToday())) ||
    (inspectionEnabled.value && (!reportTemplate.value || !inspection.value)) ||
    (selfCheckEnabled.value && !selfCheck.value) ||
    !processingMinutesValid.value ||
    (structured.value && Object.keys(parameterErrors.value).length > 0) ||
    (structured.value &&
      !unitProcessing.value &&
      (!Number.isSafeInteger(inputQuantity.value) ||
        inputQuantity.value! <= 0 ||
        inputQuantity.value! > snapshot.value.quantity)) ||
    (unitProcessing.value &&
      (count! <= 0 ||
        count! > snapshot.value.quantity ||
        completedWeight.value == null ||
        completedWeight.value < 0)) ||
    !processorName.value.trim() ||
    processorName.value.trim().length > 80 ||
    invalidOutputs ||
    (props.processing && !byOutput && !specificationValid.value) ||
    !Number.isSafeInteger(count) ||
    count! < 0 ||
    count! > 2147483647 ||
    (props.processing && !structured.value && progressInvalid.value) ||
    (structured.value && !reason.value.trim()) ||
    reason.value.trim().length > 2000
  ) {
    await nextTick()
    focusFirstInvalidField(formRef.value?.$el)
    return
  }
  if (!props.processing && quantity.value === snapshot.value.quantity) {
    error.value = '件数未发生变化'
    return
  }
  const outputLines: CreateProcessingOutput[] = activeOutputs.value.map((line) => ({
    role: line.role,
    ...(snapshot.value?.shared_unallocated &&
    (!snapshot.value.process_route || snapshot.value.process_route.split_here) &&
    line.role === 'produced'
      ? { serial_no: line.serialNo }
      : {}),
    ...(perOutputCheck.value && line.role === 'produced'
      ? { failed_quantity: line.failedQuantity || 0 }
      : {}),
    quantity: outputQuantity(line)!,
    weight: line.weight!,
    material_type: line.material_type,
    transfer_specification: line.specification.trim(),
    ...(line.material_type === 'sludge'
      ? sludgePayload(line.material_type, line.gross, line.percent)
      : {}),
  }))
  const body = {
    ...(selfCheckEnabled.value && selfCheck.value ? { self_check: selfCheck.value } : {}),
    ...(inspectionEnabled.value && inspection.value
      ? { inspection: inspection.value, report_template: reportTemplate.value }
      : {}),
    ...(isRework.value
      ? { work_kind: 'rework' as const, rework_of_id: originalRecordId.value || undefined }
      : {}),
    ...(props.processing ? { production_schedule_id: scheduleId.value } : {}),
    source_transfer_id: props.sourceId,
    quantity: count!,
    expected_revision: snapshot.value.revision,
    processor_name: processorName.value.trim(),
    reason: reason.value.trim(),
    ...(props.processing && snapshot.value.task_required != null
      ? { processing_task_id: taskId.value, purpose_id: purposeId.value }
      : {}),
    ...(structured.value
      ? {
          processor_employee_id: employees.value[0]!.id,
          processor_employee_ids: employees.value.map((person) => person.id),
          processing_minutes: processingMinutes.value ?? null,
          ...processingParameterPayload(parameters.value, snapshot.value.parameter_fields),
          processing_date: processingDate.value,
          processing_mode: snapshot.value.processing_mode,
          ...(unitProcessing.value
            ? { completed_quantity: count!, completed_weight: completedWeight.value! }
            : { input_quantity: inputQuantity.value! }),
        }
      : {}),
    ...(props.processing
      ? {
          processing_status: structured.value
            ? (unitProcessing.value && count! < snapshot.value.quantity) ||
              (byOutput && activeOutputs.value.some((line) => line.role === 'remaining'))
              ? ('partial' as const)
              : ('complete' as const)
            : progress.value,
          ...(byOutput
            ? { outputs: outputLines }
            : { transfer_specification: specification.value.trim() }),
        }
      : {}),
  }
  const requestKey = submission.get(body)
  const current = generation
  saving.value = true
  try {
    const result = await teamMaterialApi.changeQuantity(props.teamId, {
      ...body,
      idempotency_key: requestKey,
    })
    if (current !== generation) return
    emit('saved', result)
    emit('update:modelValue', false)
  } catch (e) {
    if (current !== generation) return
    error.value = e instanceof Error ? e.message : '件数变更失败，请重试'
    conflict.value = e instanceof TeamMaterialApiError && e.status === 409
  } finally {
    if (current === generation) saving.value = false
  }
}
watch(
  () => [props.modelValue, props.teamId, props.sourceId],
  () => {
    closeRoute()
    ++generation
    snapshot.value = null
    reportTemplate.value = undefined
    selfCheck.value = undefined
    inspection.value = null
    scheduleId.value = null
    records.value = []
    total.value = 0
    page.value = 1
    quantity.value = undefined
    processorName.value = ''
    employees.value = []
    processingMinutes.value = undefined
    parameters.value = {}
    taskId.value = purposeId.value = originalRecordId.value = null
    taskFieldsValid.value = true
    processingDate.value = factoryToday()
    editingProcessingDate.value = false
    inputQuantity.value = completedWeight.value = undefined
    reason.value = error.value = ''
    submission.reset()
    progress.value = 'partial'
    specification.value = ''
    specificationValid.value = true
    submitted.value = false
    detailed.value = false
    outputs.value = []
    loading.value = saving.value = conflict.value = false
    if (props.modelValue) void load()
  },
  { immediate: true },
)
watch(
  () => `${auth.currentUser?.id}:${auth.currentUser?.team_id}:${auth.currentUser?.active}`,
  () => {
    ++generation
    emit('update:modelValue', false)
  },
)
onBeforeUnmount(() => {
  ++generation
})
</script>

<template>
  <AppDialog
    :model-value="modelValue"
    :title="
      processing
        ? editable
          ? isRework
            ? '返工登记'
            : '加工登记'
          : '加工记录'
        : editable
          ? '加工件数变更'
          : '件数变更记录'
    "
    :width="processing ? 'min(1440px, calc(100vw - 32px))' : 'min(980px, 94vw)'"
    align-center
    append-to-body
    class="processing-registration-dialog"
    :close-on-click-modal="!saving"
    :close-on-press-escape="!saving"
    :show-close="!saving"
    @close="close"
  >
    <p v-if="isRework && snapshot" class="quantity-rework-note">
      返工第 {{ snapshot.rework_round || (snapshot.rework_count || 0) + 1 }} 次<template
        v-if="originalRecordId"
      >
        · 关联加工记录 #{{ originalRecordId }}</template
      >
      · 本次完成量单独计为返工工作量
    </p>
    <ElAlert v-if="error" :title="error" type="error" :closable="false" />
    <StatePanel v-if="loading" state="loading" title="正在读取件数记录" compact />
    <FormWorkspace v-if="snapshot" :documents="processing">
      <template v-if="processing" #documents>
        <SerialRouteAttachments
          :batch-no="snapshot.batch_no"
          :items="
            snapshot.shared_unallocated && snapshot.shared_serials?.length
              ? snapshot.shared_serials.map((member) => ({
                  serialNo: member.serial_no,
                  routeId: member.process_route_id || snapshot!.process_route?.id,
                  scheduleTaskId: member.schedule_task_id,
                }))
              : [{ serialNo: snapshot.serial_no || '', routeId: snapshot.process_route?.id }]
          "
        />
      </template>
      <div :class="{ 'processing-workspace': processing }">
        <section class="processing-work-order">
          <ElAlert
            v-if="isRework && snapshot.rework_route_id && !snapshot.rework_route_ready"
            title="待检验指定返修班组"
            type="warning"
            :closable="false"
          />
          <ElButton
            v-if="!processing && snapshot.rework_route_id && snapshot.rework_route_ready"
            class="quantity-rework-route"
            :loading="routeLoading"
            @click="viewRoute(snapshot.rework_route_id)"
            >查看返工工艺</ElButton
          >
          <ElAlert
            v-if="editable && hasStock && isRework && !snapshot.rework_route_id"
            title="请联系检验班组确认返修去向"
            type="warning"
            :closable="false"
          />
          <ElForm
            v-if="editable && hasStock && (!isRework || snapshot.rework_route_ready)"
            ref="formRef"
            class="processing-registration-form"
            label-position="top"
            :show-message="true"
            :disabled="saving || loading"
            @submit.prevent="save"
          >
            <p v-if="!processing" class="quantity-note">
              只修改本批未转出的件数，重量、原签收单和已转出件数不变。保存后立即生效，取消出库不会撤销本次修改。
            </p>
            <CompactFormSection
              :title="processing ? '加工登记' : '件数调整'"
              class="processing-entry-section"
            >
              <ElFormItem
                label="加工人"
                required
                :class="{
                  'is-error':
                    submitted && (!processorName.trim() || processorName.trim().length > 80),
                }"
              >
                <TeamEmployeeInput
                  v-if="structured"
                  v-model:people="employees"
                  multiple
                  :team-id="teamId"
                  label="加工人"
                  :invalid="submitted && !employees.length"
                />
                <ProcessingPersonInput
                  v-else
                  v-model="processorName"
                  :options="snapshot.processor_options"
                  :invalid="
                    submitted && (!processorName.trim() || processorName.trim().length > 80)
                  "
                />
              </ElFormItem>
              <ElFormItem
                v-if="structured"
                label="每人加工时长"
                required
                :show-message="true"
                :error="submitted && !processingMinutesValid ? '请填写大于零的加工时长' : undefined"
              >
                <ProcessingDurationInput
                  v-model="processingMinutes"
                  label="每人加工"
                  :invalid="submitted && !processingMinutesValid"
                  :disabled="saving"
                />
              </ElFormItem>
              <ProcessingParameterFields
                v-if="structured"
                v-model="parameters"
                :team-id="teamId"
                :fields="snapshot.parameter_fields"
                :total-minutes="processingMinutes"
                :submitted="submitted"
                :disabled="saving"
              />
              <ElFormItem
                v-if="!(processing && detailed)"
                :label="unitProcessing ? '本次完成件数' : '加工后本批未转出总件数'"
                class="form-field--medium"
                required
                :class="{
                  'is-error':
                    submitted &&
                    (!Number.isSafeInteger(detailed ? outputTotal : quantity) ||
                      (detailed ? outputTotal : quantity!) < 0 ||
                      (unitProcessing && (!quantity || quantity > snapshot.quantity)) ||
                      (detailed ? outputTotal : quantity!) > 2147483647),
                }"
                ><ElInputNumber
                  v-model="quantity"
                  :aria-label="unitProcessing ? '本次完成件数' : '加工后未转出件数'"
                  :min="0"
                  :max="2147483647"
                  :precision="0"
                  controls-position="right"
                  ><template #suffix
                    ><span class="dialog-input-unit">件</span></template
                  ></ElInputNumber
                ></ElFormItem
              >
              <ElFormItem
                v-if="structured && !unitProcessing"
                label="本次投入件数"
                class="form-field--medium"
                required
                :class="{
                  'is-error': submitted && (!inputQuantity || inputQuantity > snapshot.quantity),
                }"
              >
                <ElInputNumber
                  v-model="inputQuantity"
                  :min="1"
                  :max="snapshot.quantity"
                  :precision="0"
                  aria-label="本次投入件数"
                  controls-position="right"
                />
              </ElFormItem>
              <ElFormItem
                v-if="unitProcessing"
                label="本次完成重量"
                required
                :class="{
                  'is-error': submitted && (completedWeight == null || completedWeight < 0),
                }"
              >
                <WeightInput v-model="completedWeight" ariaLabel="本次完成重量" />
                <small class="dialog-field-hint"
                  >部分{{ isRework ? '返工' : '加工' }}请核对本次重量，剩余部分保留为{{
                    isRework ? '待返工' : '未加工'
                  }}库存。</small
                >
              </ElFormItem>
              <ElFormItem
                v-if="processing && !structured"
                label="本批加工进度"
                required
                :class="{ 'is-error': submitted && progressInvalid }"
                ><ElSelect v-model="progress" aria-label="本批加工进度"
                  ><ElOption
                    v-for="(label, value) in processingProgressLabels"
                    :key="value"
                    :value="value"
                    :label="label" /></ElSelect
                ><small
                  v-if="detailed && activeOutputs.some((line) => line.role === 'remaining')"
                  class="dialog-field-hint"
                  >仍有未加工余料，请选择部分加工。</small
                ></ElFormItem
              >
              <ElFormItem
                v-if="processing && !detailed && !unitProcessing"
                label="加工后尺寸（选填）"
                class="form-field--full"
                :class="{ 'is-error': submitted && !specificationValid }"
                ><SpecificationInput
                  v-model="specification"
                  label="加工后尺寸"
                  @validity-change="specificationValid = $event"
              /></ElFormItem>
              <ElFormItem
                v-if="inspectionEnabled"
                label="日产表"
                required
                :class="{ 'is-error': submitted && !reportTemplate }"
              >
                <ElSelect v-model="reportTemplate" placeholder="选择日产表" aria-label="日产表">
                  <ElOption value="FACTORY-QC" label="检验产量表" /><ElOption
                    value="QC-SANDBLAST"
                    label="喷砂产量表"
                  /><ElOption value="QC-DEBURR" label="去毛刺产量表" />
                </ElSelect>
              </ElFormItem>
              <ProcessingInspectionFields
                v-if="inspectionEnabled"
                :key="`${teamId}:${sourceId}`"
                class="form-field--full"
                :team-id="teamId"
                :quantity="quantity"
                :submitted="submitted"
                :disabled="saving || loading"
                @change="inspection = $event"
              />
              <ProcessingSelfCheckFields
                v-if="selfCheckEnabled"
                :key="`${teamId}:${sourceId}`"
                v-bind="selfCheckTotals"
                :output-failed-quantity="outputFailedQuantity"
                :submitted="submitted"
                :disabled="saving || loading"
                @change="selfCheck = $event"
              />
              <ElFormItem
                :label="structured ? '备注' : '备注（选填）'"
                :required="structured"
                class="form-field--full"
                :error="
                  submitted && structured && !reason.trim()
                    ? '请填写备注，无特殊情况请填无'
                    : undefined
                "
                :show-message="true"
                :class="{ 'is-error': submitted && reason.trim().length > 2000 }"
                ><ElInput
                  v-model="reason"
                  type="textarea"
                  aria-label="备注"
                  :rows="2"
                  maxlength="2000"
                  show-word-limit
                  :placeholder="structured ? '无特殊情况请填无' : '选填'"
              /></ElFormItem>
              <ProcessingTaskFields
                v-if="processing && snapshot.task_required != null"
                v-model:task-id="taskId"
                v-model:purpose-id="purposeId"
                v-model:rework-record-id="originalRecordId"
                :team-id="teamId"
                :context="snapshot"
                :hide-route-instructions="processing"
                :rework="isRework"
                :rework-record-fixed="!!reworkRecordId || snapshot.rework_pending === true"
                :submitted="submitted"
                :disabled="saving || loading"
                @validity="taskFieldsValid = $event"
              />
              <ElFormItem
                class="form-field--full"
                v-if="processing && snapshot.processing_schedules?.length"
                label="排期批次"
                :required="!snapshot.production_schedule_locked"
                :class="{ 'is-error': submitted && scheduleMissing }"
              >
                <span
                  v-if="snapshot.production_schedule_locked && selectedSchedule"
                  class="processing-auto-value"
                >
                  {{ selectedSchedule.serial_no }} · {{ formatScheduleBatch(selectedSchedule) }} ·
                  {{ formatDateTime(selectedSchedule.due_at) }} ·
                  {{ selectedSchedule.target_quantity ?? '—' }} 件
                </span>
                <ElSelect
                  v-else
                  v-model="scheduleId"
                  :disabled="snapshot.production_schedule_locked"
                  aria-label="交货排期"
                  placeholder="选择本次加工对应的排期批次"
                >
                  <ElOption
                    v-for="plan in snapshot.processing_schedules"
                    :key="plan.id"
                    :value="plan.id"
                    :label="`${plan.serial_no} · ${formatScheduleBatch(plan)} · ${formatDateTime(plan.due_at)} · ${plan.target_quantity ?? '—'} 件`"
                  />
                </ElSelect>
                <div v-if="selectedSchedule" class="processing-plan-summary">
                  <span
                    >计划 <b>{{ selectedSchedule.target_quantity ?? '—' }}</b> 件</span
                  >
                  <span
                    >已转出 <b>{{ selectedSchedule.dispatched_quantity }}</b> 件</span
                  >
                  <span
                    >待交 <b>{{ selectedSchedule.remaining_quantity ?? '—' }}</b> 件</span
                  >
                </div>
              </ElFormItem>

              <ElFormItem
                v-if="structured"
                label="实际加工日期"
                required
                :class="{
                  'is-error': submitted && (!processingDate || processingDate > factoryToday()),
                }"
              >
                <div
                  v-if="!editingProcessingDate"
                  class="processing-auto-value"
                  aria-label="实际加工日期"
                >
                  <span>{{ processingDate }}</span>
                  <ElButton
                    link
                    :disabled="saving"
                    aria-label="修改实际加工日期"
                    @click="editingProcessingDate = true"
                    >修改</ElButton
                  >
                </div>
                <ElDatePicker
                  v-else
                  v-model="processingDate"
                  type="date"
                  value-format="YYYY-MM-DD"
                  aria-label="实际加工日期"
                  :clearable="false"
                  @change="editingProcessingDate = false"
                />
              </ElFormItem>
            </CompactFormSection>
            <div v-if="processing && !unitProcessing" class="processing-mode">
              <ElSwitch
                v-if="!structured"
                v-model="detailed"
                :disabled="snapshot.shared_unallocated"
                aria-label="按明细登记"
                active-text="按明细登记"
              /><span>{{
                detailed
                  ? '按加工后尺寸分别填写产出。有未加工余料时填写余料行。'
                  : '一批产出有多种尺寸时，可按明细登记。'
              }}</span>
            </div>
            <section
              v-if="processing && detailed && !unitProcessing"
              class="processing-outputs"
              :class="{ 'is-error': submitted && !activeOutputs.length }"
              aria-label="加工后完整实物明细"
            >
              <div class="processing-output-scroll">
                <AppDetailTable
                  columns-key="QuantityAdjustmentDialog-1"
                  :required-columns="[
                    '类别',
                    '物料类型',
                    '件数',
                    '不合格数',
                    '实测重量',
                    '归属流水号 *',
                  ]"
                  class="processing-output-table business-document-table"
                >
                  <thead>
                    <tr>
                      <th>类别</th>
                      <th>物料类型</th>
                      <th>件数</th>
                      <th>实测重量</th>
                      <th>加工后尺寸</th>
                      <th v-if="snapshot.shared_unallocated" class="shared-owner-column">
                        归属流水号 *
                      </th>
                      <th v-if="perOutputCheck">不合格数</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    <template v-for="(line, index) in outputs" :key="line.key"
                      ><tr>
                        <td>
                          <ElSelect
                            v-model="line.role"
                            :aria-label="`明细${index + 1}类别`"
                            @change="outputRoleChanged(line)"
                            ><ElOption
                              v-for="(label, value) in processingRoleLabels"
                              :key="value"
                              :value="value"
                              :label="label"
                          /></ElSelect>
                        </td>
                        <td>
                          <span v-if="line.role === 'remaining'">{{
                            materialTypeLabel(line.material_type)
                          }}</span>
                          <ElSelect
                            v-else
                            v-model="line.material_type"
                            :aria-label="`明细${index + 1}物料类型`"
                            @change="outputTypeChanged(line)"
                            ><ElOption
                              v-for="type in materialTypeOptions.filter(
                                (type) => isScrapType(type.value) === (line.role === 'scrap'),
                              )"
                              :key="type.value"
                              :value="type.value"
                              :label="type.label"
                          /></ElSelect>
                        </td>
                        <td>
                          <span
                            v-if="isWeightOnlyType(line.material_type)"
                            class="dialog-input-unit"
                            >仅计重量</span
                          >
                          <div
                            v-else
                            class="dialog-field"
                            :class="{ 'is-error': outputError(line, 'quantity') }"
                          >
                            <ElInputNumber
                              v-model="line.quantity"
                              :aria-label="`明细${index + 1}件数`"
                              :min="0"
                              :max="2147483647"
                              :precision="0"
                              controls-position="right"
                            />
                          </div>
                        </td>
                        <td>
                          <span v-if="line.material_type === 'sludge'"
                            >{{ line.weight ?? '—' }} kg（折算）</span
                          >
                          <div
                            v-else
                            class="dialog-field"
                            :class="{ 'is-error': outputError(line, 'weight') }"
                          >
                            <WeightInput
                              v-model="line.weight"
                              :ariaLabel="`明细${index + 1}重量`"
                            />
                          </div>
                        </td>
                        <td>
                          <span v-if="line.role !== 'produced'">{{
                            line.role === 'remaining' ? snapshot.transfer_specification || '—' : '—'
                          }}</span>
                          <div
                            v-else
                            class="dialog-field"
                            :class="{ 'is-error': outputError(line, 'specification') }"
                          >
                            <SpecificationInput
                              v-model="line.specification"
                              :label="`明细${index + 1}加工后尺寸`"
                              @validity-change="line.specificationValid = $event"
                            />
                          </div>
                        </td>
                        <td v-if="snapshot.shared_unallocated">
                          <div
                            v-if="
                              line.role === 'produced' &&
                              (!snapshot.process_route || snapshot.process_route.split_here)
                            "
                            class="dialog-field"
                            :class="{ 'is-error': outputError(line, 'serial') }"
                          >
                            <ElSelect
                              v-model="line.serialNo"
                              :aria-label="`明细${index + 1}归属流水号`"
                              placeholder="请选择"
                              filterable
                              ><ElOption
                                v-for="member in snapshot.shared_serials"
                                :key="member.serial_no"
                                :value="member.serial_no"
                                :label="
                                  member.task_batch_number
                                    ? `${member.serial_no} · 第${member.task_batch_number}批`
                                    : member.serial_no
                                "
                            /></ElSelect>
                          </div>
                          <span v-else>{{
                            line.role === 'scrap' ? '共投废料' : '共投未分配'
                          }}</span>
                        </td>
                        <td v-if="perOutputCheck">
                          <ElInputNumber
                            v-if="checkedOutputs.includes(line)"
                            v-model="line.failedQuantity"
                            :aria-label="`明细${index + 1}不合格数`"
                            :min="0"
                            :max="line.quantity"
                            :precision="0"
                            placeholder="全部合格填 0"
                          />
                          <span v-else>{{
                            line.material_type === 'defective' ? line.quantity : '—'
                          }}</span>
                        </td>
                        <td>
                          <ElButton
                            text
                            :aria-label="`移除明细${index + 1}`"
                            @click="outputs.splice(index, 1)"
                            >移除</ElButton
                          >
                        </td>
                      </tr>
                      <tr v-if="line.material_type === 'sludge'">
                        <td
                          :colspan="
                            6 +
                            Number(snapshot.shared_unallocated || false) +
                            Number(perOutputCheck)
                          "
                        >
                          <SludgeWeightFields
                            v-model:gross="line.gross"
                            v-model:percent="line.percent"
                            :label="`明细${index + 1}`"
                            :gross-error="outputError(line, 'weight') ? '请填写实重和比例' : ''"
                            :percent-error="outputError(line, 'weight') ? '请填写实重和比例' : ''"
                            @update:weight="line.weight = $event"
                          />
                        </td></tr
                    ></template>
                  </tbody>
                </AppDetailTable>
              </div>
              <footer>
                <ElButton class="action-cool" :disabled="outputs.length >= 100" @click="addOutput()"
                  >增加明细</ElButton
                ><span
                  >共 {{ activeOutputs.length }} 行 · {{ outputTotal }} 件 ·
                  {{ outputWeight }} kg；空白或全零行不提交</span
                >
              </footer>
            </section>
            <p
              v-if="
                processing &&
                ((detailed && measuredOutputs) || (unitProcessing && completedWeight != null)) &&
                (weightDifference || cumulativeWeightDifference)
              "
              class="quantity-note processing-weight-notice"
              role="status"
            >
              本次实测比账面{{ weightDifference >= 0 ? '多' : '少' }}
              {{ Math.abs(weightDifference) }} kg；同一来源在本班组累计{{
                cumulativeWeightDifference >= 0 ? '多' : '少'
              }}
              {{ Math.abs(cumulativeWeightDifference) }} kg，{{
                Math.abs(cumulativeWeightDifference) <= materialWeightToleranceKg
                  ? `在每批 ${materialWeightToleranceKg} kg 提醒范围内`
                  : `超过每批 ${materialWeightToleranceKg} kg，请核对实测值，仍可提交`
              }}。拆分和继续加工沿用同一批提醒额度，不按件数换算重量或自动记作损耗。
            </p>
          </ElForm>
          <p v-else-if="editable && !hasStock" class="quantity-note">
            {{
              snapshot.processing_status === 'complete'
                ? '本批已完成加工，下面可查看加工记录。'
                : '本批没有未转出的库存，不能登记加工。'
            }}
          </p>
          <h3 v-if="processing" class="processing-section-title">工单信息</h3>
          <ElDescriptions :column="2" border class="quantity-summary">
            <ElDescriptionsItem v-if="processing" label="流水号">{{
              sharedSerialLabel(snapshot)
            }}</ElDescriptionsItem>
            <ElDescriptionsItem v-if="processing" label="物料类型">{{
              materialTypeLabel(snapshot.material_type || null)
            }}</ElDescriptionsItem>
            <ElDescriptionsItem label="来源批次" :span="2">{{
              snapshot.batch_no
            }}</ElDescriptionsItem>
            <ElDescriptionsItem label="未转出件数">{{ snapshot.quantity }} 件</ElDescriptionsItem>
            <ElDescriptionsItem label="未转出重量">{{ snapshot.weight }} kg</ElDescriptionsItem>
            <ElDescriptionsItem v-if="processing" label="尺寸" :span="2">{{
              snapshot.transfer_specification || '—'
            }}</ElDescriptionsItem>
          </ElDescriptions>
          <SharedMaterialInfo :item="snapshot" />
          <section v-if="processing && snapshot.process_route" class="processing-current-step">
            <header>
              <strong
                >{{ snapshot.process_route.sequence_no }} ·
                {{ snapshot.process_route.step_name }}</strong
              ><span>当前工序</span>
            </header>
            <p>{{ snapshot.process_route.instructions || '未填写工艺要求' }}</p>
          </section>
        </section>
        <ProcessExecutionPanel
          v-if="processing"
          :context="snapshot.process_route"
          :serial="snapshot.serial_no"
          :shared="snapshot.shared_unallocated"
          :documents-visible="false"
        />
      </div>
    </FormWorkspace>
    <section v-if="snapshot && (historyRecords.length || !editable)" class="quantity-history">
      <h3 class="quantity-history-title">本批操作记录</h3>
      <ElTable
        columns-key="QuantityAdjustmentDialog-2"
        :data="historyRecords"
        row-key="id"
        :default-expand-all="processing && !editable"
        class="business-table"
        empty-text="暂无件数变更"
        aria-label="件数变更记录"
      >
        <ElTableColumn v-if="processing" type="expand" width="44">
          <template #default="{ row }">
            <div class="processing-history-requirements">
              <header>
                <strong>{{ row.process_step_name || '历史工序未登记' }}</strong>
                <span>具体任务 · {{ row.processing_task_name || '历史未登记' }}</span>
                <span v-if="row.rework_of_id">原加工记录 #{{ row.rework_of_id }}</span>
              </header>
              <dl class="history-facts">
                <div>
                  <dt>加工性质</dt>
                  <dd>
                    {{ row.work_kind === 'rework' ? `返工第 ${row.rework_round} 次` : '首次加工' }}
                  </dd>
                </div>
                <div v-for="field in parameterFields" :key="field.key">
                  <dt>{{ field.label }}</dt>
                  <dd>{{ formatProcessingParameter(field.key, row) }}</dd>
                </div>
                <div>
                  <dt>加工后尺寸</dt>
                  <dd>{{ row.after_specification || '—' }}</dd>
                </div>
                <div>
                  <dt>登记后重量</dt>
                  <dd>{{ row.after_weight ?? row.weight }} kg</dd>
                </div>
                <div v-if="row.reason">
                  <dt>备注</dt>
                  <dd>{{ row.reason }}</dd>
                </div>
              </dl>
              <h4>本道工艺要求</h4>
              <p>{{ row.process_step_instructions || '历史未登记本道工艺要求' }}</p>
              <template v-if="row.outputs?.length">
                <h4>实物明细</h4>
                <div class="history-outputs">
                  <div
                    v-for="output in row.outputs || []"
                    :key="output.id"
                    class="processing-history-output"
                  >
                    <strong
                      >{{ output.batch_no
                      }}{{
                        output.serial_no
                          ? ' · ' + (output.shared_unallocated ? '共投未分配' : output.serial_no)
                          : ''
                      }}
                      · {{ processingRoleLabels[output.role as ProcessingRole] }}</strong
                    ><span
                      >{{ materialTypeLabel(output.material_type) }} · {{ output.quantity }} 件 /
                      {{ output.weight }} kg ·
                      {{ output.transfer_specification || '未填尺寸' }}</span
                    ><span v-if="output.on_hand_weight != null"
                      >当前未转出 {{ output.on_hand_quantity }} 件 /
                      {{ output.on_hand_weight }} kg；待签收
                      {{ output.in_transit_quantity ?? 0 }} 件 /
                      {{ output.in_transit_weight ?? 0 }} kg</span
                    ><span v-if="output.material_type === 'sludge'"
                      >实重 {{ output.sludge_gross_weight }} kg · 有效材料
                      {{ output.sludge_content_percent }}%</span
                    >
                  </div>
                </div>
              </template>
            </div>
          </template>
        </ElTableColumn>
        <ElTableColumn label="操作" min-width="135" align="center"
          ><template #default="{ row }">{{
            row.id === snapshot.origin_processing_record?.id
              ? '创建本批的加工登记'
              : row.operation_kind === 'outbound_clearance'
                ? '出库余件清零'
                : row.processing_status
                  ? processingProgressLabels[row.processing_status as 'partial' | 'complete']
                  : '件数变更'
          }}</template></ElTableColumn
        >
        <ElTableColumn label="时间" min-width="170" align="center">
          <template #default="{ row }">{{ formatDateTime(row.created_at) }}</template>
        </ElTableColumn>
        <ElTableColumn label="加工人" min-width="110" align="center">
          <template #default="{ row }"
            ><ProcessingPeople
              :people="row.operation_kind === 'outbound_clearance' ? [] : row.processors"
              :fallback="
                row.operation_kind === 'outbound_clearance' ? '—' : row.processor_name || '未登记'
              "
          /></template>
        </ElTableColumn>
        <ElTableColumn label="对应业务" min-width="120" align="center">
          <template #default="{ row }">{{ row.purpose_name || '未登记' }}</template>
        </ElTableColumn>
        <ElTableColumn v-if="processing" label="工艺工序" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">
            <ElButton
              v-if="row.work_kind === 'rework' && row.process_route_id"
              link
              type="primary"
              :disabled="routeLoading"
              @click="viewRoute(row.process_route_id)"
              >{{ row.process_step_name || '返工工艺' }}</ElButton
            ><span v-else>{{ row.process_step_name || '历史未登记' }}</span>
          </template>
        </ElTableColumn>
        <ElTableColumn label="具体任务" min-width="120" align="center">
          <template #default="{ row }">{{ row.processing_task_name || '未登记' }}</template>
        </ElTableColumn>
        <ElTableColumn
          label="变更前 → 变更后"
          min-width="220"
          align="center"
          :show-overflow-tooltip="false"
        >
          <template #default="{ row }">
            <span class="history-quantity"
              >{{ formatAmount(row.before_quantity) }} →
              {{ formatAmount(row.after_quantity) }} 件</span
            >
          </template>
        </ElTableColumn>
        <ElTableColumn prop="labor_minutes" label="加工工时" min-width="140">
          <template #default="{ row }">{{ formatProcessingMinutes(row.labor_minutes) }}</template>
        </ElTableColumn>
        <ElTableColumn
          v-for="field in processing ? [] : parameterFields"
          :key="field.key"
          :prop="field.key"
          :label="field.label"
          min-width="140"
          show-overflow-tooltip
        >
          <template #default="{ row }">{{ formatProcessingParameter(field.key, row) }}</template>
        </ElTableColumn>
        <ElTableColumn
          v-if="!processing"
          prop="reason"
          label="备注"
          min-width="220"
          align="center"
        />
      </ElTable>
      <WorkspacePagination
        v-if="total > 10"
        :current-page="page"
        :page-size="10"
        :total="total"
        :disabled="loading || saving"
        layout="prev, pager, next"
        @current-change="
          ($event) => {
            page = $event
            load()
          }
        "
      />
    </section>
    <template #footer>
      <ElButton :disabled="saving" @click="close">关闭</ElButton>
      <ElButton
        v-if="conflict || (!snapshot && error)"
        :disabled="loading || saving"
        @click="load(true)"
        >刷新并核对</ElButton
      >
      <ElButton
        v-if="editable && snapshot?.process_route?.can_resume"
        type="primary"
        :loading="saving"
        @click="resumeRework"
        >返回正常工序</ElButton
      >
      <ElButton
        v-else-if="editable && (!isRework || snapshot?.rework_route_ready)"
        type="primary"
        :loading="saving"
        :disabled="loading || conflict || !hasStock"
        @click="save"
        >{{ processing ? (isRework ? '保存返工登记' : '保存加工登记') : '保存件数' }}</ElButton
      >
    </template>
  </AppDialog>
  <ProcessRouteEditor v-if="viewedRoute" :route="viewedRoute" view-only @close="closeRoute" />
</template>

<style scoped>
.processing-workspace {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 260px;
  gap: 16px;
  align-items: start;
}
.processing-work-order {
  min-width: 0;
}
.processing-registration-form {
  container: form-fields / inline-size;
}
.processing-entry-section :deep(> .compact-form-grid > .el-form-item:not(.form-field--full)) {
  grid-column: span 6;
}
@container form-fields (max-width: 420px) {
  .processing-entry-section :deep(> .compact-form-grid > .el-form-item) {
    grid-column: 1 / -1;
  }
}
.processing-auto-value {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  padding-block: 6px;
  color: var(--text);
}
.processing-workspace .process-execution-panel {
  position: sticky;
  top: 0;
  max-height: 70vh;
  overflow: auto;
}
.processing-section-title {
  margin: 0 0 12px;
  font-size: var(--font-size-section);
  font-weight: var(--font-weight-semibold);
}
.processing-current-step {
  margin: 12px 0;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-left: 3px solid #36725b;
  border-radius: 8px;
  background: var(--wm-muted-surface, #ffffffb8);
  font-size: var(--font-size-label);
}
.processing-current-step header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
.processing-current-step header span {
  color: var(--muted);
  font-size: var(--font-size-meta);
}
.processing-current-step p {
  margin: 8px 0 0;
  line-height: 1.65;
  white-space: pre-wrap;
}
.processing-plan-summary {
  width: 100%;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-top: 8px;
  font-size: var(--font-size-meta);
  color: var(--muted);
}
.processing-plan-summary b {
  color: var(--text);
  font-weight: var(--font-weight-medium);
}
.processing-workspace .quantity-summary {
  margin: 0;
}
@media (max-width: 1200px) {
  .processing-workspace {
    grid-template-columns: minmax(0, 1fr);
  }
  .processing-workspace .process-execution-panel {
    position: static;
    max-height: none;
  }
}

.quantity-rework-route {
  margin: 12px 0;
}
.processing-history-requirements {
  box-sizing: border-box;
  max-width: 100cqi;
  padding: 14px 20px;
  text-align: start;
  overflow-wrap: anywhere;
}
.quantity-history {
  container-type: inline-size;
}
@container (max-width: 600px) {
  .quantity-history :deep(.el-table .el-table-fixed-column--left) {
    position: static !important;
  }
  .quantity-history :deep(.el-table .el-table-fixed-column--left::before) {
    display: none;
  }
  .processing-history-requirements {
    position: sticky;
    left: 0;
  }
}
.history-quantity {
  white-space: normal;
}
.history-facts,
.history-outputs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 24px;
}
.history-facts {
  margin: 12px 0;
}
.history-facts > div {
  display: flex;
  gap: 6px;
}
.history-facts dt {
  color: var(--muted);
}
.history-facts dd {
  margin: 0;
}
.processing-history-requirements header {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px 20px;
}
.processing-history-requirements header span {
  font-size: var(--font-size-meta);
  color: var(--muted);
}
.processing-history-requirements h4 {
  margin: 12px 0 6px;
  font-size: var(--font-size-label);
  font-weight: var(--font-weight-medium);
  color: var(--muted);
}
.processing-history-requirements p {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.7;
  color: var(--text);
}

.quantity-summary {
  margin-block: 16px;
}
.quantity-note {
  color: var(--muted);
  line-height: 1.7;
  font-size: var(--font-size-body);
}
.quantity-history-title {
  margin: 16px 0 10px;
  font-size: var(--font-size-section);
  font-weight: var(--font-weight-semibold);
}
.el-pagination {
  justify-content: flex-end;
  margin-top: 12px;
}
.processing-mode,
.processing-outputs > footer {
  display: flex;
  align-items: center;
  gap: 12px;
  justify-content: space-between;
  margin-bottom: 12px;
}
.processing-mode > span,
.processing-outputs > footer > span {
  color: var(--muted);
  font-size: var(--font-size-meta);
}
.processing-mode .el-switch {
  flex-shrink: 0;
}
.processing-outputs {
  border: 1px solid var(--line);
  border-radius: 10px;
  margin-bottom: 14px;
  overflow: hidden;
}
.processing-outputs.is-error {
  border-color: var(--el-color-danger);
}
.processing-output-scroll {
  overflow-x: auto;
}
.processing-output-table {
  width: 100%;
  min-width: 1208px;
  table-layout: fixed;
  border-collapse: collapse;
  font-size: var(--font-size-body);
}
.processing-output-table th {
  padding: 8px;
  text-align: center;
  font-weight: var(--font-weight-medium);
  background: var(--surface-soft);
  color: var(--muted);
}
.processing-output-table td {
  padding: 8px;
  vertical-align: middle;
  text-align: center;
  border-top: 1px solid var(--line);
}
.processing-output-table th[data-column-index='1'] {
  width: 128px;
}
.processing-output-table th[data-column-index='2'] {
  width: 112px;
}
.processing-output-table th[data-column-index='3'] {
  width: 116px;
}
.processing-output-table th[data-column-index='4'] {
  width: 208px;
}
.processing-output-table .shared-owner-column {
  width: 150px;
}
.processing-output-table:has(.shared-owner-column) {
  min-width: 1358px;
}
.processing-output-table th:last-child {
  width: 60px;
}
.processing-output-table .dialog-field {
  margin: 0;
}
.processing-output-table :deep(.specification-input) {
  display: grid;
  grid-template-columns: 150px minmax(0, 1fr);
  gap: 4px;
  align-items: center;
}
.processing-output-table :deep(.specification-input > .el-select) {
  width: 100%;
}
.processing-output-table :deep(.specification-dimensions) {
  flex: 1 1 auto;
  flex-wrap: nowrap;
  gap: 4px;
}
.processing-output-table :deep(.specification-dimensions label) {
  flex: 0 0 128px;
  min-width: 128px;
  max-width: 128px;
}
.processing-output-table :deep(.specification-dimensions label:last-child) {
  flex-basis: 148px;
  min-width: 148px;
  max-width: 148px;
}
.processing-output-table :deep(.specification-error) {
  grid-column: 1 / -1;
  text-align: left;
}
.processing-output-table :deep(.el-input__inner) {
  text-align: center;
}
.processing-output-table :deep(.el-select__selected-item) {
  text-align: center;
}
.processing-workspace .processing-output-table {
  min-width: 1080px;
}
.processing-workspace .processing-output-table:has(.shared-owner-column) {
  min-width: 1230px;
}
.processing-workspace .processing-output-table th[data-column-index='1'] {
  width: 156px;
}
.processing-workspace .processing-output-table th[data-column-index='2'] {
  width: 132px;
}
.processing-workspace .processing-output-table th[data-column-index='3'] {
  width: 180px;
}
.processing-workspace .processing-output-table th[data-column-index='4'] {
  width: 260px;
}
.processing-workspace .processing-output-table :deep(.specification-input) {
  grid-template-columns: minmax(0, 1fr);
}
.processing-workspace .processing-output-table :deep(.specification-dimensions) {
  flex-wrap: wrap;
}
.processing-workspace .processing-output-table :deep(.specification-dimensions label) {
  flex: 1 1 100px;
  min-width: 100px;
  max-width: none;
}

.processing-outputs > footer {
  margin: 0;
  padding: 6px 10px;
  border-top: 1px solid var(--line);
  flex-wrap: wrap;
}
.processing-weight-notice {
  color: var(--action-warm);
  font-size: var(--font-size-meta);
}
.processing-history-output {
  display: grid;
  gap: 3px;
  padding-block: 5px;
  font-size: var(--font-size-meta);
}
.processing-history-output strong {
  font-weight: var(--font-weight-medium);
}
@media (max-width: 760px) {
  .processing-mode {
    align-items: flex-start;
    flex-direction: column;
    gap: 4px;
  }
}
</style>

<style>
.processing-registration-dialog {
  display: flex;
  flex-direction: column;
  max-height: calc(100dvh - 32px);
}
.processing-registration-dialog .el-dialog__body {
  min-height: 0;
  overflow: auto;
}
.processing-registration-dialog .el-input-number {
  width: 100%;
}
@media (max-width: 600px) {
  .processing-registration-dialog .el-descriptions__label {
    width: 80px;
  }
  .processing-registration-dialog .el-descriptions__content {
    overflow-wrap: anywhere;
  }
}
</style>
