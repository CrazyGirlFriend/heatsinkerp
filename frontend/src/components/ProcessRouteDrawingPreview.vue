<script setup lang="ts">
import DocumentPreviewTrigger from './DocumentPreviewTrigger.vue'
import AsyncStatus from './AsyncStatus.vue'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import ElButton from '@/components/AppButton.vue'
import { processRouteApi } from '@/services/processRouteApi'
import type { ProcessRouteDrawing } from '@/types/processRoute'
import DocumentViewer from './DocumentViewer.vue'

const props = defineProps<{
  routeId: number
  drawing?: ProcessRouteDrawing
  file?: File
  filename?: string
  loadPreview?: (signal: AbortSignal) => Promise<Blob>
  loadOriginal?: (signal?: AbortSignal) => Promise<Blob>
  thumbnail?: boolean
}>()
const url = ref(''),
  error = ref(''),
  loading = ref(false)
const viewing = ref(false)
let controller: AbortController | undefined
let generation = 0
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
  error.value = ''
  loading.value = true
  try {
    const blob =
      (props.loadPreview && (await props.loadPreview(controller.signal))) ||
      (props.file && (await processRouteApi.previewDrawing(props.file, controller.signal))) ||
      (props.drawing &&
        (await processRouteApi.drawing(props.routeId, props.drawing.id, controller.signal, true)))
    if (!blob || current !== generation) return
    url.value = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }))
  } catch {
    if (current === generation) error.value = '图纸读取失败，请重试'
  } finally {
    if (current === generation) loading.value = false
  }
}
const ready = computed(() => !!url.value && !loading.value)
function open() {
  if (ready.value) viewing.value = true
}
async function download() {
  const current = generation
  try {
    const blob =
      (props.loadOriginal && (await props.loadOriginal(controller?.signal))) ||
      props.file ||
      (props.drawing &&
        (await processRouteApi.drawing(props.routeId, props.drawing.id, controller?.signal)))
    if (!blob || current !== generation) return
    const original = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = original
    link.download = props.filename || props.file?.name || props.drawing?.filename || '图纸.pdf'
    link.click()
    setTimeout(() => URL.revokeObjectURL(original), 1000)
  } catch {
    if (current === generation) error.value = '原件下载失败，请重试'
  }
}
defineExpose({ open, ready })
watch(() => [props.routeId, props.drawing?.id, props.file, props.loadPreview], load, {
  immediate: true,
})
onBeforeUnmount(() => {
  ++generation
  controller?.abort()
  release()
})
</script>
<template>
  <section
    class="route-drawing-preview"
    :class="{ 'route-drawing-preview--thumbnail': thumbnail }"
    aria-label="图纸原件预览"
    :aria-busy="loading"
  >
    <AsyncStatus v-if="loading" label="正在读取图纸…" />
    <AsyncStatus v-if="error" state="error" :label="error"
      ><ElButton text @click="load">重试</ElButton></AsyncStatus
    >
    <template v-if="url">
      <div v-if="!thumbnail" class="drawing-preview-tools">
        <ElButton text @click="download">下载图纸原件</ElButton>
      </div>
      <DocumentPreviewTrigger class="drawing-preview-sheet" aria-label="放大图纸" @click="open">
        <iframe
          :src="`${url}#toolbar=0&navpanes=0&view=Fit`"
          title="PDF图纸原件"
          tabindex="-1"
          :loading="thumbnail ? 'lazy' : 'eager'"
          referrerpolicy="no-referrer"
        />
      </DocumentPreviewTrigger>
      <template v-if="thumbnail">
        <strong
          class="drawing-thumbnail-name"
          :title="filename || drawing?.filename || file?.name"
          >{{ filename || drawing?.filename || file?.name }}</strong
        >
        <ElButton class="drawing-thumbnail-download" link @click="download">下载原件</ElButton>
      </template>
      <DocumentViewer v-if="viewing" title="图纸" :pdf="url" @close="viewing = false" />
    </template>
  </section>
</template>
<style scoped>
.route-drawing-preview {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  gap: 12px;
  margin-top: 12px;
}
.route-drawing-preview p {
  font-size: 13px;
  color: var(--muted);
}
.drawing-preview-tools {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.drawing-preview-sheet {
  width: 100%;
  flex: 1;
}
.drawing-preview-sheet iframe {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  pointer-events: none;
}
.route-drawing-preview--thumbnail {
  flex: none;
  margin-top: 0;
  gap: 5px;
}
.route-drawing-preview--thumbnail .drawing-preview-sheet {
  height: 128px;
  flex: none;
}
.drawing-thumbnail-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}
.drawing-thumbnail-download {
  align-self: flex-start;
  font-size: 12px;
}
</style>
