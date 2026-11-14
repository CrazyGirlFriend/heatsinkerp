<script setup lang="ts">
import { computed } from 'vue'
import ScheduleProgressMeter from './ScheduleProgressMeter.vue'
import { formatAmount } from '@/utils/format'
import { shipmentStatusLabels } from '@/types/productionSchedule'
const props = defineProps<{
  shipped?: number
  target?: number | null
  status?: keyof typeof shipmentStatusLabels
}>()
const percent = computed(() =>
  props.target && props.target > 0
    ? Math.min(100, ((props.shipped || 0) / props.target) * 100)
    : null,
)
</script>
<template>
  <div
    class="shipment-progress"
    :aria-label="`客户发货：${formatAmount(shipped || 0)} / ${formatAmount(target)} 件`"
  >
    <span
      ><b>{{ formatAmount(shipped || 0) }}</b> / {{ formatAmount(target) }} 件
      <small>{{ shipmentStatusLabels[status || 'unshipped'] }}</small></span
    >
    <ScheduleProgressMeter :percent="percent" color="#168779" label="客户发货比例" />
  </div>
</template>
<style scoped>
.shipment-progress {
  display: grid;
  gap: 3px;
  min-width: 150px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.shipment-progress > span {
  display: flex;
  align-items: baseline;
  gap: 4px;
}
.shipment-progress small {
  margin-left: auto;
  color: var(--muted);
}
</style>
