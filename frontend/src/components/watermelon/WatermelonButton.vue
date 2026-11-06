<script setup lang="ts">
import AppButton from '../AppButton.vue'
import { IconLoader2 } from '@tabler/icons-vue'
defineProps<{ primary?: boolean; loading?: boolean; disabled?: boolean }>()
</script>
<template>
  <AppButton
    watermelon
    class="wm-button"
    :class="{ 'wm-button-primary': primary }"
    :type="primary ? 'primary' : 'default'"
    :loading="loading"
    :disabled="disabled"
  >
    <span class="wm-button-label"><slot /></span>
    <template #loading><IconLoader2 :size="16" class="wm-button-spinner is-loading" /></template>
  </AppButton>
</template>

<style scoped>
.wm-button-label {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  line-height: 1.25;
}
.wm-button-label :deep(svg) {
  display: block;
  flex: 0 0 auto;
}
</style>
