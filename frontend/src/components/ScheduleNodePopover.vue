<script setup lang="ts">
import { computed, ref } from 'vue'
import AppPopover from './AppPopover.vue'
import type { ProductionSchedule } from '@/types/productionSchedule'
import { boardTeamColor } from '@/utils/scheduleBoard'
import { nodeTarget, nodeWorkProgress } from '@/utils/scheduleProgress'
import { plannedDueLabel } from '@/utils/schedulePlanning'
import { formatAmount, formatDateTime } from '@/utils/format'

const props = defineProps<{ node: ProductionSchedule; label: string }>()
const open = ref(false)
const progress = computed(() => nodeWorkProgress(props.node))
</script>

<template>
  <AppPopover
    v-model:visible="open"
    trigger="hover"
    placement="top"
    :width="300"
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
      <dl>
        <dt>约定转交</dt>
        <dd>{{ plannedDueLabel(node) }}</dd>
        <dt>实际交完</dt>
        <dd>{{ formatDateTime(node.completed_at) }}</dd>
        <dt>计划数量</dt>
        <dd>{{ nodeTarget(node) || '—' }}</dd>
        <template v-if="node.assessment_enabled !== false && node.processed_quantity != null"
          ><dt>已加工</dt>
          <dd>{{ formatAmount(node.processed_quantity) }} 件</dd></template
        >
        <dt>已转出</dt>
        <dd>
          {{ formatAmount(node.dispatched_quantity) }} 件 ·
          {{ formatAmount(node.dispatched_weight) }} kg
        </dd>
        <dt>下序已签收</dt>
        <dd>{{ formatAmount(node.received_quantity) }} 件</dd>
      </dl>
    </section>
  </AppPopover>
</template>

<style scoped>
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
</style>
