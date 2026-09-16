<script setup lang="ts">
import { computed } from 'vue'
import '@/styles/team-workspace.css'

const props = defineProps<{
  title: string
  modelValue: string
  pendingCount?: number | null
  warehouse?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const tabs = computed(() => [
  { value: 'serials', label: '流水号台账' },
  { value: 'pending', label: '待接收', count: props.pendingCount },
  { value: 'stock', label: '库存明细' },
  { value: 'outgoing', label: '出库记录' },
  ...(props.warehouse ? [{ value: 'receipts', label: '入库记录' }] : []),
  { value: 'losses', label: '丢失记录' },
  { value: 'materials', label: '材质归类' },
  { value: 'overview', label: '数据分析' },
])

function changeTab(event: KeyboardEvent, index: number): void {
  let next = index
  if (event.key === 'ArrowRight') next = (index + 1) % tabs.value.length
  else if (event.key === 'ArrowLeft') next = (index + tabs.value.length - 1) % tabs.value.length
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = tabs.value.length - 1
  else return
  event.preventDefault()
  emit('update:modelValue', tabs.value[next]!.value)
  ;(event.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus()
}
</script>

<template>
  <section class="page workspace-page team-workspace reading-workspace team-workspace--reading" :aria-label="title + '工作台'">
    <h1 class="sr-only">{{ tabs.find(tab => tab.value === modelValue)?.label || title }}</h1>
    <div class="team-workspace__navigation">
      <div class="team-workspace__tabs" role="tablist" aria-label="班组物料工作区">
        <button v-for="(tab, index) in tabs" :id="`workspace-tab-${tab.value}`" :key="tab.value" type="button" role="tab" :aria-selected="modelValue === tab.value" :aria-controls="`workspace-panel-${tab.value}`" :tabindex="modelValue === tab.value ? 0 : -1" :class="{ 'is-selected': modelValue === tab.value }" @click="emit('update:modelValue', tab.value)" @keydown="changeTab($event, index)">
          <span>{{ tab.label }}</span><small v-if="tab.count">{{ tab.count }}</small>
        </button>
      </div>
      <slot name="actions" />
    </div>
    <div :id="`workspace-panel-${modelValue}`" class="team-workspace__content" role="tabpanel" :aria-labelledby="`workspace-tab-${modelValue}`"><slot /></div>
    <slot name="dialogs" />
  </section>
</template>

<style scoped>
.team-workspace { gap: 0; padding: 12px 24px 20px; background: #fff; }
.team-workspace__navigation { display: flex; flex-shrink: 0; align-items: center; gap: 16px; padding-bottom: 12px; border-bottom: 1px solid var(--line); }
.team-workspace__navigation > :deep(.workspace-actions) { flex: 0 0 auto; }
.team-workspace__tabs { display: flex; flex: 1; min-width: 0; align-items: stretch; overflow-x: auto; gap: 4px; scrollbar-width: thin; }
.team-workspace__tabs button { display: flex; flex-shrink: 0; align-items: center; gap: 6px; padding: 10px; border: 1px solid transparent; border-radius: 5px; background: transparent; color: var(--muted); font: inherit; font-size: 16px; cursor: pointer; transition: background-color var(--motion-fast) ease, color var(--motion-fast) ease; }
.team-workspace__tabs button.is-selected { color: var(--primary); background: var(--surface-soft); box-shadow: inset 0 -2px var(--primary); font-weight: 500; }
.team-workspace__tabs button:not(.is-selected):hover { color: var(--text); background: var(--table-hover-bg); }
.team-workspace__tabs button:focus-visible { outline: 2px solid var(--primary); outline-offset: -4px; }
.team-workspace__tabs small { min-width: 20px; padding: 0 5px; border-radius: 4px; background: var(--table-header-bg); color: var(--muted); font-size: 14px; font-weight: 400; font-variant-numeric: tabular-nums; }
.team-workspace__tabs button.is-selected small { background: #fff; color: var(--primary); }
.team-workspace__content { display: flex; flex-direction: column; flex: 1; min-height: 0; min-width: 0; gap: 12px; overflow: hidden; overscroll-behavior: contain; scrollbar-width: thin; }
@media (max-width: 760px) {
  .team-workspace { padding: 12px; }
  .team-workspace__navigation { align-items: stretch; flex-direction: column; gap: 10px; }
  .team-workspace__tabs { flex: none; }
  .team-workspace__tabs button { padding: 8px 12px; }
}
@media (prefers-reduced-motion: reduce) { .team-workspace__tabs button { transition: none; } }
</style>
