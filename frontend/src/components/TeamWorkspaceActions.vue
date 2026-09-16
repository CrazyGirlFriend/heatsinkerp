<script setup lang="ts">
import { FullScreen, Plus, Refresh } from '@element-plus/icons-vue'
import { ElButton, ElTag } from 'element-plus'
withDefaults(defineProps<{ canWrite: boolean; canReceive: boolean; openingReceipt: boolean; openingDispatch: boolean; loading: boolean; showScan?: boolean }>(), { showScan: true })
const emit = defineEmits<{ dispatch: []; receipt: []; scan: []; refresh: [] }>()
</script>

<template>
  <div class="workspace-actions" role="group" aria-label="班组操作">
    <ElTag v-if="!canWrite" type="info" effect="plain" size="small">仅查看</ElTag>
    <ElButton v-if="canReceive" :loading="openingReceipt" @click="emit('receipt')">手工入库</ElButton>
    <ElButton v-if="canWrite" type="primary" :icon="Plus" :loading="openingDispatch" @click="emit('dispatch')">新建出库</ElButton>
    <ElButton v-if="showScan" :icon="FullScreen" @click="emit('scan')">扫码查询</ElButton>
    <ElButton :icon="Refresh" :loading="loading" text aria-label="刷新工作台" title="刷新" @click="emit('refresh')" />
  </div>
</template>

<style scoped>
.workspace-actions { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 8px; margin-left: auto; }
.workspace-actions :deep(.el-button + .el-button) { margin-left: 0; }
@media (max-width: 760px) { .workspace-actions { width: 100%; justify-content: flex-start; } }
</style>
