<script setup lang="ts">
import PersonName from './PersonName.vue'
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import type { Dayjs } from 'dayjs'
import {
  ElAlert,
  ElButton,
  ElDatePicker,
  ElForm,
  ElFormItem,
  ElInput,
  ElInputNumber,
  ElTable,
  ElTableColumn,
} from 'element-plus'
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
} from '@/types/productionSchedule'
import type { ProcessRoute, RouteOrderDocument } from '@/types/processRoute'
import { materialRequestKey } from '@/utils/materialStock'
import { formatDateTime } from '@/utils/format'
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
  key = ''
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
const quantity = ref<number | undefined>(
  props.task?.delivery_batches?.reduce((sum, b) => sum + b.target_quantity, 0) ||
    props.task?.nodes.filter((n) => n.status !== 'cancelled').at(-1)?.target_quantity ||
    undefined,
)
const importedQuantity = computed(() => Number(steps.value.at(-1)?.planned_quantity) || undefined)
const quantityConfirmed = ref(false)
const requiresQuantityConfirmation = computed(() => !props.task && !!importedQuantity.value)
const quantityConfirmationError = computed(() =>
  submitted.value && requiresQuantityConfirmation.value && !quantityConfirmed.value
    ? '请核对工艺和计划数量'
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
const writable = computed(() => auth.isDispatch && !props.task?.locked_at)
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
let generation = 0,
  key = '',
  fingerprint = ''
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
    quantityConfirmationError.value
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
      const next = JSON.stringify(body)
      if (!key || fingerprint !== next) {
        key = materialRequestKey()
        fingerprint = next
      }
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
    :title="task ? '修改订单交期' : '新建排期'"
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
              label="计划数量"
              class="form-field--short"
              required
              :error="submitted ? plannedQuantityError : ''"
            >
              <template #label
                >计划数量
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
                  aria-label="计划数量"
                />
                <span>件</span>
              </div>
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
            <ElTable class="form-field--full" :data="batches" border aria-label="订单分批交期">
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
          <CompactFormSection v-if="!task && steps.length" title="执行工艺">
            <ElTable
              class="form-field--full"
              :data="steps"
              border
              size="small"
              aria-label="工艺执行班组"
            >
              <ElTableColumn label="工序" prop="name" min-width="130" />
              <ElTableColumn label="班组" min-width="100"
                ><template #default="{ row }">{{
                  directory.items.find((t) => Number(t.id) === row.team_id)?.name || row.team_name
                }}</template></ElTableColumn
              >
              <ElTableColumn label="计划数量" prop="planned_quantity" width="110" align="right" />
              <ElTableColumn
                label="工艺要求"
                prop="instructions"
                min-width="220"
                show-overflow-tooltip
              />
            </ElTable>
          </CompactFormSection>
          <CompactFormSection
            ><ElFormItem label="备注" class="form-field--full"
              ><ElInput v-model="notes" maxlength="2000" /></ElFormItem
          ></CompactFormSection>
          <ImportedDataConfirmation
            v-if="requiresQuantityConfirmation"
            v-model="quantityConfirmed"
            label="已核对工艺和计划数量"
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
        >{{ task ? '保存交期' : '创建排期' }}</ElButton
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
