<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElAlert, ElOption, ElSelect } from 'element-plus'
import ElButton from '@/components/AppButton.vue'
import ProcessRouteAttachments from './ProcessRouteAttachments.vue'
import WarehouseReceiptDocuments from './WarehouseReceiptDocuments.vue'
import { warehouseReceiptDocumentApi } from '@/services/warehouseReceiptDocumentApi'
import type { ReceiptDocument } from '@/types/warehouseReceiptDocuments'
import { processRouteApi } from '@/services/processRouteApi'
import { productionScheduleApi } from '@/services/productionScheduleApi'
import { materialTransferApi } from '@/services/materialTransferApi'
import type { ProcessRoute, RouteOrderDocument } from '@/types/processRoute'

const props = defineProps<{
  batchNo?: string
  items: { serialNo: string; batchNo?: string; routeId?: number | null; route?: ProcessRoute }[]
}>()
const options = computed(() =>
  props.items.filter(
    (item, index, all) =>
      (item.serialNo || item.batchNo) &&
      all.findIndex(
        (other) =>
          other.serialNo === item.serialNo &&
          (other.routeId || other.route?.id) === (item.routeId || item.route?.id) &&
          other.batchNo === item.batchNo,
      ) === index,
  ),
)
const selected = ref('')
const key = (item: (typeof props.items)[number]) =>
  `${item.serialNo}:${item.routeId || item.route?.id || ''}${item.batchNo ? `:${item.batchNo}` : ''}`
const current = computed(() => options.value.find((item) => key(item) === selected.value))
const selectedBatch = computed(() => current.value?.batchNo || props.batchNo)
const batchSerial = ref('')
const serialNo = computed(() => current.value?.serialNo || batchSerial.value)
const sourceRoute = ref<ProcessRoute>()
const route = ref<ProcessRoute>(),
  loading = ref(false),
  error = ref('')
const dispatchOrder = ref<{ task_id: number; document: RouteOrderDocument } | null>(null)
const orderDownload = computed(() =>
  dispatchOrder.value
    ? () =>
        productionScheduleApi.downloadOrder(
          dispatchOrder.value!.task_id,
          dispatchOrder.value!.document.filename,
        )
    : undefined,
)
const receiptDocuments = ref<ReceiptDocument[]>([])
const documentsLoading = ref(false)
const documentsError = ref('')
let documentsGeneration = 0
async function loadReceiptDocuments() {
  const version = ++documentsGeneration
  receiptDocuments.value = []
  documentsError.value = ''
  documentsLoading.value = false
  if (!selectedBatch.value) return
  documentsLoading.value = true
  try {
    const result = await warehouseReceiptDocumentApi.forTransfer(selectedBatch.value)
    if (version === documentsGeneration) receiptDocuments.value = result.items
  } catch (e) {
    if (version === documentsGeneration)
      documentsError.value = e instanceof Error ? e.message : '入库附件读取失败'
  } finally {
    if (version === documentsGeneration) documentsLoading.value = false
  }
}
watch(selectedBatch, loadReceiptDocuments, { immediate: true })
let generation = 0
async function load() {
  const version = ++generation
  const item = current.value
  route.value = item?.route
  sourceRoute.value = undefined
  batchSerial.value = ''
  dispatchOrder.value = null
  error.value = ''
  loading.value = false
  if (!item && !selectedBatch.value) return
  loading.value = true
  try {
    let routeId = item?.routeId
    if (selectedBatch.value && !item?.route && !routeId) {
      const transfer = await materialTransferApi.get(selectedBatch.value)
      if (version !== generation) return
      batchSerial.value = transfer.serial_no
      routeId = transfer.process_route?.id
    }
    const result =
      item?.route ||
      (routeId
        ? await processRouteApi.detail(routeId)
        : !selectedBatch.value && item?.serialNo
          ? await processRouteApi.resolve(item.serialNo)
          : undefined)
    if (version !== generation) return
    route.value = result
    if (!result) return
    if (result.route_kind === 'rework' && result.rework_request?.resume_route_id) {
      const original = await processRouteApi.detail(result.rework_request.resume_route_id)
      if (version !== generation) return
      sourceRoute.value = original
    }
    if (!selectedBatch.value) {
      const order = await processRouteApi.dispatchOrder(result.id, serialNo.value)
      if (version === generation) dispatchOrder.value = order
    }
  } catch (e) {
    if (version === generation) error.value = e instanceof Error ? e.message : '资料读取失败'
  } finally {
    if (version === generation) loading.value = false
  }
}
watch(
  options,
  (items) => {
    if (!items.some((item) => key(item) === selected.value))
      selected.value = items[0] ? key(items[0]) : ''
  },
  { immediate: true },
)
watch(
  [() => (current.value ? key(current.value) : ''), () => current.value?.route, selectedBatch],
  load,
  {
    immediate: true,
  },
)
onBeforeUnmount(() => {
  ++generation
  ++documentsGeneration
})
</script>

<template>
  <aside class="serial-attachments" aria-label="流水号附件">
    <ElSelect v-if="options.length > 1" v-model="selected" aria-label="切换附件流水号">
      <ElOption
        v-for="item in options"
        :key="key(item)"
        :value="key(item)"
        :label="
          item.batchNo ? `${item.serialNo || '未分配流水号'} · ${item.batchNo}` : item.serialNo
        "
      />
    </ElSelect>
    <strong v-else-if="current" class="serial-attachments-label" :title="current.serialNo">{{
      current.serialNo
    }}</strong>
    <span v-if="loading" class="serial-attachments-state" role="status">读取资料…</span>
    <template v-if="error">
      <ElAlert :title="error" type="error" :closable="false" />
      <ElButton size="small" @click="load">重试</ElButton>
    </template>
    <span v-if="documentsLoading" class="serial-attachments-state" role="status"
      >读取入库附件…</span
    >
    <template v-if="documentsError">
      <ElAlert :title="documentsError" type="error" :closable="false" />
      <ElButton size="small" @click="loadReceiptDocuments">重试附件</ElButton>
    </template>
    <WarehouseReceiptDocuments
      v-if="selectedBatch && !documentsLoading"
      :route="route"
      :source-route="sourceRoute"
      :serial-no="serialNo"
      :documents="receiptDocuments"
      @error="documentsError = $event"
    />
    <ProcessRouteAttachments
      v-else-if="route && !selectedBatch"
      :key="selected"
      :route="route"
      :source-route="sourceRoute"
      :order-document="dispatchOrder?.document ?? null"
      :order-task-id="dispatchOrder?.task_id"
      :order-download="orderDownload"
    />
    <span v-else-if="!selectedBatch && !loading && !error" class="serial-attachments-state"
      >填写流水号后显示附件</span
    >
  </aside>
</template>

<style scoped>
.serial-attachments {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.serial-attachments-label {
  font-size: 13px;
  overflow-wrap: anywhere;
}
.serial-attachments-state {
  color: var(--muted);
  font-size: 12px;
  padding: 12px 0;
}
</style>
