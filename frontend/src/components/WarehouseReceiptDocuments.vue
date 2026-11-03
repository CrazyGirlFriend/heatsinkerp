<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElButton } from 'element-plus'
import { Upload } from '@element-plus/icons-vue'
import DocumentCard from './DocumentCard.vue'
import WordDocumentPreview from './WordDocumentPreview.vue'
import OrderDocumentPreview from './OrderDocumentPreview.vue'
import ProcessRouteDrawingPreview from './ProcessRouteDrawingPreview.vue'
import { processRouteApi } from '@/services/processRouteApi'
import { productionScheduleApi } from '@/services/productionScheduleApi'
import { warehouseReceiptDocumentApi } from '@/services/warehouseReceiptDocumentApi'
import type { ProcessRoute, RouteOrderDocument } from '@/types/processRoute'
import type { ReceiptDocument, ReceiptDocumentKind } from '@/types/warehouseReceiptDocuments'

const props = withDefaults(
  defineProps<{
    teamId?: number
    route?: ProcessRoute
    sourceRoute?: ProcessRoute
    serialNo?: string
    documents: ReceiptDocument[]
    editable?: boolean
    disabled?: boolean
  }>(),
  { editable: false, disabled: false },
)
const emit = defineEmits<{
  uploaded: [document: ReceiptDocument]
  remove: [id: number]
  busy: [value: boolean]
  error: [message: string]
  'inherited-order': [document: RouteOrderDocument | null]
}>()
const labels = { process: '工艺原件', drawing: '图纸', order: '订单表' } as const
const extensions = { process: '.docx', drawing: '.pdf', order: '.xlsx' } as const
const input = ref<HTMLInputElement>()
const uploadKind = ref<ReceiptDocumentKind>('process')
const uploading = ref(false)
const orderLoading = ref(false)
const orderError = ref('')
const dispatchOrder = ref<{ task_id: number; document: RouteOrderDocument } | null>(null)
const legacyOrder = ref<RouteOrderDocument | null>(null)
const wordPreview = ref<InstanceType<typeof WordDocumentPreview>>()
const processDocument = computed(() => props.documents.find((item) => item.kind === 'process'))
const orderDocument = computed(() =>
  props.documents.find(
    (item) =>
      item.kind === 'order' &&
      (props.editable ||
        !props.serialNo ||
        !item.parsed.serial_no ||
        item.parsed.serial_no === props.serialNo.trim()),
  ),
)
const drawingDocuments = computed(() =>
  props.documents
    .filter((item) => item.kind === 'drawing')
    .map((document) => ({
      ...document,
      preview: (signal: AbortSignal) => warehouseReceiptDocumentApi.file(document.id, signal, true),
      original: (signal?: AbortSignal) => warehouseReceiptDocumentApi.file(document.id, signal),
    })),
)
const wordRoute = computed<ProcessRoute | undefined>(() => {
  const document = processDocument.value
  if (!document) return props.sourceRoute || props.route
  return {
    id: 0,
    title: document.filename,
    filename: document.filename,
    state: 'draft',
    version: 1,
    parent_id: null,
    serial_nos: document.parsed.serial_nos || [],
    steps: [],
    review_note: null,
    source_data: { tables: [], issues: [] },
    created_by: '',
    created_at: '',
    published_at: null,
  }
})
const processLoader = computed(() => {
  const id = processDocument.value?.id
  return id ? (signal?: AbortSignal) => warehouseReceiptDocumentApi.file(id, signal) : undefined
})
const orderLoader = computed(() => {
  const id = orderDocument.value?.id
  return id
    ? (signal: AbortSignal) => warehouseReceiptDocumentApi.file(id, signal, true)
    : undefined
})
const inheritedOrder = computed(() => dispatchOrder.value?.document ?? legacyOrder.value)
const orderName = computed(() => orderDocument.value?.filename || inheritedOrder.value?.filename)
let orderGeneration = 0
let uploadGeneration = 0
let active = true

