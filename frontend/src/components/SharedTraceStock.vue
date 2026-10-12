<script setup lang="ts">
import { computed } from 'vue'
import { ElPopover } from 'element-plus'
import type { MaterialTrace } from '@/types/materialTrace'
import { isScrapType, materialTypeLabel } from '@/types/materialTransfer'
import { historyNumber as num } from '@/utils/serialHistoryChart'
import { sharedSerialColor } from '@/utils/traceOrigins'
const props = defineProps<{ trace: MaterialTrace; appendTo?: HTMLElement }>()
const emit = defineEmits<{ serial: [value: string] }>()
const groups = computed(() => [...new Map(props.trace.items.filter(item => item.shared_group_id).map(item => [item.shared_group_id, item])).values()])
const totals = computed(() => (props.trace.shared_positions || []).reduce((sum, item) => { if (isScrapType(item.material_type)) sum.scrap += item.weight; else { sum.quantity += item.quantity; sum.weight += item.weight } return sum }, { quantity: 0, weight: 0, scrap: 0 }))
</script>
<template>
  <div v-if="groups.length" class="shared-trace-stock" aria-label="关联共投库存">
    <ElPopover trigger="click" :width="440" :append-to="appendTo" title="共投库存 · 不计入单一流水号">
      <template #reference><button class="shared-stock-button" type="button">共投未分配 <b>{{ num(totals.quantity) }} 件 / {{ num(totals.weight) }} kg</b><span>共投废料 {{ num(totals.scrap) }} kg</span></button></template>
      <div class="shared-stock-details"><div v-for="(item, index) in trace.shared_positions" :key="index"><strong>{{ item.team_name }} · {{ materialTypeLabel(item.material_type) }}</strong><span>{{ num(item.quantity) }} 件 / {{ num(item.weight) }} kg</span><small>{{ item.origin_batch_no }}</small></div><p v-if="!trace.shared_positions?.length">暂无未分配库存</p></div>
    </ElPopover>
    <div class="shared-trace-orders"><template v-for="group in groups" :key="group.shared_group_id"><button type="button" @click="emit('serial', group.shared_origin_batch_no!)">查看整块料</button><button v-for="(member, index) in group.shared_serials" :key="`${group.shared_group_id}-${member.serial_no}`" type="button" :class="{ active: trace.serial_no === member.serial_no }" @click="emit('serial', member.serial_no)"><i :style="{ background: sharedSerialColor(index) }" />{{ member.serial_no }}</button></template></div>
  </div>
</template>
<style scoped>
.shared-trace-stock { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; padding: 10px 16px; border-block: 1px solid var(--line); background: var(--surface-soft); font-size: 12px; }
button { border: 0; color: var(--primary); font: inherit; cursor: pointer; background: transparent; padding: 4px 7px; border-radius: 5px; }.shared-stock-button { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }.shared-stock-button b { font-weight: 600; }.shared-stock-button span { color: var(--action-warm); }.shared-trace-orders { display: flex; overflow-x: auto; max-width: 100%; gap: 4px; }.shared-trace-orders button { white-space: nowrap; }.shared-trace-orders .active, button:hover { background: var(--primary-soft); }
.shared-stock-details { max-height: 300px; overflow: auto; }.shared-stock-details > div { display: grid; grid-template-columns: 1fr auto; gap: 6px; padding: 8px 0; border-bottom: 1px solid var(--line); }.shared-stock-details strong { font-weight: 500; }.shared-stock-details small { grid-column: 1 / -1; color: var(--muted); }
.shared-trace-orders i { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 5px; }
</style>
