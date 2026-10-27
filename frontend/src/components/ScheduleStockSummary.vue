<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { ElIcon, ElPopover } from 'element-plus'
import { Box, Clock, Lock } from '@element-plus/icons-vue'
import type { ScheduleTask } from '@/types/productionSchedule'
import { formatAmount } from '@/utils/format'
import { scheduleTeamStyle } from '@/utils/scheduleTeamColor'

defineProps<{ task: ScheduleTask; compact?: boolean }>()
const visible = ref(false)
const trigger = ref<HTMLButtonElement>()
function closeOnEscape(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  event.preventDefault()
  event.stopPropagation()
  visible.value = false
  trigger.value?.focus()
}
watch(visible, (open) => {
  if (open) document.addEventListener('keydown', closeOnEscape, true)
  else document.removeEventListener('keydown', closeOnEscape, true)
})
onBeforeUnmount(() => document.removeEventListener('keydown', closeOnEscape, true))
</script>

<template>
  <ElPopover
    v-model:visible="visible"
    trigger="click"
    placement="bottom-end"
    :width="540"
    :persistent="false"
    :popper-style="{ maxWidth: 'calc(100vw - 32px)' }"
  >
    <template #reference>
      <button
        ref="trigger"
        type="button"
        class="stock-summary"
        :class="{ 'is-compact': compact }"
        :aria-label="`${task.serial_no} ${task.title}的库存分布`"
        :aria-expanded="visible"
      >
        <template v-if="compact">
          <ElIcon><Box /></ElIcon>
        </template>
        <template v-else>
          <span
            v-for="item in task.locations?.slice(0, 2)"
            :key="item.team_id"
            class="stock-team"
            :style="scheduleTeamStyle(item.team_name)"
            :class="{ 'is-held': item.quality_held }"
          >
            <ElIcon v-if="item.quality_held"><Lock /></ElIcon>
            {{ item.team_name }}
            <ElIcon
              v-if="item.pending_quantity || item.pending_weight"
              class="stock-pending"
              aria-label="含待签收物料"
            >
              <Clock />
            </ElIcon>
          </span>
          <span v-if="(task.locations?.length || 0) > 2" class="stock-more">
            +{{ task.locations!.length - 2 }}
          </span>
        </template>
      </button>
    </template>
    <section class="stock-distribution" aria-label="库存分布">
      <header>
        <strong>{{ task.serial_no }}</strong>
        <span v-if="task.shared_source" class="stock-shared">共用批次</span>
      </header>
      <div class="stock-distribution-scroll">
        <table>
          <thead>
            <tr>
              <th>班组</th>
              <th>在库件数</th>
              <th>在库重量 (kg)</th>
              <th>待签收件数</th>
              <th>待签收重量 (kg)</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in task.locations" :key="item.team_id">
              <th>
                {{ item.team_name
                }}<ElIcon v-if="item.quality_held" aria-label="质量暂扣"><Lock /></ElIcon>
              </th>
              <td>{{ formatAmount(item.quantity) }}</td>
              <td>{{ formatAmount(item.weight) }}</td>
              <td>{{ formatAmount(item.pending_quantity) }}</td>
              <td>{{ formatAmount(item.pending_weight) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </ElPopover>
</template>

<style scoped>
.stock-summary {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  padding: 3px 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  font: inherit;
  text-align: left;
}
.stock-summary:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 3px;
  border-radius: 4px;
}
.stock-team,
.stock-more {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 6px;
  border: 1px solid #d8e5df;
  border-radius: 5px;
  color: #245b48;
  background: #f0f7f3;
  font-size: 12px;
  line-height: 18px;
  white-space: nowrap;
}
.stock-pending {
  color: #946018;
}
.stock-team {
  color: var(--team-color);
  border-color: var(--team-border);
  background: var(--team-tint);
}
.stock-team.is-held > .el-icon:first-child {
  color: #98423d;
}
.stock-more {
  color: var(--muted);
  border-color: var(--line);
  background: #f5f7f6;
}
.stock-summary:hover .stock-team {
  border-color: #9cb9aa;
}
.stock-summary.is-compact {
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  color: var(--primary);
  border: 1px solid #dce7e0;
  border-radius: 6px;
  background: #f5faf7;
}
.stock-distribution header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  color: var(--text);
}
.stock-shared {
  font-size: 12px;
  color: var(--muted);
}
.stock-distribution-scroll {
  max-height: 260px;
  overflow: auto;
}
.stock-distribution table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.stock-distribution th,
.stock-distribution td {
  padding: 8px;
  border: 1px solid var(--line);
  white-space: nowrap;
}
.stock-distribution th {
  font-weight: 500;
  text-align: left;
}
.stock-distribution thead th {
  background: #f2f6f4;
}
.stock-distribution td {
  text-align: right;
}
.stock-distribution th .el-icon {
  margin-left: 4px;
  color: #98423d;
}
</style>
