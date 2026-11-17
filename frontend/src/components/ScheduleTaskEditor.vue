<script setup lang="ts">
import AsyncStatus from './AsyncStatus.vue'
import ElAlert from '@/components/AppAlert.vue'
import ElDatePicker from '@/components/AppDatePicker.vue'
import ElInput from '@/components/AppInput.vue'
import PersonName from './PersonName.vue'
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import type { Dayjs } from 'dayjs'
import { ElForm, ElFormItem, ElTableColumn } from 'element-plus'
import ElInputNumber from '@/components/AppNumberInput.vue'
import ElTable from '@/components/watermelon/WatermelonDataTable.vue'
import ElButton from '@/components/AppButton.vue'
import AppDialog from './AppDialog.vue'
import { Refresh, Upload } from '@element-plus/icons-vue'
import MaterialInput from './MaterialInput.vue'
import ScheduleSelectionDialog from './ScheduleSelectionDialog.vue'
import ScheduleDocuments from './ScheduleDocuments.vue'
import CompactFormSection from './CompactFormSection.vue'
import ImportedDataConfirmation from './ImportedDataConfirmation.vue'
import AutofillBadge from './AutofillBadge.vue'
import ScheduleRouteSelect from './ScheduleRouteSelect.vue'
import { useAuthStore } from '@/stores/auth'
import { useTeamDirectoryStore } from '@/stores/teamDirectory'
import { productionScheduleApi } from '@/services/productionScheduleApi'
import type {
  ScheduleTask,
  ScheduleRouteOption,
  ScheduleSelection,
  DispatchTaskWrite,
  ScheduleBatchWrite,
  TaskTeamPlanWrite,
} from '@/types/productionSchedule'
import type { ProcessRoute, RouteOrderDocument } from '@/types/processRoute'
import { createMaterialSubmissionKey } from '@/utils/materialStock'
import { formatAmount, formatDateTime } from '@/utils/format'
import { referenceOrderQuantity } from '@/utils/schedulePlanning'
import { focusFirstInvalidField } from '@/composables/useDialogValidation'

const props = defineProps<{
  task?: ScheduleTask | null
  processRoute?: ProcessRoute
  routeSerial?: string
}>()
const emit = defineEmits<{ close: []; saved: [task: ScheduleTask] }>()
const auth = useAuthStore(),
  directory = useTeamDirectoryStore()
const visible = ref(true),
  saving = ref(false),
  loading = ref(false),
  error = ref(''),
  submitted = ref(false),
  personOpen = ref(false)
const form = ref<{ $el: HTMLElement }>()
const serial = ref(props.task?.serial_no || props.routeSerial || '')
const orderInput = ref<HTMLInputElement>(),
  orderFile = ref<File>(),
  orderDocument = ref<RouteOrderDocument>(),
  orderBusy = ref(false),
  orderError = ref('')
let orderGeneration = 0
async function importOrder(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const current = ++orderGeneration
  orderFile.value = undefined
  orderDocument.value = undefined
  orderError.value = ''
  submission.reset()
  if (!file.name.toLowerCase().endsWith('.xlsx') || file.size > 5 * 1024 * 1024) {
    orderError.value = '请选择不超过 5 MB 的 XLSX 订单表'
    return
  }
  orderBusy.value = true
  try {
    const result = await productionScheduleApi.parseOrder(file)
    if (current !== orderGeneration) return
    if (result.serial_no !== serial.value.trim()) {
      orderError.value = `订单表流水号为 ${result.serial_no}，与填写的 ${serial.value.trim() || '未填写'} 不一致，请核对。`
      return
    }
    orderFile.value = file
    orderDocument.value = result
  } catch (e) {
    if (current === orderGeneration)
      orderError.value = e instanceof Error ? e.message : '订单表读取失败'
  } finally {
    if (current === orderGeneration) orderBusy.value = false
  }
}
const local = (value?: string | null) =>
  value ? formatDateTime(value).replace(' ', 'T') + ':00' : ''
const finalDue = ref(local(props.task?.final_due_at)),
  notes = ref(props.task?.notes || '')
