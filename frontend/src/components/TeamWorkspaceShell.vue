<script setup lang="ts">
import { computed } from 'vue'
import { ArrowDown } from '@element-plus/icons-vue'
import { ElDropdown, ElDropdownItem, ElDropdownMenu, ElIcon } from 'element-plus'
import '@/styles/team-workspace.css'

const props = defineProps<{
  title: string
  modelValue: string
  pendingCount?: number | null
  warehouse?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const tabs = computed(() => [
  { value: 'stock', label: '库存明细' },
  { value: 'pending', label: '待接收', count: props.pendingCount },
  ...(props.warehouse ? [{ value: 'receipts', label: '入库记录' }] : []),
  { value: 'outgoing', label: '出库记录' },
  { value: 'losses', label: '丢失记录' },
  ...(!props.warehouse ? [{ value: 'materials', label: '材质归类' }] : []),
  { value: 'history', label: '收发历史' },
])
const statsSelected = computed(() => props.modelValue === 'materials')
const statsLabel = computed(() => props.modelValue === 'materials' ? '材质归类' : '统计')

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
    <h1 class="sr-only">{{ tabs.find(tab => tab.value === modelValue)?.label || (warehouse && statsSelected ? statsLabel : title) }}</h1>
    <div class="team-workspace__navigation">
      <div class="team-workspace__tabs" role="tablist" aria-label="班组物料工作区">
        <button v-for="(tab, index) in tabs" :id="`workspace-tab-${tab.value}`" :key="tab.value" type="button" role="tab" :aria-selected="modelValue === tab.value" :aria-controls="`workspace-panel-${tab.value}`" :tabindex="modelValue === tab.value || (warehouse && statsSelected && index === 0) ? 0 : -1" :class="{ 'is-selected': modelValue === tab.value }" @click="emit('update:modelValue', tab.value)" @keydown="changeTab($event, index)">
          <span>{{ tab.label }}</span><small v-if="tab.count">{{ tab.count }}</small>
        </button>
      </div>
      <ElDropdown v-if="warehouse" trigger="click" @command="emit('update:modelValue', $event)">
        <button class="workspace-statistics" :class="{ 'is-selected': statsSelected }" type="button" aria-label="库房统计"><span id="workspace-tab-statistics">{{ statsLabel }}</span><ElIcon><ArrowDown /></ElIcon></button>
        <template #dropdown><ElDropdownMenu><ElDropdownItem command="materials">材质归类</ElDropdownItem></ElDropdownMenu></template>
      </ElDropdown>
      <slot name="actions" />
    </div>
    <div :id="`workspace-panel-${modelValue}`" class="team-workspace__content" role="tabpanel" :aria-labelledby="warehouse && statsSelected ? 'workspace-tab-statistics' : `workspace-tab-${modelValue}`"><slot /></div>
    <slot name="dialogs" />
  </section>
</template>

<style scoped>
.team-workspace { gap: 0; padding: 12px 24px 20px; background: #fff; }
.team-workspace__navigation { display: flex; flex-shrink: 0; align-items: center; gap: 16px; padding-bottom: 12px; border-bottom: 1px solid var(--line); }
.team-workspace__navigation > :deep(.workspace-actions) { flex: 0 0 auto; }
.team-workspace__navigation:has(.workspace-statistics) .team-workspace__tabs { flex: 0 1 auto; }
.workspace-statistics { display: flex; align-items: center; gap: 8px; padding: 10px; border: 0; border-radius: 5px; background: transparent; font: inherit; font-size: 16px; color: var(--muted); cursor: pointer; white-space: nowrap; }
.workspace-statistics.is-selected { color: var(--primary); background: var(--surface-soft); box-shadow: inset 0 -2px var(--primary); }
.workspace-statistics:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
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
  .team-workspace__navigation:has(.workspace-statistics) { display: grid; grid-template-columns: auto 1fr; }
  .team-workspace__navigation:has(.workspace-statistics) .team-workspace__tabs { grid-column: 1 / -1; }
  .team-workspace__navigation:has(.workspace-statistics) > :deep(.workspace-actions) { width: auto; justify-content: flex-end; }
}
@media (prefers-reduced-motion: reduce) { .team-workspace__tabs button { transition: none; } }
</style>
