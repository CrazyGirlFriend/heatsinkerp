<script setup lang="ts">
import { materialWeightToleranceKg } from '@/config/materialRules'

import { computed } from 'vue'
import { ElIcon, ElTag, ElTooltip } from 'element-plus'
import { WarningFilled } from '@element-plus/icons-vue'
import type { ProcessingSummary } from '@/types/materialProcessing'
import {
  processingStateLabels,
  stockProcessingState,
  type ProcessingState,
} from '@/types/materialProcessing'
import { isScrapType, type MaterialType } from '@/types/materialTransfer'
import { inventoryAmount } from '@/types/teamInventory'

const props = defineProps<{
  state?: ProcessingState
  summary?: ProcessingSummary & { max_weight_difference?: number }
  materialType?: MaterialType | '' | null
  pending?: boolean
  compact?: boolean
}>()
const current = computed(() =>
  isScrapType(props.materialType)
    ? 'not_applicable'
    : (props.state ?? stockProcessingState(props.summary, props.pending)),
)
const label = computed(() =>
  current.value === 'mixed' ? '部分批次有加工记录' : processingStateLabels[current.value],
)
const weightWarning = computed(() =>
  (props.summary?.max_weight_difference ?? 0) > materialWeightToleranceKg
    ? `同批重量相差超过 ${materialWeightToleranceKg} kg`
    : '',
)
</script>

<template>
  <ElTooltip :content="weightWarning" :disabled="!weightWarning" :trigger="['hover', 'focus']">
    <div
      class="processing-stock-status"
      :class="{ 'processing-stock-status--compact': compact }"
      :tabindex="weightWarning ? 0 : undefined"
    >
      <span v-if="current === 'not_applicable'">—</span>
      <ElTag
        v-else
        effect="light"
        :type="
          current === 'rework'
            ? 'danger'
            : current === 'unregistered'
              ? 'primary'
              : current === 'mixed' || current === 'partial' || current === 'pending'
                ? 'warning'
                : current === 'complete'
                  ? 'success'
                  : 'info'
        "
        >{{ label }}</ElTag
      >
      <small
        v-if="
          current !== 'not_applicable' && !compact && summary?.processing_registered_batch_count
        "
        >未转出 {{ inventoryAmount(summary.processing_registered_quantity) }} 件</small
      >
      <small v-if="!compact && weightWarning" class="processing-weight-warning">{{
        weightWarning
      }}</small>
      <ElIcon
        v-if="compact && weightWarning"
        class="processing-weight-warning"
        role="img"
        :aria-label="weightWarning"
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
  font-size: var(--font-size-meta);
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
