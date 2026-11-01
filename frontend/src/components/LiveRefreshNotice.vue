<script setup lang="ts">
import { WarningFilled } from '@element-plus/icons-vue'
import { ElButton, ElIcon } from 'element-plus'
defineProps<{ message: string }>()
defineEmits<{ retry: [] }>()
</script>
<template>
  <div v-if="message" class="live-refresh-notice" role="status" :title="message">
    <ElIcon><WarningFilled /></ElIcon>
    <span class="live-refresh-notice__message">{{ message }}</span>
    <ElButton link type="primary" @click="$emit('retry')">重试同步</ElButton>
  </div>
</template>

<style scoped>
.live-refresh-notice {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  flex: 0 1 auto;
  gap: 8px;
  width: fit-content;
  max-width: 100%;
  min-width: 0;
  min-height: 32px;
  padding: 4px 10px;
  box-sizing: border-box;
  border: 1px solid var(--el-color-warning-light-7);
  border-radius: 6px;
  background: var(--el-color-warning-light-9);
  color: var(--el-color-warning-dark-2);
  font-size: 12px;
  line-height: 20px;
}
.live-refresh-notice > .el-icon {
  flex-shrink: 0;
  font-size: 14px;
}
.live-refresh-notice__message {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.live-refresh-notice > .el-button {
  flex-shrink: 0;
  height: auto;
  margin: 0;
  padding: 0;
  font-size: inherit;
}
</style>
