<script setup lang="ts">
import { useId } from 'vue'
import { IconChevronDown } from '@tabler/icons-vue'
import AppButton from './AppButton.vue'

const open = defineModel<boolean>('open', { default: false })
const id = useId()
</script>

<template>
  <section class="app-disclosure" :data-open="open || undefined">
    <AppButton
      :id="`${id}-trigger`"
      class="app-disclosure-trigger"
      text
      :aria-expanded="open"
      :aria-controls="`${id}-content`"
      @click="open = !open"
    >
      <span class="app-disclosure-label"><slot name="summary" /></span>
      <IconChevronDown class="app-disclosure-chevron" :size="16" aria-hidden="true" />
    </AppButton>
    <div
      :id="`${id}-content`"
      class="app-disclosure-content"
      :inert="!open ? true : undefined"
      :aria-hidden="!open"
      :aria-labelledby="`${id}-trigger`"
    >
      <div class="app-disclosure-inner"><slot /></div>
    </div>
  </section>
</template>

<style scoped>
.app-disclosure {
  min-width: 0;
  color: var(--wm-text, var(--text));
}
.app-disclosure .app-disclosure-trigger {
  width: 100%;
  margin: 0;
  padding: 8px 0;
  white-space: normal;
  text-align: left;
}
.app-disclosure-trigger :deep(> span) {
  display: flex;
  width: 100%;
  gap: 12px;
}
.app-disclosure-label {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
}
.app-disclosure-chevron {
  flex-shrink: 0;
  color: var(--wm-muted, var(--muted));
  transition: transform 200ms ease;
}
.app-disclosure-content {
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  visibility: hidden;
  transition:
    grid-template-rows 220ms ease,
    opacity 160ms ease,
    visibility 220ms;
}
.app-disclosure-inner {
  min-height: 0;
  overflow: hidden;
}
.app-disclosure[data-open] > .app-disclosure-content {
  grid-template-rows: 1fr;
  opacity: 1;
  visibility: visible;
}
.app-disclosure[data-open] .app-disclosure-chevron {
  transform: rotate(180deg);
}
@media (prefers-reduced-motion: reduce) {
  .app-disclosure-content,
  .app-disclosure-chevron {
    transition: none;
  }
}
</style>
