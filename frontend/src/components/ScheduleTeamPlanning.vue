<script setup lang="ts">
import { computed } from 'vue'
import { IconCheck, IconCircle, IconClock } from '@tabler/icons-vue'
import ElButton from './AppButton.vue'
import type { ProductionSchedule } from '@/types/productionSchedule'
import { boardTeamColor } from '@/utils/scheduleBoard'
import { awaitingReview, planLabel } from '@/utils/schedulePlanning'

const props = defineProps<{ nodes: ProductionSchedule[] }>()
const emit = defineEmits<{ select: [node: ProductionSchedule] }>()
const steps = computed(() =>
  props.nodes
    .filter((node) => node.status !== 'cancelled')
    .slice()
    .sort((a, b) => a.sequence_no - b.sequence_no || a.id - b.id)
    .map((node, index, nodes) => ({
      node,
      filled: node.planning_state ? node.planning_state !== 'pending' : !!node.due_at,
      label:
        node.team_name +
        (nodes.some((other) => other.id !== node.id && other.team_id === node.team_id)
          ? ` ${nodes.slice(0, index + 1).filter((other) => other.team_id === node.team_id).length}`
          : ''),
    })),
)
</script>

<template>
  <div class="team-planning" aria-label="班组排期填写情况">
    <ElButton
      v-for="{ node, filled, label } in steps"
      :key="node.id"
      unstyled
      class="team-planning__step"
      :class="{ 'is-filled': filled }"
      :style="{ '--planning-team-color': boardTeamColor(node.team_name) }"
      :aria-label="`${label}：${planLabel(node)}，查看排期`"
      :title="`第 ${node.sequence_no} 道 · ${label} · ${planLabel(node)}`"
      @click="emit('select', node)"
    >
      <component
        :is="!filled ? IconCircle : awaitingReview(node) ? IconClock : IconCheck"
        :size="13"
        aria-hidden="true"
      />{{ label }}
    </ElButton>
    <span v-if="!steps.length">—</span>
  </div>
</template>

<style scoped>
.team-planning {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding-block: 2px;
}
.team-planning .team-planning__step {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  font-family: inherit;
  height: 28px;
  min-height: 28px;
  margin: 0;
  padding: 0 8px;
  border: 1px solid var(--line);
  border-radius: 6px;
  color: var(--subtle);
  background: var(--surface);
  box-shadow: none;
  font-size: 12px;
  line-height: 1;
}
.team-planning .team-planning__step.is-filled {
  border-color: color-mix(in srgb, var(--planning-team-color) 32%, transparent);
  color: var(--planning-team-color);
  background: color-mix(in srgb, var(--planning-team-color) 12%, var(--surface));
}
.team-planning .team-planning__step:hover {
  border-color: currentColor;
}
.team-planning .team-planning__step:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
@media (prefers-color-scheme: dark) {
  .team-planning .team-planning__step.is-filled {
    color: color-mix(in srgb, var(--planning-team-color) 70%, white);
  }
}
</style>
