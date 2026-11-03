<script setup lang="ts">
import { motion, useReducedMotion } from 'motion-v'

const props = defineProps<{ label: string; disabled?: boolean }>()
const checked = defineModel<boolean>({ default: false })
const reduced = useReducedMotion()
function toggle() {
  if (!props.disabled) checked.value = !checked.value
}
</script>

<template>
  <button
    type="button"
    role="switch"
    :aria-label="label"
    :aria-checked="checked"
    :disabled="disabled"
    class="wm-switch"
    @click="toggle"
  >
    <motion.span
      :animate="{ x: checked ? 18 : 0 }"
      :transition="reduced ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 32 }"
    />
  </button>
</template>

<style>
.wm-switch {
  flex-shrink: 0;
  height: 24px;
  width: 42px;
  border: 0;
  border-radius: 12px;
  padding: 3px;
  background: #d7d7de;
  cursor: pointer;
}
.wm-switch[aria-checked='true'] {
  background: #111;
}
.wm-switch > span {
  display: block;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px #0003;
}
.wm-switch:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.wm-switch:focus-visible {
  outline: 2px solid #328369;
  outline-offset: 3px;
}
</style>
