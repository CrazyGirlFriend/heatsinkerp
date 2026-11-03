<script setup lang="ts">
import { inject, provide } from 'vue'
import { IconRefresh } from '@tabler/icons-vue'
import WorkspaceTools from '../WorkspaceTools.vue'
import { workspaceToolsKey, workspaceToolbarExportKey } from '@/utils/workspaceTools'
import WatermelonSearch from './WatermelonSearch.vue'
import WatermelonButton from './WatermelonButton.vue'

withDefaults(
  defineProps<{
    loading?: boolean
    label?: string
    placeholder?: string
    maxlength?: number | string
    searchable?: boolean
    searchOnClear?: boolean
    refresh?: boolean
    refreshLabel?: string
    columns?: boolean
  }>(),
  {
    label: '搜索',
    placeholder: '搜索',
    maxlength: 80,
    searchable: true,
    searchOnClear: true,
    refresh: true,
  },
)
const query = defineModel<string>({ default: '' })
const emit = defineEmits<{ search: []; refresh: []; columns: [anchor: HTMLElement] }>()
const workspace = inject(workspaceToolsKey, null)
if (workspace?.registerExport) provide(workspaceToolbarExportKey, workspace.registerExport)
</script>

<template>
  <form class="wm-data-toolbar" role="search" @submit.prevent="emit('search')">
    <slot name="leading" />
    <div v-if="searchable" class="wm-toolbar-search">
      <slot name="search">
        <WatermelonSearch
          v-model="query"
          :label="label"
          :placeholder="placeholder"
          :maxlength="maxlength"
          :search-on-clear="searchOnClear"
          @search="emit('search')"
        />
      </slot>
    </div>
    <slot name="filters" />
    <WatermelonButton
      v-if="refresh"
      class="wm-refresh"
      :aria-label="refreshLabel || `刷新${label.replace(/^搜索/, '')}`"
      title="刷新"
      :loading="loading"
      @click="emit('refresh')"
    >
      <IconRefresh v-if="!loading" :size="17" />
    </WatermelonButton>
    <div class="wm-toolbar-tools">
      <slot name="tools" />
      <slot name="status" />
      <WorkspaceTools :columns="columns" @columns="emit('columns', $event)" />
      <slot name="actions" />
      <slot name="primary-actions" />
    </div>
  </form>
</template>

<style>
.wm-data-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  flex: 0 0 auto;
  min-width: 0;
}
.wm-data-toolbar > .wm-toolbar-search {
  display: flex;
  gap: 8px;
  flex: 0 1 360px;
  min-width: 140px;
}
.wm-toolbar-search > :is(.wm-search, .el-input, .el-select, .el-date-editor) {
  flex: 1;
  min-width: 0;
  width: 100%;
}
.wm-toolbar-search > .numeric-operator {
  flex: 0 0 90px;
}
.wm-data-toolbar .wm-filter-trigger {
  height: 40px;
  border-color: var(--wm-control-border, #e4e4e7);
  border-radius: 8px;
  background: var(--wm-control-bg, #fff);
  color: var(--wm-control-text, #27272a);
  font-size: 14px;
  font-weight: 500;
  box-shadow: none;
}
.wm-data-toolbar .wm-filter-trigger:hover {
  background: var(--wm-control-hover-bg, #f4f4f5);
  box-shadow: none;
}
.wm-data-toolbar .wm-filter-trigger.active {
  border-color: var(--wm-filter-active-border, #b9d8cd);
  background: var(--wm-filter-active-bg, #f3faf7);
  color: var(--wm-filter-active-text, #247960);
}
.wm-data-toolbar .wm-refresh {
  width: 40px;
  flex: 0 0 40px;
  padding: 0;
}
.wm-toolbar-tools {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  min-width: 0;
  max-width: 100%;
  margin-left: auto;
}
.wm-toolbar-tools .workspace-actions {
  max-width: 100%;
}
.wm-toolbar-tools .el-button {
  height: 40px;
  margin: 0;
  padding-inline: 12px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  box-shadow: none;
  font-size: 14px;
  font-weight: 500;
  color: var(--wm-control-text, #27272a);
}
.wm-toolbar-tools .el-button:hover:not(:disabled) {
  background: var(--wm-control-hover-bg, #f4f4f5);
}
.wm-toolbar-tools .el-button::before,
.wm-toolbar-tools .el-button::after {
  display: none;
}
@media (max-width: 850px) {
  .wm-data-toolbar > .wm-toolbar-search {
    flex: 1 1 220px;
  }
}
</style>
