<script setup lang="ts">
defineProps<{ title?: string }>()
</script>

<template>
  <section class="compact-form-section" :aria-label="title">
    <header v-if="title || $slots.actions" class="compact-form-section-heading">
      <h3 v-if="title">{{ title }}</h3>
      <div v-if="$slots.actions" class="compact-form-section-actions"><slot name="actions" /></div>
    </header>
    <div class="compact-form-grid"><slot /></div>
  </section>
</template>

<style scoped>
.compact-form-section {
  min-width: 0;
  padding-block: 14px;
  border-bottom: 1px solid var(--line);
}
.compact-form-section:first-child {
  padding-top: 0;
}
.compact-form-section:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}
.compact-form-section-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  margin-bottom: 10px;
}
.compact-form-section-heading h3 {
  margin: 0;
  font-size: 14px;
  line-height: 20px;
  font-weight: 600;
  color: var(--text);
}
.compact-form-section-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}
.compact-form-grid {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  align-items: start;
  gap: var(--form-field-gap, 10px 14px);
  min-width: 0;
}
.compact-form-grid > :deep(*) {
  grid-column: span 4;
  min-width: 0;
}
.compact-form-grid > :deep(.el-form-item) {
  margin-bottom: 0;
}
.compact-form-grid > :deep(.form-field--short) {
  grid-column: span 2;
}
.compact-form-grid > :deep(.form-field--medium) {
  grid-column: span 3;
}
.compact-form-grid > :deep(.form-field--long),
.compact-form-grid > :deep(.form-field--group) {
  grid-column: span 6;
}
.compact-form-grid > :deep(.form-field--full) {
  grid-column: 1 / -1;
}
@container form-fields (max-width: 720px) {
  .compact-form-grid > :deep(*),
  .compact-form-grid > :deep(.form-field--medium),
  .compact-form-grid > :deep(.form-field--long) {
    grid-column: span 6;
  }
  .compact-form-grid > :deep(.form-field--short) {
    grid-column: span 3;
  }
  .compact-form-grid > :deep(.form-field--full),
  .compact-form-grid > :deep(.form-field--group) {
    grid-column: 1 / -1;
  }
}
@container form-fields (max-width: 420px) {
  .compact-form-grid > :deep(*),
  .compact-form-grid > :deep(.form-field--medium),
  .compact-form-grid > :deep(.form-field--long) {
    grid-column: 1 / -1;
  }
  .compact-form-grid > :deep(.form-field--short) {
    grid-column: span 6;
  }
}
</style>
