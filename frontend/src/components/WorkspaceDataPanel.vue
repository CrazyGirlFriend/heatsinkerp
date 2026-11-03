<script setup lang="ts">
import { useWatermelonAppearance } from '@/composables/useWorkspaceAppearance'
const watermelon = useWatermelonAppearance()
</script>
<template>
  <section class="workspace-data-panel" :class="{ 'wm-data-panel': watermelon }"><slot /></section>
</template>

<style scoped>
.workspace-data-panel {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 0;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
}
.workspace-data-panel > :deep(form.workspace-data-toolbar.workspace-toolbar) {
  flex-shrink: 0;
  margin-bottom: 10px;
}
.workspace-data-panel > :deep(.state-panel) {
  flex: 1;
  min-height: 0;
}
</style>
