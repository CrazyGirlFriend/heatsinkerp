<script setup lang="ts">
import { ref, useId } from 'vue'
import { ElDatePicker, type DatePickerInstance, type DatePickerProps } from 'element-plus'
import { motion, useReducedMotion } from 'motion-v'
import { useWatermelonAppearance } from '@/composables/useWorkspaceAppearance'
defineOptions({ inheritAttrs: false })
withDefaults(
  defineProps<{ popperClass?: string; watermelon?: boolean; type?: DatePickerProps['type'] }>(),
  { type: 'date' },
)
const themed = useWatermelonAppearance()
const reduced = useReducedMotion()
const id = useId()
const picker = ref<DatePickerInstance>()
defineExpose({
  focus: () => picker.value?.focus(),
  blur: () => picker.value?.blur(),
  handleOpen: () => picker.value?.handleOpen(),
  handleClose: () => picker.value?.handleClose(),
})
</script>
<template>
  <ElDatePicker
    ref="picker"
    v-bind="$attrs"
    :type="type"
    :class="{ 'wm-date-input': themed || watermelon }"
    :popper-class="
      [popperClass, themed || watermelon ? 'wm-scope wm-date-panel' : ''].filter(Boolean).join(' ')
    "
  >
    <template
      v-if="(themed || watermelon) && ['date', 'datetime'].includes(type) && !$slots.default"
      #default="cell"
    >
      <motion.div
        class="wm-date-cell"
        :class="{ 'is-selected': cell.isCurrent }"
        :while-press="reduced || cell.type === 'disabled' ? {} : { scale: 0.94 }"
      >
        <motion.span
          v-if="cell.isCurrent"
          class="wm-date-selected"
          :layout-id="`${id}-day`"
          :transition="reduced ? { duration: 0 } : { type: 'spring', stiffness: 300, damping: 25 }"
        />
        <span class="wm-date-day">{{ cell.text }}</span>
      </motion.div>
    </template>
    <template v-for="(_, name) in $slots" #[name]="scope"
      ><slot :name="name" v-bind="scope || {}"
    /></template>
  </ElDatePicker>
</template>

<style>
.wm-scope .wm-date-input.el-date-editor {
  width: 100%;
  height: 40px;
}
.wm-date-panel.el-popper {
  border-radius: 12px;
  box-shadow: 0 12px 35px #0003;
}
.wm-date-panel .el-picker-panel {
  border-radius: 12px;
}
.wm-date-panel .el-date-picker__header {
  margin: 16px 14px 10px;
}
.wm-date-panel .el-date-picker__header-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--wm-text);
}
.wm-date-panel .el-date-picker .el-picker-panel__content {
  margin: 8px 12px 14px;
  width: auto;
}
.wm-date-panel .el-date-table th {
  color: var(--wm-muted);
  border-bottom: 0;
}
.wm-date-panel .el-date-table td {
  height: 36px;
  padding: 1px 0;
}
.wm-date-cell {
  position: relative;
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  margin: auto;
  border-radius: 8px;
}
.wm-date-panel td.available:hover .wm-date-cell {
  background: var(--wm-hover);
}
.wm-date-selected {
  position: absolute;
  inset: 0;
  border-radius: 8px;
  background: var(--wm-primary);
}
.wm-date-day {
  position: relative;
  z-index: 1;
  font-size: 13px;
}
.wm-date-cell.is-selected .wm-date-day {
  color: var(--wm-primary-text);
}
.wm-date-panel .el-picker-panel {
  animation: wm-calendar-in 180ms ease-out;
}
.wm-date-panel.el-zoom-in-top-enter-active .el-picker-panel,
.wm-date-panel.el-zoom-in-top-leave-active .el-picker-panel {
  transition:
    opacity 160ms,
    transform 180ms;
}
.wm-date-panel.el-zoom-in-top-enter-from .el-picker-panel,
.wm-date-panel.el-zoom-in-top-leave-to .el-picker-panel {
  opacity: 0;
  transform: translateY(-6px);
}
@keyframes wm-calendar-in {
  from {
    opacity: 0;
    transform: translateY(-6px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .wm-date-panel .el-picker-panel {
    animation: none;
    transition: none !important;
  }
}
</style>
