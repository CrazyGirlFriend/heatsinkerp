<script setup lang="ts">
import AppDialog from '@/components/AppDialog.vue'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  ElAlert,
  ElButton,
  ElCheckbox,
  ElCheckboxGroup,
  ElRadioGroup,
  ElRadioButton,
} from 'element-plus'
import {
  assertExportSize,
  createExportWorkbook,
  downloadExportWorkbook,
  type TableExportSource,
} from '@/utils/tableExport'

const props = defineProps<{
  source: TableExportSource | null
  variants?: TableExportSource[]
  appendTo?: HTMLElement
}>()
const variant = ref(0)
const sources = computed(() => (props.source ? [props.source, ...(props.variants || [])] : []))
const activeSource = computed(() => sources.value[variant.value] || null)
watch(
  () => props.source,
  () => {
    variant.value = 0
  },
)
const emit = defineEmits<{ close: [] }>()
const selected = ref<string[]>([]),
  busy = ref(false),
  error = ref(''),
  loaded = ref(0),
  total = ref(0)
const allSelected = computed(() => selected.value.length === activeSource.value?.fields.length)
let controller: AbortController | undefined
function cancel() {
  controller?.abort()
  controller = undefined
  busy.value = false
}
function selectAll(value: boolean) {
  selected.value = value ? activeSource.value?.fields.map((field) => field.key) || [] : []
}
watch(
  activeSource,
  (source) => {
    cancel()
    error.value = ''
    loaded.value = 0
    total.value = source?.total || 0
    selected.value =
      source?.fields.filter((field) => field.selected !== false).map((field) => field.key) || []
  },
  { immediate: true },
)
async function exportFile() {
  const selectedSource = activeSource.value
  if (!selectedSource || busy.value || !selected.value.length) return
  const fields = selectedSource.fields.filter((field) => selected.value.includes(field.key))
  const task = new AbortController()
  controller = task
  busy.value = true
  error.value = ''
  try {
    assertExportSize(selectedSource.total)
    const rows = await selectedSource.load(task.signal, (count, size) => {
      loaded.value = count
      total.value = size
    })
    task.signal.throwIfAborted()
    if (!rows.length) throw new Error('当前筛选没有记录可导出。')
    const blob = await createExportWorkbook(fields, rows)
    task.signal.throwIfAborted()
    downloadExportWorkbook(blob, selectedSource.title)
    emit('close')
  } catch (e) {
    if (!task.signal.aborted) error.value = e instanceof Error ? e.message : '导出失败，请重试。'
  } finally {
    if (controller === task) {
      controller = undefined
      busy.value = false
    }
  }
}
function close() {
  cancel()
  emit('close')
}
onBeforeUnmount(cancel)
</script>

<template>
  <AppDialog
    :model-value="Boolean(activeSource)"
    title="导出数据"
    width="560px"
    class="table-export-dialog"
    append-to-body
    :append-to="appendTo || 'body'"
    :close-on-click-modal="false"
    @update:model-value="!$event && close()"
  >
    <template v-if="activeSource">
      <ElRadioGroup
        v-if="sources.length > 1"
        v-model="variant"
        class="export-variants"
        aria-label="导出内容"
        :disabled="busy"
      >
        <ElRadioButton v-for="(item, index) in sources" :key="item.title" :value="index">{{
          item.title
        }}</ElRadioButton>
      </ElRadioGroup>
      <div class="export-scope">
        <strong>{{ activeSource.title }}</strong
        ><span>当前筛选 · 全部 {{ total.toLocaleString('zh-CN') }} 条</span>
      </div>
      <div class="export-fields-heading">
        <strong>选择字段</strong
        ><ElCheckbox
          :model-value="allSelected"
          :indeterminate="selected.length > 0 && !allSelected"
          :disabled="busy"
          @update:model-value="selectAll(Boolean($event))"
          >全选</ElCheckbox
        >
      </div>
      <ElCheckboxGroup
        v-model="selected"
        class="export-fields"
        aria-label="导出字段"
        :disabled="busy"
        ><ElCheckbox v-for="field in activeSource.fields" :key="field.key" :value="field.key">{{
          field.label
        }}</ElCheckbox></ElCheckboxGroup
      >
      <p v-if="busy" class="export-progress" role="status">
        {{
          loaded === total
            ? '正在生成 Excel…'
            : `正在读取 ${loaded.toLocaleString('zh-CN')} / ${total.toLocaleString('zh-CN')} 条…`
        }}
      </p>
      <ElAlert v-if="error" :title="error" type="error" :closable="false" show-icon />
    </template>
    <template #footer
      ><span class="export-selected">已选 {{ selected.length }} 项</span
      ><ElButton @click="close">{{ busy ? '取消导出' : '取消' }}</ElButton
      ><ElButton
        class="action-warm"
        :loading="busy"
        :disabled="!selected.length || !total"
        @click="exportFile"
        >导出 Excel</ElButton
      ></template
    >
  </AppDialog>
</template>

<style>
.table-export-dialog.el-dialog {
  max-width: calc(100vw - 24px);
  max-height: calc(100dvh - max(32px, 16dvh));
  margin-top: max(16px, 8dvh);
  display: flex;
  flex-direction: column;
}
.table-export-dialog .el-dialog__body {
  min-height: 0;
  overflow-y: auto;
}
.table-export-dialog .el-dialog__footer {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.table-export-dialog .el-dialog__footer .el-button {
  margin: 0;
}
.export-variants {
  margin-bottom: 14px;
}
.export-scope {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 14px;
  border-radius: 8px;
  background: var(--surface-soft);
}
.export-scope span,
.export-selected,
.export-progress {
  color: var(--muted);
  font-size: 13px;
}
.export-fields-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 12px 0 4px;
}
.export-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px 12px;
}
.export-fields .el-checkbox {
  min-width: 0;
  margin: 0;
  height: auto;
  min-height: 36px;
}
.export-fields .el-checkbox__label {
  white-space: normal;
  overflow-wrap: anywhere;
}
.export-selected {
  margin-right: auto;
}
.export-progress {
  margin-bottom: 0;
}
@media (max-width: 420px) {
  .export-fields {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
