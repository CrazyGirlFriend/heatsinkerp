<script setup lang="ts">
import { ElTooltip } from 'element-plus'
import { IconFileText, IconPencil } from '@tabler/icons-vue'
defineProps<{ source: string; kind?: 'document'; modified?: boolean }>()
</script>
<template>
  <ElTooltip
    v-if="source"
    :content="
      kind === 'document'
        ? `来自工艺单 ${source}，可修改并与原文对照`
        : `资料来自批次 ${source}，可修改`
    "
    :trigger="['hover', 'focus']"
    placement="top"
    ><span
      class="autofill-badge"
      :class="{
        'autofill-badge--modified': modified,
        'autofill-badge--document': kind === 'document',
      }"
      tabindex="0"
      ><IconPencil
        v-if="kind === 'document' && modified"
        :size="12"
        stroke="1.7"
        aria-hidden="true"
      />
      <IconFileText v-else-if="kind === 'document'" :size="12" stroke="1.7" aria-hidden="true" />
      {{ modified ? '已修改' : kind === 'document' ? '文件带入' : '已带入' }}</span
    ></ElTooltip
  >
</template>
<style scoped>
.autofill-badge {
  margin-left: 8px;
  padding: 2px 6px;
  border: 1px solid #c9e4dd;
  border-radius: 5px;
  background: #eef8f4;
  color: #296c5e;
  font-size: 11px;
  font-weight: 500;
  line-height: 16px;
  cursor: help;
}
.autofill-badge--modified {
  border-color: var(--el-color-warning-light-5);
  background: var(--el-color-warning-light-9);
  color: var(--el-color-warning-dark-2);
}
.autofill-badge--document {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--muted);
  vertical-align: middle;
}
.autofill-badge--document.autofill-badge--modified {
  color: color-mix(in srgb, var(--danger) 55%, var(--action-warm));
}
.autofill-badge--document svg {
  flex-shrink: 0;
}
</style>
