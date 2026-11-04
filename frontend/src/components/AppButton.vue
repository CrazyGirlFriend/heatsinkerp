<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElButton, type ButtonInstance } from 'element-plus'
import { useWatermelonAppearance } from '@/composables/useWorkspaceAppearance'
import { useControlFeedback } from '@/composables/useControlFeedback'

// Retain the existing button API, form submission and focus restoration.
defineOptions({ inheritAttrs: false })
const props = defineProps<{ loading?: boolean; watermelon?: boolean }>()
const button = ref<ButtonInstance>()
const appearance = useWatermelonAppearance()
const themed = computed(() => props.watermelon || appearance.value)
const busyWidth = ref(0)
watch(
  () => props.loading,
  (loading) => {
    busyWidth.value = loading ? button.value?.ref?.offsetWidth || 0 : 0
  },
  { flush: 'pre' },
)
useControlFeedback(
  computed(() => button.value?.ref),
  themed,
)
defineExpose({ ref: computed(() => button.value?.ref) })
</script>

<template>
  <ElButton
    ref="button"
    class="app-button"
    :class="{ 'wm-control-button': themed }"
    :style="themed && busyWidth ? { minWidth: `${busyWidth}px` } : undefined"
    :loading="loading"
    :aria-busy="loading || undefined"
    v-bind="$attrs"
  >
    <template v-for="(_, name) in $slots" #[name]="scope">
      <slot :name="name" v-bind="scope || {}" />
    </template>
  </ElButton>
</template>
