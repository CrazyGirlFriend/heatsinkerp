<script setup lang="ts">
import ElAlert from '@/components/AppAlert.vue'
import ElDatePicker from '@/components/AppDatePicker.vue'
import { computed, onMounted, ref } from 'vue'
import { ElForm, ElFormItem, ElTableColumn } from 'element-plus'
import ElInputNumber from '@/components/AppNumberInput.vue'
import ElTable from '@/components/watermelon/WatermelonDataTable.vue'
import ElButton from '@/components/AppButton.vue'
import AppDialog from './AppDialog.vue'
import AsyncStatus from './AsyncStatus.vue'
import ScheduleDocuments from './ScheduleDocuments.vue'
import CompactFormSection from './CompactFormSection.vue'
import type { ProductionSchedule, ScheduleTask } from '@/types/productionSchedule'
import { productionScheduleApi } from '@/services/productionScheduleApi'
import { formatAmount, formatDateTime } from '@/utils/format'
import { plannedDueLabel, teamPlanValues } from '@/utils/schedulePlanning'

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
const { due_at, ...values } = teamPlanValues(props.schedule)
const plan = ref(values)
const due = ref(due_at ? `${formatDateTime(due_at).replace(' ', 'T')}:00` : '')
const warning = computed(() => {
  if (!due.value) return ''
  const items: string[] = []
  const end = Date.parse(`${due.value}+08:00`)
  if (task.value?.final_due_at && end > Date.parse(task.value.final_due_at))
    items.push('晚于最终交期')
  const upstreamDue = plan.value.upstream_batch_ids.length
    ? Math.max(
        ...plan.value.upstream_batch_ids.map((id) =>
          Date.parse(upstream.value?.batches?.find((batch) => batch.id === id)?.due_at || ''),
        ),
      )
    : Date.parse(props.schedule.planned_start_at || '')
  if (upstreamDue > end) items.push('早于上序计划转交')
  return items.join(' · ')
})
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
  if (saving.value || loading.value || !task.value) return
  error.value = ''
  if (!due.value) {
    error.value = '请填写转交时间'
    return
  }
  if (
    (basis.value !== 'weight' && !(Number(plan.value.target_quantity) > 0)) ||
    (basis.value !== 'quantity' && !(Number(plan.value.target_weight) > 0))
  ) {
    error.value = '请填写计划数量'
    return
  }
  saving.value = true
  try {
    const result = await productionScheduleApi.saveBatches(props.schedule.id, {
      expected_version: props.schedule.version,
      batches: [{ ...plan.value, due_at: `${due.value}+08:00` }],
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
    title="班组转出计划"
    width="min(1480px, 96vw)"
    append-to-body
    :close-on-click-modal="!saving"
    :close-on-press-escape="!saving"
    :show-close="!saving"
    @closed="emit('close')"
  >
    <ElAlert
      v-if="schedule.pending_batches?.length"
      :title="
        schedule.pending_batches.length > 1
          ? '旧版草稿已汇总为一条计划，请核对转交时间和数量'
          : '旧版排期草稿已保留，保存后生效'
      "
      type="info"
      :closable="false"
    />
    <ElAlert v-if="error" :title="error" type="error" :closable="false" />
    <div class="batch-plan-summary">
      <strong>{{ schedule.serial_no }}</strong
      ><span>第 {{ schedule.sequence_no }} 道 · {{ schedule.team_name }}</span
      ><span
        >最终交期 <b>{{ formatDateTime(task?.final_due_at) }}</b></span
      >
    </div>
    <ScheduleDocuments
      :serial-no="schedule.serial_no"
      :route-ids="[schedule.process_route_id]"
      :task-id="schedule.task_id"
      :order-document="task?.order_document ?? null"
    >
      <CompactFormSection v-if="task?.delivery_batches?.length" title="调度交货要求">
        <ElTable
          columns-key="ScheduleBatchEditor-1"
          class="form-field--full"
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
      </CompactFormSection>
      <ElForm label-position="top" @submit.prevent="save">
        <CompactFormSection title="本班组排期" class="batch-plan-main">
          <ElFormItem label="转交时间" required>
            <ElDatePicker
              v-model="due"
              type="datetime"
              format="YYYY-MM-DD HH:mm"
              value-format="YYYY-MM-DDTHH:mm:ss"
              :default-time="defaultTime"
              :disabled-minutes="nonZeroMinutes"
              :disabled-seconds="nonZeroMinutes"
              :disabled="saving"
              placeholder="选择转交时间"
              aria-label="转交时间"
            />
          </ElFormItem>
          <ElFormItem v-if="basis !== 'weight'" label="计划件数" required>
            <ElInputNumber
              v-model="plan.target_quantity"
              :min="1"
              :max="2147483647"
              :precision="0"
              :controls="false"
              :disabled="saving"
              aria-label="计划件数"
            />
          </ElFormItem>
          <ElFormItem v-if="basis !== 'quantity'" label="计划重量（kg）" required>
            <ElInputNumber
              v-model="plan.target_weight"
              :min="0.000001"
              :precision="6"
              :controls="false"
              :disabled="saving"
              aria-label="计划重量"
            />
          </ElFormItem>
          <p v-if="warning" class="form-field--full batch-plan-warning" role="status">
            {{ warning }}
          </p>
        </CompactFormSection>
      </ElForm>
      <CompactFormSection title="上游供料" class="batch-plan-reference">
        <template #actions
          ><span>{{ upstream?.team_name || '库房备料' }}</span></template
        >
        <div class="form-field--long">
          <AsyncStatus v-if="loading" label="正在读取上游供料…" />
          <ElButton v-else-if="!task" @click="load">重新读取</ElButton>
          <p v-else-if="upstream">计划转交 {{ plannedDueLabel(upstream) }}</p>
          <p v-else>暂无上序供料计划</p>
        </div>
        <dl class="form-field--long">
          <dt>本班组在库</dt>
          <dd>{{ formatAmount(schedule.stock?.on_hand_quantity || 0) }} 件</dd>
          <dt>待签收</dt>
          <dd>{{ formatAmount(schedule.stock?.pending_quantity || 0) }} 件</dd>
        </dl>
      </CompactFormSection>
    </ScheduleDocuments>
    <template #footer
      ><ElButton :disabled="saving" @click="visible = false">取消</ElButton
      ><ElButton type="primary" :loading="saving" :disabled="loading || !task" @click="save"
        >保存排期</ElButton
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
  padding: 4px 0 12px;
  font-size: 14px;
}
.batch-plan-summary strong {
  color: var(--el-color-primary);
  font-size: 18px;
}
.batch-plan-summary > span:last-child {
  margin-left: auto;
}
.batch-plan-main {
  min-width: 0;
}
.batch-plan-main :deep(.el-input-number),
.batch-plan-main :deep(.el-date-editor) {
  width: 100%;
}
.batch-plan-reference :deep(.compact-form-section-actions) {
  color: var(--el-color-primary);
  font-size: 13px;
}
.batch-plan-reference p {
  font-size: 13px;
}
.batch-plan-reference dl {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  margin: 0;
  font-size: 13px;
}
.batch-plan-reference dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
}
.batch-plan-warning {
  margin-bottom: 8px;
  padding: 8px 12px;
  color: var(--wm-danger-text, #923a2b);
  background: var(--wm-danger-bg, #fff0eb);
  border-left: 3px solid var(--wm-danger-text, #c45b43);
  border-radius: 4px;
  font-size: 13px;
}
</style>
