<script setup lang="ts">
import { Plus, Refresh } from '@element-plus/icons-vue'
import ElButton from '@/components/AppButton.vue'
import { IconPlus, IconRefresh } from '@tabler/icons-vue'
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
    inspection?: boolean
    showRefresh?: boolean
    warehouse?: boolean
  }>(),
  { showRefresh: true },
)
const emit = defineEmits<{
  dispatch: []
  receipt: []
  shipment: []
  loss: []
  reallocate: []
  refresh: []
}>()
const receiptVisible = computed(() => props.canReceive && props.section === 'receipts')
const dispatchVisible = computed(
  () => props.canWrite && !props.warehouse && props.section === 'outgoing',
)
const lossVisible = computed(() => props.canWrite && props.section === 'losses')
const reallocationVisible = computed(() => props.canReallocate && props.section === 'reallocations')
</script>

<template>
  <div
    v-if="receiptVisible || dispatchVisible || lossVisible || reallocationVisible || showRefresh"
    class="workspace-actions"
    role="group"
    aria-label="班组操作"
  >
    <ElButton
      v-if="receiptVisible"
      :icon="!watermelon && warehouse ? Plus : undefined"
      :loading="openingReceipt"
      @click="emit('receipt')"
    >
      <IconPlus v-if="watermelon" :size="17" />{{ warehouse ? '新建入库' : '手工入库' }}
    </ElButton>
    <ElButton
      v-if="dispatchVisible"
      :icon="watermelon ? undefined : Plus"
      :loading="openingDispatch"
      @click="emit('dispatch')"
    >
      <IconPlus v-if="watermelon" :size="17" />新建出库
    </ElButton>
    <ElButton
      v-if="dispatchVisible && inspection"
      :loading="openingDispatch"
      @click="emit('shipment')"
    >
      汇总发货
    </ElButton>
    <ElButton
      v-if="lossVisible"
      :icon="watermelon ? undefined : Plus"
      :loading="openingDispatch"
      @click="emit('loss')"
    >
      <IconPlus v-if="watermelon" :size="17" />登记丢失
    </ElButton>
    <ElButton
      v-if="reallocationVisible"
      :icon="watermelon ? undefined : Plus"
      :loading="openingDispatch"
      @click="emit('reallocate')"
    >
      <IconPlus v-if="watermelon" :size="17" />新建转投
    </ElButton>
    <ElButton
      v-if="showRefresh"
      class="workspace-refresh"
      :icon="watermelon ? undefined : Refresh"
      :loading="loading"
      aria-label="刷新工作台"
      title="刷新"
      @click="emit('refresh')"
    >
      <IconRefresh v-if="watermelon" :size="17" /><template v-else>刷新</template>
    </ElButton>
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
