<script setup lang="ts">
import { FullScreen, Plus, Refresh } from '@element-plus/icons-vue'
import ElButton from '@/components/AppButton.vue'
import WatermelonButton from './watermelon/WatermelonButton.vue'
import { IconPlus, IconQrcode, IconRefresh } from '@tabler/icons-vue'
import { useWatermelonAppearance } from '@/composables/useWorkspaceAppearance'
const watermelon = useWatermelonAppearance()
withDefaults(
  defineProps<{
    canWrite: boolean
    canReceive: boolean
    openingReceipt: boolean
    openingDispatch: boolean
    loading: boolean
    showScan?: boolean
    showRefresh?: boolean
    warehouse?: boolean
  }>(),
  { showScan: true, showRefresh: true },
)
const emit = defineEmits<{ dispatch: []; receipt: []; scan: []; refresh: [] }>()
</script>

<template>
  <div
    v-if="canWrite || canReceive || showRefresh"
    class="workspace-actions"
    role="group"
    aria-label="班组操作"
  >
    <template v-if="watermelon">
      <WatermelonButton
        v-if="canReceive"
        :primary="warehouse"
        :loading="openingReceipt"
        @click="emit('receipt')"
      >
        <IconPlus :size="17" />{{ warehouse ? '新建入库' : '手工入库' }}
      </WatermelonButton>
      <WatermelonButton
        v-if="canWrite"
        :primary="!warehouse"
        :loading="openingDispatch"
        @click="emit('dispatch')"
      >
        <IconPlus :size="17" />新建出库
      </WatermelonButton>
      <WatermelonButton v-if="canWrite && showScan" @click="emit('scan')"
        ><IconQrcode :size="17" />扫码入库</WatermelonButton
      >
      <WatermelonButton
        v-if="showRefresh"
        :loading="loading"
        aria-label="刷新工作台"
        @click="emit('refresh')"
        ><IconRefresh :size="17"
      /></WatermelonButton>
    </template>
    <template v-else>
      <ElButton
        v-if="canReceive"
        :type="warehouse ? 'primary' : 'default'"
        :icon="warehouse ? Plus : undefined"
        :loading="openingReceipt"
        @click="emit('receipt')"
        >{{ warehouse ? '新建入库' : '手工入库' }}</ElButton
      >
      <ElButton
        v-if="canWrite"
        :type="warehouse ? 'default' : 'primary'"
        :icon="Plus"
        :loading="openingDispatch"
        @click="emit('dispatch')"
        >新建出库</ElButton
      >
      <ElButton
        v-if="canWrite && showScan"
        class="action-cool"
        :icon="FullScreen"
        @click="emit('scan')"
        >扫码入库</ElButton
      >
      <ElButton
        v-if="showRefresh"
        class="workspace-refresh"
        :icon="Refresh"
        :loading="loading"
        aria-label="刷新工作台"
        title="刷新"
        @click="emit('refresh')"
        >刷新</ElButton
      >
    </template>
  </div>
</template>

<style scoped>
.workspace-actions {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
  margin-left: auto;
}
.workspace-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}
.workspace-actions .workspace-refresh.el-button {
  width: var(--workspace-control-height);
  padding-inline: 0;
}
@media (max-width: 760px) {
  .workspace-actions {
    max-width: 100%;
    justify-content: flex-start;
    margin-left: 0;
  }
}
</style>
