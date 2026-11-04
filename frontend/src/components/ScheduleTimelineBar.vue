<script setup lang="ts">
import { computed, ref } from 'vue'
import { IconChevronRight } from '@tabler/icons-vue'
import AppPopover from './AppPopover.vue'
import ScheduleBatchSummary from './ScheduleBatchSummary.vue'
import ScheduleDeliveryMark from './ScheduleDeliveryMark.vue'
import { scheduleStatusLabels } from '@/types/productionSchedule'
import { formatDateTime } from '@/utils/format'
import {
  BOARD_LANE_HEIGHT,
  boardDeliveryState,
  boardTeamColor,
  type BoardBar,
} from '@/utils/scheduleBoard'

const props = defineProps<{ bar: BoardBar; serialNo: string; now: number; summary?: boolean }>()
const emit = defineEmits<{ open: [] }>()
const popover = ref<InstanceType<typeof AppPopover>>()
const node = computed(() => props.bar.node)
const state = computed(() => boardDeliveryState(node.value, props.now))
const label = computed(() =>
  props.summary || !node.value.batch_number
    ? node.value.team_name
    : `第${node.value.batch_number}批`,
)
const statusLabel = computed(() =>
  state.value === 'unassessed'
    ? '备料转出'
    : scheduleStatusLabels[state.value as keyof typeof scheduleStatusLabels],
)
const accessibleLabel = computed(
  () =>
    `${props.serialNo} · ${node.value.team_name}${node.value.batch_number ? ` · 第${node.value.batch_number}批` : ''} · ${statusLabel.value} · 交期 ${formatDateTime(node.value.due_at)}`,
)
function open() {
  popover.value?.hide()
  emit('open')
}
</script>

<template>
  <AppPopover
    ref="popover"
    :trigger="['hover', 'focus']"
    :trigger-keys="[]"
    placement="top"
    :width="324"
    :show-after="180"
    :hide-after="120"
    :show-arrow="false"
    popper-class="schedule-batch-popover"
  >
    <template #reference>
      <button
        type="button"
        class="batch-bar"
        :class="{
          milestone: !bar.interval,
          compact: bar.width < 58,
          narrow: bar.width < 35,
          'clipped-start': bar.clippedStart,
          'clipped-end': bar.clippedEnd,
        }"
        :style="{
          left: `${bar.left}px`,
          width: `${bar.width}px`,
          top: `${13 + bar.lane * BOARD_LANE_HEIGHT}px`,
          '--team': boardTeamColor(node.team_name),
        }"
        :aria-label="accessibleLabel"
        @click="open"
      >
        <span v-if="bar.interval" class="bar-label">{{ label }}</span>
        <ScheduleDeliveryMark v-if="!bar.clippedEnd" :state="state" class="bar-endpoint" />
        <IconChevronRight v-else class="clipped-marker" :size="14" />
      </button>
    </template>
    <ScheduleBatchSummary :node="node" :serial-no="serialNo" :now="now" @open="open" />
  </AppPopover>
</template>

<style scoped>
.batch-bar {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  height: 34px;
  padding: 0 10px;
  border: 0;
  border-radius: 4px;
  background: var(--team);
  color: white;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  text-align: left;
  z-index: 2;
  transition:
    box-shadow 160ms ease,
    filter 160ms ease,
    transform 160ms ease;
}
.batch-bar:hover,
.batch-bar:focus-visible {
  filter: brightness(1.07);
  box-shadow: 0 3px 8px color-mix(in srgb, var(--team) 25%, transparent);
  transform: translateY(-1px);
  z-index: 5;
}
.batch-bar:focus-visible {
  outline: 2px solid var(--team);
  outline-offset: 3px;
}
.bar-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.batch-bar.compact {
  padding-inline: 5px 9px;
  font-size: 11px;
}
.batch-bar.narrow .bar-label {
  display: none;
}
.bar-endpoint {
  position: absolute;
  right: -9px;
  top: -7px;
  background: var(--wm-bg, white);
  border: 2px solid var(--wm-bg, white);
  border-radius: 50%;
}
.batch-bar.milestone {
  background: transparent;
  padding: 0;
}
.milestone .bar-endpoint {
  inset: 7px auto auto 2px;
}
.clipped-start {
  border-left: 2px dashed #ffffffb3;
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
}
.clipped-end {
  border-right: 2px dashed #ffffffb3;
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
}
.clipped-marker {
  margin-left: auto;
  flex-shrink: 0;
}
@media (prefers-reduced-motion: reduce) {
  .batch-bar {
    transition: none;
  }
}
</style>
