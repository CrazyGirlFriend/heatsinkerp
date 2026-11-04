<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref } from 'vue'
import { ElTabs } from 'element-plus'
import { useWatermelonAppearance } from '@/composables/useWorkspaceAppearance'
defineOptions({ inheritAttrs: false })
const themed = useWatermelonAppearance()
const tabs = ref<InstanceType<typeof ElTabs>>()
let animation: Animation | undefined
async function changed() {
  await nextTick()
  animation?.cancel()
  if (!themed.value || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  const content = tabs.value?.$el.querySelector('.el-tabs__content') as HTMLElement | undefined
  animation = content?.animate?.(
    [
      { opacity: 0, transform: 'translateY(4px)' },
      { opacity: 1, transform: 'none' },
    ],
    { duration: 160, easing: 'ease-out' },
  )
}
onBeforeUnmount(() => animation?.cancel())
</script>
<template>
  <ElTabs ref="tabs" v-bind="$attrs" :class="{ 'wm-control-tabs': themed }" @tab-change="changed">
    <template v-for="(_, name) in $slots" #[name]="scope"
      ><slot :name="name" v-bind="scope || {}"
    /></template>
  </ElTabs>
</template>
