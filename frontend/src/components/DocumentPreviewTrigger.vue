<script setup lang="ts">
import { ref } from 'vue'
import { useControlFeedback } from '@/composables/useControlFeedback'
import { useWatermelonAppearance } from '@/composables/useWorkspaceAppearance'

defineProps<{ overlay?: boolean }>()
const trigger = ref<HTMLButtonElement>()
useControlFeedback(trigger, useWatermelonAppearance())
</script>

<template>
  <button
    ref="trigger"
    type="button"
    class="document-preview-trigger"
    :class="{ 'document-preview-trigger--overlay': overlay }"
  >
    <slot />
  </button>
</template>

<style scoped>
.document-preview-trigger {
  min-height: 0;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--wm-border, var(--line));
  border-radius: 10px;
  background: var(--wm-muted-surface, var(--surface));
  cursor: zoom-in;
  transition: border-color 140ms ease;
}
.document-preview-trigger--overlay {
  position: absolute;
  inset: 0;
  background: transparent;
}
.document-preview-trigger:hover,
.document-preview-trigger:focus-visible {
  outline: 2px solid var(--wm-focus-ring, var(--primary));
  outline-offset: 2px;
}
@media (prefers-reduced-motion: reduce) {
  .document-preview-trigger {
    transition: none;
  }
}
</style>
