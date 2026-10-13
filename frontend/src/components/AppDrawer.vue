<script setup lang="ts">
import { computed, ref, useSlots } from 'vue'
import { ElDrawer } from 'element-plus'
import { useGlassSurface } from '@/composables/useGlassSurface'

defineOptions({ inheritAttrs: false })
const props = withDefaults(
  defineProps<{ modelValue?: boolean; modalClass?: string; modal?: boolean }>(),
  { modal: true },
)
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  opened: []
  closed: []
  close: []
}>()
const overlayClass = computed(() =>
  [props.modal ? 'app-glass-overlay' : '', props.modalClass].filter(Boolean).join(' '),
)
const anchor = ref<HTMLElement>()
const slots = useSlots()
function namedSlots() {
  return Object.keys(slots).filter((name) => name !== 'default')
}
const glass = useGlassSurface(
  () => anchor.value?.closest<HTMLElement>('.el-drawer'),
  () => Boolean(props.modelValue),
)
function opened() {
  void glass.start()
  emit('opened')
}
function closed() {
  glass.stop()
  emit('closed')
}
function close() {
  glass.stop()
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
