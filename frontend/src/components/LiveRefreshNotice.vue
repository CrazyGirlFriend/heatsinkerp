<script setup lang="ts">
import { ElAlert, ElButton } from 'element-plus'
defineProps<{ message: string }>()
defineEmits<{ retry: [] }>()
</script>
<template>
  <ElAlert v-if="message" type="warning" :closable="false" class="live-refresh-notice">
    <template #title>{{ message }} <ElButton link type="primary" @click="$emit('retry')">重试同步</ElButton></template>
  </ElAlert>
</template>
