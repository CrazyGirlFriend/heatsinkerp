<script setup lang="ts">
import { ElSwitch } from 'element-plus'
import { useWatermelonAppearance } from '@/composables/useWorkspaceAppearance'
defineOptions({ inheritAttrs: false })
defineProps<{ disabled?: boolean }>()
const themed = useWatermelonAppearance()
</script>
<template>
  <ElSwitch v-bind="$attrs" :disabled="disabled" :class="{ 'wm-control-switch': themed }">
    <template v-for="(_, name) in $slots" #[name]="scope"
      ><slot :name="name" v-bind="scope || {}"
    /></template>
  </ElSwitch>
</template>
