<script setup lang="ts">
defineProps<{ percent: number | null; color: string; label: string }>()
</script>
<template>
  <span class="schedule-progress-meter" :style="{ '--progress-color': color }">
    <span
      class="schedule-progress-meter__track"
      role="progressbar"
      :aria-label="label"
      :aria-valuenow="percent == null ? undefined : Math.round(percent)"
      :aria-valuemin="0"
      :aria-valuemax="100"
    >
      <span :style="{ width: `${Math.max(0, Math.min(100, percent ?? 0))}%` }" />
    </span>
    <small>{{ percent == null ? '—' : `${Math.round(percent)}%` }}</small>
  </span>
</template>
<style scoped>
.schedule-progress-meter {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 88px;
}
.schedule-progress-meter__track {
  flex: 1;
  height: 6px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--surface-soft);
}
.schedule-progress-meter__track > span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--progress-color) 55%, var(--surface)),
    var(--progress-color)
  );
  transition: width 240ms ease-out;
}
small {
  min-width: 30px;
  text-align: right;
  font-size: 11px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
@media (prefers-reduced-motion: reduce) {
  .schedule-progress-meter__track > span {
    transition: none;
  }
}
</style>
