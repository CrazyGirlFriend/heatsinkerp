<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElButton, type ButtonInstance } from 'element-plus'
import { useWatermelonAppearance } from '@/composables/useWorkspaceAppearance'
import { useControlFeedback } from '@/composables/useControlFeedback'

// Retain the existing button API, form submission and focus restoration.
defineOptions({ inheritAttrs: false })
const props = defineProps<{
  loading?: boolean
  disabled?: boolean
  watermelon?: boolean
  unstyled?: boolean
}>()
const button = ref<ButtonInstance>()
const nativeButton = ref<HTMLButtonElement>()
const element = computed(() => (props.unstyled ? nativeButton.value : button.value?.ref))
const appearance = useWatermelonAppearance()
const themed = computed(() => props.watermelon || appearance.value)
const busyWidth = ref(0)
watch(
  () => props.loading,
  (loading) => {
    busyWidth.value = loading ? element.value?.offsetWidth || 0 : 0
  },
  { flush: 'pre' },
)
useControlFeedback(element, themed)
defineExpose({ ref: element })
</script>

<template>
  <button
    v-if="unstyled"
    ref="nativeButton"
    type="button"
    v-bind="$attrs"
    :disabled="disabled || loading"
    :aria-busy="loading || undefined"
  >
    <slot />
  </button>
  <ElButton
    v-else
    ref="button"
    class="app-button"
    :class="{ 'wm-control-button': themed }"
    :style="themed && busyWidth ? { minWidth: `${busyWidth}px` } : undefined"
    :loading="loading"
    :disabled="disabled"
    :aria-busy="loading || undefined"
    v-bind="$attrs"
  >
    <template v-for="(_, name) in $slots" #[name]="scope">
      <slot :name="name" v-bind="scope || {}" />
    </template>
  </ElButton>
</template>
