<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  ElAlert,
  ElButton,
  ElDatePicker,
  ElInputNumber,
  ElOption,
  ElSelect,
  ElTable,
  ElTableColumn,
} from 'element-plus'
import AppDialog from './AppDialog.vue'
import type {
  ProductionSchedule,
  ScheduleBatchWrite,
  ScheduleTask,
} from '@/types/productionSchedule'
import { productionScheduleApi } from '@/services/productionScheduleApi'
import { useAuthStore } from '@/stores/auth'
import { formatAmount, formatDateTime } from '@/utils/format'

const auth = useAuthStore()
const props = defineProps<{ schedule: ProductionSchedule }>()
const emit = defineEmits<{ close: []; saved: [ProductionSchedule] }>()
const visible = ref(true),
  saving = ref(false),
  loading = ref(true),
  error = ref('')
const task = ref<ScheduleTask>()
const upstream = computed(() =>
  task.value?.nodes.find((n) => n.id === props.schedule.predecessor_id),
)
const basis = computed(() => props.schedule.completion_basis || 'quantity')
type Draft = Omit<ScheduleBatchWrite, 'planned_start_at' | 'due_at'> & {
  key: number
  start: string
  end: string
}
let key = 0
const local = (value?: string) => (value ? formatDateTime(value).replace(' ', 'T') + ':00' : '')
const utc = (value: string) => (value ? `${value}+08:00` : '')
const rows = ref<Draft[]>(
  (props.schedule.pending_batches || props.schedule.batches || []).map((b) => ({
    ...b,
    key: ++key,
    start: local(b.planned_start_at),
    end: local(b.due_at),
    upstream_batch_ids: [...b.upstream_batch_ids],
  })),
)
function add() {
  rows.value.push({
    key: ++key,
    batch_number: Math.max(0, ...rows.value.map((b) => b.batch_number)) + 1,
    start: '',
    end: local(props.schedule.due_at),
    target_quantity: rows.value.length ? null : props.schedule.target_quantity,
    target_weight: rows.value.length ? null : props.schedule.target_weight,
    upstream_batch_ids: [],
  })
}
if (!rows.value.length) add()
const total = computed(() => ({
  quantity: rows.value.reduce((n, b) => n + (b.target_quantity || 0), 0),
  weight: rows.value.reduce((n, b) => n + (b.target_weight || 0), 0),
}))
const unassigned = computed(() =>
  props.schedule.deliveries?.some((d) => !d.schedule_batch_id && d.status !== 'voided'),
)
function warnings(row: Draft) {
  const items: string[] = []
  if (
    task.value?.final_due_at &&
    row.end &&
    Date.parse(utc(row.end)) > Date.parse(task.value.final_due_at)
  )
    items.push('晚于最终交期')
  for (const id of row.upstream_batch_ids) {
    const batch = upstream.value?.batches?.find((b) => b.id === id)
    if (batch && row.start && Date.parse(batch.due_at) > Date.parse(utc(row.start)))
      items.push(`早于上游第 ${batch.batch_number} 批转出`)
  }
  return items
}
async function load() {
  loading.value = true
  error.value = ''
  try {
    if (props.schedule.task_id)
      task.value = await productionScheduleApi.task(props.schedule.task_id)
  } catch (e) {
    error.value = e instanceof Error ? e.message : '供料计划读取失败'
  } finally {
    loading.value = false
  }
}
async function save() {
  if (saving.value || loading.value || !task.value || task.value.locked_at) return
  error.value = ''
  if (!rows.value.length) {
    error.value = '请至少安排一批'
    return
  }
  if (new Set(rows.value.map((b) => b.batch_number)).size !== rows.value.length) {
    error.value = '批次序号不能重复'
    return
  }
  for (const row of rows.value) {
    if (!row.start || !row.end || Date.parse(utc(row.start)) >= Date.parse(utc(row.end))) {
      error.value = `第 ${row.batch_number} 批：请填写开始、转出时间，开始须早于转出`
      return
    }
    if (
      (basis.value !== 'weight' && !(row.target_quantity! > 0)) ||
      (basis.value !== 'quantity' && !(row.target_weight! > 0))
    ) {
      error.value = `第 ${row.batch_number} 批：请填写数量`
      return
    }
  }
  saving.value = true
  try {
    const result = await productionScheduleApi.saveBatches(props.schedule.id, {
      expected_version: props.schedule.version,
      batches: rows.value.map((row) => ({
        ...(row.id ? { id: row.id } : {}),
        batch_number: row.batch_number,
        planned_start_at: utc(row.start),
        due_at: utc(row.end),
        target_quantity: row.target_quantity || null,
        target_weight: row.target_weight || null,
        upstream_batch_ids: row.upstream_batch_ids,
      })),
    })
    emit('saved', result)
  } catch (e) {
    error.value = e instanceof Error ? e.message : '排期保存失败'
  } finally {
    saving.value = false
  }
}
onMounted(load)
const nonZeroMinutes = () => Array.from({ length: 59 }, (_, i) => i + 1)
const defaultTime = new Date(2000, 0, 1, 8)
</script>

