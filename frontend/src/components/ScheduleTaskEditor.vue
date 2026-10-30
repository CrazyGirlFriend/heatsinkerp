<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import {
  ElAlert,
  ElButton,
  ElDatePicker,
  ElForm,
  ElFormItem,
  ElInput,
  ElInputNumber,
  ElSelect,
  ElOption,
  ElTable,
  ElTableColumn,
} from 'element-plus'
import AppDialog from './AppDialog.vue'
import MaterialInput from './MaterialInput.vue'
import ScheduleSelectionDialog from './ScheduleSelectionDialog.vue'
import ScheduleDocuments from './ScheduleDocuments.vue'
import { useAuthStore } from '@/stores/auth'
import { useTeamDirectoryStore } from '@/stores/teamDirectory'
import { productionScheduleApi } from '@/services/productionScheduleApi'
import type {
  ScheduleTask,
  ScheduleRouteOption,
  ScheduleSelection,
  DispatchTaskWrite,
} from '@/types/productionSchedule'
import type { ProcessRoute } from '@/types/processRoute'
import { materialRequestKey } from '@/utils/materialStock'
import { formatDateTime } from '@/utils/format'

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
  personOpen = ref(false)
const serial = ref(props.task?.serial_no || props.routeSerial || '')
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
  routeId = ref<number>()
const selectedRoute = computed(() => routes.value.find((r) => r.id === routeId.value))
const steps = computed(
  () =>
    selectedRoute.value?.steps.filter(
      (s) => !s.serial_nos.length || s.serial_nos.includes(serial.value.trim()),
    ) || [],
)
const quantity = computed(() =>
  props.task
    ? props.task.delivery_batches?.reduce((sum, b) => sum + b.target_quantity, 0) ||
      props.task.nodes.filter((n) => n.status !== 'cancelled').at(-1)?.target_quantity ||
      0
    : Number(steps.value.at(-1)?.planned_quantity) || 0,
)
const batches = ref(
  (props.task?.delivery_batches || []).map((b) => ({
    quantity: b.target_quantity,
    due: local(b.due_at),
  })),
)
if (!batches.value.length)
  batches.value.push({ quantity: quantity.value, due: props.task ? finalDue.value : '' })
const writable = computed(() => auth.isDispatch && !props.task?.locked_at)
let generation = 0,
  key = '',
  fingerprint = ''
