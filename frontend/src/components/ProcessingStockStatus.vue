<script setup lang="ts">
import { computed } from 'vue'
import { ElTag, ElTooltip } from 'element-plus'
import type { ProcessingSummary } from '@/types/materialProcessing'
import { processingStateLabels, type ProcessingState } from '@/types/materialProcessing'
import { isScrapType, type MaterialType } from '@/types/materialTransfer'
import { inventoryAmount } from '@/types/teamInventory'

const props = defineProps<{ state?: ProcessingState; summary?: ProcessingSummary & { in_transit_quantity?: number | null; in_transit_weight?: number | null }; materialType?: MaterialType | '' | null; pending?: boolean }>()
const registered = computed(() => (props.summary?.processing_registered_batch_count ?? 0) > 0)
const unregistered = computed(() => (props.summary?.processing_unregistered_batch_count ?? 0) > 0)
const current = computed<ProcessingState>(() => props.state || (isScrapType(props.materialType) ? 'not_applicable' : registered.value ? 'registered' : unregistered.value ? 'unregistered' : props.pending ? 'pending' : 'cleared'))
const mixed = computed(() => !props.state && registered.value && unregistered.value)
const label = computed(() => mixed.value ? '部分已登记加工' : processingStateLabels[current.value])
const hint = computed(() => props.summary ? `已登记加工、未转出：${inventoryAmount(props.summary.processing_registered_quantity)} 件 / ${inventoryAmount(props.summary.processing_registered_weight)} kg\n未登记加工：${inventoryAmount(props.summary.processing_unregistered_quantity)} 件 / ${inventoryAmount(props.summary.processing_unregistered_weight)} kg${props.pending ? `\n转出待签收：${inventoryAmount(props.summary.in_transit_quantity)} 件 / ${inventoryAmount(props.summary.in_transit_weight)} kg` : ''}` : '')
</script>

<template>
  <ElTooltip :content="hint" :disabled="!summary || current === 'not_applicable' || current === 'cleared' || current === 'pending'" :trigger="['hover', 'focus']" popper-class="processing-status-tooltip">
    <div class="processing-stock-status" :tabindex="summary ? 0 : undefined">
      <ElTag effect="light" :type="mixed || current === 'unregistered' || current === 'pending' ? 'warning' : current === 'registered' ? 'success' : 'info'">{{ label }}</ElTag>
      <small v-if="summary && registered">未转出 {{ inventoryAmount(summary.processing_registered_quantity) }} 件</small>
    </div>
  </ElTooltip>
</template>

<style scoped>
.processing-stock-status { display: flex; align-items: center; flex-direction: column; gap: 4px; }
.processing-stock-status small { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
</style>

<style>
.processing-status-tooltip { white-space: pre-line; }
</style>
