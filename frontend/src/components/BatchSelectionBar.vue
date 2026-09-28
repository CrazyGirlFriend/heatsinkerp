<script setup lang="ts">
import { ElButton, ElCheckbox } from 'element-plus'
import { inventoryAmount } from '@/types/teamInventory'
defineProps<{ count: number; quantity: number; weight: number; allChecked: boolean; partial: boolean; disabled?: boolean }>()
defineEmits<{ all: [checked: boolean]; clear: [] }>()
</script>

<template>
  <div class="batch-selection-bar">
    <ElCheckbox :model-value="allChecked" :indeterminate="partial" :disabled="disabled" @change="$emit('all', Boolean($event))">本页全选</ElCheckbox>
    <span class="batch-selection-total" aria-live="polite">已选 <strong>{{ count }}</strong> 批<span class="batch-amount">{{ inventoryAmount(quantity) }} 件</span><span class="batch-amount">{{ inventoryAmount(weight) }} kg</span></span>
    <ElButton text :disabled="!count" @click="$emit('clear')">清空</ElButton>
    <span class="batch-selection-hint">跨页保留勾选 · 最多 100 批</span>
    <slot />
  </div>
</template>

<style scoped>
.batch-selection-bar { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; padding: 10px 14px; margin-bottom: 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--el-color-primary-light-9); }
.batch-selection-total { color: var(--text); font-size: 14px; font-variant-numeric: tabular-nums; }
.batch-selection-total strong { color: var(--el-color-primary); font-size: 16px; }
.batch-amount { padding-left: 16px; }
.batch-selection-hint { font-size: 12px; color: var(--muted); margin-left: auto; }
.batch-selection-bar :deep(.el-button) { margin-left: 0; }
@media (max-width: 760px) { .batch-selection-hint { margin-left: 0; } }
</style>
