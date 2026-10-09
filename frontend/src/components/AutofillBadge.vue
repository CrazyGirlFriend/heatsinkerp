<script setup lang="ts">
import { ElTooltip } from 'element-plus'
defineProps<{ source: string }>()
</script>
<template>
  <ElTooltip
    v-if="source"
    :content="`资料来自批次 ${source}，可修改`"
    :trigger="['hover', 'focus']"
    placement="top"
    ><span class="autofill-badge" tabindex="0">已带入</span></ElTooltip
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
</style>
