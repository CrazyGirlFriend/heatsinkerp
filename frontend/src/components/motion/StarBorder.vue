<script setup lang="ts">
// Adapted from Vue Bits StarBorder. See frontend/THIRD_PARTY_NOTICES.md.
withDefaults(defineProps<{ paused?: boolean }>(), { paused: false })
</script>
<template>
  <span class="star-border" :class="{ 'star-border--paused': paused }">
    <span class="star-border__light star-border__light--bottom" aria-hidden="true" />
    <span class="star-border__light star-border__light--top" aria-hidden="true" />
    <span class="star-border__content"><slot /></span>
  </span>
</template>
<style scoped>
.star-border { position: relative; display: inline-flex; overflow: hidden; padding: 1px; border-radius: 18px; background: #efbe8a; color: #9b510d; }
.star-border__content { z-index: 1; position: relative; display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: 17px; background: #fffaf3; font-size: 14px; line-height: 20px; font-weight: 500; white-space: nowrap; }
.star-border__light { position: absolute; width: 300%; height: 50%; border-radius: 50%; pointer-events: none; background: radial-gradient(circle, #b66610, transparent 10%); }
.star-border__light--bottom { right: -250%; bottom: -2px; animation: star-bottom 6s linear infinite alternate; }
.star-border__light--top { left: -250%; top: -2px; animation: star-top 6s linear infinite alternate; }
.star-border--paused .star-border__light { animation-play-state: paused; opacity: 0; }
@keyframes star-bottom { from { transform: translate(0, 0); opacity: 1; } to { transform: translate(-100%, 0); opacity: 0; } }
@keyframes star-top { from { transform: translate(0, 0); opacity: 1; } to { transform: translate(100%, 0); opacity: 0; } }
@media (prefers-reduced-motion: reduce), print { .star-border__light { animation: none; display: none; } }
</style>
