<script setup lang="ts">
withDefaults(defineProps<{ quantity?: number | null; weight?: number | null; prominent?: boolean }>(), { prominent: false })
function amount(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? '—' : new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 3 }).format(value)
}
</script>

<template>
  <span class="material-amount" :class="{ 'material-amount--prominent': prominent }">
    <span><strong>{{ amount(quantity) }}</strong><small>件</small></span>
    <span><strong>{{ amount(weight) }}</strong><small>kg</small></span>
  </span>
</template>

<style scoped>
.material-amount { display: inline-flex; flex-wrap: wrap; align-items: baseline; gap: 6px 18px; font-variant-numeric: tabular-nums; }
.material-amount > span { display: inline-flex; align-items: baseline; gap: 5px; white-space: nowrap; }
.material-amount strong { color: var(--text); font-size: 14px; font-weight: 500; }
.material-amount small { color: var(--subtle); font-size: 12px; }
.material-amount--prominent strong { font-size: 27px; font-weight: 600; letter-spacing: -.7px; }
.material-amount--prominent { gap: 6px 24px; }
</style>
