<script setup lang="ts">
import { computed, useId } from 'vue'
import { ElPopover } from 'element-plus'
import type { SerialUrgency } from '@/types/recordFilters'
import { formatDateTime } from '@/utils/format'
const props = defineProps<{ urgency?: SerialUrgency | null; editable?: boolean }>()
const emit = defineEmits<{ manage: [] }>()
const flameId = `urgency-flame-${useId()}`
const label = computed(() =>
  props.editable ? (props.urgency?.urgent ? '取消加急' : '标记加急') : '查看加急原因',
)
</script>
<template>
  <ElPopover
    v-if="urgency?.urgent || editable"
    :disabled="editable"
    trigger="click"
    placement="top"
    :width="280"
  >
    <template #reference>
      <button
        type="button"
        class="serial-urgency-badge"
        :class="{ 'is-urgent': urgency?.urgent }"
        :aria-label="label"
        :aria-pressed="editable ? Boolean(urgency?.urgent) : undefined"
        :title="label"
        @click="editable && emit('manage')"
      >
        <svg class="urgency-flame" viewBox="0 0 24 30" aria-hidden="true">
          <defs>
            <path
              :id="flameId"
              d="M13 2c1 6-5.5 7.5-5.5 13.5-1.2-1-1.7-2.4-1.6-4.1C2.9 15 2 17.7 2 20.5a10 10 0 0 0 20 0c0-5.3-3.5-10.1-5.8-11.8.2 3.6-1.1 4.5-2.3 5.2C15.5 9.4 15.8 5.5 13 2Z"
            />
            <linearGradient :id="`${flameId}-color`" x1="0" y1="0" x2="0.25" y2="1">
              <stop offset="0" stop-color="#f9bd55" />
              <stop offset="0.5" stop-color="#f77d37" />
              <stop offset="1" stop-color="#dc4b38" />
            </linearGradient>
            <linearGradient :id="`${flameId}-light`" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="#fff8d9" />
              <stop offset="1" stop-color="#ffbd56" />
            </linearGradient>
            <clipPath :id="`${flameId}-clip`"><use :href="`#${flameId}`" /></clipPath>
          </defs>
          <use
            :href="`#${flameId}`"
            :fill="urgency?.urgent ? `url(#${flameId}-color)` : 'none'"
            :stroke="urgency?.urgent ? 'none' : 'currentColor'"
            stroke-width="1.5"
            stroke-linejoin="round"
          />
          <g v-if="urgency?.urgent" :clip-path="`url(#${flameId}-clip)`">
            <path
              class="urgency-flame__flow"
              d="M10 10c3 6-4 8-3 14 1 7 10 8 12 1 1-5-2-8-3-11 0 6-4 8-4 5 1-4 1-6-2-9Z"
              fill="#ffca65"
            />
            <path
              class="urgency-flame__core"
              d="M13 17c1 4-4 5-4 9 0 5 7 6 8 1 1-4-2-6-4-10Z"
              :fill="`url(#${flameId}-light)`"
            />
          </g>
        </svg>
        <span class="serial-urgency-badge__label">{{ urgency?.urgent ? '加急' : '普通' }}</span>
      </button>
    </template>
    <div v-if="!editable && urgency" class="urgency-detail">
      <strong>流水号加急</strong>
      <p>{{ urgency.reason || '未填写原因' }}</p>
      <small>{{ urgency.updated_by || '管理员' }} · {{ formatDateTime(urgency.updated_at) }}</small>
    </div>
  </ElPopover>
</template>
<style scoped>
.serial-urgency-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  margin-left: 4px;
  padding: 3px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--subtle);
  cursor: pointer;
  vertical-align: middle;
  transition:
    background-color 160ms ease,
    border-color 160ms ease;
}
.serial-urgency-badge__label {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.serial-urgency-badge:hover {
  background: var(--surface-soft);
  border-color: var(--line);
}
.serial-urgency-badge.is-urgent {
  background: #fff2e5;
}
.serial-urgency-badge.is-urgent:hover {
  background: #ffe9d4;
  border-color: #f4c89e;
}
.serial-urgency-badge:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
.urgency-flame {
  display: block;
  width: 18px;
  height: 22px;
  overflow: visible;
}
.urgency-flame__flow,
.urgency-flame__core {
  transform-box: fill-box;
  transform-origin: center bottom;
  animation: urgency-fire-flow 3.6s ease-in-out infinite alternate;
}
.urgency-flame__core {
  animation-duration: 2.8s;
  animation-delay: -1.4s;
}
@keyframes urgency-fire-flow {
  from {
    transform: translate(-0.4px, 1px) scale(0.94, 0.9) rotate(-5deg);
  }
  to {
    transform: translate(0.5px, -1px) scale(1.04, 1.08) rotate(5deg);
  }
}
@media (prefers-reduced-motion: reduce), print {
  .serial-urgency-badge,
  .urgency-flame__flow,
  .urgency-flame__core {
    animation: none;
    transition: none;
  }
}
.urgency-detail strong {
  color: var(--el-color-danger-dark-2);
}
.urgency-detail p {
  margin: 10px 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.urgency-detail small {
  color: var(--muted);
}
</style>
