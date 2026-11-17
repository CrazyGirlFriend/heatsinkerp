<script setup lang="ts">
import { ref, useSlots } from 'vue'
import { ElDialog, type DialogProps } from 'element-plus'
import { useAppOverlay } from '@/composables/useAppOverlay'

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
  (event: 'update:modelValue', value: boolean): void
  (event: 'open' | 'opened' | 'close' | 'closed'): void
}>()
const anchor = ref<HTMLElement>()
const { watermelon, overlayClass, events } = useAppOverlay(
  () => anchor.value?.closest<HTMLElement>('.el-dialog'),
  props,
  emit,
)
const slots = useSlots()
function namedSlots() {
  return Object.keys(slots).filter((name) => name !== 'default')
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
    v-on="events"
  >
    <span ref="anchor" hidden aria-hidden="true" />
    <slot />
    <template v-for="name in namedSlots()" #[name]="scope">
      <slot :name="name" v-bind="scope || {}" />
    </template>
  </ElDialog>
</template>
