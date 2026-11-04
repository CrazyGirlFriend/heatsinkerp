<script setup lang="ts">
import ElAlert from '@/components/AppAlert.vue'
import { computed, ref } from 'vue'

import ElButton from '@/components/AppButton.vue'
import DocumentCard from './DocumentCard.vue'
import WordDocumentPreview from './WordDocumentPreview.vue'
import ProcessRouteDrawingPreview from './ProcessRouteDrawingPreview.vue'
import OrderDocumentPreview from './OrderDocumentPreview.vue'
import { processRouteApi } from '@/services/processRouteApi'
import type { ProcessRoute, RouteOrderDocument } from '@/types/processRoute'
const props = withDefaults(
  defineProps<{
    route: ProcessRoute
    sourceRoute?: ProcessRoute
    sourceRow?: string
    documents?: ('order' | 'word' | 'drawing')[]
    orderThumbnail?: boolean
    sourceFile?: File
    orderFile?: File
    orderTaskId?: number
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
const orderPreview = ref<InstanceType<typeof OrderDocumentPreview>>()
const error = ref('')
const wordRoute = computed(() => props.sourceRoute || props.route)
const order = computed(() =>
  props.orderDocument === undefined ? props.route.source_data.order_document : props.orderDocument,
)

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
  if (kind === 'order') orderPreview.value?.open()
  else wordPreview.value?.open()
}
defineExpose({ open })
</script>
<template>
  <aside class="route-attachment-rail" aria-label="工艺附件缩略图">
    <DocumentCard
      v-if="documents.includes('order')"
      class="route-attachment-card"
      :class="{ 'route-attachment-card--full': !orderThumbnail }"
      title="订单表"
      :filename="order?.filename"
      :missing="order ? undefined : '未上传订单表'"
    >
      <OrderDocumentPreview
        v-if="order"
        ref="orderPreview"
        :route-id="route.id"
        :task-id="orderTaskId"
        :file="orderFile"
        :thumbnail="orderThumbnail"
      />
      <template v-if="order" #actions
        ><ElButton link @click="downloadOrder">下载原件</ElButton></template
      >
    </DocumentCard>
    <DocumentCard
      v-if="documents.includes('word')"
      class="route-attachment-card"
      title="工艺原件"
      :filename="sourceFile?.name || wordRoute.filename || undefined"
      :missing="sourceFile || wordRoute.filename ? undefined : '未上传工艺原件'"
    >
      <WordDocumentPreview
        v-if="sourceFile || wordRoute.filename"
        ref="wordPreview"
        :route="wordRoute"
        :source-file="sourceFile"
        :source-row="sourceRow"
        thumbnail
      />
      <template v-if="sourceFile || wordRoute.filename" #actions>
        <ElButton link @click="wordPreview?.download()">下载原件</ElButton>
      </template>
    </DocumentCard>
    <template v-if="documents.includes('drawing')">
      <DocumentCard
        v-for="drawing in route.drawings"
        :key="drawing.id"
        class="route-attachment-card"
        title="图纸"
      >
        <ProcessRouteDrawingPreview :route-id="route.id" :drawing="drawing" thumbnail />
        <template v-if="editable" #actions>
          <ElButton
            link
            type="danger"
            :disabled="disabled"
            :aria-label="`移除 ${drawing.filename}`"
            @click="emit('removeDrawing', drawing.id)"
            >移除</ElButton
          >
        </template>
      </DocumentCard>
      <DocumentCard
        v-for="(file, index) in pendingDrawings"
        :key="`pending-${index}`"
        class="route-attachment-card"
        title="图纸"
        source="待保存"
      >
        <ProcessRouteDrawingPreview :route-id="route.id" :file="file" thumbnail />
        <template v-if="editable" #actions>
          <ElButton
            link
            type="danger"
            :disabled="disabled"
            :aria-label="`移除 ${file.name}`"
            @click="emit('removePendingDrawing', file)"
            >移除</ElButton
          >
        </template>
      </DocumentCard>
      <DocumentCard
        v-if="!route.drawings?.length && !pendingDrawings?.length"
        class="route-attachment-card"
        title="图纸"
        missing="未上传图纸"
      />
    </template>
  </aside>
  <ElAlert v-if="error" :title="error" type="error" :closable="false" />
</template>
<style scoped>
.route-attachment-rail {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
@media (max-width: 760px) {
  .route-attachment-rail {
    flex-direction: row;
    overflow-x: auto;
    padding: 4px;
  }
  .route-attachment-card--full {
    flex: 1 0 100%;
  }
}
</style>
