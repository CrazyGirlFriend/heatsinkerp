<script setup lang="ts">
import { formatDateTime } from '@/utils/format'
defineProps<{ updatedAt?: string; loading?: boolean }>()
</script>
<template>
  <header class="dashboard-toolbar" :aria-busy="loading">
    <div class="dashboard-toolbar__filters"><slot /></div>
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
.dashboard-toolbar__actions {
  margin-left: auto;
}
.dashboard-toolbar__updated {
  font-size: 11px;
  color: var(--wm-muted);
  white-space: nowrap;
}
@media (max-width: 1100px) {
  .dashboard-toolbar__updated {
    display: none;
  }
}
</style>
