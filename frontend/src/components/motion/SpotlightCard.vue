<script setup lang="ts">
// Adapted from Vue Bits SpotlightCard. See frontend/THIRD_PARTY_NOTICES.md.
import { ref, watch } from 'vue'
const props = withDefaults(defineProps<{ enabled?: boolean }>(), { enabled: true })
const root = ref<HTMLElement>(), focused = ref(false), hovering = ref(false)
const position = ref({ x: 0, y: 0 })
function move(event: PointerEvent) {
  if (!props.enabled || event.pointerType === 'touch' || focused.value || !root.value) return
  const rect = root.value.getBoundingClientRect()
  position.value = { x: event.clientX - rect.left, y: event.clientY - rect.top }
  hovering.value = true
}
function focus() {
  focused.value = true
  if (root.value) position.value = { x: root.value.clientWidth / 2, y: root.value.clientHeight / 3 }
}
function blur(event: FocusEvent) {
  if (!(event.relatedTarget instanceof Node) || !root.value?.contains(event.relatedTarget)) focused.value = false
}
watch(() => props.enabled, enabled => { if (!enabled) hovering.value = false })
</script>
<template>
  <article ref="root" class="spotlight-card" @pointermove="move" @pointerleave="hovering = false" @focusin="focus" @focusout="blur">
    <div class="spotlight-card__light" aria-hidden="true" :style="{ opacity: enabled && (hovering || focused) ? 1 : 0, background: `radial-gradient(320px circle at ${position.x}px ${position.y}px, rgba(101, 80, 237, .085), transparent 80%)` }" />
    <div class="spotlight-card__content"><slot /></div>
  </article>
</template>
<style scoped>
.spotlight-card { position: relative; overflow: hidden; }
.spotlight-card__light { position: absolute; inset: 0; pointer-events: none; transition: opacity 220ms ease; }
.spotlight-card__content { position: relative; height: 100%; }
@media (prefers-reduced-motion: reduce) { .spotlight-card__light { display: none; transition: none; } }
</style>