async function loadRoutes() {
  if (props.task) return
  const current = ++generation
  routes.value = []
  routeId.value = undefined
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
    routeId.value =
      result.find((r) => r.id === props.processRoute?.id)?.id ||
      (result.length === 1 ? result[0]!.id : undefined)
    if (!result.length) error.value = '该流水号暂无工艺，请先由工艺班组制定'
  } catch (e) {
    if (current === generation) error.value = e instanceof Error ? e.message : '工艺读取失败'
  } finally {
    if (current === generation) loading.value = false
  }
}
watch(quantity, (value) => {
  if (!props.task) batches.value = [{ quantity: value, due: '' }]
})
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
function disabledBatchDate(value: Date) {
  return !!finalDue.value && value.getTime() > new Date(finalDue.value).getTime()
}
async function save() {
  if (saving.value || !writable.value || loading.value) return
  error.value = ''
  if (!serial.value.trim() || (!props.task && !selectedRoute.value)) {
    error.value = '请选择流水号和对应工艺'
    return
  }
  if (!finalDue.value) {
    error.value = '请选择最终交期'
    return
  }
  for (const [index, batch] of batches.value.entries()) {
    if (!batch.due) {
      error.value = `请选择第 ${index + 1} 批交期`
      return
    }
    if (!Number.isSafeInteger(batch.quantity) || batch.quantity <= 0) {
      error.value = `请填写第 ${index + 1} 批数量`
      return
    }
    if (batch.due > finalDue.value) {
      error.value = `第 ${index + 1} 批交期不能晚于最终交期`
      return
    }
    if (index > 0 && batch.due < batches.value[index - 1]!.due) {
      error.value = `第 ${index + 1} 批交期不能早于上一批`
      return
    }
  }
  if (batches.value.reduce((sum, b) => sum + b.quantity, 0) !== quantity.value) {
    error.value = `各批数量合计须为 ${quantity.value} 件`
    return
  }
  if (!people.value.length) {
    error.value = '请至少选择一位业务人员'
    return
  }
  saving.value = true
  try {
    const common = {
      final_due_at: `${finalDue.value}+08:00`,
      delivery_batches: batches.value.map((b, i) => ({
        batch_number: i + 1,
        target_quantity: b.quantity,
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
      emit('saved', await productionScheduleApi.createTask({ ...body, idempotency_key: key }))
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : '排期保存失败'
  } finally {
    saving.value = false
  }
}
let serialTimer: ReturnType<typeof setTimeout> | undefined
watch(serial, () => {
  ++generation
  routes.value = []
  routeId.value = undefined
  clearTimeout(serialTimer)
  serialTimer = setTimeout(loadRoutes, 350)
})
onBeforeUnmount(() => {
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
    width="min(1040px,96vw)"
    append-to-body
    :close-on-click-modal="!saving"
    :close-on-press-escape="!saving"
    :show-close="!saving"
    @closed="emit('close')"
  >
    <ElAlert v-if="error" :title="error" type="error" :closable="false" />
    <ElForm
      label-position="top"
      :disabled="saving || !writable"
      class="dispatch-task-form"
      @submit.prevent="save"
    >
      <div class="dispatch-task-fields">
        <ElFormItem label="流水号" required
          ><MaterialInput
            v-model="serial"
            field="serial_no"
            label="任务流水号"
            :disabled="!!task"
          /><ElButton v-if="!task" link :loading="loading" @click="loadRoutes"
            >读取工艺</ElButton
          ></ElFormItem
        >
        <ElFormItem label="最终交期" required
          ><ElDatePicker
            v-model="finalDue"
            type="datetime"
            format="YYYY-MM-DD HH:mm"
            value-format="YYYY-MM-DDTHH:mm:ss"
            :disabled-minutes="nonZeroMinutes"
            :disabled-seconds="nonZeroMinutes"
            aria-label="最终交期"
        /></ElFormItem>
        <ElFormItem label="业务人员"
          ><ElButton class="dispatch-person-select" @click="personOpen = true">{{
            people.length ? people.map((p) => p.label).join('、') : '选择业务人员'
          }}</ElButton></ElFormItem
        >
      </div>
      <ElFormItem v-if="!task && routes.length > 1" label="工艺" required
        ><ElSelect v-model="routeId" aria-label="关联工艺"
          ><ElOption v-for="r in routes" :key="r.id" :value="r.id" :label="r.title" /></ElSelect
      ></ElFormItem>
      <ScheduleDocuments
        :serial-no="serial.trim()"
        :route-ids="task ? task.nodes.map((node) => node.process_route_id) : [routeId]"
      />
      <h3>
        分批交货 <span>{{ quantity }} 件</span>
      </h3>
      <ElTable :data="batches" border aria-label="订单分批交期">
        <ElTableColumn label="批次" width="90" align="center"
          ><template #default="{ $index }">第 {{ $index + 1 }} 批</template></ElTableColumn
        >
        <ElTableColumn label="数量（件）" width="170"
          ><template #default="{ row, $index }"
            ><ElInputNumber
              v-model="row.quantity"
              :min="1"
              :precision="0"
              :controls="false"
              :aria-label="`第${$index + 1}批交货数量`" /></template
        ></ElTableColumn>
        <ElTableColumn label="交货时间" min-width="230"
          ><template #default="{ row, $index }"
            ><ElDatePicker
              v-model="row.due"
              type="datetime"
              format="YYYY-MM-DD HH:mm"
              value-format="YYYY-MM-DDTHH:mm:ss"
              :disabled-date="disabledBatchDate"
              :disabled-minutes="nonZeroMinutes"
              :disabled-seconds="nonZeroMinutes"
              :aria-label="`第${$index + 1}批交期`" /></template
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
      <ElButton :disabled="batches.length >= 100" class="dispatch-add-batch" @click="addBatch"
        >＋ 增加一批</ElButton
      >
      <template v-if="!task && steps.length">
        <h3>执行工艺</h3>
        <ElTable :data="steps" border size="small" aria-label="工艺执行班组">
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
      </template>
      <ElFormItem label="备注" class="dispatch-notes"
        ><ElInput v-model="notes" maxlength="2000"
      /></ElFormItem>
    </ElForm>
    <template #footer
      ><ElButton :disabled="saving" @click="visible = false">取消</ElButton
      ><ElButton type="primary" :loading="saving" :disabled="!writable || loading" @click="save">{{
        task ? '保存交期' : '创建排期'
      }}</ElButton></template
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
.dispatch-task-form {
  padding-top: 12px;
}
.dispatch-task-fields {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 16px;
}
.dispatch-task-form h3 {
  display: flex;
  align-items: center;
  gap: 16px;
  margin: 12px 0;
  font-size: 14px;
}
.dispatch-task-form h3 span {
  color: var(--muted);
  font-weight: 400;
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
.dispatch-add-batch {
  margin-top: 10px;
}
.dispatch-notes {
  margin-top: 16px;
}
@media (max-width: 760px) {
  .dispatch-task-fields {
    grid-template-columns: 1fr;
    gap: 0;
  }
}
</style>
