<script setup lang="ts">
import { ElDialog } from 'element-plus'

const props = withDefaults(defineProps<{ modelValue: boolean; busy: boolean; title?: string }>(), { title: '转料单详情' })
const emit = defineEmits<{ close: [] }>()
function close() { if (props.modelValue && !props.busy) emit('close') }
</script>

<template>
  <ElDialog :model-value="modelValue" class="material-detail-dialog" :title="title" width="min(1080px, calc(100vw - 32px))" align-center :show-close="!busy" :close-on-click-modal="!busy" :close-on-press-escape="!busy" append-to-body :destroy-on-close="false" @update:model-value="!$event && close()">
    <template v-if="$slots.header" #header><slot name="header" /></template>
    <slot />
    <template v-if="$slots.footer" #footer><slot name="footer" /></template>
  </ElDialog>
</template>
