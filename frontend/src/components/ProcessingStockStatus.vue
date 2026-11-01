<script setup lang="ts">
import { materialWeightToleranceKg } from '@/config/materialRules'

import { computed } from 'vue'
import { ElIcon, ElTag, ElTooltip } from 'element-plus'
import { WarningFilled } from '@element-plus/icons-vue'
import type { ProcessingSummary } from '@/types/materialProcessing'
import { processingStateLabels, type ProcessingState } from '@/types/materialProcessing'
import { isScrapType, type MaterialType } from '@/types/materialTransfer'
import { inventoryAmount } from '@/types/teamInventory'

const props = defineProps<{
  state?: ProcessingState
  summary?: ProcessingSummary & {
    in_transit_quantity?: number | null
    in_transit_weight?: number | null
    max_weight_difference?: number
  }
  materialType?: MaterialType | '' | null
  pending?: boolean
  compact?: boolean
}>()
const registered = computed(() => (props.summary?.processing_registered_batch_count ?? 0) > 0)
const unregistered = computed(() => (props.summary?.processing_unregistered_batch_count ?? 0) > 0)
const progress = computed<ProcessingState>(() =>
  props.summary?.processing_partial_batch_count
    ? 'partial'
    : props.summary?.processing_complete_batch_count ===
          props.summary?.processing_registered_batch_count &&
        registered.value &&
        !unregistered.value
      ? 'complete'
      : 'registered',
)
const current = computed<ProcessingState>(
  () =>
    props.state ||
    (isScrapType(props.materialType)
      ? 'not_applicable'
      : registered.value
        ? progress.value
        : unregistered.value
          ? 'unregistered'
          : props.pending
            ? 'pending'
            : 'cleared'),
)
const mixed = computed(() => !props.state && registered.value && unregistered.value)
const label = computed(() =>
  mixed.value ? '部分批次有加工记录' : processingStateLabels[current.value],
)
const weightWarning = computed(
  () => (props.summary?.max_weight_difference || 0) > materialWeightToleranceKg,
)
const hint = computed(() =>
  props.summary
    ? `有加工记录的批次库存：${inventoryAmount(props.summary.processing_registered_quantity)} 件 / ${inventoryAmount(props.summary.processing_registered_weight)} kg\n未登记批次库存：${inventoryAmount(props.summary.processing_unregistered_quantity)} 件 / ${inventoryAmount(props.summary.processing_unregistered_weight)} kg${props.pending ? `\n转出待签收：${inventoryAmount(props.summary.in_transit_quantity)} 件 / ${inventoryAmount(props.summary.in_transit_weight)} kg` : ''}${weightWarning.value ? `\n同批累计差异超 ${materialWeightToleranceKg} kg` : ''}`
    : '',
)
</script>

<template>
  <ElTooltip
    :content="hint"
    :disabled="
      !summary ||
      (!weightWarning &&
        (current === 'not_applicable' || current === 'cleared' || current === 'pending'))
    "
    :trigger="['hover', 'focus']"
    popper-class="processing-status-tooltip"
  >
    <div
      class="processing-stock-status"
      :class="{ 'processing-stock-status--compact': compact }"
      :tabindex="summary ? 0 : undefined"
    >
      <ElTag
        effect="light"
        :type="
          mixed || current === 'partial' || current === 'unregistered' || current === 'pending'
            ? 'warning'
            : current === 'complete'
              ? 'success'
              : 'info'
        "
        >{{ label }}</ElTag
      >
      <small v-if="!compact && summary && registered"
        >未转出 {{ inventoryAmount(summary.processing_registered_quantity) }} 件</small
      >
      <small v-if="!compact && weightWarning" class="processing-weight-warning"
        >同批累计差异超 {{ materialWeightToleranceKg }} kg</small
      >
      <ElIcon
        v-if="compact && weightWarning"
        class="processing-weight-warning"
        role="img"
        :aria-label="`同批累计差异超 ${materialWeightToleranceKg} kg`"
        ><WarningFilled
      /></ElIcon>
    </div>
  </ElTooltip>
</template>

<style scoped>
.processing-stock-status {
  display: flex;
  align-items: center;
  flex-direction: column;
  gap: 4px;
}
.processing-stock-status small {
  color: var(--muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.processing-stock-status--compact {
  display: inline-flex;
  flex-direction: row;
  gap: 6px;
  vertical-align: middle;
}
.processing-stock-status .processing-weight-warning {
  color: var(--el-color-danger);
}
</style>

<style>
.processing-status-tooltip {
  white-space: pre-line;
}
</style>