const people = ref<ScheduleSelection[]>(
  (
    props.task?.business_people ||
    (props.task?.business_person_id
      ? [{ id: props.task.business_person_id, name: props.task.business_person_name || '' }]
      : [])
  ).map((p) => ({ value: p.id, label: p.name })),
)
const routes = ref<ScheduleRouteOption[]>([]),
  routeId = ref<number>(),
  routeManuallySelected = ref(false)
const selectedRoute = computed(() => routes.value.find((r) => r.id === routeId.value))
const steps = computed(
  () =>
    selectedRoute.value?.steps.filter(
      (s) =>
        !s.serial_nos.length ||
        s.serial_nos.includes(selectedRoute.value?.execution_serial ?? serial.value.trim()),
    ) || [],
)
type TeamBatchDraft = Omit<ScheduleBatchWrite, 'due_at'> & { due: string }
type TeamPlanDraft = Omit<TaskTeamPlanWrite, 'batches'> & {
  name: string
  instructions: string
  basis: string
  confirmed: boolean
  original: string
  batches: TeamBatchDraft[]
}
function teamPlanPayload(plan: TeamPlanDraft): TaskTeamPlanWrite {
  return {
    schedule_id: plan.schedule_id,
    process_step_index: plan.process_step_index,
    expected_version: plan.expected_version,
    batches: plan.batches.map(({ due, ...batch }) => ({ ...batch, due_at: `${due}+08:00` })),
  }
}
const teamPlans = ref<TeamPlanDraft[]>(
  (props.task?.nodes || [])
    .filter((node) => node.status !== 'cancelled')
    .map((node) => {
      const plan: TeamPlanDraft = {
        schedule_id: node.id,
        process_step_index: node.process_step_index,
        expected_version: node.version,
        name: `${node.team_name}${node.process_step_names?.length ? `：${node.process_step_names.join(' → ')}` : node.notes ? ` · ${node.notes}` : ''}`,
        instructions: '',
        basis: node.completion_basis || 'quantity',
        confirmed: node.planning_state === 'confirmed',
        original: '',
        batches: (node.pending_batches?.length
          ? node.pending_batches
          : node.batches?.length
            ? node.batches
            : [
                {
                  batch_number: 1,
                  due_at: node.planning_state === 'pending' ? '' : node.due_at,
                  target_quantity: node.target_quantity,
                  target_weight: node.target_weight,
                  upstream_batch_ids: [],
                },
              ]
        ).map((batch) => ({
          id: batch.id || undefined,
          batch_number: batch.batch_number,
          due: local(batch.due_at),
          target_quantity: batch.target_quantity,
          target_weight: batch.target_weight == null ? null : Number(batch.target_weight),
          upstream_batch_ids: [...batch.upstream_batch_ids],
        })),
      }
      plan.original = JSON.stringify(teamPlanPayload(plan))
      return plan
    }),
)
const teamPlanRows = computed(() =>
  teamPlans.value.flatMap((plan, index) =>
    plan.batches.map((batch, batchIndex) => ({ plan, batch, index, batchIndex })),
  ),
)
const hasWeightPlans = computed(() => teamPlans.value.some((plan) => plan.basis !== 'quantity'))
function resetTeamPlans() {
  const selected = selectedRoute.value
  const grouped: {
    step: (typeof steps.value)[number]
    index: number
    names: string[]
    requirements: string[]
  }[] = []
  selected?.steps.forEach((step, index) => {
    if (
      step.serial_nos.length &&
      !step.serial_nos.includes(selected.execution_serial ?? serial.value.trim())
    )
      return
    const previous = grouped.at(-1)
    if (previous?.step.team_id === step.team_id) {
      previous.step = step
      previous.index = index
      previous.names.push(step.name)
      previous.requirements.push(step.instructions)
    } else grouped.push({ step, index, names: [step.name], requirements: [step.instructions] })
  })
  teamPlans.value = grouped.map(({ step, index, names, requirements }) => ({
    process_step_index: index,
    name: `${directory.items.find((team) => Number(team.id) === step.team_id)?.name || step.team_name || '班组'}：${names.join(' → ')}`,
    instructions: names.map((name, i) => `${name}：${requirements[i]}`).join('\n'),
    basis: 'quantity',
    confirmed: false,
    original: '',
    batches: [
      {
        batch_number: 1,
        due: '',
        target_quantity: Number(step.planned_quantity) || null,
        target_weight: null,
        upstream_batch_ids: [],
      },
    ],
  }))
}
function teamBatchError(
  plan: TeamPlanDraft,
  batch: TeamBatchDraft,
  field: 'due' | 'quantity' | 'weight',
) {
  if (!submitted.value) return ''
  if (field === 'due') return batch.due ? '' : '请选择转交时间'
  const amount = field === 'quantity' ? batch.target_quantity : batch.target_weight
  if (field === 'quantity' && plan.basis === 'weight') return ''
  if (field === 'weight' && plan.basis === 'quantity') return ''
  return amount &&
    amount > 0 &&
    (field !== 'quantity' || (Number.isSafeInteger(amount) && amount <= 2147483647))
    ? ''
    : '请填写有效计划数量'
}
function addTeamBatch(plan: TeamPlanDraft) {
  plan.batches.push({
    batch_number: Math.max(...plan.batches.map((b) => b.batch_number)) + 1,
    due: '',
    target_quantity: null,
    target_weight: null,
    upstream_batch_ids: [],
  })
}
const quantity = ref<number | undefined>(
  props.task?.delivery_batches?.reduce((sum, b) => sum + b.target_quantity, 0) ||
    props.task?.nodes.filter((n) => n.status !== 'cancelled').at(-1)?.target_quantity ||
    undefined,
)
const importedQuantity = computed(() => Number(steps.value.at(-1)?.planned_quantity) || undefined)
const orderQuantity = computed(() =>
  referenceOrderQuantity(props.task ? props.task.order_document : orderDocument.value),
)
const quantityConfirmed = ref(false)
const requiresQuantityConfirmation = computed(() => !props.task && !!importedQuantity.value)
const quantityConfirmationError = computed(() =>
  submitted.value && requiresQuantityConfirmation.value && !quantityConfirmed.value
    ? '请核对工艺和本批交货量'
    : '',
)
watch(
  [() => selectedRoute.value?.id, () => selectedRoute.value?.version, quantity, orderFile],
  () => {
    quantityConfirmed.value = false
  },
  { flush: 'sync' },
)
const batches = ref<{ quantity: number | undefined; due: string }[]>(
  (props.task?.delivery_batches || []).map((b) => ({
    quantity: b.target_quantity,
    due: local(b.due_at),
  })),
)
if (!batches.value.length)
  batches.value.push({ quantity: quantity.value, due: props.task ? finalDue.value : '' })
