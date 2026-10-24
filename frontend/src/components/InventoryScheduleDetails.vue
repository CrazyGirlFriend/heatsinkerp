<script setup lang="ts">
import { ElButton, ElTable, ElTableColumn, ElTag } from 'element-plus'
import {
  scheduleStatusLabels,
  scheduleStatusTone,
  completionBasisLabels,
  scheduleExecutionLabels,
  type InventoryScheduleSummary,
  type ScheduleSummary,
} from '@/types/productionSchedule'
import { formatAmount, formatDateTime } from '@/utils/format'

defineProps<{ summary: InventoryScheduleSummary; serialNo: string }>()
const emit = defineEmits<{ close: []; view: [id: number]; viewAll: [] }>()
const batches = (value: unknown) => {
  const row = value as ScheduleSummary
  const sources = row.linked_batches?.length ? row.linked_batches : row.sources
  return (
    sources.map((source) => source.batch_no || `#${source.source_transfer_id}`).join('、') ||
    (row.predecessor_id ? '衔接上序' : '待关联')
  )
}
</script>

<template>
  <section class="inventory-schedule-detail" :aria-label="`${serialNo}交货安排`">
    <header>
      <div>
        <strong>交货安排</strong><span>{{ serialNo }} · {{ summary.count }}项排期</span>
      </div>
      <ElButton link @click="emit('close')">收起</ElButton>
    </header>
    <ElTable
      :data="summary.items"
      class="business-table inventory-schedule-table"
      row-key="id"
      empty-text="暂无交货安排"
    >
      <ElTableColumn
        v-if="summary.items.some((item) => item.serial_no !== serialNo)"
        prop="serial_no"
        label="流水号"
        min-width="140"
        align="center"
        show-overflow-tooltip
      />
      <ElTableColumn label="关联批次" min-width="195" align="center" show-overflow-tooltip>
        <template #default="{ row }">{{ batches(row) }}</template>
      </ElTableColumn>
      <ElTableColumn label="交货任务" min-width="170" align="center" show-overflow-tooltip>
        <template #default="{ row }">{{ row.task_title || row.task_no || '—' }}</template>
      </ElTableColumn>
      <ElTableColumn label="完成依据" min-width="110" align="center">
        <template #default="{ row }">{{
          row.completion_basis
            ? completionBasisLabels[row.completion_basis as keyof typeof completionBasisLabels]
            : '—'
        }}</template>
      </ElTableColumn>
      <ElTableColumn label="接收班组 / 去向" min-width="140" align="center" show-overflow-tooltip>
        <template #default="{ row }">{{
          row.next_team_name || row.external_destination || '—'
        }}</template>
      </ElTableColumn>
      <ElTableColumn label="计划件数" min-width="95" align="center">
        <template #default="{ row }">{{ formatAmount(row.target_quantity) }}</template>
      </ElTableColumn>
      <ElTableColumn label="已转出件数" min-width="110" align="center">
        <template #default="{ row }">{{ formatAmount(row.dispatched_quantity) }}</template>
      </ElTableColumn>
      <ElTableColumn label="待交件数" min-width="95" align="center">
        <template #default="{ row }">{{
          formatAmount(row.completion_basis === 'weight' ? null : row.remaining_quantity)
        }}</template>
      </ElTableColumn>
      <ElTableColumn
        v-if="summary.items.some((item) => item.target_weight != null)"
        label="计划 / 参考重量 (kg)"
        min-width="130"
        align="center"
        ><template #default="{ row }">{{
          formatAmount(row.target_weight)
        }}</template></ElTableColumn
      >
      <ElTableColumn
        v-if="summary.items.some((item) => item.target_weight != null)"
        label="待交重量 (kg)"
        min-width="130"
        align="center"
        ><template #default="{ row }">{{
          formatAmount(row.completion_basis === 'quantity' ? null : row.remaining_weight)
        }}</template></ElTableColumn
      >
      <ElTableColumn label="要求交货时间" min-width="175" align="center">
        <template #default="{ row }">{{ formatDateTime(row.due_at) }}</template>
      </ElTableColumn>
      <ElTableColumn label="排期状态" min-width="115" align="center">
        <template #default="{ row }"
          ><ElTag :type="scheduleStatusTone(row.status)">{{
            scheduleStatusLabels[row.status as ScheduleSummary['status']]
          }}</ElTag></template
        >
      </ElTableColumn>
      <ElTableColumn label="操作" width="100" align="center" fixed="right">
        <template #default="{ row }"
          ><ElButton link type="primary" @click="emit('view', row.id)">查看排期</ElButton></template
        >
      </ElTableColumn>
      <ElTableColumn label="执行情况" min-width="130" align="center">
        <template #default="{ row }">
          <span>{{
            row.execution_state
              ? scheduleExecutionLabels[row.execution_state as keyof typeof scheduleExecutionLabels]
              : '—'
          }}</span>
          <ElTag v-if="row.quality_held" type="danger" size="small">质量冻结</ElTag>
        </template>
      </ElTableColumn>
    </ElTable>
    <footer>
      <span>按实际转出计算交货进度，签收时间在排期详情单独显示。</span>
      <span v-if="summary.items_truncated"
        >仅展示前{{ summary.items.length }}项，<ElButton
          link
          type="primary"
          @click="emit('viewAll')"
          >查看完整排期</ElButton
        ></span
      >
    </footer>
  </section>
</template>

<style scoped>
.inventory-schedule-detail {
  position: sticky;
  left: 0;
  width: 100cqi;
  box-sizing: border-box;
  min-width: 0;
  padding: 14px 18px 10px;
  background: linear-gradient(115deg, rgba(234, 245, 240, 0.48), rgba(255, 255, 255, 0.9));
  border-block: 1px solid var(--line);
}
.inventory-schedule-detail > header,
.inventory-schedule-detail > header > div {
  display: flex;
  align-items: center;
  gap: 12px;
}
.inventory-schedule-detail > header {
  justify-content: space-between;
  margin-bottom: 10px;
}
.inventory-schedule-detail > header strong {
  color: var(--text);
  font-size: 14px;
  font-weight: 600;
}
.inventory-schedule-detail > header span,
.inventory-schedule-detail > footer {
  color: var(--muted);
  font-size: 12px;
}
.inventory-schedule-detail > footer {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}
.inventory-schedule-table {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: 10px;
}
</style>
