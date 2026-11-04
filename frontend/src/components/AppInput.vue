<script setup lang="ts">
import { ref } from 'vue'
import { ElInput, type InputInstance } from 'element-plus'
defineOptions({ inheritAttrs: false })
const input = ref<InputInstance>()
defineExpose({
  focus: () => input.value?.focus(),
  blur: () => input.value?.blur(),
  select: () => input.value?.select(),
  clear: () => input.value?.clear(),
})
</script>
<template>
  <ElInput ref="input" class="app-input" v-bind="$attrs">
    <template v-for="(_, name) in $slots" #[name]="scope"
      ><slot :name="name" v-bind="scope || {}"
    /></template>
  </ElInput>
</template>
