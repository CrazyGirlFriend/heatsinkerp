<script setup lang="ts">
import AppPopover from '@/components/AppPopover.vue'
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import ElButton from '@/components/AppButton.vue'
import WatermelonButton from './watermelon/WatermelonButton.vue'
import { IconAdjustmentsHorizontal, IconX } from '@tabler/icons-vue'
const panel = ref<HTMLElement>()
const trigger = ref<{ $el: HTMLElement }>()
const panelHeight = ref(640)
const props = withDefaults(
  defineProps<{
    modelValue: boolean
    count?: number
    title?: string
    appendTo?: HTMLElement
    suspended?: boolean
  }>(),
  {
    count: 0,
    title: '筛选条件',
  },
)
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  open: []
  cancel: []
  apply: []
  reset: []
}>()
function open() {
  fitPanel()
  emit('open')
  emit('update:modelValue', true)
}
function cancel() {
  emit('cancel')
  emit('update:modelValue', false)
}
function fitPanel() {
  if (!trigger.value) return
  panelHeight.value = Math.max(
    160,
    Math.min(640, window.innerHeight - trigger.value.$el.getBoundingClientRect().bottom - 20),
  )
}
function escapePanel(event: KeyboardEvent) {
  if (
    !props.modelValue ||
    props.suspended ||
    event.key !== 'Escape' ||
    event.defaultPrevented ||
    panel.value?.querySelector('[aria-expanded="true"]')
  )
    return
  event.preventDefault()
  cancel()
  void nextTick(() => trigger.value?.$el.focus())
}
function outsidePanel(event: PointerEvent) {
  if (!props.modelValue || props.suspended) return
  const target = event.target as Node
  if (!panel.value?.contains(target) && !trigger.value?.$el.contains(target)) cancel()
}
onMounted(() => {
  window.addEventListener('resize', fitPanel)
  document.addEventListener('keydown', escapePanel)
  document.addEventListener('pointerdown', outsidePanel)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', fitPanel)
  document.removeEventListener('keydown', escapePanel)
  document.removeEventListener('pointerdown', outsidePanel)
})
</script>
<template>
  <AppPopover
    :visible="modelValue"
    trigger="click"
    role="dialog"
    :aria-label="title"
    placement="bottom-start"
    :width="560"
    :offset="8"
    :show-arrow="false"
    :append-to="appendTo || 'body'"
    popper-class="filter-form-popover"
    :popper-options="{
      modifiers: [{ name: 'preventOverflow', options: { altAxis: true, padding: 12 } }],
    }"
  >
    <template #reference>
      <WatermelonButton
        ref="trigger"
        class="filter-dialog-trigger"
        :aria-label="title"
        :aria-expanded="modelValue"
        aria-haspopup="dialog"
        @click="modelValue ? cancel() : open()"
        ><IconAdjustmentsHorizontal :size="17" />筛选<span v-if="count" class="filter-count">{{
          count
        }}</span></WatermelonButton
      >
    </template>
    <div ref="panel" class="filter-form-panel" :style="{ maxHeight: `${panelHeight}px` }">
      <header>
        <strong>{{ title }}</strong>
        <ElButton size="small" circle aria-label="关闭筛选" @click="cancel"
          ><IconX :size="16"
        /></ElButton>
      </header>
      <div class="filter-form-body">
        <div class="filter-dialog-fields"><slot :append-to="panel" /></div>
      </div>
      <footer>
        <WatermelonButton class="filter-reset" @click="emit('reset')">重置</WatermelonButton>
        <WatermelonButton @click="cancel">取消</WatermelonButton>
        <WatermelonButton primary @click="emit('apply')">应用筛选</WatermelonButton>
      </footer>
    </div>
  </AppPopover>
</template>
<style>
.filter-form-popover.el-popper {
  max-width: calc(100vw - 24px);
  padding: 0;
  border-radius: 12px;
  box-shadow: 0 12px 40px rgb(0 0 0 / 14%);
}
.filter-form-panel {
  display: flex;
  flex-direction: column;
  max-height: min(640px, calc(100dvh - 110px));
  color: var(--wm-text, var(--el-text-color-primary));
}
.filter-form-panel header,
.filter-form-panel footer {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  padding: 12px 16px;
}
.filter-form-panel header {
  justify-content: space-between;
  font-size: var(--font-size-section);
  border-bottom: 1px solid var(--wm-border, var(--el-border-color));
}
.filter-form-body {
  min-height: 0;
  padding: 16px;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.filter-form-panel .filter-dialog-fields > .filter-fields {
  gap: 14px 16px;
}
.filter-form-panel footer {
  border-top: 1px solid var(--wm-border, var(--el-border-color));
}
.filter-form-panel .filter-reset {
  margin-right: auto;
}
.filter-dialog-trigger.el-button {
  margin: 0;
}
.filter-count {
  margin-left: 7px;
  min-width: 19px;
  padding: 0 5px;
  border-radius: 4px;
  background: var(--primary-soft);
  color: var(--primary);
  font-size: var(--font-size-meta);
  font-variant-numeric: tabular-nums;
}
.filter-dialog-fields,
.filter-dialog-fields > .filter-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px 20px;
  min-width: 0;
}
.filter-dialog-fields > .filter-fields {
  grid-column: 1 / -1;
}
.filter-dialog-fields label:not(.el-checkbox) {
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-width: 0;
  color: var(--muted);
  font-size: var(--font-size-label);
}
.filter-dialog-fields :is(.el-select, .el-input, .el-date-editor, .record-date-trigger) {
  width: 100%;
  min-width: 0;
}
.filter-dialog-fields .record-date-trigger > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.filter-dialog-fields .processing-person-input {
  max-width: none;
}
.filter-dialog-fields .el-checkbox {
  margin: 0;
}
.filter-dialog-fields .el-checkbox__label {
  white-space: normal;
}
.filter-dialog-fields .filter-wide {
  grid-column: 1 / -1;
}
@media (max-width: 560px) {
  .filter-dialog-fields,
  .filter-dialog-fields > .filter-fields {
    grid-template-columns: minmax(0, 1fr);
    gap: 14px;
  }
}
</style>
