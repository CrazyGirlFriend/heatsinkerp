<script setup lang="ts">
import { Refresh, Search } from '@element-plus/icons-vue'
import { ElButton, ElInput } from 'element-plus'
import WorkspaceTools from './WorkspaceTools.vue'
import { inject, provide } from 'vue'
import { workspaceToolsKey, workspaceToolbarExportKey } from '@/utils/workspaceTools'

const workspace = inject(workspaceToolsKey, null)
if (workspace?.registerExport) provide(workspaceToolbarExportKey, workspace.registerExport)

withDefaults(
  defineProps<{
    searchLabel?: string
    placeholder?: string
    maxlength?: number | string
    searchable?: boolean
    searchOnClear?: boolean
    loading?: boolean
    refresh?: boolean
    refreshLabel?: string
    columns?: boolean
  }>(),
  { searchable: true, searchOnClear: true, refresh: true, refreshLabel: '刷新工作台' },
)
const query = defineModel<string>({ default: '' })
const emit = defineEmits<{ search: []; refresh: []; columns: [anchor: HTMLElement] }>()
</script>

<template>
  <form
    class="workspace-data-toolbar workspace-toolbar"
    role="search"
    @submit.prevent="emit('search')"
  >
    <slot name="leading" />
    <div v-if="searchable" class="workspace-toolbar__search">
      <slot name="search">
        <ElInput
          v-model="query"
          :prefix-icon="Search"
          :aria-label="searchLabel || '搜索'"
          :placeholder="placeholder"
          :maxlength="maxlength"
          clearable
          @keydown.enter.prevent
          @keyup.enter="emit('search')"
          @clear="searchOnClear && emit('search')"
        />
      </slot>
    </div>
    <slot name="filters" />
    <div class="workspace-toolbar__query-actions">
      <ElButton
        v-if="searchable"
        class="workspace-query action-warm"
        :loading="loading"
        @click="emit('search')"
        >查询</ElButton
      >
      <ElButton
        v-if="refresh"
        :icon="Refresh"
        :loading="loading"
        :aria-label="refreshLabel"
        title="刷新"
        @click="emit('refresh')"
      />
    </div>
    <slot name="tools" />
    <slot name="status" />
    <WorkspaceTools :columns="columns" @columns="emit('columns', $event)">
      <template v-if="$slots.actions" #actions><slot name="actions" /></template>
    </WorkspaceTools>
    <slot name="primary-actions" />
  </form>
</template>

<style scoped>
form.workspace-toolbar.workspace-data-toolbar {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  flex-wrap: nowrap;
  gap: 8px;
  min-width: 0;
  margin: 0;
  /* Keep the hover lift and focus ring inside bounded workspace panels. */
  padding: 6px 8px;
  border: 1px solid var(--glass-border);
  border-radius: 12px;
  background: var(--glass-chrome-fill);
  box-shadow: var(--glass-shadow);
}
.workspace-toolbar__search {
  display: flex;
  flex: 0 1 400px;
  gap: 8px;
  min-width: min(180px, 100%);
  max-width: 400px;
}
.workspace-toolbar__search > :deep(.el-input),
.workspace-toolbar__search > :deep(.el-select),
.workspace-toolbar__search > :deep(.el-date-editor) {
  flex: 1;
  min-width: 0;
  width: 100%;
}
.workspace-toolbar__search > :deep(.numeric-operator) {
  flex: 0 0 96px;
}
.workspace-toolbar__query-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 8px;
}
.workspace-toolbar :deep(.el-button:not(.is-link)) {
  height: 38px;
  margin: 0;
  border-radius: 11px;
  font-size: 13px;
}
.workspace-toolbar__query-actions > .el-button:last-child:not(.workspace-query) {
  width: 38px;
  padding: 0;
}
.workspace-toolbar__search :deep(.el-input__wrapper),
.workspace-toolbar__search :deep(.el-select__wrapper) {
  min-height: 38px;
  font-size: 14px;
}
.workspace-toolbar > :deep(.live-refresh-notice) {
  align-self: center;
  margin-left: auto;
}
.workspace-toolbar > :deep(.workspace-tools) {
  margin-left: auto;
}
@media (max-width: 640px) {
  form.workspace-toolbar.workspace-data-toolbar {
    flex-wrap: wrap;
  }
  .workspace-toolbar__search {
    flex: 1 1 220px;
  }
}
@media (prefers-reduced-transparency: reduce), (prefers-contrast: more) {
  form.workspace-toolbar.workspace-data-toolbar {
    border-color: var(--line);
    background: var(--surface);
    box-shadow: none;
  }
}
</style>
