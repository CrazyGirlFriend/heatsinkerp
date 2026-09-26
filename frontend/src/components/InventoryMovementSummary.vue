<script setup lang="ts">
import type { MaterialBalance } from '@/types/teamMaterials'
import { inventoryAmount as amount } from '@/types/teamInventory'

defineProps<{ balance: MaterialBalance }>()
const outbound = (balance: MaterialBalance, unit: 'quantity' | 'weight') => balance[`dispatched_${unit}`] == null || balance[`reserved_${unit}`] == null ? null : Number(balance[`dispatched_${unit}`]) + Number(balance[`reserved_${unit}`])
</script>

<template>
  <div class="inventory-movement">
    <div><span>已接收</span><b>{{ amount(balance.received_quantity) }} 件 / {{ amount(balance.received_weight) }} kg</b></div>
    <div><span>已转出</span><b>{{ amount(outbound(balance, 'quantity')) }} 件 / {{ amount(outbound(balance, 'weight')) }} kg</b></div>
    <div v-if="Number(balance.reserved_quantity) > 0 || Number(balance.reserved_weight) > 0" class="movement-pending"><span>其中待确认</span><b>{{ amount(balance.reserved_quantity) }} 件 / {{ amount(balance.reserved_weight) }} kg</b></div>
    <div v-if="Number(balance.lost_quantity) > 0 || Number(balance.lost_weight) > 0" class="movement-loss"><span>丢失</span><b>{{ amount(balance.lost_quantity) }} 件 / {{ amount(balance.lost_weight) }} kg</b></div>
  </div>
</template>

<style scoped>
.inventory-movement { display: inline-flex; flex-direction: column; gap: 6px; max-width: 100%; font-size: 13px; line-height: 1.5; font-variant-numeric: tabular-nums; text-align: left; }
.inventory-movement > div { display: flex; justify-content: space-between; align-items: baseline; gap: 14px; }
.inventory-movement span { color: var(--muted); font-size: 13px; white-space: nowrap; }
.inventory-movement b { font-weight: 500; white-space: nowrap; }
.inventory-movement .movement-pending { border-left: 2px solid #c69b54; padding-left: 7px; font-size: 13px; }
.inventory-movement .movement-loss, .inventory-movement .movement-loss span { color: #9a502d; }
</style>
