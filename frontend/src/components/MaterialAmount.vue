<script setup lang="ts">
import { formatAmount as amount } from '@/utils/format'
withDefaults(
  defineProps<{
    quantity?: number | null
    weight?: number | null
    prominent?: boolean
    weightOnly?: boolean
  }>(),
  { prominent: false },
)
</script>

<template>
  <span
    class="material-amount"
    :class="{
      'material-amount--prominent': prominent,
      'material-amount--shortage': (weight ?? 0) < 0,
    }"
  >
    <span v-if="!weightOnly"
      ><strong>{{ amount(quantity) }}</strong
      ><small>件</small></span
    >
    <span
      ><strong>{{ amount(weight) }}</strong
      ><small>kg</small></span
    >
    <small v-if="(weight ?? 0) < 0" class="shortage-label">重量差异</small>
  </span>
</template>

<style scoped>
.material-amount {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px 18px;
  font-variant-numeric: tabular-nums;
}
.material-amount > span {
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
  white-space: nowrap;
}
.material-amount strong {
  color: var(--text);
  font-size: 14px;
  font-weight: 500;
}
.material-amount small {
  color: var(--subtle);
  font-size: 12px;
}
.material-amount--prominent strong {
  font-size: 27px;
  font-weight: 600;
  letter-spacing: -0.7px;
}
.material-amount--prominent {
  gap: 6px 24px;
}
.material-amount--shortage strong,
.material-amount--shortage .shortage-label {
  color: var(--el-color-danger);
}
</style>
