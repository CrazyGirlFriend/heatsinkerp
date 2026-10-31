<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElAlert, ElButton, ElIcon } from 'element-plus'
import { Document } from '@element-plus/icons-vue'
import WordDocumentPreview from './WordDocumentPreview.vue'
import ProcessRouteDrawingPreview from './ProcessRouteDrawingPreview.vue'
import DocumentViewer from './DocumentViewer.vue'
import { processRouteApi } from '@/services/processRouteApi'
import type { ProcessRoute, RouteOrderDocument } from '@/types/processRoute'
const props = withDefaults(
  defineProps<{
    route: ProcessRoute
    sourceRow?: string
    documents?: ('order' | 'word' | 'drawing')[]
    orderThumbnail?: boolean
    sourceFile?: File
    orderFile?: File
    orderDocument?: RouteOrderDocument | null
    orderDownload?: () => Promise<void>
    pendingDrawings?: File[]
    editable?: boolean
    disabled?: boolean
  }>(),
  { documents: () => ['order', 'word', 'drawing'], orderThumbnail: true },
)
const emit = defineEmits<{
  removeDrawing: [id: number]
  removePendingDrawing: [file: File]
}>()
const wordPreview = ref<InstanceType<typeof WordDocumentPreview>>()
const orderViewing = ref(false),
  error = ref('')
