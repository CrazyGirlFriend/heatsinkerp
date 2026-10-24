<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElButton } from 'element-plus'
import { processRouteApi } from '@/services/processRouteApi'
import type { ProcessRoute } from '@/types/processRoute'

const props = defineProps<{ route: ProcessRoute }>()
const frame = ref<HTMLIFrameElement>()
const content = ref(''),
  styles = ref(''),
  error = ref(''),
  loading = ref(false)
const viewportWidth = ref(600),
  pageWidth = ref(800)
const zoom = ref('fit')
const scale = computed(() =>
  zoom.value === 'fit'
    ? Math.min(1, Math.max(0.2, (viewportWidth.value - 24) / pageWidth.value))
    : Number(zoom.value),
)
let generation = 0
let controller: AbortController | undefined
let observer: ResizeObserver | undefined
const sourceDocument = computed(() =>
  content.value
    ? `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"><meta name="referrer" content="no-referrer">${styles.value}<style>html{background:#eef1f0}body{margin:0;padding:12px;width:max-content;min-width:calc(100% - 24px);box-sizing:border-box}#original-pages{zoom:${scale.value}}.docx-original-wrapper{padding:0!important;background:transparent!important}.docx-original-wrapper>section.docx-original{margin:0 0 16px!important;box-shadow:0 2px 10px #16362b14}a{pointer-events:none;color:inherit;text-decoration:inherit}</style></head><body><main id="original-pages">${content.value}</main></body></html>`
    : '',
)

async function load() {
  const current = ++generation
  controller?.abort()
  controller = new AbortController()
  loading.value = true
  error.value = ''
  content.value = styles.value = ''
  try {
    const [blob, renderer] = await Promise.all([
      processRouteApi.source(props.route.id, controller.signal),
      import('docx-preview'),
    ])
    if (current !== generation) return
    const detached = document.implementation.createHTMLDocument('Word 原件')
    const body = detached.createElement('div'),
      style = detached.createElement('div')
    await renderer.renderAsync(await blob.arrayBuffer(), body, style, {
      className: 'docx-original',
      inWrapper: true,
      ignoreWidth: false,
      ignoreHeight: false,
      ignoreFonts: false,
      renderHeaders: true,
      renderFooters: true,
      renderFootnotes: true,
      renderEndnotes: true,
      renderComments: false,
      renderAltChunks: false,
      renderChanges: false,
      useBase64URL: true,
      ignoreLastRenderedPageBreak: false,
    })
    if (current !== generation) return
    body.querySelectorAll('a').forEach((link) => {
      link.removeAttribute('href')
      link.removeAttribute('target')
    })
    const originalWidth = body.querySelector<HTMLElement>('section')?.style.width || ''
    pageWidth.value =
      Number.parseFloat(originalWidth) * (originalWidth.endsWith('pt') ? 96 / 72 : 1) || 800
    styles.value = style.innerHTML
    content.value = body.innerHTML
  } catch {
    if (current === generation) error.value = '原文件预览暂时失败，请重试或下载原件查看'
  } finally {
    if (current === generation) loading.value = false
  }
}
watch(() => props.route.id, load, { immediate: true })
onMounted(() => {
  if (!frame.value) return
  viewportWidth.value = frame.value.clientWidth || 600
  observer = new ResizeObserver((entries) => {
    viewportWidth.value = entries[0]?.contentRect.width || 600
  })
  observer.observe(frame.value)
})
onBeforeUnmount(() => {
  ++generation
  controller?.abort()
  observer?.disconnect()
})
async function download() {
  try {
    await processRouteApi.download(props.route)
  } catch {
    error.value = '原件下载失败，请重试'
  }
}
</script>
<template>
  <section class="word-document-preview" aria-label="Word原文件预览" :aria-busy="loading">
    <div class="word-preview-tools">
      <label
        >缩放<select v-model="zoom" aria-label="原文件缩放">
          <option value="fit">适合宽度</option>
          <option value="0.5">50%</option>
          <option value="0.75">75%</option>
          <option value="1">100%</option>
          <option value="1.25">125%</option>
          <option value="1.5">150%</option>
        </select></label
      >
      <ElButton text @click="download">下载原件</ElButton>
    </div>
    <p v-if="loading" class="word-preview-message" role="status">正在打开原文件…</p>
    <div v-if="error" class="word-preview-message" role="alert">
      {{ error }} <ElButton text @click="load">重试</ElButton>
    </div>
    <iframe
      ref="frame"
      :srcdoc="sourceDocument"
      sandbox=""
      referrerpolicy="no-referrer"
      title="上传的Word原文件"
      class="word-original-frame"
      :class="{ 'word-original-frame--hidden': !content }"
    />
  </section>
</template>
<style scoped>
.word-document-preview {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.word-preview-tools {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 2px 0 10px;
  color: var(--muted);
  font-size: 12px;
}
.word-preview-tools label {
  display: flex;
  align-items: center;
  gap: 8px;
}
.word-preview-tools select {
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 5px 8px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
}
.word-original-frame {
  width: 100%;
  height: 100%;
  min-height: 420px;
  flex: 1;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: #eef1f0;
}
.word-original-frame--hidden {
  min-height: 0;
  height: 0;
  visibility: hidden;
}
.word-preview-message {
  margin: 0;
  padding: 20px 8px;
  line-height: 1.6;
  color: var(--muted);
  font-size: 13px;
}
</style>
