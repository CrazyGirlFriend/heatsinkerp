<script setup lang="ts">
import { Loading, RefreshRight } from '@element-plus/icons-vue'
import { ElButton, ElEmpty, ElIcon, ElResult } from 'element-plus'

withDefaults(
  defineProps<{
    state: 'loading' | 'empty' | 'error'
    title?: string
    description?: string
    compact?: boolean
  }>(),
  {
    title: '',
    description: '',
    compact: false,
  },
)

defineEmits<{ retry: [] }>()
</script>

<template>
  <div class="state-panel" :class="{ 'state-panel--compact': compact }">
    <template v-if="state === 'loading'">
      <ElIcon class="state-loading" aria-hidden="true"><Loading /></ElIcon>
      <strong>{{ title || '正在加载' }}</strong>
      <span v-if="description">{{ description }}</span>
    </template>

    <ElResult
      v-else-if="state === 'error'"
      class="state-result"
      icon="error"
      :title="title || '加载失败'"
      :sub-title="description || '暂时无法获取数据。'"
    >
      <template #extra>
        <ElButton type="primary" plain :icon="RefreshRight" @click="$emit('retry')">重新加载</ElButton>
      </template>
    </ElResult>

    <template v-else>
      <ElEmpty class="state-empty" :image-size="compact ? 64 : 88" :description="title || '暂无数据'" />
      <span v-if="description" class="state-description">{{ description }}</span>
      <slot />
    </template>
  </div>
</template>

<style scoped>
.state-panel {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 300px;
  padding: 32px 24px;
  flex-direction: column;
  color: var(--muted);
  text-align: center;
}
.state-panel--compact { min-height: 180px; }
.state-loading { color: var(--orange); font-size: 34px; animation: rotating 1.1s linear infinite; }
.state-panel > strong { margin-top: 13px; color: var(--text); font-size: 15px; }
.state-panel > span { margin-top: 5px; font-size: 13px; }
.state-result { width: 100%; padding: 0; }
.state-result :deep(.el-result__icon svg) { width: 54px; height: 54px; }
.state-result :deep(.el-result__title p) { font-size: 16px; }
.state-result :deep(.el-result__subtitle p) { font-size: 13px; }
.state-empty { padding: 0; }
.state-description { margin: -10px 0 14px; color: #718094; font-size: 13px; }
@keyframes rotating { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .state-loading { animation-duration: 2.4s; } }
</style>