const writable = computed(
  () =>
    (auth.isAdmin || auth.isDispatch) &&
    auth.currentUser?.active !== false &&
    !auth.currentUserError,
)
const allocated = computed(() =>
  batches.value.reduce((sum, batch) => sum + (Number(batch.quantity) || 0), 0),
)
const remaining = computed(() => (quantity.value || 0) - allocated.value)
const plannedQuantityError = computed(() =>
  quantity.value === undefined ||
  !Number.isSafeInteger(quantity.value) ||
  quantity.value <= 0 ||
  quantity.value > 2147483647
    ? '请输入 1 至 2147483647 的整数'
    : '',
)
const allocationError = computed(() =>
  !plannedQuantityError.value && remaining.value !== 0
    ? `各批数量合计须为 ${quantity.value} 件`
    : '',
)
const finalDueError = computed(() => (submitted.value && !finalDue.value ? '请选择最终交期' : ''))
const serialError = computed(() => (submitted.value && !serial.value.trim() ? '请选择流水号' : ''))
const routeError = computed(() =>
  submitted.value && !props.task && !selectedRoute.value ? '请选择关联工艺' : '',
)
const peopleError = computed(() =>
  submitted.value && !people.value.length ? '请至少选择一位业务人员' : '',
)
const orderRequiredError = computed(() =>
  submitted.value &&
  !props.task &&
  selectedRoute.value &&
  (!orderFile.value || orderDocument.value?.serial_no !== serial.value.trim())
    ? '请上传对应流水号的订单表'
    : '',
)
function quantityError(index: number) {
  if (!props.task && !selectedRoute.value) return ''
  const value = batches.value[index]!.quantity
  return value === undefined || !Number.isSafeInteger(value) || value <= 0
    ? '请输入大于 0 的整数'
    : ''
}
function batchDueError(index: number) {
  const due = batches.value[index]!.due
  if (!due) return submitted.value ? `请选择第 ${index + 1} 批交期` : ''
  if (finalDue.value && due > finalDue.value) return `第 ${index + 1} 批交期不能晚于最终交期`
  if (index > 0 && batches.value[index - 1]!.due && due < batches.value[index - 1]!.due)
    return `第 ${index + 1} 批交期不能早于上一批`
  return ''
}
let generation = 0
const submission = createMaterialSubmissionKey()
async function loadRoutes() {
  if (props.task) return
  const current = ++generation
  const previousRouteId = routeId.value
  error.value = ''
  if (!serial.value.trim()) {
    loading.value = false
    return
  }
  loading.value = true
  try {
    const result = await productionScheduleApi.taskRouteOptions(serial.value.trim())
    if (current !== generation) return
    routes.value = result
    const matches = result.filter((route) => route.serial_nos?.includes(serial.value.trim()))
    const preferredId = routeManuallySelected.value
      ? previousRouteId
      : matches.find((r) => r.id === props.processRoute?.id)?.id
    routeId.value =
      result.find((r) => r.id === preferredId)?.id ||
      (matches.length === 1 ? matches[0]!.id : undefined)
    if (!result.length) error.value = '暂无可用工艺，请先由工艺班组制定'
  } catch (e) {
    if (current === generation) error.value = e instanceof Error ? e.message : '工艺读取失败'
  } finally {
    if (current === generation) loading.value = false
  }
}
watch(
  () =>
    selectedRoute.value &&
    `${selectedRoute.value.id}:${selectedRoute.value.version}:${selectedRoute.value.execution_serial}`,
  () => {
    if (props.task) return
    quantity.value = Number(steps.value.at(-1)?.planned_quantity) || undefined
    batches.value = [{ quantity: quantity.value, due: '' }]
    resetTeamPlans()
  },
)
function selectPeople(value: ScheduleSelection[]) {
  people.value = value
  personOpen.value = false
}
function addBatch() {
  batches.value.push({ quantity: 0, due: '' })
}
function removeBatch(index: number) {
  batches.value.splice(index, 1)
}
function disabledBatchDate(value: Date, index: number) {
  const day = new Date(value).setHours(0, 0, 0, 0)
  const previous = batches.value[index - 1]?.due
  return (
    (!!finalDue.value && day > new Date(finalDue.value).setHours(0, 0, 0, 0)) ||
    (!!previous && day < new Date(previous).setHours(0, 0, 0, 0))
  )
}
function disabledBatchHours(index: number, comparingDate?: Dayjs) {
  const current = comparingDate?.toDate() || new Date(batches.value[index]!.due)
  if (Number.isNaN(current.getTime())) return []
  const previous = batches.value[index - 1]?.due
  return Array.from({ length: 24 }, (_, hour) => hour).filter((hour) => {
    const value = new Date(current).setHours(hour, 0, 0, 0)
    return (
      (!!finalDue.value && value > new Date(finalDue.value).getTime()) ||
      (!!previous && value < new Date(previous).getTime())
    )
  })
}
async function save() {
  if (saving.value || !writable.value || loading.value || orderBusy.value) return
  error.value = ''
  submitted.value = true
  if (
    serialError.value ||
    routeError.value ||
    finalDueError.value ||
    plannedQuantityError.value ||
    batches.value.some((_, index) => quantityError(index) || batchDueError(index)) ||
    allocationError.value ||
    peopleError.value ||
    orderRequiredError.value ||
    quantityConfirmationError.value ||
    teamPlans.value.some((plan) =>
      plan.batches.some(
        (batch) =>
          teamBatchError(plan, batch, 'due') ||
          teamBatchError(plan, batch, 'quantity') ||
          teamBatchError(plan, batch, 'weight'),
      ),
    )
  ) {
    await nextTick()
    focusFirstInvalidField(form.value?.$el)
    return
  }
  saving.value = true
  try {
    const common = {
      planned_quantity: quantity.value!,
      final_due_at: `${finalDue.value}+08:00`,
      delivery_batches: batches.value.map((b, i) => ({
        batch_number: i + 1,
        target_quantity: b.quantity!,
        due_at: `${b.due}+08:00`,
      })),
      business_person_ids: people.value.map((p) => Number(p.value)),
      notes: notes.value.trim() || null,
      team_plans: teamPlans.value
        .filter(
          (plan) =>
            !props.task ||
            !plan.confirmed ||
            JSON.stringify(teamPlanPayload(plan)) !== plan.original,
        )
        .map(teamPlanPayload),
    }
    if (props.task)
      emit(
        'saved',
        await productionScheduleApi.updateTask(props.task.id, {
          ...common,
          title: props.task.title,
          expected_version: props.task.version,
        }),
      )
    else {
      const body: Omit<DispatchTaskWrite, 'idempotency_key'> = {
        ...common,
        serial_no: serial.value.trim(),
        route_id: selectedRoute.value!.id,
        route_version: selectedRoute.value!.version,
      }
      const key = submission.get(body)
      emit(
        'saved',
        await productionScheduleApi.createTask({ ...body, idempotency_key: key }, orderFile.value!),
      )
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : '排期保存失败'
  } finally {
    saving.value = false
  }
}
let serialTimer: ReturnType<typeof setTimeout> | undefined
watch(
  () => serial.value.trim(),
  () => {
    ++orderGeneration
    orderFile.value = undefined
    orderDocument.value = undefined
    orderBusy.value = false
    orderError.value = ''
    ++generation
    clearTimeout(serialTimer)
    if (props.task) return
    routeId.value = undefined
    routes.value = []
    teamPlans.value = []
    routeManuallySelected.value = false
    quantity.value = undefined
    batches.value = [{ quantity: undefined, due: '' }]
    error.value = ''
    loading.value = !!serial.value.trim()
    if (loading.value) serialTimer = setTimeout(loadRoutes, 350)
  },
)
onBeforeUnmount(() => {
  ++orderGeneration
  ++generation
  clearTimeout(serialTimer)
})
const nonZeroMinutes = () => Array.from({ length: 59 }, (_, i) => i + 1)
onMounted(loadRoutes)
</script>
<template>
  <AppDialog
    v-model="visible"
    :title="task ? '修改排期' : '新建排期'"
    width="min(1280px,96vw)"
    append-to-body
    :close-on-click-modal="!saving"
    :close-on-press-escape="!saving"
    :show-close="!saving"
    @closed="emit('close')"
  >
    <ElAlert v-if="error" :title="error" type="error" :closable="false" />
    <ElForm
      ref="form"
      label-position="top"
      :disabled="saving || !writable"
      class="dispatch-task-form"
      @submit.prevent="save"
    >
      <ScheduleDocuments
        :serial-no="serial.trim()"
        :route-ids="task ? task.nodes.map((node) => node.process_route_id) : [routeId]"
        :task-id="task?.id"
        :order-document="task ? task.order_document || undefined : orderDocument || null"
        :order-file="orderFile"
      >
        <template v-if="!task" #upload>
          <ElFormItem class="dispatch-order-field" :error="orderRequiredError">
            <ElButton
              :icon="Upload"
              :loading="orderBusy"
              :disabled="!selectedRoute || saving"
              @click="orderInput?.click()"
              >{{ orderFile ? '替换订单表' : '上传订单表' }}</ElButton
            >
            <input
              ref="orderInput"
              type="file"
              accept=".xlsx"
              hidden
              aria-label="上传订单表"
              @change="importOrder"
            />
          </ElFormItem>
          <AsyncStatus v-if="orderBusy" label="正在导入订单表…" />
          <ElAlert v-if="orderError" :title="orderError" type="error" :closable="false" />
        </template>
        <div class="dispatch-task-content">
          <CompactFormSection title="排期信息">
            <ElFormItem label="流水号" required :error="serialError"
              ><MaterialInput
                v-model="serial"
                field="serial_no"
                label="任务流水号"
                :disabled="!!task"
            /></ElFormItem>
            <ElFormItem label="最终交期" required :error="finalDueError"
              ><ElDatePicker
                v-model="finalDue"
                type="datetime"
                format="YYYY-MM-DD HH:mm"
                value-format="YYYY-MM-DDTHH:mm:ss"
                :disabled-minutes="nonZeroMinutes"
                :disabled-seconds="nonZeroMinutes"
                aria-label="最终交期"
              />
              <span class="dispatch-field-hint">各批交期的最晚时间 · 按整点选择</span>
            </ElFormItem>
            <ElFormItem label="业务人员" required :error="peopleError"
              ><ElButton class="dispatch-person-select" @click="personOpen = true"
                ><span v-if="people.length" class="schedule-people"
                  ><PersonName
                    v-for="person in people"
                    :key="person.value"
                    :name="person.label" /></span
                ><template v-else>选择业务人员</template></ElButton
              ></ElFormItem
            >

            <ElFormItem
              v-if="!task"
              class="dispatch-route-select form-field--long"
              label="关联工艺"
              required
              :error="routeError"
              ><div class="dispatch-route-choice">
                <ScheduleRouteSelect
                  v-model="routeId"
                  :options="routes"
                  :loading="loading"
                  :disabled="!serial.trim()"
                  @change="routeManuallySelected = true"
                />
                <ElButton
                  :icon="Refresh"
                  :loading="loading"
                  :disabled="!serial.trim()"
                  aria-label="刷新工艺"
                  title="刷新工艺"
                  @click="loadRoutes"
                />
              </div>
            </ElFormItem>
            <ElFormItem
              label="本批交货量"
              class="form-field--short"
              required
              :error="submitted ? plannedQuantityError : ''"
            >
              <template #label
                >本批交货量
                <AutofillBadge
                  v-if="requiresQuantityConfirmation"
                  kind="document"
                  source="工艺单"
                  :modified="quantity !== importedQuantity"
                />
              </template>
              <div class="dispatch-quantity-input">
                <ElInputNumber
                  v-model="quantity"
                  :min="1"
                  :max="2147483647"
                  :precision="0"
                  :controls="false"
                  :disabled="!task && !selectedRoute"
                  aria-label="本批交货量"
                />
                <span>件</span>
              </div>
            </ElFormItem>
            <ElFormItem label="订单总量（参考）">
              <span>{{ formatAmount(orderQuantity) }} 件</span>
            </ElFormItem>
          </CompactFormSection>
          <CompactFormSection title="分批交货">
            <template #actions>
              <div
                v-if="!plannedQuantityError"
                class="dispatch-allocation"
                role="status"
                aria-live="polite"
              >
                <span
                  >已分配 <strong>{{ allocated }}</strong> 件</span
                >
                <span
                  class="dispatch-allocation-balance"
                  :class="{
                    'is-complete': remaining === 0,
                    'is-exceeded': remaining < 0,
                  }"
                >
                  {{ remaining < 0 ? '超出' : remaining === 0 ? '剩余' : '待分配' }}
                  <strong>{{ Math.abs(remaining) }}</strong> 件
                </span>
              </div>
            </template>
            <ElTable
              columns-key="ScheduleTaskEditor-1"
              :required-columns="['数量（件）', '交货时间']"
              class="form-field--full"
              :data="batches"
              border
              aria-label="订单分批交期"
            >
              <ElTableColumn label="批次" width="90" align="center"
                ><template #default="{ $index }">第 {{ $index + 1 }} 批</template></ElTableColumn
              >
              <ElTableColumn label="数量（件）" width="140"
                ><template #default="{ row, $index }"
                  ><ElFormItem
                    class="dispatch-batch-field"
                    :error="
                      quantityError($index) || (submitted && $index === 0 ? allocationError : '')
                    "
                  >
                    <ElInputNumber
                      v-model="row.quantity"
                      :min="1"
                      :max="2147483647"
                      :precision="0"
                      :controls="false"
                      :disabled="!task && !selectedRoute"
                      :aria-label="`第${$index + 1}批交货数量`"
                    /> </ElFormItem></template
              ></ElTableColumn>
              <ElTableColumn label="交货时间" min-width="230"
                ><template #header>
                  <div class="dispatch-date-heading">
                    <span>交货时间</span>
                    <span class="dispatch-field-hint">按批次先后 · 不晚于最终交期</span>
                  </div>
                </template>
                <template #default="{ row, $index }"
                  ><ElFormItem
                    class="dispatch-batch-field dispatch-batch-field--date"
                    :error="batchDueError($index)"
                  >
                    <ElDatePicker
                      v-model="row.due"
                      type="datetime"
                      format="YYYY-MM-DD HH:mm"
                      value-format="YYYY-MM-DDTHH:mm:ss"
                      :disabled-date="(value: Date) => disabledBatchDate(value, $index)"
                      :disabled-hours="
                        (_role: string, value?: Dayjs) => disabledBatchHours($index, value)
                      "
                      :disabled-minutes="nonZeroMinutes"
                      :disabled-seconds="nonZeroMinutes"
                      :placeholder="
                        finalDue
                          ? `最晚 ${finalDue.replace('T', ' ').slice(5, 16)}`
                          : '选择交货时间'
                      "
                      :aria-label="`第${$index + 1}批交期`"
                    /> </ElFormItem></template
              ></ElTableColumn>
              <ElTableColumn label="操作" width="80" align="center"
                ><template #default="{ $index }"
                  ><ElButton
                    link
                    type="danger"
                    :disabled="batches.length === 1"
                    @click="removeBatch($index)"
                    >删除</ElButton
                  ></template
                ></ElTableColumn
              >
            </ElTable>
            <div class="form-field--full">
              <ElButton :disabled="batches.length >= 100" @click="addBatch">＋ 增加一批</ElButton>
            </div>
          </CompactFormSection>
          <CompactFormSection v-if="teamPlans.length" title="班组排期">
            <p class="form-field--full dispatch-field-hint">
              按工艺顺序设置各班组的转交时间和数量，保存后班组直接查看执行。
            </p>
            <ElTable
              columns-key="ScheduleTaskEditor-team-plans"
              class="form-field--full"
              :data="teamPlanRows"
              border
              size="small"
              aria-label="班组排期设置"
            >
              <ElTableColumn label="班组 / 工序" min-width="190">
                <template #default="{ row }"
                  ><span class="dispatch-team-operations" :title="row.plan.instructions"
                    >{{ row.index + 1 }} · {{ row.plan.name }}</span
                  ></template
                >
              </ElTableColumn>
              <ElTableColumn label="批次" width="100">
                <template #default="{ row }">第 {{ row.batch.batch_number }} 批</template>
              </ElTableColumn>
              <ElTableColumn label="转交时间" min-width="235">
                <template #default="{ row }">
                  <ElFormItem
                    class="dispatch-batch-field"
                    :error="teamBatchError(row.plan, row.batch, 'due')"
                  >
                    <ElDatePicker
                      v-model="row.batch.due"
                      type="datetime"
                      format="YYYY-MM-DD HH:mm"
                      value-format="YYYY-MM-DDTHH:mm:ss"
                      :disabled-minutes="nonZeroMinutes"
                      :disabled-seconds="nonZeroMinutes"
                      :aria-label="`班组${row.index + 1}第${row.batch.batch_number}批转交时间`"
                      placeholder="选择转交时间"
                    />
                    <span
                      v-if="row.batch.due && finalDue && row.batch.due > finalDue"
                      class="dispatch-plan-warning"
                      >晚于最终交期</span
                    >
                  </ElFormItem>
                </template>
              </ElTableColumn>
              <ElTableColumn label="计划件数" width="160">
                <template #default="{ row }">
                  <ElFormItem
                    v-if="row.plan.basis !== 'weight'"
                    class="dispatch-batch-field"
                    :error="teamBatchError(row.plan, row.batch, 'quantity')"
                  >
                    <ElInputNumber
                      v-model="row.batch.target_quantity"
                      :min="1"
                      :max="2147483647"
                      :precision="0"
                      :controls="false"
                      :aria-label="`班组${row.index + 1}第${row.batch.batch_number}批计划件数`"
                    /> </ElFormItem
                  ><span v-else>—</span>
                </template>
              </ElTableColumn>
              <ElTableColumn v-if="hasWeightPlans" label="计划重量（kg）" width="170">
                <template #default="{ row }">
                  <ElFormItem
                    v-if="row.plan.basis !== 'quantity'"
                    class="dispatch-batch-field"
                    :error="teamBatchError(row.plan, row.batch, 'weight')"
                  >
                    <ElInputNumber
                      v-model="row.batch.target_weight"
                      :min="0"
                      :precision="6"
                      :controls="false"
                      :aria-label="`班组${row.index + 1}第${row.batch.batch_number}批计划重量`"
                    /> </ElFormItem
                  ><span v-else>—</span>
                </template>
              </ElTableColumn>
              <ElTableColumn label="操作" width="150">
                <template #default="{ row }">
                  <ElButton
                    v-if="row.batchIndex === 0"
                    link
                    :disabled="row.plan.batches.length >= 100"
                    :aria-label="`班组${row.index + 1}增加一批`"
                    @click="addTeamBatch(row.plan)"
                    >增加一批</ElButton
                  >
                  <ElButton
                    v-if="row.plan.batches.length > 1"
                    link
                    type="danger"
                    :aria-label="`班组${row.index + 1}删除第${row.batch.batch_number}批`"
                    @click="row.plan.batches.splice(row.batchIndex, 1)"
                    >删除</ElButton
                  >
                </template>
              </ElTableColumn>
            </ElTable>
          </CompactFormSection>
          <CompactFormSection
            ><ElFormItem label="备注" class="form-field--full"
              ><ElInput v-model="notes" maxlength="2000" /></ElFormItem
          ></CompactFormSection>
          <ImportedDataConfirmation
            v-if="requiresQuantityConfirmation"
            v-model="quantityConfirmed"
            label="已核对工艺和本批交货量"
            :error="quantityConfirmationError"
            :disabled="saving || !writable"
          />
        </div>
      </ScheduleDocuments>
    </ElForm>
    <template #footer
      ><ElButton :disabled="saving" @click="visible = false">取消</ElButton
      ><ElButton
        type="primary"
        :loading="saving"
        :disabled="!writable || loading || orderBusy || (!task && !selectedRoute)"
        @click="save"
        >{{ task ? '保存排期' : '创建排期' }}</ElButton
      ></template
    >
  </AppDialog>
  <ScheduleSelectionDialog
    v-if="personOpen"
    kind="people"
    active-only
    :selected="people"
    @close="personOpen = false"
    @apply="selectPeople"
  />
