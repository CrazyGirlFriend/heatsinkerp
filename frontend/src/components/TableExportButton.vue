<script setup lang="ts">
import { ref, watch } from 'vue'
import { Download } from '@element-plus/icons-vue'
import { ElButton } from 'element-plus'
import TableExportDialog from './TableExportDialog.vue'
import { useAuthStore } from '@/stores/auth'
import type { TableExportSource } from '@/utils/tableExport'

const props = defineProps<{
  source: () => TableExportSource | null
  disabled?: boolean
  context?: unknown
  appendTo?: HTMLElement
}>()
const auth = useAuthStore()
const taskSource = ref<TableExportSource | null>(null)
watch(
  () => [
    props.context,
    props.disabled,
    auth.currentUser?.id,
    auth.currentUser?.team_id,
    auth.currentUser?.role,
    auth.currentUser?.active,
    auth.currentUserError,
  ],
  () => {
    taskSource.value = null
  },
)
</script>

<template>
  <ElButton
    class="table-export-button action-cool"
    :icon="Download"
    :disabled="disabled"
    @click="taskSource = props.source()"
    >导出</ElButton
  >
  <TableExportDialog :source="taskSource" :append-to="appendTo" @close="taskSource = null" />
</template>
