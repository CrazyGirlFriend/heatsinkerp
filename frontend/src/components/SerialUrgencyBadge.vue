<script setup lang="ts">
import { Flag } from '@element-plus/icons-vue'
import { ElIcon, ElPopover } from 'element-plus'
import type { SerialUrgency } from '@/types/recordFilters'
import { formatDateTime } from '@/utils/format'
defineProps<{ urgency?: SerialUrgency | null }>()
</script>
<template>
  <ElPopover v-if="urgency?.urgent" trigger="click" placement="top" :width="280">
    <template #reference><button type="button" class="serial-urgency-badge" aria-label="查看加急原因"><ElIcon class="serial-urgency-badge__flag" aria-hidden="true"><Flag /></ElIcon><span class="serial-urgency-badge__label">加急</span></button></template>
    <div class="urgency-detail"><strong>流水号加急</strong><p>{{ urgency.reason || '未填写原因' }}</p><small>{{ urgency.updated_by || '管理员' }} · {{ formatDateTime(urgency.updated_at) }}</small></div>
  </ElPopover>
</template>
<style scoped>
.serial-urgency-badge { position: relative; display: inline-flex; align-items: center; gap: 4px; height: 22px; margin-left: 6px; padding: 0 4px; border: 1px solid #fac6cc; border-radius: 5px; background: #fff3f4; color: #be123c; cursor: pointer; vertical-align: middle; white-space: nowrap; font: inherit; }
.serial-urgency-badge::before { content: ''; position: absolute; inset: -3px; border: 1px solid #e7536a; border-radius: 7px; opacity: 0; pointer-events: none; animation: serial-urgent-pulse 2.8s ease-in-out infinite; }
.serial-urgency-badge .serial-urgency-badge__flag { flex: 0 0 14px; font-size: 14px; transform-origin: 25% 85%; animation: serial-flag-wave 2.8s ease-in-out infinite; }
.serial-urgency-badge .serial-urgency-badge__label { font-size: 11px; font-weight: 500; line-height: 18px; }
.serial-urgency-badge:is(:hover, :focus) { background: #ffe8ec; border-color: #ed9aa8; }
.serial-urgency-badge:is(:hover, :focus)::before, .serial-urgency-badge:is(:hover, :focus) .serial-urgency-badge__flag { animation-play-state: paused; }
.serial-urgency-badge:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
@keyframes serial-flag-wave {
  0%, 18%, 100% { transform: rotate(-4deg) skewY(0); }
  34% { transform: rotate(10deg) skewY(-4deg); }
  48% { transform: rotate(-9deg) skewY(2deg); }
  62% { transform: rotate(6deg) skewY(-2deg); }
  78% { transform: rotate(-2deg) skewY(0); }
}
@keyframes serial-urgent-pulse {
  0%, 18%, 100% { opacity: 0; transform: scale(.96); }
  45% { opacity: .28; transform: scale(1); }
  78% { opacity: 0; transform: scale(1.08); }
}
@media (prefers-reduced-motion: reduce), print {
  .serial-urgency-badge::before { animation: none; opacity: 0; }
  .serial-urgency-badge .serial-urgency-badge__flag { animation: none; transform: none; }
}
.urgency-detail strong { color: #c9323f; }.urgency-detail p { margin: 10px 0; white-space: pre-wrap; overflow-wrap: anywhere; }.urgency-detail small { color: var(--muted); }
</style>