async function loadOrder() {
  const generation = ++orderGeneration
  dispatchOrder.value = null
  legacyOrder.value = null
  orderError.value = ''
  orderLoading.value = false
  emit('inherited-order', null)
  const serial = props.serialNo?.trim()
  if (!props.route?.id || !serial || orderDocument.value) return
  orderLoading.value = true
  try {
    const result = await processRouteApi.dispatchOrder(props.route.id, serial)
    if (generation !== orderGeneration) return
    dispatchOrder.value = result
    const original = props.route.source_data.order_document
    if (!result && original?.serial_no === serial) legacyOrder.value = original
    emit('inherited-order', result?.document ?? legacyOrder.value)
  } catch (error) {
    if (generation !== orderGeneration) return
    orderError.value = error instanceof Error ? error.message : '订单资料读取失败'
  } finally {
    if (generation === orderGeneration) orderLoading.value = false
  }
}
watch(
  () => uploading.value || orderLoading.value,
  (busy) => emit('busy', busy),
  { immediate: true },
)
watch([() => props.route?.id, () => props.serialNo, () => orderDocument.value?.id], loadOrder, {
  immediate: true,
})
watch(
  () => props.teamId,
  () => {
    ++uploadGeneration
    uploading.value = false
  },
)
function choose(kind: ReceiptDocumentKind) {
  if (!props.editable || props.disabled || uploading.value || !props.teamId) return
  uploadKind.value = kind
  if (input.value) {
    input.value.accept = extensions[kind]
    input.value.multiple = kind === 'drawing'
    input.value.click()
  }
}
async function upload(event: Event) {
  const target = event.target as HTMLInputElement
  const files = [...(target.files || [])]
  target.value = ''
  if (!files.length || !props.editable || props.disabled || uploading.value || !props.teamId) return
  const generation = ++uploadGeneration
  const teamId = props.teamId
  const kind = uploadKind.value
  uploading.value = true
  emit('error', '')
  try {
    for (const file of files) {
      const document = await warehouseReceiptDocumentApi.upload(teamId, kind, file)
      if (!active || generation !== uploadGeneration) return
      emit('uploaded', document)
    }
  } catch (error) {
    if (active && generation === uploadGeneration)
      emit('error', error instanceof Error ? error.message : `${labels[kind]}上传失败`)
  } finally {
    if (active && generation === uploadGeneration) {
      uploading.value = false
    }
  }
}
async function downloadOrder() {
  try {
    if (orderDocument.value) await warehouseReceiptDocumentApi.download(orderDocument.value)
    else if (dispatchOrder.value)
      await productionScheduleApi.downloadOrder(
        dispatchOrder.value.task_id,
        dispatchOrder.value.document.filename,
      )
    else if (legacyOrder.value && props.route) await processRouteApi.downloadOrder(props.route)
  } catch (error) {
    emit('error', error instanceof Error ? error.message : '订单原件下载失败')
  }
}
onBeforeUnmount(() => {
  active = false
  ++orderGeneration
  ++uploadGeneration
  if (uploading.value || orderLoading.value) emit('busy', false)
})
</script>

