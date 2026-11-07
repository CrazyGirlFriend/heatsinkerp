<script setup lang="ts">
import { computed } from 'vue'
import { IconArrowRight } from '@tabler/icons-vue'
import AppButton from './AppButton.vue'
import AppDetailTable from './AppDetailTable.vue'
import FactoryNavIcon from './FactoryNavIcon.vue'
import { boardTeamColor } from '@/utils/scheduleBoard'
import { formatAmount } from '@/utils/format'
import type { FactoryTeam } from '@/types/factoryOverview'
import type { Metric } from '@/types/materialAnalytics'

const props = defineProps<{ teams: FactoryTeam[]; metric: Metric; motion: boolean }>()
defineEmits<{ open: [team: FactoryTeam, state?: string] }>()
const states = [
  { key: 'unregistered', label: '待加工' },
  { key: 'partial', label: '部分加工' },
  { key: 'complete', label: '已加工待转出' },
  { key: 'rework', label: '待返工' },
]
const icons = {
  'FACTORY-WAREHOUSE': 'warehouse',
  'FACTORY-ROLL': 'rolling',
  'FACTORY-ANNEAL': 'annealing',
  'FACTORY-GRIND': 'grinding',
  'FACTORY-WIRE': 'cutting',
  'FACTORY-ENGRAVE': 'engraving',
  'FACTORY-PLATE': 'plating',
  'FACTORY-QC': 'inspection',
} as const
const maxStock = computed(() =>
  Math.max(1, ...props.teams.map((team) => team.balance?.[`on_hand_${props.metric}`] || 0)),
)
function amount(team: FactoryTeam, state: string) {
  if (!team.processing) return null
  return team.processing.find((row) => row.state === state)?.[props.metric] ?? 0
}
</script>
<template>
  <div class="team-status" :class="{ 'team-status--motion': motion }">
    <AppDetailTable class="team-status-table" aria-label="各班组当前物料状态">
      <thead>
        <tr>
          <th scope="col">班组</th>
          <th scope="col">流水号</th>
          <th scope="col">在库 {{ metric === 'quantity' ? '件' : 'kg' }}</th>
          <th v-for="state in states" :key="state.key" scope="col">{{ state.label }}</th>
          <th scope="col">待签收 <small>批</small></th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(team, index) in teams"
          :key="team.code"
          :style="{ '--team-color': boardTeamColor(team.name), '--row-delay': `${index * 30}ms` }"
        >
          <th scope="row">
            <AppButton
              link
              :disabled="!team.id"
              :aria-label="`查看${team.name}库存`"
              @click="$emit('open', team)"
            >
              <span class="team-status-icon"
                ><FactoryNavIcon :name="icons[team.code as keyof typeof icons] || 'workspaces'"
              /></span>
              <span
                >{{ team.name
                }}<small v-if="!team.active">{{ team.id ? '停用' : '未配置' }}</small></span
              >
            </AppButton>
          </th>
          <td>
            <AppButton
              link
              :disabled="!team.id"
              :aria-label="`${team.name}在库流水号`"
              @click="$emit('open', team)"
              >{{ formatAmount(team.serial_count) }}</AppButton
            >
          </td>
          <td>
            <AppButton
              link
              :disabled="!team.id"
              class="team-stock-value"
              :aria-label="`${team.name}在库${metric === 'quantity' ? '件数' : '重量'}`"
              @click="$emit('open', team)"
              >{{ formatAmount(team.balance?.[`on_hand_${metric}`]) }}</AppButton
            >
            <span class="team-stock-track" aria-hidden="true"
              ><i
                :style="{
                  width: `${Math.max(0, ((team.balance?.[`on_hand_${metric}`] || 0) / maxStock) * 100)}%`,
                }"
            /></span>
          </td>
          <td
            v-if="team.code === 'FACTORY-WAREHOUSE'"
            :colspan="states.length"
            class="team-warehouse"
          >
            <span>备料与转出</span>
          </td>
          <template v-else
            ><td
              v-for="state in states"
              :key="state.key"
              :class="[
                'team-state',
                state.key,
                { 'has-stock': (amount(team, state.key) || 0) > 0 },
              ]"
            >
              <AppButton
                link
                :disabled="!team.id || !team.processing"
                :aria-label="`${team.name}${state.label}`"
                @click="$emit('open', team, state.key)"
                ><i aria-hidden="true" />{{ formatAmount(amount(team, state.key)) }}</AppButton
              >
            </td></template
          >
          <td>
            <AppButton
              link
              class="team-pending"
              :class="{ 'has-pending': (team.pending_incoming?.batches || 0) > 0 }"
              :disabled="!team.id"
              :aria-label="`查看${team.name}待签收`"
              @click="$emit('open', team, 'pending')"
              >{{ formatAmount(team.pending_incoming?.batches) }}<IconArrowRight :size="13"
            /></AppButton>
          </td>
        </tr>
      </tbody>
    </AppDetailTable>
  </div>
