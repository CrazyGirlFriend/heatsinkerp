<script setup lang="ts">
import AppSelect from './AppSelect.vue'
import { ElOption } from 'element-plus'
import AsyncStatus from './AsyncStatus.vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElIcon } from 'element-plus'
import ElButton from '@/components/AppButton.vue'
import { Document, Download } from '@element-plus/icons-vue'
import { processRouteApi } from '@/services/processRouteApi'
import type { ProcessRoute } from '@/types/processRoute'
import DocumentViewer from './DocumentViewer.vue'

const props = defineProps<{
  route: ProcessRoute
  sourceFile?: File
  loadSource?: (signal?: AbortSignal) => Promise<Blob>
  sourceRow?: string
  compact?: boolean
  thumbnail?: boolean
}>()
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
    ? Math.min(
        1,
        Math.max(props.thumbnail ? 0.05 : 0.2, (viewportWidth.value - 24) / pageWidth.value),
      )
    : Number(zoom.value),
)
let generation = 0
let controller: AbortController | undefined
let observer: ResizeObserver | undefined
const viewing = ref(false)
function originalDocument(zoom: number) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"><meta name="referrer" content="no-referrer">${styles.value}<style>html{background:#eef1f0}body{margin:0;padding:12px;width:max-content;min-width:calc(100% - 24px);box-sizing:border-box}#original-pages{zoom:${zoom}}.docx-original-wrapper{padding:0!important;background:transparent!important}.docx-original-wrapper>section.docx-original{margin:0 0 16px!important;box-shadow:0 2px 10px #16362b14}.route-source-target>td{background:#fff2cf!important;box-shadow:inset 0 2px #c99638,inset 0 -2px #c99638}a{pointer-events:none;color:inherit;text-decoration:inherit}</style></head><body><main id="original-pages">${content.value}</main></body></html>`
}
const sourceDocument = computed(() => (content.value ? originalDocument(scale.value) : ''))
const ready = computed(() => !!content.value && !loading.value)
function open() {
  if (!ready.value) return
  viewing.value = true
}
defineExpose({ open, ready, download })

function fitRenderedPage() {
  const sections =
    frame.value?.contentDocument?.querySelectorAll<HTMLElement>('section.docx-original')
  if (!sections?.length) return
  const width = Math.max(...[...sections].map((section) => section.scrollWidth))
  if (width > pageWidth.value + 2) pageWidth.value = width
  highlightSource()
}
function highlightSource() {
  const doc = frame.value?.contentDocument
  doc
    ?.querySelectorAll('.route-source-target')
    .forEach((row) => row.classList.remove('route-source-target'))
  const match = props.sourceRow?.match(/^(\d+):(\d+)$/)
  if (!doc || !match) return
  const tables = [...doc.querySelectorAll('table')]
  const source = props.route.source_data.tables
  const tableIndex = Number(match[1]) - 1
  // Locate only when the rendered structure still matches the original table.
  // Pagination or unsupported Word layout must not highlight a different row.
  if (tables.length !== source.length) return
  const table = tables[tableIndex]
  if (!table || table.rows.length !== source[tableIndex]?.length) return
  const row = table.rows[Number(match[2]) - 1]
  if (!row) return
  row.classList.add('route-source-target')
  const view = frame.value?.contentWindow
  view?.scrollTo?.({ top: row.getBoundingClientRect().top + view.scrollY - view.innerHeight / 2 })
}
watch(() => props.sourceRow, highlightSource)

async function load() {
  const current = ++generation
  controller?.abort()
  controller = new AbortController()
  viewing.value = false
  loading.value = true
  error.value = ''
  content.value = styles.value = ''
  try {
    const [blob, renderer] = await Promise.all([
      props.sourceFile
        ? Promise.resolve(props.sourceFile)
        : props.loadSource
          ? props.loadSource(controller.signal)
          : processRouteApi.source(props.route.id, controller.signal),
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
watch(() => [props.route.id, props.route.filename, props.sourceFile, props.loadSource], load, {
  immediate: true,
})
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
    if (props.sourceFile || props.loadSource) {
      const blob = props.sourceFile || (await props.loadSource!(controller?.signal))
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = props.sourceFile?.name || props.route.filename
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } else await processRouteApi.download(props.route)
  } catch {
    error.value = '原件下载失败，请重试'
  }
}
</script>
<template>
  <section
    class="word-document-preview"
    :class="{ 'word-document-preview--thumbnail': thumbnail }"
    aria-label="Word原文件预览"
    :aria-busy="loading"
  >
    <div v-if="!thumbnail" class="word-preview-tools">
      <span v-if="compact" class="word-preview-filename" :title="sourceFile?.name || route.filename"
        ><ElIcon><Document /></ElIcon><span>{{ sourceFile?.name || route.filename }}</span></span
      >
      <label
        ><span v-if="!compact">缩放</span
        ><AppSelect v-model="zoom" class="document-zoom-select" aria-label="原文件缩放">
          <ElOption value="fit" label="适合宽度" />
          <ElOption
            v-for="value in ['0.5', '0.75', '1', '1.25', '1.5', '2', '3']"
            :key="value"
            :value="value"
            :label="`${Number(value) * 100}%`"
          /> </AppSelect
      ></label>
      <ElButton
        text
        :icon="compact ? Download : undefined"
        aria-label="下载原件"
        title="下载原件"
        @click="download"
        ><template v-if="!compact">下载原件</template></ElButton
      >
    </div>
    <AsyncStatus v-if="loading" label="正在打开原文件…" />
    <AsyncStatus v-if="error" state="error" :label="error"
      ><ElButton text @click="load">重试</ElButton></AsyncStatus
    >
    <iframe
      ref="frame"
      :srcdoc="sourceDocument"
      sandbox="allow-same-origin"
      @load="fitRenderedPage"
      referrerpolicy="no-referrer"
      title="上传的Word原文件"
      class="word-original-frame"
      :class="{ 'word-original-frame--hidden': !content }"
    />
    <button
      v-if="thumbnail && ready"
      type="button"
      class="word-thumbnail-open"
      aria-label="放大工艺原稿"
      @click="open"
    />
    <DocumentViewer
      v-if="viewing"
      title="工艺原稿"
      :html="originalDocument(1)"
      @close="viewing = false"
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
.word-preview-filename {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
  color: #54718a;
}
.word-preview-filename > span {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.word-preview-tools > .el-button {
  flex-shrink: 0;
  margin-left: 0;
}
.word-preview-tools label {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
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
.word-document-preview--thumbnail {
  position: relative;
  height: 206px;
  flex: none;
}
.word-document-preview--thumbnail .word-original-frame {
  min-height: 0;
  height: 100%;
  pointer-events: none;
}
.word-thumbnail-open {
  position: absolute;
  inset: 0;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: transparent;
  cursor: zoom-in;
}
.word-thumbnail-open:hover,
.word-thumbnail-open:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
</style>
