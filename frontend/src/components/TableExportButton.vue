<script setup lang="ts">
import { inject, onBeforeUnmount, ref, watch, watchEffect } from 'vue'
import { Download } from '@element-plus/icons-vue'
import { ElButton } from 'element-plus'
import TableExportDialog from './TableExportDialog.vue'
import { useAuthStore } from '@/stores/auth'
import type { TableExportSource } from '@/utils/tableExport'
import { workspaceToolbarExportKey } from '@/utils/workspaceTools'

const props = defineProps<{
  source: () => TableExportSource | null
  variants?: () => TableExportSource[]
  disabled?: boolean
  context?: unknown
  appendTo?: HTMLElement
  text?: boolean
}>()
const emit = defineEmits<{ 'visible-change': [value: boolean] }>()
const auth = useAuthStore()
const headerExport = inject(workspaceToolbarExportKey, null)
const exportOwner = Symbol('tableExport')
watchEffect(() => {
  headerExport?.(exportOwner, { open, disabled: !!props.disabled })
})
onBeforeUnmount(() => {
  headerExport?.(exportOwner, null)
})
const taskSource = ref<TableExportSource | null>(null)
const taskVariants = ref<TableExportSource[]>([])
watch(taskSource, (source) => emit('visible-change', source !== null))
function open() {
  taskSource.value = props.source()
  taskVariants.value = props.variants?.() || []
}
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
    taskVariants.value = []
  },
)
</script>

<template>
  <ElButton
    v-if="!headerExport"
    class="table-export-button action-warm"
    :icon="Download"
    :text="text"
    :disabled="disabled"
    @click="open"
    >导出</ElButton
  >
  <TableExportDialog
    :source="taskSource"
    :variants="taskVariants"
    :append-to="appendTo"
    @close="taskSource = null"
  />
</template>
