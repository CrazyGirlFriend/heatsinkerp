<script setup lang="ts">
import { ref } from 'vue'
import { ElPopover } from 'element-plus'
import { useWatermelonAppearance } from '@/composables/useWorkspaceAppearance'
defineOptions({ inheritAttrs: false })
defineProps<{ popperClass?: string; transition?: string }>()
const themed = useWatermelonAppearance()
const popover = ref<InstanceType<typeof ElPopover>>()
defineExpose({ hide: () => popover.value?.hide() })
</script>
<template>
  <ElPopover
    ref="popover"
    v-bind="$attrs"
    :transition="themed ? 'wm-popover' : transition"
    :popper-class="
      [popperClass, themed ? 'wm-scope wm-control-menu' : ''].filter(Boolean).join(' ')
    "
  >
    <template v-for="(_, name) in $slots" #[name]="scope"
      ><slot :name="name" v-bind="scope || {}"
    /></template>
  </ElPopover>
</template>
