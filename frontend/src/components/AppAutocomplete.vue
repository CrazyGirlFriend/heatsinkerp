<script setup lang="ts">
import { ElAutocomplete } from 'element-plus'
import { useWatermelonAppearance } from '@/composables/useWorkspaceAppearance'
defineOptions({ inheritAttrs: false })
defineProps<{ popperClass?: string }>()
const themed = useWatermelonAppearance()
</script>
<template>
  <ElAutocomplete
    class="app-input"
    v-bind="$attrs"
    :popper-class="
      [popperClass, themed ? 'wm-scope wm-control-menu' : ''].filter(Boolean).join(' ')
    "
  >
    <template v-for="(_, name) in $slots" #[name]="scope"
      ><slot :name="name" v-bind="scope || {}"
    /></template>
  </ElAutocomplete>
</template>