<template>
  <AppDialog
    v-model="visible"
    title="班组分批排期"
    width="min(1480px, 96vw)"
    append-to-body
    :close-on-click-modal="!saving"
    :close-on-press-escape="!saving"
    :show-close="!saving"
    @closed="emit('close')"
  >
    <ElAlert v-if="error" :title="error" type="error" :closable="false" />
    <div class="batch-plan-summary">
      <strong>{{ schedule.serial_no }}</strong
      ><span>{{ schedule.team_name }}</span
      ><span
        >最终交期 <b>{{ formatDateTime(task?.final_due_at) }}</b></span
      >
    </div>
    <ElAlert
      v-if="task?.locked_at"
      title="订单已锁定，请联系调度解锁"
      type="warning"
      :closable="false"
    />
    <ElTable
      v-if="task?.delivery_batches?.length"
      :data="task.delivery_batches"
      border
      size="small"
      aria-label="调度交货要求"
      ><ElTableColumn label="订单批次" prop="batch_number" width="100" /><ElTableColumn
        label="数量（件）"
        prop="target_quantity"
        width="120"
      /><ElTableColumn label="要求交期"
        ><template #default="{ row }">{{ formatDateTime(row.due_at) }}</template></ElTableColumn
      ></ElTable
    >
    <div class="batch-plan-layout">
      <section class="batch-plan-main">
        <ElTable :data="rows" border class="business-table" aria-label="班组分批计划" row-key="key">
          <ElTableColumn label="批次" width="102" align="center"
            ><template #default="{ row }"
              ><ElInputNumber
                v-model="row.batch_number"
                :min="1"
                :max="9999"
                :controls="false"
                :disabled="saving || !!task?.locked_at"
                aria-label="批次序号" /></template
          ></ElTableColumn>
          <ElTableColumn v-if="basis !== 'weight'" label="数量（件）" width="120" align="center"
            ><template #default="{ row }"
              ><ElInputNumber
                v-model="row.target_quantity"
                :min="1"
                :precision="0"
                :controls="false"
                :disabled="saving || !!task?.locked_at"
                :aria-label="`第${row.batch_number}批数量`" /></template
          ></ElTableColumn>
          <ElTableColumn v-if="basis !== 'quantity'" label="重量（kg）" width="130" align="center"
            ><template #default="{ row }"
              ><ElInputNumber
                v-model="row.target_weight"
                :min="0.000001"
                :precision="6"
                :controls="false"
                :disabled="saving || !!task?.locked_at"
                :aria-label="`第${row.batch_number}批重量`" /></template
          ></ElTableColumn>
          <ElTableColumn label="计划开始" min-width="195"
            ><template #default="{ row }"
              ><ElDatePicker
                v-model="row.start"
                type="datetime"
                format="YYYY-MM-DD HH:mm"
                value-format="YYYY-MM-DDTHH:mm:ss"
                :default-time="defaultTime"
                :disabled-minutes="nonZeroMinutes"
                :disabled-seconds="nonZeroMinutes"
                :disabled="saving || !!task?.locked_at"
                placeholder="选择开始时间"
                :aria-label="`第${row.batch_number}批计划开始`" /></template
          ></ElTableColumn>
          <ElTableColumn label="计划转出" min-width="195"
            ><template #default="{ row }"
              ><ElDatePicker
                v-model="row.end"
                type="datetime"
                format="YYYY-MM-DD HH:mm"
                value-format="YYYY-MM-DDTHH:mm:ss"
                :default-time="defaultTime"
                :disabled-minutes="nonZeroMinutes"
                :disabled-seconds="nonZeroMinutes"
                :disabled="saving || !!task?.locked_at"
                placeholder="选择转出时间"
                :aria-label="`第${row.batch_number}批计划转出`" /></template
          ></ElTableColumn>
          <ElTableColumn v-if="upstream?.batches?.length" label="上游供料批次" min-width="165"
            ><template #default="{ row }"
              ><ElSelect
                v-model="row.upstream_batch_ids"
                multiple
                collapse-tags
                :disabled="saving || !!task?.locked_at"
                placeholder="选择供料批次"
                :aria-label="`第${row.batch_number}批上游供料`"
                ><ElOption
                  v-for="batch in upstream.batches"
                  :key="batch.id"
                  :value="batch.id"
                  :label="`第 ${batch.batch_number} 批`" /></ElSelect></template
          ></ElTableColumn>
          <ElTableColumn label="操作" width="70" align="center"
            ><template #default="{ row }"
              ><ElButton
                link
                type="danger"
                :disabled="saving || rows.length === 1"
                @click="rows = rows.filter((b) => b.key !== row.key)"
                >删除</ElButton
              ></template
            ></ElTableColumn
          >
        </ElTable>
        <div class="batch-plan-actions">
          <ElButton :disabled="saving || !!task?.locked_at" @click="add">＋ 增加一批</ElButton
          ><span
            >合计
            <b>{{
              basis !== 'weight'
                ? `${formatAmount(total.quantity)} 件`
                : `${formatAmount(total.weight)} kg`
            }}</b></span
          >
        </div>
        <div
          v-for="row in rows.filter((r) => warnings(r).length)"
          :key="row.key"
          class="batch-plan-warning"
          role="status"
        >
          第 {{ row.batch_number }} 批：{{ warnings(row).join('；') }}
        </div>
        <ElAlert
          v-if="unassigned"
          title="已有转出记录尚未分配交货批次，保留在班组总进度中。"
          type="warning"
          :closable="false"
        />
      </section>
      <aside class="batch-plan-reference">
        <h3>
          上游供料 <span>{{ upstream?.team_name || '库房备料' }}</span>
        </h3>
        <p v-if="loading">加载中…</p>
        <ElButton v-else-if="!task" @click="load">重新读取</ElButton>
        <ElTable
          v-else-if="upstream?.batches?.length"
          :data="upstream.batches"
          border
          size="small"
          aria-label="上游供料计划"
          ><ElTableColumn label="批次" width="65"
            ><template #default="{ row }">{{ row.batch_number }}</template></ElTableColumn
          ><ElTableColumn label="计划数量" width="90"
            ><template #default="{ row }">{{
              row.target_quantity != null
                ? `${formatAmount(row.target_quantity)} 件`
                : `${formatAmount(row.target_weight)} kg`
            }}</template></ElTableColumn
          ><ElTableColumn label="计划转出" min-width="140"
            ><template #default="{ row }">{{ formatDateTime(row.due_at) }}</template></ElTableColumn
          ></ElTable
        >
        <p v-else>
          {{ upstream ? '上游尚未安排批次' : '暂无上游供料计划' }}
        </p>
        <dl>
          <dt>本班组在库</dt>
          <dd>{{ formatAmount(schedule.stock?.on_hand_quantity || 0) }} 件</dd>
          <dt>待签收</dt>
          <dd>{{ formatAmount(schedule.stock?.pending_quantity || 0) }} 件</dd>
        </dl>
      </aside>
    </div>
    <template #footer
      ><ElButton :disabled="saving || !!task?.locked_at" @click="visible = false">取消</ElButton
      ><ElButton
        type="primary"
        :loading="saving"
        :disabled="loading || !task || !!task.locked_at"
        @click="save"
        >{{ auth.isDispatch ? '确认并保存' : '提交调度确认' }}</ElButton
      ></template
    >
  </AppDialog>
