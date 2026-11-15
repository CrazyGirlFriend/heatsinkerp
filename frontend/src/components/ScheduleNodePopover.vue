<script setup lang="ts">
import { ElTag } from 'element-plus'
import { scheduleStatusLabels, scheduleStatusTone } from '@/types/productionSchedule'
import { computed, ref } from 'vue'
import AppPopover from './AppPopover.vue'
import type { ProductionSchedule } from '@/types/productionSchedule'
import { boardTeamColor } from '@/utils/scheduleBoard'
import { nodeProgress, nodeTarget, nodeWorkProgress } from '@/utils/scheduleProgress'
import { plannedDueLabel } from '@/utils/schedulePlanning'
import { formatAmount, formatDateTime } from '@/utils/format'

const props = defineProps<{ node: ProductionSchedule; label: string }>()
const open = ref(false)
const progress = computed(() => nodeWorkProgress(props.node))
const batches = computed(() =>
  (props.node.batches || [])
    .filter((batch) => batch.status !== 'cancelled')
    .slice()
    .sort((a, b) => a.batch_number - b.batch_number)
    .map((batch) => ({
      ...batch,
      transferStatus: batch.handover_status || batch.status,
      quantities: nodeProgress({ ...props.node, ...batch }),
    })),
)
const multipleBatches = computed(() => batches.value.length > 1)
</script>

<template>
  <AppPopover
    v-model:visible="open"
    trigger="hover"
    placement="top"
    :width="multipleBatches ? 360 : 300"
    popper-class="schedule-node-popover"
    :show-after="180"
    :hide-after="120"
  >
    <template #reference>
      <span class="schedule-node-reference" @focusin="open = true" @focusout="open = false"
        ><slot
      /></span>
    </template>
    <section v-if="open" class="schedule-node-summary" :aria-label="`${label}排期摘要`">
      <header>
        <strong :style="{ color: boardTeamColor(node.team_name) }">{{ label }}</strong>
        <span
          >{{ progress.label }}
          <b>{{ progress.percent == null ? '—' : `${Math.round(progress.percent)}%` }}</b></span
        >
      </header>
      <ElTag
        class="schedule-node-state"
        :type="scheduleStatusTone(node.handover_status || node.status)"
        >{{ scheduleStatusLabels[node.handover_status || node.status] }}</ElTag
      >
      <dl>
        <template v-if="!multipleBatches">
          <dt>约定转交</dt>
          <dd>{{ plannedDueLabel(node) }}</dd>
          <dt>实际交完</dt>
          <dd>{{ formatDateTime(node.handover_completed_at || node.completed_at) }}</dd>
        </template>
        <dt>计划数量</dt>
        <dd>{{ nodeTarget(node) || '—' }}</dd>
        <dt>已转出</dt>
        <dd>
          {{ formatAmount(node.dispatched_quantity) }} 件 ·
          {{ formatAmount(node.dispatched_weight) }} kg
        </dd>
        <dt>下序已签收</dt>
        <dd>{{ formatAmount(node.received_quantity) }} 件</dd>
      </dl>
      <div v-if="multipleBatches" class="schedule-node-batches">
        <div class="schedule-node-batches__heading">
          <span>分批交货 · {{ batches.length }} 批</span><span>已转 / 应交</span>
        </div>
        <ul aria-label="分批交货情况">
          <li v-for="batch in batches" :key="batch.id">
            <div class="schedule-node-batches__line">
              <span>第 {{ batch.batch_number }} 批</span>
              <strong>{{ batch.quantities }}</strong>
            </div>
            <div class="schedule-node-batches__line">
              <span class="schedule-node-batches__due"
                >交期 {{ formatDateTime(batch.due_at) }}</span
              >
              <ElTag size="small" :type="scheduleStatusTone(batch.transferStatus)">
                {{ scheduleStatusLabels[batch.transferStatus] }}
              </ElTag>
            </div>
          </li>
        </ul>
      </div>
    </section>
  </AppPopover>
</template>

<style scoped>
:global(.schedule-node-popover.el-popper) {
  max-width: calc(100vw - 24px);
}
.schedule-node-reference {
  display: inline-flex;
  min-width: 0;
}
.schedule-node-summary {
  font-size: 13px;
  color: var(--text);
}
.schedule-node-summary header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  margin-bottom: 14px;
}
.schedule-node-summary header > span {
  color: var(--muted);
  font-size: 12px;
}
.schedule-node-summary b {
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.schedule-node-state {
  margin-bottom: 12px;
}
.schedule-node-summary dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 9px 16px;
  margin: 0;
}
.schedule-node-summary dt {
  color: var(--muted);
}
.schedule-node-summary dd {
  margin: 0;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.schedule-node-batches {
  margin-top: 12px;
  border-top: 1px solid var(--line);
}
.schedule-node-batches__heading,
.schedule-node-batches__line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.schedule-node-batches__heading {
  padding-top: 10px;
  color: var(--muted);
  font-size: 12px;
}
.schedule-node-batches ul {
  max-height: min(240px, 35dvh);
  overflow-y: auto;
  overscroll-behavior: contain;
  list-style: none;
  margin: 0;
  padding: 0;
}
.schedule-node-batches li {
  display: grid;
  gap: 5px;
  padding-block: 10px;
}
.schedule-node-batches li + li {
  border-top: 1px solid var(--line);
}
.schedule-node-batches__due {
  font-size: 12px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.schedule-node-batches strong {
  font-size: 12px;
  text-align: right;
}
</style>
