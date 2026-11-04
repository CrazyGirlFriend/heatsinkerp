<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElButton, type ButtonInstance } from 'element-plus'

// Retain the existing button API, form submission and focus restoration.
defineOptions({ inheritAttrs: false })
const button = ref<ButtonInstance>()
defineExpose({ ref: computed(() => button.value?.ref) })
</script>

<template>
  <ElButton ref="button" class="app-button" v-bind="$attrs">
    <template v-for="(_, name) in $slots" #[name]="scope">
      <slot :name="name" v-bind="scope || {}" />
    </template>
  </ElButton>
</template>
