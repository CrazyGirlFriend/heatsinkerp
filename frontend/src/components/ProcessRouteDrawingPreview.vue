<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElButton } from 'element-plus'
import { processRouteApi } from '@/services/processRouteApi'
import type { ProcessRouteDrawing } from '@/types/processRoute'
import DocumentViewer from './DocumentViewer.vue'

const props = defineProps<{ routeId: number; drawing?: ProcessRouteDrawing; file?: File }>()
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
      props.file ||
      (props.drawing &&
        (await processRouteApi.drawing(props.routeId, props.drawing.id, controller?.signal)))
    if (!blob || current !== generation) return
    const original = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = original
    link.download = props.file?.name || props.drawing?.filename || '图纸.pdf'
    link.click()
    setTimeout(() => URL.revokeObjectURL(original), 1000)
  } catch {
    if (current === generation) error.value = '原件下载失败，请重试'
  }
}
defineExpose({ open, ready })
watch(() => [props.routeId, props.drawing?.id, props.file], load, { immediate: true })
onBeforeUnmount(() => {
  ++generation
  controller?.abort()
  release()
})
</script>
<template>
  <section class="route-drawing-preview" aria-label="图纸原件预览" :aria-busy="loading">
    <p v-if="loading" role="status">正在读取图纸…</p>
    <p v-if="error" role="alert">{{ error }} <ElButton text @click="load">重试</ElButton></p>
    <template v-if="url">
      <div class="drawing-preview-tools">
        <ElButton text @click="download">下载图纸原件</ElButton>
      </div>
      <button type="button" class="drawing-preview-sheet" aria-label="放大图纸" @click="open">
        <iframe
          :src="`${url}#toolbar=0&navpanes=0&view=Fit`"
          title="PDF图纸原件"
          tabindex="-1"
          referrerpolicy="no-referrer"
        />
      </button>
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
  min-height: 0;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: #fff;
  padding: 0;
  overflow: hidden;
  cursor: zoom-in;
}
.drawing-preview-sheet:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
.drawing-preview-sheet iframe {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  pointer-events: none;
}
</style>