</template>

<style scoped>
.batch-plan-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  padding: 8px 0 18px;
  font-size: 14px;
}
.batch-plan-summary strong {
  color: var(--el-color-primary);
  font-size: 18px;
}
.batch-plan-summary > span:last-child {
  margin-left: auto;
}
.batch-plan-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 18px;
}
.batch-plan-main {
  min-width: 0;
}
.batch-plan-main :deep(.el-input-number),
.batch-plan-main :deep(.el-date-editor) {
  width: 100%;
}
.batch-plan-main :deep(.cell) {
  padding: 6px 8px;
}
.batch-plan-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0;
}
.batch-plan-reference {
  align-self: start;
  padding: 14px;
  border: 1px solid var(--el-border-color);
  border-radius: 10px;
  background: var(--el-fill-color-light);
}
.batch-plan-reference h3 {
  margin: 0 0 14px;
  font-size: 14px;
  display: flex;
  justify-content: space-between;
}
.batch-plan-reference h3 span {
  color: var(--el-color-primary);
}
.batch-plan-reference p {
  font-size: 13px;
}
.batch-plan-reference dl {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 12px;
  margin: 18px 0 0;
  font-size: 13px;
}
.batch-plan-reference dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
}
.batch-plan-warning {
  margin-bottom: 8px;
  padding: 8px 12px;
  color: #923a2b;
  background: #fff0eb;
  border-left: 3px solid #c45b43;
  border-radius: 4px;
  font-size: 13px;
}
@media (max-width: 1100px) {
  .batch-plan-layout {
    grid-template-columns: 1fr;
  }
  .batch-plan-reference {
    order: -1;
  }
}
</style>