const order = computed(() =>
  props.orderDocument === undefined ? props.route.source_data.order_document : props.orderDocument,
)
const orderHtml = computed(() => {
  const document = order.value
  if (!document) return ''
  const escape = (value: string) =>
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  const values = document.display_values || document.values
  const rows = document.headers
    .map(
      (label, index) =>
        `<tr><th>${escape(label || '—')}</th><td>${escape(values[index] || '—')}</td></tr>`,
    )
    .join('')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>body{margin:24px;font:14px system-ui;color:#17221e}section{width:760px;background:white;padding:24px;box-sizing:border-box}h1{font-size:18px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #cbd5cf;padding:10px;text-align:left;white-space:pre-wrap;overflow-wrap:anywhere}th{width:180px;background:#f2f6f3}</style></head><body><main id="original-pages"><section class="docx-original"><h1>${escape(document.filename)}</h1><table>${rows}</table></section></main></body></html>`
})

async function downloadOrder() {
  try {
    if (props.orderFile) {
      const url = URL.createObjectURL(props.orderFile)
      const link = document.createElement('a')
      link.href = url
      link.download = props.orderFile.name
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } else if (props.orderDownload) await props.orderDownload()
    else await processRouteApi.downloadOrder(props.route)
  } catch (e) {
    error.value = e instanceof Error ? e.message : '订单表下载失败'
  }
}
function open(kind: 'word' | 'order') {
  if (!props.documents.includes(kind)) return
  if (kind === 'order') orderViewing.value = true
  else wordPreview.value?.open()
}
defineExpose({ open })
</script>
<template>
  <aside class="route-attachment-rail" aria-label="工艺附件缩略图">
    <div v-if="documents.includes('order') && order" class="route-attachment-card">
      <button
        type="button"
        class="route-order-thumbnail"
        :class="{ 'route-order-thumbnail--full': !orderThumbnail }"
        aria-label="放大订单表"
        @click="orderViewing = true"
      >
        <table aria-hidden="true">
          <tbody>
            <tr
              v-for="(label, index) in orderThumbnail ? order.headers.slice(0, 12) : order.headers"
              :key="index"
            >
              <th>{{ label }}</th>
              <td>
                {{ (order.display_values || order.values)[index] }}
              </td>
            </tr>
          </tbody>
        </table>
      </button>
      <strong>订单表</strong>
      <span :title="order.filename">{{ order.filename }}</span>
      <ElButton link @click="downloadOrder">下载原件</ElButton>
    </div>
    <div
      v-else-if="documents.includes('order') && route.route_kind !== 'rework'"
      class="route-attachment-card route-attachment-card--missing"
    >
      <ElIcon><Document /></ElIcon><strong>订单表</strong><span>未上传</span>
    </div>
    <div
      v-if="documents.includes('word') && (sourceFile || route.filename)"
      class="route-attachment-card"
    >
      <WordDocumentPreview
        ref="wordPreview"
        :route="route"
        :source-file="sourceFile"
        :source-row="sourceRow"
        thumbnail
      />
      <strong>工艺原稿</strong>
      <span :title="sourceFile?.name || route.filename">{{
        sourceFile?.name || route.filename
      }}</span>
      <ElButton link @click="wordPreview?.download()">下载原件</ElButton>
    </div>
    <div
      v-else-if="documents.includes('word') && route.route_kind !== 'rework'"
      class="route-attachment-card route-attachment-card--missing"
    >
      <ElIcon><Document /></ElIcon><strong>工艺原件</strong><span>未上传</span>
    </div>
    <template v-if="documents.includes('drawing')">
      <div v-for="drawing in route.drawings" :key="drawing.id" class="route-attachment-card">
        <ProcessRouteDrawingPreview :route-id="route.id" :drawing="drawing" thumbnail />
        <ElButton
          v-if="editable"
          link
          type="danger"
          :disabled="disabled"
          :aria-label="`移除 ${drawing.filename}`"
          @click="emit('removeDrawing', drawing.id)"
          >移除</ElButton
        >
      </div>
      <div
        v-for="(file, index) in pendingDrawings"
        :key="`pending-${index}`"
        class="route-attachment-card"
      >
        <ProcessRouteDrawingPreview :route-id="route.id" :file="file" thumbnail />
        <span>待保存</span>
        <ElButton
          v-if="editable"
          link
          type="danger"
          :disabled="disabled"
          :aria-label="`移除 ${file.name}`"
          @click="emit('removePendingDrawing', file)"
          >移除</ElButton
        >
      </div>
    </template>
    <div
      v-if="documents.includes('drawing') && !route.drawings?.length && !pendingDrawings?.length"
      class="route-attachment-card route-attachment-card--missing"
    >
      <ElIcon><Document /></ElIcon><strong>图纸</strong
      ><span>{{ route.route_kind === 'rework' ? '图纸缺失' : '未上传' }}</span>
    </div>
  </aside>
  <DocumentViewer
    v-if="orderViewing && documents.includes('order')"
    title="订单表"
    :html="orderHtml"
    @close="orderViewing = false"
  />
  <ElAlert v-if="error" :title="error" type="error" :closable="false" />
</template>
<style scoped>
.route-attachment-rail {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}
.route-attachment-card {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
  padding: 8px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: #ffffffc9;
}
.route-attachment-card > :is(strong, span) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}
.route-attachment-card > span {
  font-size: 11px;
  color: var(--muted);
}
.route-attachment-card > .el-button {
  align-self: flex-start;
  font-size: 12px;
}
.route-attachment-card--missing {
  min-height: 96px;
  align-items: center;
  justify-content: center;
  border-style: dashed;
  background: #ffffff80;
}
.route-attachment-card--missing > .el-icon {
  color: var(--muted);
  font-size: 20px;
}
.route-attachment-card--missing > span {
  color: #9b702e;
}
.route-order-thumbnail {
  height: 150px;
  overflow: hidden;
  padding: 8px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: white;
  cursor: zoom-in;
}
.route-order-thumbnail:hover,
.route-order-thumbnail:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
.route-order-thumbnail table {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
  font-size: 4px;
  line-height: 1.5;
  color: var(--text);
}
.route-order-thumbnail :is(th, td) {
  border: 1px solid #d5ddd8;
  padding: 2px;
  overflow-wrap: anywhere;
}
.route-order-thumbnail--full {
  height: auto;
  padding: 0;
  text-align: left;
}
.route-order-thumbnail--full table {
  font-size: 13px;
}
.route-order-thumbnail--full :is(th, td) {
  padding: 8px 12px;
  white-space: pre-wrap;
  font-weight: 400;
}
.route-order-thumbnail--full th {
  width: 28%;
  background: #f2f6f3;
}

@media (max-width: 760px) {
  .route-attachment-rail {
    flex-direction: row;
    overflow-x: auto;
    padding: 4px;
  }
  .route-attachment-card {
    flex: 0 0 160px;
  }
  .route-attachment-card:has(.route-order-thumbnail--full) {
    flex: 1 0 100%;
  }
}
</style>
