<script setup lang="ts">
import { computed, ref, useSlots } from 'vue'
import { ElDialog, type DialogProps } from 'element-plus'
import { useGlassSurface } from '@/composables/useGlassSurface'
import { useGlassOverlayDepth } from '@/composables/useGlassOverlayDepth'
import { useWatermelonAppearance } from '@/composables/useWorkspaceAppearance'
const watermelon = useWatermelonAppearance()

defineOptions({ inheritAttrs: false })
const props = withDefaults(
  defineProps<{
    modelValue?: boolean
    modalClass?: string
    transition?: DialogProps['transition']
  }>(),
  { transition: 'app-dialog' },
)
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  open: []
  opened: []
  closed: []
  close: []
}>()
const anchor = ref<HTMLElement>()
const overlay = useGlassOverlayDepth(() => anchor.value?.closest<HTMLElement>('.el-dialog'))
const overlayClass = computed(() =>
  [
    watermelon.value ? 'wm-dialog-overlay' : 'app-glass-overlay',
    overlay.nested.value ? 'app-glass-overlay--nested' : '',
    props.modalClass,
  ]
    .filter(Boolean)
    .join(' '),
)
const slots = useSlots()
function namedSlots() {
  return Object.keys(slots).filter((name) => name !== 'default')
}
const glass = useGlassSurface(
  () => anchor.value?.closest<HTMLElement>('.el-dialog'),
  () => Boolean(props.modelValue) && !watermelon.value,
)
function open() {
  void overlay.opening()
  emit('open')
}
function opened() {
  overlay.sync()
  if (!watermelon.value) void glass.start()
  emit('opened')
}
function closed() {
  glass.stop()
  overlay.reset()
  emit('closed')
}
function close() {
  glass.cancelPending()
  emit('close')
}
</script>

<template>
  <ElDialog
    v-bind="$attrs"
    :model-value="modelValue"
    :modal-class="overlayClass"
    :transition="watermelon ? 'wm-app-dialog' : transition"
    :class="watermelon ? 'wm-scope wm-app-dialog' : 'app-glass-surface app-glass-dialog'"
    @update:model-value="emit('update:modelValue', $event)"
    @open="open"
    @opened="opened"
    @closed="closed"
    @close="close"
  >
    <span ref="anchor" hidden aria-hidden="true" />
    <slot />
    <template v-for="name in namedSlots()" #[name]="scope">
      <slot :name="name" v-bind="scope || {}" />
    </template>
  </ElDialog>
</template>
