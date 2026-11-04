<script setup lang="ts">
import AsyncStatus from './AsyncStatus.vue'
import ElSkeleton from '@/components/AppSkeleton.vue'
import { onBeforeUnmount, ref, watch } from 'vue'
import { ElSkeletonItem } from 'element-plus'
import ElButton from '@/components/AppButton.vue'
import DocumentViewer from './DocumentViewer.vue'
import { processRouteApi } from '@/services/processRouteApi'
import { productionScheduleApi } from '@/services/productionScheduleApi'

const props = withDefaults(
  defineProps<{
    routeId: number
    taskId?: number
    file?: File
    loadPreview?: (signal: AbortSignal) => Promise<Blob>
    thumbnail?: boolean
  }>(),
  { thumbnail: true },
)
const url = ref(''),
  loading = ref(false),
  error = ref(''),
  viewing = ref(false)
let generation = 0
let controller: AbortController | undefined
function release() {
  viewing.value = false
  if (url.value) URL.revokeObjectURL(url.value)
  url.value = ''
}
async function load() {
  const current = ++generation
  controller?.abort()
  controller = new AbortController()
  release()
  loading.value = true
  error.value = ''
  try {
    const blob = props.loadPreview
      ? await props.loadPreview(controller.signal)
      : props.file
        ? await productionScheduleApi.previewOrder(props.file, controller.signal)
        : props.taskId
          ? await productionScheduleApi.orderPreview(props.taskId, controller.signal)
          : await processRouteApi.orderPreview(props.routeId, controller.signal)
    if (current !== generation) return
    url.value = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }))
  } catch {
    if (current === generation) error.value = '订单原件预览失败，请重试或下载原件查看'
  } finally {
    if (current === generation) loading.value = false
  }
}
function open() {
  if (url.value && !loading.value) viewing.value = true
}
defineExpose({ open })
watch(
  [
    () => props.file,
    () => props.loadPreview,
    () => (props.file ? '' : props.taskId ? `task:${props.taskId}` : `route:${props.routeId}`),
  ],
  load,
  { immediate: true },
)
onBeforeUnmount(() => {
  ++generation
  controller?.abort()
  release()
})
</script>

<template>
  <section class="order-document-preview" aria-label="订单原件预览" :aria-busy="loading">
    <AsyncStatus v-if="loading" label="正在加载订单原件…" />
    <ElSkeleton v-if="loading" animated :throttle="0">
      <template #template>
        <ElSkeletonItem variant="image" class="order-document-placeholder" />
      </template>
    </ElSkeleton>
    <AsyncStatus v-if="error" state="error" :label="error"
      ><ElButton link @click="load">重试</ElButton></AsyncStatus
    >
    <button
      v-if="url"
      type="button"
      class="route-order-thumbnail"
      :class="{ 'route-order-thumbnail--full': !thumbnail }"
      aria-label="放大订单表"
      @click="open"
    >
      <iframe
        :src="`${url}#toolbar=0&navpanes=0&view=Fit`"
        title="订单表原件"
        tabindex="-1"
        referrerpolicy="no-referrer"
        loading="lazy"
      />
    </button>
    <DocumentViewer
      v-if="viewing"
      title="订单表"
      :pdf="url"
      :initial-zoom="100"
      @close="viewing = false"
    />
  </section>
</template>

<style scoped>
.order-document-preview {
  min-width: 0;
}
.order-document-preview p {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.5;
}
.order-document-placeholder {
  width: 100%;
  height: 150px;
  border-radius: 8px;
}
.route-order-thumbnail {
  display: block;
  width: 100%;
  height: 150px;
  overflow: hidden;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #eef1f0;
  cursor: zoom-in;
}
.route-order-thumbnail:hover,
.route-order-thumbnail:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
.route-order-thumbnail iframe {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  pointer-events: none;
}
.route-order-thumbnail--full {
  height: 280px;
}
@media (prefers-reduced-motion: reduce) {
  .order-document-preview :deep(.el-skeleton.is-animated .el-skeleton__item) {
    animation: none;
  }
}
</style>
