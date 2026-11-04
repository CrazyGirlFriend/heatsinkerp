<script setup lang="ts">
import { ElAlert } from 'element-plus'
import { useWatermelonAppearance } from '@/composables/useWorkspaceAppearance'
defineOptions({ inheritAttrs: false })
const themed = useWatermelonAppearance()
</script>
<template>
  <ElAlert v-bind="$attrs" :class="{ 'wm-inline-notice': themed }">
    <template v-for="(_, name) in $slots" #[name]="scope"
      ><slot :name="name" v-bind="scope || {}"
    /></template>
  </ElAlert>
</template>