</template>
<style scoped>
.team-status {
  overflow-x: auto;
}
.team-status-table.app-detail-table {
  border: 0;
  min-width: 720px;
  width: 100%;
  font-variant-numeric: tabular-nums;
}
.team-status-table.app-detail-table :deep(th),
.team-status-table.app-detail-table :deep(td) {
  padding: 11px 8px;
  text-align: right;
  white-space: nowrap;
}
.team-status-table.app-detail-table :deep(thead th) {
  font-size: 11px;
  font-weight: 500;
  padding-top: 10px;
  padding-bottom: 12px;
  background: transparent;
}
.team-status-table.app-detail-table :deep(th:first-child) {
  text-align: left;
  padding-left: 0;
}
.team-status-table.app-detail-table :deep(th:last-child),
.team-status-table.app-detail-table :deep(td:last-child) {
  padding-right: 0;
}
.team-status-table.app-detail-table :deep(tbody th) {
  background: transparent;
  font-weight: 550;
}
.team-status-table :deep(.el-button.is-link) {
  height: auto;
  min-height: 26px;
  font-size: 13px;
  padding: 0;
  font-weight: 550;
}
.team-status-table :deep(.el-button > span) {
  gap: 6px;
}
.team-status-icon {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  color: var(--team-color);
  background: color-mix(in srgb, var(--team-color) 10%, var(--wm-bg));
  margin-right: 3px;
}
.team-status-table small {
  font-weight: 400;
  font-size: 10px;
  color: var(--wm-muted);
}
.team-status-table th small {
  display: block;
}
.team-status-table thead small {
  display: inline;
}
.team-stock-value {
  color: var(--wm-text);
}
.team-stock-track {
  display: block;
  height: 3px;
  width: 72px;
  margin: 2px 0 0 auto;
  background: var(--wm-muted-surface);
  border-radius: 3px;
  overflow: hidden;
}
.team-stock-track i {
  display: block;
  height: 100%;
  background: var(--team-color);
  border-radius: inherit;
}
.team-status--motion .team-stock-track i {
  transition: width 450ms ease;
  animation: stock-bar-enter 600ms ease-out both;
  transform-origin: left;
}
.team-state :deep(.el-button.is-link) {
  color: var(--wm-muted);
}
.team-state.has-stock :deep(.el-button.is-link) {
  color: var(--wm-text);
}
.team-state i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--wm-border);
}
.team-state.has-stock.unregistered i {
  background: #6485ed;
}
.team-state.has-stock.partial i {
  background: #e8a23c;
}
.team-state.has-stock.complete i {
  background: #28a487;
}
.team-state.has-stock.rework i {
  background: var(--wm-danger-text);
}
.team-status-table.app-detail-table :deep(.team-warehouse) {
  text-align: center;
  color: var(--wm-muted);
  font-size: 12px;
}
.team-pending :deep(svg) {
  color: var(--wm-muted);
}
.team-pending.has-pending {
  color: var(--wm-warning-text);
}
.team-status--motion tbody tr {
  animation: team-row-enter 280ms ease-out both;
  animation-delay: var(--row-delay);
}
@keyframes team-row-enter {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@keyframes stock-bar-enter {
  from {
    transform: scaleX(0);
  }
  to {
    transform: scaleX(1);
  }
}
@media (prefers-reduced-motion: reduce) {
  .team-status--motion tbody tr,
  .team-status--motion .team-stock-track i {
    animation: none;
    transition: none;
  }
}
</style>
