<script setup lang="ts">
import { ElEmpty } from 'element-plus'
import { IconPackage } from '@tabler/icons-vue'
import { useWatermelonAppearance } from '@/composables/useWorkspaceAppearance'
defineOptions({ inheritAttrs: false })
const themed = useWatermelonAppearance()
</script>
<template>
  <ElEmpty v-bind="$attrs" :class="{ 'wm-empty': themed }" :image-size="themed ? 36 : undefined">
    <template v-if="themed && !$slots.image" #image
      ><IconPackage :size="36" :stroke-width="1.3" aria-hidden="true"
    /></template>
    <template v-for="(_, name) in $slots" #[name]="scope"
      ><slot :name="name" v-bind="scope || {}"
    /></template>
  </ElEmpty>
</template>
