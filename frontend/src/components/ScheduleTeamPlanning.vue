<script setup lang="ts">
import { computed, ref } from 'vue'
import AppPopover from './AppPopover.vue'
import FactoryNavIcon from './FactoryNavIcon.vue'
import ScheduleNodePopover from './ScheduleNodePopover.vue'
import type { ProductionSchedule } from '@/types/productionSchedule'
import { boardTeamColor } from '@/utils/scheduleBoard'
import { hasConfirmedPlan, planLabel } from '@/utils/schedulePlanning'
import { nodeWorkProgress } from '@/utils/scheduleProgress'

const props = defineProps<{ nodes: ProductionSchedule[] }>()
const moreOpen = ref(false)
const icons = {
  库房: 'warehouse',
  线切割: 'cutting',
  退火: 'annealing',
  研磨: 'grinding',
  轧制: 'rolling',
  检验: 'inspection',
  雕刻: 'engraving',
  电镀: 'plating',
} as const
const steps = computed(() =>
  props.nodes
    .filter((node) => node.status !== 'cancelled')
    .slice()
    .sort((a, b) => a.sequence_no - b.sequence_no || a.id - b.id)
    .map((node, index, nodes) => {
      const filled = hasConfirmedPlan(node)
      const occurrence = nodes.some(
        (other) => other.id !== node.id && other.team_id === node.team_id,
      )
        ? nodes.slice(0, index + 1).filter((other) => other.team_id === node.team_id).length
        : null
      return {
        node,
        filled,
        occurrence,
        label: node.team_name + (occurrence ? ` ${occurrence}` : ''),
        state: planLabel(node),
        progress: nodeWorkProgress(node),
        icon: icons[node.team_name as keyof typeof icons] || 'flow',
      }
    }),
)
// Nine icons fit in one table row; unusually long routes share the same bounded layout.
const visibleSteps = computed(() =>
  steps.value.length > 9 ? steps.value.slice(0, 8) : steps.value,
)
const remaining = computed(() => steps.value.length - visibleSteps.value.length)
</script>

<template>
  <div class="team-planning" role="group" aria-label="班组排期填写情况">
    <template v-for="(step, index) in visibleSteps" :key="step.node.id">
      <span v-if="index" class="team-planning__connector" aria-hidden="true" />
      <ScheduleNodePopover :node="step.node" :label="step.label">
        <span
          tabindex="0"
          role="img"
          class="team-planning__step team-planning__symbol"
          :class="{ 'is-filled': step.filled }"
          :style="{
            '--planning-team-color': boardTeamColor(step.node.team_name),
            '--planning-progress': `${step.progress.percent ?? 0}%`,
          }"
          :aria-label="`${step.label}：${step.state}，${step.progress.label} ${step.progress.percent == null ? '暂无进度' : `${Math.round(step.progress.percent)}%`}`"
        >
          <span class="team-planning__fill" aria-hidden="true" />
          <FactoryNavIcon :name="step.icon" />
          <small v-if="step.occurrence" class="team-planning__occurrence" aria-hidden="true">{{
            step.occurrence
          }}</small>
        </span>
      </ScheduleNodePopover>
    </template>
    <template v-if="remaining">
      <span class="team-planning__connector" aria-hidden="true" />
      <AppPopover
        v-model:visible="moreOpen"
        trigger="hover"
        placement="bottom-start"
        :width="280"
        :show-after="180"
      >
        <template #reference>
          <span
            tabindex="0"
            class="team-planning__step team-planning__more"
            :aria-label="`另有 ${remaining} 道工序，查看完整班组排期`"
            :aria-expanded="moreOpen"
            @focusin="moreOpen = true"
            @focusout="moreOpen = false"
            >+{{ remaining }}</span
          >
        </template>
        <div v-if="moreOpen" class="team-planning__list" aria-label="完整班组排期">
          <ScheduleNodePopover
            v-for="step in steps"
            :key="step.node.id"
            :node="step.node"
            :label="step.label"
          >
            <span
              tabindex="0"
              class="team-planning__item"
              :aria-label="`${step.label}：${step.state}`"
            >
              <span
                class="team-planning__symbol"
                :class="{ 'is-filled': step.filled }"
                :style="{
                  '--planning-team-color': boardTeamColor(step.node.team_name),
                  '--planning-progress': `${step.progress.percent ?? 0}%`,
                }"
              >
                <span class="team-planning__fill" aria-hidden="true" />
                <FactoryNavIcon :name="step.icon" />
              </span>
              <span>{{ step.label }}</span
              ><small>{{
                step.progress.percent == null
                  ? step.state
                  : `${step.progress.label} ${Math.round(step.progress.percent)}%`
              }}</small>
            </span>
          </ScheduleNodePopover>
        </div>
      </AppPopover>
    </template>
    <span v-if="!steps.length">—</span>
  </div>
</template>

<style scoped>
.team-planning {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  min-width: 0;
  padding-block: 2px;
}
.team-planning__symbol,
.team-planning__more {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  position: relative;
  flex: 0 0 24px;
  width: 24px;
  height: 24px;
  min-height: 24px;
  margin: 0;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 50%;
  color: var(--muted);
  background: var(--surface-soft);
  box-shadow: none;
  font: inherit;
  line-height: 1;
  transition:
    border-color 160ms,
    background-color 160ms;
}
.team-planning__symbol :deep(.tabler-icon) {
  position: relative;
  width: 15px;
  height: 15px;
}
.team-planning__fill {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--planning-team-color) 24%, transparent),
    color-mix(in srgb, var(--planning-team-color) 58%, transparent)
  );
  clip-path: inset(0 calc(100% - var(--planning-progress, 0%)) 0 0);
  transition: clip-path 240ms ease-out;
}
.team-planning__symbol.is-filled {
  border-color: color-mix(in srgb, var(--planning-team-color) 36%, transparent);
  color: var(--planning-team-color);
  background: color-mix(in srgb, var(--planning-team-color) 14%, var(--surface));
}
.team-planning__step,
.team-planning__item {
  cursor: default;
}
.team-planning__step:hover {
  border-color: currentColor;
}
.team-planning__step:focus-visible,
.team-planning__item:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
.team-planning__connector {
  flex: 0 0 4px;
  height: 1px;
  background: var(--line);
}
.team-planning__occurrence {
  position: absolute;
  right: -3px;
  bottom: -2px;
  min-width: 11px;
  height: 12px;
  border-radius: 4px;
  background: var(--surface);
  color: inherit;
  font-size: 9px;
  line-height: 12px;
  text-align: center;
}
.team-planning__more {
  flex-basis: auto;
  min-width: 24px;
  width: auto;
  padding-inline: 3px;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}
.team-planning__list {
  display: grid;
  gap: 2px;
  max-height: min(360px, 55vh);
  overflow-y: auto;
}
.team-planning__item {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 38px;
  padding: 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 13px;
  text-align: left;
  width: 100%;
}
.team-planning__list :deep(.schedule-node-reference) {
  width: 100%;
}
.team-planning__item:hover {
  background: var(--surface-soft);
}
.team-planning__item small {
  margin-left: auto;
  color: var(--muted);
  font-size: 12px;
}
@media (prefers-color-scheme: dark) {
  .team-planning__symbol.is-filled {
    color: color-mix(in srgb, var(--planning-team-color) 70%, white);
  }
}
@media (prefers-reduced-motion: reduce) {
  .team-planning__symbol,
  .team-planning__more,
  .team-planning__fill {
    transition: none;
  }
}
</style>
