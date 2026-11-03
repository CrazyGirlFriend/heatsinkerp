<script setup lang="ts">
import { Document } from '@element-plus/icons-vue'
import { ElIcon } from 'element-plus'
defineProps<{ title?: string; source?: string; filename?: string; missing?: string }>()
</script>

<template>
  <section class="document-card" :class="{ 'document-card--missing': missing }">
    <header v-if="title || source" class="document-card-heading">
      <strong v-if="title">{{ title }}</strong
      ><span v-if="source">{{ source }}</span>
    </header>
    <div v-if="missing" class="document-card-empty">
      <ElIcon><Document /></ElIcon><span>{{ missing }}</span>
    </div>
    <slot v-else />
    <span v-if="filename" class="document-card-filename" :title="filename">{{ filename }}</span>
    <div v-if="$slots.actions" class="document-card-actions"><slot name="actions" /></div>
  </section>
</template>

<style scoped>
.document-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 6px;
  padding: 8px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: #ffffffc9;
}
.document-card-heading,
.document-card-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.document-card-heading {
  justify-content: space-between;
  font-size: 12px;
  line-height: 18px;
}
.document-card-heading strong {
  font-weight: 500;
}
.document-card-heading span,
.document-card-filename {
  color: var(--muted);
  font-size: 11px;
}
.document-card-filename {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.document-card-actions :deep(.el-button) {
  margin: 0;
  font-size: 12px;
}
.document-card-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 72px;
  color: var(--muted);
  font-size: 12px;
}
.document-card-empty .el-icon {
  font-size: 22px;
}
.document-card--missing {
  border-style: dashed;
  background: #ffffff80;
}
@media (max-width: 760px) {
  .document-card {
    flex: 0 0 160px;
  }
}
</style>
