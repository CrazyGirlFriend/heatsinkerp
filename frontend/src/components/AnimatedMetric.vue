<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
const props = defineProps<{ value: number | null; animate: boolean; precision: number }>()
const displayed = ref(props.value)
let frame = 0
const format = (value: number | null) => value == null ? '—' : new Intl.NumberFormat('zh-CN', { maximumFractionDigits: props.precision }).format(value)
const actual = computed(() => format(props.value))
function stop() { if (frame) cancelAnimationFrame(frame); frame = 0 }
watch(() => [props.value, props.animate] as const, ([value, animate]) => {
  stop()
  if (!animate || displayed.value === value || displayed.value == null || value == null) { displayed.value = value; return }
  const from = displayed.value, start = performance.now()
  const step = (now: number) => {
    const progress = Math.min(1, Math.max(0, (now - start) / 700))
    displayed.value = progress === 1 ? value : from + (value - from) * (1 - (1 - progress) ** 3)
    frame = progress < 1 ? requestAnimationFrame(step) : 0
  }
  frame = requestAnimationFrame(step)
})
onBeforeUnmount(stop)
</script>
<template><span :aria-label="actual"><span aria-hidden="true">{{ format(displayed) }}</span></span></template>
