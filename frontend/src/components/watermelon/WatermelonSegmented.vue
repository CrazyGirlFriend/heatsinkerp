<script setup lang="ts">
// Vue adaptation of Watermelon fluid selection indicator. See NOTICE.md.
import { computed, useId, type Component } from 'vue'
import { motion, useReducedMotion } from 'motion-v'

defineProps<{
  label: string
  controls?: string
  options: ReadonlyArray<{
    value: string
    label: string
    icon?: Component
    disabled?: boolean
    count?: number | null
  }>
}>()
const value = defineModel<string>({ default: '' })
const emit = defineEmits<{ change: [value: string] }>()
const reduced = useReducedMotion()
const id = useId()
const spring = computed(() =>
  reduced.value ? { duration: 0 } : { type: 'spring' as const, stiffness: 360, damping: 30 },
)
function choose(option: { value: string; disabled?: boolean }) {
  if (option.disabled || option.value === value.value) return
  value.value = option.value
  emit('change', option.value)
}
function keyboard(event: KeyboardEvent) {
  if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const group = event.currentTarget as HTMLElement
  const buttons = [...group.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
  if (!buttons.length) return
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
  const index =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? buttons.length - 1
        : (current + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length
  const target = buttons[index]!
  target.focus()
  target.click()
}
</script>

<template>
  <div class="wm-segmented" role="group" :aria-label="label" @keydown="keyboard">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      :aria-pressed="value === option.value"
      :aria-controls="controls"
      :aria-current="controls && value === option.value ? 'page' : undefined"
      :class="{ active: value === option.value }"
      :disabled="option.disabled"
      @click="choose(option)"
    >
      <motion.span
        v-if="value === option.value"
        :layout-id="`${id}-segment`"
        class="wm-segmented-indicator"
        :transition="spring"
      />
      <component :is="option.icon" v-if="option.icon" :size="16" />
      <span>{{ option.label }}</span>
      <span v-if="option.count && option.count > 0" class="wm-segmented-count">{{
        option.count
      }}</span>
    </button>
  </div>
</template>

<style>
.wm-segmented {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 3px;
  padding: 4px;
  border-radius: 12px;
  background: var(--wm-muted-surface, #f2f3f5);
}
.wm-segmented button {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 34px;
  padding: 0 14px;
  border: 0;
  background: transparent;
  border-radius: 9px;
  color: var(--wm-muted, #767b83);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  flex-shrink: 0;
  white-space: nowrap;
}
.wm-segmented button > :not(.wm-segmented-indicator) {
  position: relative;
  z-index: 1;
}
.wm-segmented .active {
  color: var(--wm-text, #22262b);
  font-weight: 600;
}
.wm-segmented-count {
  min-width: 20px;
  padding: 0 5px;
  border-radius: 5px;
  background: var(--wm-neutral-bg, #e4e4e7);
  color: var(--wm-text, #22262b);
  font-size: 11px;
  line-height: 20px;
  font-variant-numeric: tabular-nums;
}
.wm-segmented button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.wm-segmented button:focus-visible {
  outline: 2px solid var(--wm-primary, #437fba);
  outline-offset: 2px;
}
.wm-segmented-indicator {
  position: absolute;
  inset: 0;
  border-radius: 9px;
  background: var(--wm-surface, white);
  box-shadow:
    0 1px 3px #11182714,
    0 0 0 1px #11182706;
}
</style>
