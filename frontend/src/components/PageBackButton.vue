<script setup lang="ts">
import { computed } from 'vue'
import { useRouter, type RouteLocationRaw } from 'vue-router'
import { ElButton } from 'element-plus'
import { ArrowLeft } from '@element-plus/icons-vue'
import { useAuthStore } from '@/stores/auth'
import { appPinia } from '@/stores/access'
import { pageBackDestination } from '@/utils/navigation'

const props = defineProps<{ fallback?: RouteLocationRaw }>()
const router = useRouter()
const auth = useAuthStore(appPinia)
const destination = computed(() => pageBackDestination(router, auth.currentUser, props.fallback))
function goBack(): void {
  const target = destination.value
  if (!target) return
  if (target.history) router.back()
  else void router.replace(target.path)
}
</script>

<template>
  <ElButton
    v-if="destination"
    class="page-back-button"
    aria-label="返回"
    :icon="ArrowLeft"
    :title="destination.history ? '返回上一页' : '返回所属模块首页'"
    @click="goBack"
    >返回</ElButton
  >
</template>

<style scoped>
.page-back-button.el-button {
  flex: 0 0 auto;
  align-self: center;
  width: 82px;
  height: 36px;
  margin: 0;
  padding: 0 12px;
  border-radius: 11px;
  font-size: 13px;
  font-weight: 500;
}
.page-back-button.el-button :deep(.el-icon) {
  font-size: 16px;
  transition: transform 0.16s ease;
}
.page-back-button.el-button:not(:disabled):not(.is-loading):hover :deep(.el-icon) {
  transform: translateX(-2px);
}
.page-back-button.el-button:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 3px;
}
@media (prefers-reduced-motion: reduce) {
  .page-back-button.el-button,
  .page-back-button.el-button :deep(.el-icon) {
    transition: none;
  }
  .page-back-button.el-button:not(:disabled):not(.is-loading):hover :deep(.el-icon) {
    transform: none;
  }
}
</style>
