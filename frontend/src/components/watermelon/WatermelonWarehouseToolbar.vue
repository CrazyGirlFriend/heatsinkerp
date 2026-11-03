<script setup lang="ts">
import { computed, inject, provide } from 'vue'
import WorkspaceTools from '../WorkspaceTools.vue'
import { workspaceToolsKey, workspaceToolbarExportKey } from '@/utils/workspaceTools'
import WatermelonFilter from './WatermelonFilter.vue'
import WatermelonSegmented from './WatermelonSegmented.vue'
import WatermelonSearch from './WatermelonSearch.vue'
import WatermelonButton from './WatermelonButton.vue'
import {
  IconRefresh,
  IconBox,
  IconLayoutGrid,
  IconClock,
  IconLock,
  IconCircleOff,
} from '@tabler/icons-vue'
import type { WarehouseLocationFilter } from '@/services/warehouseLocationApi'

const props = defineProps<{
  loading?: boolean
  state?: WarehouseLocationFilter
  section: 'locations' | 'unassigned'
  showUnassigned?: boolean
}>()
const query = defineModel<string>({ default: '' })
const workspace = inject(workspaceToolsKey, null)
if (workspace?.registerExport) provide(workspaceToolbarExportKey, workspace.registerExport)
const emit = defineEmits<{
  search: []
  refresh: []
  reset: []
  state: [value: WarehouseLocationFilter | undefined]
  section: [value: 'locations' | 'unassigned']
}>()
const stateOptions = [
  { value: '', label: '全部仓位', icon: IconLayoutGrid, color: '#6b7280' },
  { value: 'occupied', label: '有料', icon: IconBox, color: '#24896d' },
  { value: 'available', label: '空闲', icon: IconLayoutGrid, color: '#89939e' },
  { value: 'pending', label: '待签收', icon: IconClock, color: '#397fba' },
  { value: 'draft', label: '填写中', icon: IconLock, color: '#b28030' },
  { value: 'disabled', label: '停用', icon: IconCircleOff, color: '#8d8793' },
]
const sectionOptions = computed(() => [
  { value: 'locations', label: '仓位总览', icon: IconLayoutGrid },
  ...(props.showUnassigned ? [{ value: 'unassigned', label: '未分配仓位', icon: IconBox }] : []),
])
function changeState(value: string) {
  emit('state', (value || undefined) as WarehouseLocationFilter | undefined)
}
function changeSection(value: string) {
  emit('section', value as 'locations' | 'unassigned')
}
</script>

<template>
  <div class="wm-warehouse-toolbar">
    <div class="wm-warehouse-heading">
      <WatermelonSegmented
        :model-value="section"
        :options="sectionOptions"
        label="仓位视图"
        @update:model-value="changeSection"
      />
    </div>
    <form class="wm-warehouse-actions" role="search" @submit.prevent="emit('search')">
      <template v-if="section === 'locations'">
        <WatermelonSearch
          v-model="query"
          class="wm-warehouse-search"
          label="搜索仓位"
          placeholder="仓位、流水号或材质"
          :maxlength="80"
          @search="emit('search')"
        />
        <WatermelonFilter
          :model-value="state || ''"
          :options="stateOptions"
          label="筛选"
          title="仓位状态"
          @update:model-value="changeState"
        />
        <WatermelonButton
          class="wm-refresh"
          aria-label="刷新仓位"
          title="刷新仓位"
          :loading="loading"
          @click="emit('refresh')"
          ><IconRefresh v-if="!loading" :size="17"
        /></WatermelonButton>
        <WatermelonButton v-if="state || query" class="wm-reset" @click="emit('reset')">
          重置
        </WatermelonButton>
      </template>
      <div class="wm-warehouse-tools">
        <slot name="tools" />
        <WorkspaceTools
          ><template #actions><slot name="actions" /></template
        ></WorkspaceTools>
        <slot name="primary-actions" />
      </div>
    </form>
  </div>
</template>

<style>
.wm-warehouse-toolbar {
  color: #202326;
  flex: 0 0 auto;
}
.wm-warehouse-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.wm-warehouse-actions {
  display: flex;
  align-items: center;
  gap: 9px;
}
.wm-warehouse-search {
  flex: 0 1 340px;
  min-width: 150px;
}
.wm-warehouse-actions .wm-refresh {
  width: 36px;
  padding: 0;
}
.wm-warehouse-actions .wm-reset {
  background: transparent;
  border: 0;
  padding-inline: 5px;
}
.wm-warehouse-tools {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}
@media (max-width: 850px) {
  .wm-warehouse-actions {
    flex-wrap: wrap;
  }
  .wm-warehouse-search {
    flex: 1 1 220px;
  }
}
</style>