</template>
<style scoped>
.schedule-people {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  max-width: 100%;
  overflow: hidden;
  vertical-align: middle;
}
.dispatch-route-choice {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}
.dispatch-route-choice > :deep(.el-select) {
  flex: 1;
  min-width: 0;
}
.dispatch-quantity-input {
  position: relative;
  width: 100%;
}
.dispatch-quantity-input :deep(.el-input-number) {
  max-width: none;
}
.dispatch-quantity-input :deep(.el-input__inner) {
  text-align: left;
  padding-right: 28px;
}
.dispatch-quantity-input > span {
  position: absolute;
  right: 14px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--muted);
  pointer-events: none;
}
.dispatch-plan-warning {
  color: var(--el-color-warning-dark-2);
  font-size: 12px;
}
.dispatch-team-operations {
  white-space: normal;
  overflow-wrap: anywhere;
}
.dispatch-date-heading,
.dispatch-allocation {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 16px;
}
.dispatch-allocation {
  color: var(--muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.dispatch-allocation strong {
  font-weight: 500;
}
.dispatch-allocation-balance {
  padding: 3px 8px;
  border-radius: 5px;
  background: var(--el-color-warning-light-9);
  color: var(--el-color-warning-dark-2);
}
.dispatch-allocation-balance.is-complete {
  background: var(--el-color-success-light-9);
  color: var(--el-color-success-dark-2);
}
.dispatch-allocation-balance.is-exceeded {
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
}
.dispatch-field-hint {
  color: var(--muted);
  font-size: 12px;
  font-weight: 400;
  line-height: 18px;
}
.dispatch-batch-field,
.dispatch-order-field {
  margin-bottom: 0;
}
.dispatch-batch-field :deep(.el-form-item__error),
.dispatch-order-field :deep(.el-form-item__error) {
  position: static;
  line-height: 18px;
}
.dispatch-task-form :deep(.el-date-editor),
.dispatch-task-form :deep(.el-input-number) {
  width: 100%;
}
.dispatch-person-select {
  width: 100%;
  justify-content: flex-start;
  overflow: hidden;
}
.dispatch-batch-field--date {
  max-width: 320px;
}
</style>