<template>
  <aside
    class="receipt-documents"
    aria-label="入库附件缩略图"
    :aria-busy="uploading || orderLoading"
  >
    <input
      ref="input"
      class="receipt-document-input"
      type="file"
      aria-label="上传入库资料"
      @change="upload"
    />
    <DocumentCard
      class="receipt-document-card"
      data-document-kind="process"
      title="工艺原件"
      :source="processDocument ? '本次补传' : wordRoute?.filename ? '来自工艺' : undefined"
      :filename="wordRoute?.filename || undefined"
      :missing="wordRoute?.filename ? undefined : '未上传工艺原件'"
    >
      <WordDocumentPreview
        v-if="wordRoute?.filename"
        ref="wordPreview"
        :route="wordRoute"
        :load-source="processLoader"
        thumbnail
      />
      <template #actions>
        <ElButton v-if="wordRoute?.filename" link @click="wordPreview?.download()"
          >下载原件</ElButton
        >
        <ElButton
          v-if="editable && (processDocument || !wordRoute?.filename)"
          link
          :icon="Upload"
          :disabled="disabled || uploading"
          @click="choose('process')"
          >{{ wordRoute?.filename ? '替换' : '上传' }}</ElButton
        >
        <ElButton
          v-if="editable && processDocument"
          link
          type="danger"
          :disabled="disabled || uploading"
          @click="emit('remove', processDocument.id)"
          >移除</ElButton
        >
      </template>
    </DocumentCard>
    <DocumentCard
      v-for="drawing in route?.drawings || []"
      :key="`route-${drawing.id}`"
      class="receipt-document-card"
      data-document-kind="drawing"
      title="图纸"
      source="来自工艺"
    >
      <ProcessRouteDrawingPreview :route-id="route!.id" :drawing="drawing" thumbnail />
    </DocumentCard>
    <DocumentCard
      v-for="drawing in drawingDocuments"
      :key="`receipt-${drawing.id}`"
      class="receipt-document-card"
      data-document-kind="drawing"
      title="图纸"
      source="本次补传"
    >
      <ProcessRouteDrawingPreview
        :route-id="0"
        :filename="drawing.filename"
        :load-preview="drawing.preview"
        :load-original="drawing.original"
        thumbnail
      />
      <template v-if="editable" #actions
        ><ElButton
          link
          type="danger"
          :disabled="disabled || uploading"
          :aria-label="`移除 ${drawing.filename}`"
          @click="emit('remove', drawing.id)"
          >移除</ElButton
        ></template
      >
    </DocumentCard>
    <DocumentCard
      v-if="!route?.drawings?.length && !drawingDocuments.length"
      class="receipt-document-card"
      data-document-kind="drawing"
      title="图纸"
      missing="未上传图纸"
    >
      <template v-if="editable" #actions
        ><ElButton link :icon="Upload" :disabled="disabled || uploading" @click="choose('drawing')"
          >上传图纸</ElButton
        ></template
      >
    </DocumentCard>
    <ElButton
      v-else-if="editable"
      :icon="Upload"
      :disabled="disabled || uploading"
      size="small"
      @click="choose('drawing')"
      >补充图纸</ElButton
    >
    <DocumentCard
      class="receipt-document-card"
      data-document-kind="order"
      title="订单表"
      :source="
        orderDocument
          ? '本次补传'
          : inheritedOrder
            ? dispatchOrder
              ? '来自排期'
              : '来自工艺'
            : undefined
      "
      :filename="orderName"
      :missing="!orderName && !orderLoading && !orderError ? '未上传订单表' : undefined"
    >
      <OrderDocumentPreview
        v-if="orderName"
        :route-id="route?.id || 0"
        :task-id="dispatchOrder?.task_id"
        :load-preview="orderLoader"
        thumbnail
      />
      <p v-else-if="orderLoading" class="receipt-document-state" role="status">正在读取订单…</p>
      <p v-else-if="orderError" class="receipt-document-state" role="alert">
        {{ orderError }} <ElButton link @click="loadOrder">重试</ElButton>
      </p>
      <template #actions>
        <ElButton v-if="orderName" link @click="downloadOrder">下载原件</ElButton>
        <ElButton
          v-if="editable && (orderDocument || !inheritedOrder)"
          link
          :icon="Upload"
          :disabled="disabled || uploading"
          @click="choose('order')"
          >{{ orderName ? '替换' : '上传' }}</ElButton
        >
        <ElButton
          v-if="editable && orderDocument"
          link
          type="danger"
          :disabled="disabled || uploading"
          @click="emit('remove', orderDocument.id)"
          >移除</ElButton
        >
      </template>
    </DocumentCard>
    <span v-if="uploading" class="receipt-document-state" role="status"
      >正在导入{{ labels[uploadKind] }}…</span
    >
  </aside>
</template>
<style scoped>
.receipt-documents {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.receipt-document-input {
  display: none;
}
.receipt-document-state {
  color: var(--muted);
  font-size: 12px;
}
.receipt-document-card :deep(.word-document-preview--thumbnail) {
  height: 160px;
}
@media (max-width: 760px) {
  .receipt-documents {
    flex-direction: row;
    align-items: flex-start;
    overflow-x: auto;
    padding: 3px;
  }
  .receipt-documents > .el-button {
    flex: none;
  }
}
</style>
