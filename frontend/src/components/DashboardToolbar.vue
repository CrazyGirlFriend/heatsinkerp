<script setup lang="ts">
import { formatDateTime } from '@/utils/format'
defineProps<{
  updatedAt?: string
  loading?: boolean
  inline?: boolean
}>()
</script>
<template>
  <header
    class="dashboard-toolbar"
    :class="{ 'dashboard-toolbar--inline': inline }"
    :aria-busy="loading"
  >
    <div class="dashboard-toolbar__filters">
      <slot name="heading" />
      <slot />
    </div>
    <div class="dashboard-toolbar__actions">
      <span v-if="updatedAt" class="dashboard-toolbar__updated"
        >{{ formatDateTime(updatedAt) }} 更新</span
      >
      <slot name="actions" />
    </div>
  </header>
</template>
<style scoped>
.dashboard-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px 20px;
  flex-wrap: wrap;
  padding: 12px 16px;
  border: 1px solid var(--wm-border);
  border-radius: 12px;
  background: var(--wm-bg);
}
.dashboard-toolbar__filters,
.dashboard-toolbar__actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  min-width: 0;
}
.dashboard-toolbar--inline {
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
}
.dashboard-toolbar__actions {
  margin-left: auto;
}
.dashboard-toolbar__updated {
  font-size: var(--font-size-meta);
  color: var(--wm-muted);
  white-space: nowrap;
}
@media (max-width: 1100px) {
  .dashboard-toolbar__updated {
    display: none;
  }
}
</style>
