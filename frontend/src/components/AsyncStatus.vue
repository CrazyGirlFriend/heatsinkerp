<script setup lang="ts">
import { IconCircleCheck, IconAlertCircle, IconLoader2 } from '@tabler/icons-vue'
import { useWatermelonAppearance } from '@/composables/useWorkspaceAppearance'
const themed = useWatermelonAppearance()
withDefaults(defineProps<{ state?: 'loading' | 'success' | 'error'; label: string }>(), {
  state: 'loading',
})
</script>
<template>
  <div
    class="async-status"
    :class="[state, { 'wm-async-status': themed }]"
    :role="state === 'error' ? 'alert' : 'status'"
    :aria-busy="state === 'loading'"
  >
    <component
      :is="
        state === 'loading' ? IconLoader2 : state === 'success' ? IconCircleCheck : IconAlertCircle
      "
      :size="17"
      aria-hidden="true"
    />
    <span>{{ label }}</span
    ><slot />
    <span v-if="state === 'loading'" class="async-status-track" aria-hidden="true" />
  </div>
</template>
<style scoped>
.async-status {
  display: flex;
  align-items: center;
  position: relative;
  gap: 8px;
  padding: 10px 12px;
  overflow: hidden;
  color: var(--muted);
  font-size: 13px;
}
.async-status span {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.async-status svg {
  flex-shrink: 0;
}
</style>
