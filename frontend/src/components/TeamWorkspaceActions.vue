<script setup lang="ts">
import { FullScreen, Plus, Refresh } from '@element-plus/icons-vue'
import ElButton from '@/components/AppButton.vue'
import WatermelonButton from './watermelon/WatermelonButton.vue'
import { IconPlus, IconQrcode, IconRefresh } from '@tabler/icons-vue'
import { useWatermelonAppearance } from '@/composables/useWorkspaceAppearance'
import { computed } from 'vue'
import type { TeamWorkspaceSection } from '@/config/teamWorkspaces'
const watermelon = useWatermelonAppearance()
const props = withDefaults(
  defineProps<{
    section: TeamWorkspaceSection
    canWrite: boolean
    canReceive: boolean
    canReallocate?: boolean
    openingReceipt: boolean
    openingDispatch: boolean
    loading: boolean
    showScan?: boolean
    showRefresh?: boolean
    warehouse?: boolean
  }>(),
  { showScan: true, showRefresh: true },
)
const emit = defineEmits<{
  dispatch: []
  receipt: []
  scan: []
  loss: []
  reallocate: []
  refresh: []
}>()
const receiptVisible = computed(
  () => props.canReceive && ['stock', 'receipts'].includes(props.section),
)
const dispatchVisible = computed(
  () => props.canWrite && ['stock', 'outgoing'].includes(props.section),
)
const scanVisible = computed(() => props.canWrite && props.showScan && props.section === 'stock')
const lossVisible = computed(() => props.canWrite && props.section === 'losses')
const reallocationVisible = computed(() => props.canReallocate && props.section === 'reallocations')
</script>

<template>
  <div
    v-if="
      receiptVisible ||
      dispatchVisible ||
      scanVisible ||
      lossVisible ||
      reallocationVisible ||
      showRefresh
    "
    class="workspace-actions"
    role="group"
    aria-label="班组操作"
  >
    <template v-if="watermelon">
      <WatermelonButton
        v-if="receiptVisible"
        :primary="warehouse"
        :loading="openingReceipt"
        @click="emit('receipt')"
      >
        <IconPlus :size="17" />{{ warehouse ? '新建入库' : '手工入库' }}
      </WatermelonButton>
      <WatermelonButton
        v-if="dispatchVisible"
        :primary="!receiptVisible"
        :loading="openingDispatch"
        @click="emit('dispatch')"
      >
        <IconPlus :size="17" />新建出库
      </WatermelonButton>
      <WatermelonButton v-if="scanVisible" @click="emit('scan')"
        ><IconQrcode :size="17" />扫码入库</WatermelonButton
      >
      <WatermelonButton v-if="lossVisible" primary :loading="openingDispatch" @click="emit('loss')">
        <IconPlus :size="17" />登记丢失
      </WatermelonButton>
      <WatermelonButton
        v-if="reallocationVisible"
        primary
        :loading="openingDispatch"
        @click="emit('reallocate')"
      >
        <IconPlus :size="17" />新建转投
      </WatermelonButton>
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
        v-if="receiptVisible"
        :type="warehouse ? 'primary' : 'default'"
        :icon="warehouse ? Plus : undefined"
        :loading="openingReceipt"
        @click="emit('receipt')"
        >{{ warehouse ? '新建入库' : '手工入库' }}</ElButton
      >
      <ElButton
        v-if="dispatchVisible"
        :type="receiptVisible ? 'default' : 'primary'"
        :icon="Plus"
        :loading="openingDispatch"
        @click="emit('dispatch')"
        >新建出库</ElButton
      >
      <ElButton v-if="scanVisible" class="action-cool" :icon="FullScreen" @click="emit('scan')"
        >扫码入库</ElButton
      >
      <ElButton
        v-if="lossVisible"
        type="primary"
        :icon="Plus"
        :loading="openingDispatch"
        @click="emit('loss')"
        >登记丢失</ElButton
      >
      <ElButton
        v-if="reallocationVisible"
        type="primary"
        :icon="Plus"
        :loading="openingDispatch"
        @click="emit('reallocate')"
        >新建转投</ElButton
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
