<script setup lang="ts">
import { computed } from 'vue'
import AppNumberInput from './AppNumberInput.vue'

const minutes = defineModel<number | undefined>()
withDefaults(defineProps<{ disabled?: boolean; invalid?: boolean; label?: string }>(), {
  label: '加工',
})
const hoursPart = computed({
  get: () => (minutes.value == null ? undefined : Math.floor(minutes.value / 60)),
  set: (hours: number | undefined) => {
    const remainder = (minutes.value || 0) % 60
    minutes.value = hours == null && !remainder ? undefined : (hours || 0) * 60 + remainder
  },
})
const minutesPart = computed({
  get: () => (minutes.value == null ? undefined : minutes.value % 60),
  set: (value: number | undefined) => {
    const hours = Math.floor((minutes.value || 0) / 60)
    minutes.value = value == null && !hours ? undefined : hours * 60 + (value || 0)
  },
})
</script>

<template>
  <div
    class="processing-duration"
    :class="{ 'is-invalid': invalid }"
    role="group"
    :aria-label="`${label}时长`"
  >
    <AppNumberInput
      v-model="hoursPart"
      :disabled="disabled"
      :min="0"
      :precision="0"
      :controls="false"
      :aria-label="`${label}小时`"
      :aria-invalid="invalid || undefined"
      placeholder="小时"
    />
    <span>小时</span>
    <AppNumberInput
      v-model="minutesPart"
      :disabled="disabled"
      :min="0"
      :max="59"
      :precision="0"
      :controls="false"
      :aria-label="`${label}分钟`"
      :aria-invalid="invalid || undefined"
      placeholder="分钟"
    />
    <span>分钟</span>
  </div>
</template>

<style scoped>
.processing-duration {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 320px;
  width: 100%;
}
.processing-duration .el-input-number {
  flex: 1;
  width: 80px;
  min-width: 0;
}
.processing-duration > span {
  color: var(--muted);
  white-space: nowrap;
}
.processing-duration.is-invalid :deep(.el-input__wrapper) {
  box-shadow: 0 0 0 1px var(--el-color-danger) inset;
}
</style>
