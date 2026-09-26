<script setup lang="ts">
import { computed } from 'vue'
import { CircleCheck, Clock, Remove } from '@element-plus/icons-vue'
import { ElIcon, ElTag } from 'element-plus'
import { isExternalEntryKind, materialTransferStatusLabel, materialTransferStatusTone, type MaterialEntryKind, type MaterialTransferStatus } from '@/types/materialTransfer'
const props = withDefaults(defineProps<{ status: MaterialTransferStatus; entryKind?: MaterialEntryKind; plain?: boolean; outgoing?: boolean }>(), { plain: false })
const label = computed(() => props.outgoing && !isExternalEntryKind(props.entryKind) && ['pending', 'received'].includes(props.status) ? props.status === 'pending' ? '转出待签收' : '已签收' : materialTransferStatusLabel(props.status, props.entryKind))
</script>

<template>
  <span v-if="plain" class="transfer-status-text" :class="`transfer-status-text--${status}`">{{ label }}</span>
  <ElTag v-else class="transfer-status" :type="materialTransferStatusTone(status)" effect="light">
    <ElIcon><Clock v-if="status === 'pending'" /><CircleCheck v-else-if="status === 'received' || status === 'dispatched'" /><Remove v-else /></ElIcon>
    {{ label }}
  </ElTag>
</template>

<style scoped>
.transfer-status { font-size: 14px; }
.transfer-status :deep(.el-tag__content) { display: inline-flex; align-items: center; gap: 5px; }
.transfer-status .el-icon { font-size: 15px; }
.transfer-status-text { font-size: 15px; font-weight: 400; color: var(--subtle); }
.transfer-status-text--pending { color: #ad650b; }
.transfer-status-text--received, .transfer-status-text--dispatched { color: #3c8463; }
</style>
