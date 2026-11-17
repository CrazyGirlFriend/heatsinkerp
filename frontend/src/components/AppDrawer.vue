<script setup lang="ts">
import { ref, useSlots } from 'vue'
import { ElDrawer } from 'element-plus'
import { useAppOverlay } from '@/composables/useAppOverlay'

defineOptions({ inheritAttrs: false })
const props = withDefaults(
  defineProps<{ modelValue?: boolean; modalClass?: string; modal?: boolean }>(),
  { modal: true },
)
const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'open' | 'opened' | 'close' | 'closed'): void
}>()
const anchor = ref<HTMLElement>()
const { watermelon, overlayClass, events } = useAppOverlay(
  () => anchor.value?.closest<HTMLElement>('.el-drawer'),
  props,
  emit,
)
const slots = useSlots()
function namedSlots() {
  return Object.keys(slots).filter((name) => name !== 'default')
}
</script>

<template>
  <ElDrawer
    v-bind="$attrs"
    :model-value="modelValue"
    :modal="modal"
    :modal-class="overlayClass"
    :class="watermelon ? 'wm-scope wm-app-drawer' : 'app-glass-surface app-glass-drawer'"
    @update:model-value="emit('update:modelValue', $event)"
    v-on="events"
  >
    <span ref="anchor" hidden aria-hidden="true" />
    <slot />
    <template v-for="name in namedSlots()" #[name]="scope">
      <slot :name="name" v-bind="scope || {}" />
    </template>
  </ElDrawer>
</template>
