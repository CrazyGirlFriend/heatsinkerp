<script setup lang="ts">
import { computed } from 'vue'
import { IconArrowRight, IconChevronRight } from '@tabler/icons-vue'
import ScheduleDeliveryMark from './ScheduleDeliveryMark.vue'
import { scheduleStatusLabels, type ProductionSchedule } from '@/types/productionSchedule'
import { formatAmount, formatDateTime } from '@/utils/format'
import { boardDeliveryState, boardTeamColor } from '@/utils/scheduleBoard'
const props = defineProps<{
  node: ProductionSchedule
  serialNo: string
  now: number
  batches?: ProductionSchedule[]
  relations?: { upstream: ProductionSchedule[]; downstream: ProductionSchedule[] }
}>()
const emit = defineEmits<{ open: [] }>()
const state = computed(() => boardDeliveryState(props.node, props.now))
const statusLabel = computed(() =>
  state.value === 'unassessed'
    ? '备料转出'
    : scheduleStatusLabels[state.value as keyof typeof scheduleStatusLabels],
)
const weight = computed(() => props.node.completion_basis === 'weight')
const measurements = computed(() => [
  { label: '应交', value: weight.value ? props.node.target_weight : props.node.target_quantity },
  {
    label: '已转出',
    value: weight.value ? props.node.dispatched_weight : props.node.dispatched_quantity,
  },
  {
    label: '下序已签收',
    value: weight.value ? props.node.received_weight : props.node.received_quantity,
  },
])
</script>

<template>
  <div class="batch-detail" :style="{ '--team': boardTeamColor(node.team_name) }">
    <header>
      <span class="detail-team"
        >{{ node.team_name
        }}<template v-if="node.batch_number"> · 第{{ node.batch_number }}批</template></span
      >
      <span class="detail-status"><ScheduleDeliveryMark :state="state" />{{ statusLabel }}</span>
    </header>
    <div class="detail-serial">{{ serialNo }}</div>
    <table v-if="batches && batches.length > 1" class="detail-batches">
      <thead>
        <tr>
          <th>批次</th>
          <th>{{ weight ? '应交 kg' : '应交件数' }}</th>
          <th>开始</th>
          <th>交期</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="batch in batches" :key="batch.id">
          <td>
            <span class="detail-batch-number">
              <ScheduleDeliveryMark :state="boardDeliveryState(batch, now)" />
              {{ batch.batch_number }}
            </span>
          </td>
          <td>{{ formatAmount(weight ? batch.target_weight : batch.target_quantity) }}</td>
          <td :title="formatDateTime(batch.planned_start_at)">
            {{ formatDateTime(batch.planned_start_at).slice(5) || '—' }}
          </td>
          <td :title="formatDateTime(batch.due_at)">
            {{ formatDateTime(batch.due_at).slice(5) || '—' }}
          </td>
        </tr>
      </tbody>
    </table>
    <dl v-else class="detail-dates">
      <div>
        <dt>计划开始</dt>
        <dd>{{ formatDateTime(node.planned_start_at) }}</dd>
      </div>
      <div>
        <dt>约定交期</dt>
        <dd>{{ formatDateTime(node.due_at) }}</dd>
      </div>
      <div>
        <dt>实际交齐</dt>
        <dd>{{ formatDateTime(node.completed_at) }}</dd>
      </div>
    </dl>
    <div class="detail-quantities">
      <div v-for="item in measurements" :key="item.label">
        <span>{{ item.label }}</span
        ><strong
          >{{ formatAmount(item.value) }}<small>{{ weight ? 'kg' : '件' }}</small></strong
        >
      </div>
    </div>
    <div v-if="node.completion_basis === 'both'" class="detail-weight">
      重量 {{ formatAmount(node.dispatched_weight) }} / {{ formatAmount(node.target_weight) }} kg
    </div>
    <dl v-if="relations" class="detail-dates detail-relations">
      <div v-for="(label, key) in { upstream: '上序来料', downstream: '下序去向' }" :key="key">
        <dt>{{ label }}</dt>
        <dd>
          <template v-if="relations[key].length">
            <span v-for="batch in relations[key]" :key="batch.id">
              {{ batch.team_name }} · 第{{ batch.batch_number }}批
            </span>
          </template>
          <span v-else>—</span>
        </dd>
      </div>
    </dl>
    <footer>
      <span
        >{{ node.team_name }} <IconArrowRight :size="13" />
        {{ node.next_team_name || node.external_destination || '交付' }}</span
      ><button type="button" class="detail-button" @click="emit('open')">
        查看明细 <IconChevronRight :size="14" />
      </button>
    </footer>
  </div>
</template>

<style scoped>
.batch-detail {
  color: var(--wm-text, #20242c);
  font-size: 12px;
  line-height: 1.5;
}
.batch-detail header,
.detail-status,
.batch-detail footer,
.batch-detail footer > span,
.detail-button {
  display: flex;
  align-items: center;
  gap: 5px;
}
.batch-detail header {
  justify-content: space-between;
  gap: 12px;
}
.detail-team {
  color: color-mix(in srgb, var(--team) 75%, var(--wm-text, #20242c));
  font-weight: 650;
  font-size: 14px;
}
.detail-status {
  color: var(--wm-muted, #71717a);
  font-size: 11px;
  white-space: nowrap;
}
.detail-serial {
  margin-top: 4px;
  color: var(--wm-muted, #71717a);
}
.detail-batches {
  width: 100%;
  margin: 12px 0;
  border-collapse: collapse;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.detail-batches th,
.detail-batches td {
  padding: 5px 3px;
  text-align: right;
}
.detail-batches th {
  color: var(--wm-muted, #71717a);
  font-weight: 400;
}
.detail-batches th:first-child,
.detail-batches td:first-child {
  text-align: left;
  padding-left: 0;
}
.detail-batch-number {
  display: flex;
  align-items: center;
  gap: 5px;
}
.detail-dates {
  margin: 16px 0;
  display: grid;
  gap: 7px;
}
.detail-dates > div {
  display: flex;
  justify-content: space-between;
  gap: 16px;
}
.detail-dates dt {
  color: var(--wm-muted, #71717a);
}
.detail-dates dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
}
.detail-relations dd {
  display: grid;
  gap: 3px;
  text-align: right;
}
.detail-quantities {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  padding-block: 12px;
  border-block: 1px solid var(--wm-border, #e4e4e7);
}
.detail-quantities > div {
  display: grid;
  gap: 5px;
  padding-left: 12px;
  border-left: 1px solid var(--wm-border, #e4e4e7);
}
.detail-quantities > div:first-child {
  padding-left: 0;
  border: 0;
}
.detail-quantities span {
  color: var(--wm-muted, #71717a);
  font-size: 11px;
}
.detail-quantities strong {
  font-size: 16px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.detail-quantities small {
  font-size: 11px;
  font-weight: 400;
  margin-left: 4px;
  color: var(--wm-muted, #71717a);
}
.detail-weight {
  padding-top: 8px;
  color: var(--wm-muted, #71717a);
}
.batch-detail footer {
  justify-content: space-between;
  margin-top: 12px;
  color: var(--wm-muted, #71717a);
}
.detail-button {
  border: 0;
  padding: 4px 0;
  background: none;
  color: var(--wm-text, #20242c);
  font: inherit;
  cursor: pointer;
}
</style>
