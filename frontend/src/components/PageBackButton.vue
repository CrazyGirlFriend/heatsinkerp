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
  <ElButton v-if="destination" class="page-back-button" aria-label="返回" :icon="ArrowLeft" plain :title="destination.history ? '返回上一页' : '返回所属模块首页'" @click="goBack">返回</ElButton>
</template>

<style scoped>
.page-back-button.el-button.is-plain { flex: 0 0 auto; align-self: center; width: 82px; height: 36px; margin: 0; padding: 0 12px; border: 1px solid var(--line); border-radius: 11px; color: var(--primary); background: linear-gradient(150deg, #ffffffeb, #f3f9f5b8); box-shadow: inset 0 1px 0 #fff, 0 2px 5px #203b2e08; backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); font-size: 13px; font-weight: 500; transition: background-color .16s ease, border-color .16s ease, box-shadow .16s ease; }
.page-back-button.el-button.is-plain :deep(.el-icon) { font-size: 16px; transition: transform .16s ease; }
.page-back-button.el-button.is-plain:hover { color: var(--primary); border-color: var(--primary); background: var(--primary-soft); box-shadow: inset 0 1px 0 #ffffffc2, 0 3px 8px #203b2e0d; }
.page-back-button.el-button.is-plain:hover :deep(.el-icon) { transform: translateX(-2px); }
.page-back-button.el-button.is-plain:active { background: var(--primary-soft); box-shadow: inset 0 1px 3px #203b2e18; }
.page-back-button.el-button.is-plain:focus-visible { outline: 2px solid var(--primary); outline-offset: 3px; }
@media (prefers-reduced-motion: reduce) { .page-back-button.el-button.is-plain, .page-back-button.el-button.is-plain :deep(.el-icon) { transition: none; } .page-back-button.el-button.is-plain:hover :deep(.el-icon) { transform: none; } }
</style>
