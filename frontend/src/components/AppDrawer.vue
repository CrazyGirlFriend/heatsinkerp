<script setup lang="ts">
import { computed, ref, useSlots } from 'vue'
import { ElDrawer } from 'element-plus'
import { useGlassSurface } from '@/composables/useGlassSurface'
import { useGlassOverlayDepth } from '@/composables/useGlassOverlayDepth'

defineOptions({ inheritAttrs: false })
const props = withDefaults(
  defineProps<{ modelValue?: boolean; modalClass?: string; modal?: boolean }>(),
  { modal: true },
)
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  open: []
  opened: []
  closed: []
  close: []
}>()
const anchor = ref<HTMLElement>()
const overlay = useGlassOverlayDepth(
  () => anchor.value?.closest<HTMLElement>('.el-drawer'),
  () => props.modal,
)
const overlayClass = computed(() =>
  [
    props.modal ? 'app-glass-overlay' : '',
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
  () => anchor.value?.closest<HTMLElement>('.el-drawer'),
  () => Boolean(props.modelValue),
)
function open() {
  void overlay.opening()
  emit('open')
}
function opened() {
  overlay.sync()
  void glass.start()
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
  <ElDrawer
    v-bind="$attrs"
    :model-value="modelValue"
    :modal="modal"
    :modal-class="overlayClass"
    class="app-glass-surface app-glass-drawer"
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
  </ElDrawer>
</template>
