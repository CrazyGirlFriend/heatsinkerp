<script setup lang="ts">
import { FullScreen, Plus, Refresh, Setting } from '@element-plus/icons-vue'
import { ElButton } from 'element-plus'
withDefaults(defineProps<{ canWrite: boolean; canReceive: boolean; openingReceipt: boolean; openingDispatch: boolean; loading: boolean; showScan?: boolean; warehouse?: boolean }>(), { showScan: true })
const emit = defineEmits<{ dispatch: []; receipt: []; scan: []; refresh: []; settings: [] }>()
</script>

<template>
  <div class="workspace-actions" role="group" aria-label="班组操作">
    <ElButton v-if="canReceive" :type="warehouse ? 'primary' : 'default'" :icon="warehouse ? Plus : undefined" :loading="openingReceipt" @click="emit('receipt')">{{ warehouse ? '新建入库' : '手工入库' }}</ElButton>
    <ElButton v-if="canWrite" :type="warehouse ? 'default' : 'primary'" :icon="Plus" :loading="openingDispatch" @click="emit('dispatch')">新建出库</ElButton>
    <ElButton v-if="showScan" :icon="FullScreen" @click="emit('scan')">扫码查询</ElButton>
    <ElButton v-if="canWrite" :icon="Setting" text aria-label="班组设置" title="班组设置" @click="emit('settings')" />
    <ElButton :icon="Refresh" :loading="loading" text aria-label="刷新工作台" title="刷新" @click="emit('refresh')" />
  </div>
</template>

<style scoped>
.workspace-actions { display: flex; align-items: center; flex-shrink: 0; justify-content: flex-end; flex-wrap: wrap; gap: 8px; margin-left: auto; }
.workspace-actions :deep(.el-button + .el-button) { margin-left: 0; }
@media (max-width: 760px) { .workspace-actions { max-width: 100%; justify-content: flex-start; margin-left: 0; } }
</style>
