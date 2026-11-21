<script setup lang="ts">
import ElAlert from '@/components/AppAlert.vue'
import ElSelect from '@/components/AppSelect.vue'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElOption } from 'element-plus'
import ElButton from '@/components/AppButton.vue'
import ProcessRouteAttachments from './ProcessRouteAttachments.vue'
import WarehouseReceiptDocuments from './WarehouseReceiptDocuments.vue'
import { warehouseReceiptDocumentApi } from '@/services/warehouseReceiptDocumentApi'
import type { ReceiptDocument, ReceiptDocumentKind } from '@/types/warehouseReceiptDocuments'
import { processRouteApi } from '@/services/processRouteApi'
import { productionScheduleApi } from '@/services/productionScheduleApi'
import { materialTransferApi } from '@/services/materialTransferApi'
import type { ProcessRoute, RouteOrderDocument } from '@/types/processRoute'

const props = defineProps<{
  batchNo?: string
  availableOnly?: boolean
  documentKind?: ReceiptDocumentKind
  items: {
    serialNo: string
    batchNo?: string
    routeId?: number | null
    route?: ProcessRoute
    scheduleTaskId?: number | null
  }[]
}>()
const options = computed(() =>
  props.items.filter(
    (item, index, all) =>
      (item.serialNo || item.batchNo) &&
      all.findIndex(
        (other) =>
          other.serialNo === item.serialNo &&
          (other.routeId || other.route?.id) === (item.routeId || item.route?.id) &&
          other.batchNo === item.batchNo &&
          other.scheduleTaskId === item.scheduleTaskId,
      ) === index,
  ),
)
const selected = ref('')
const key = (item: (typeof props.items)[number]) =>
  `${item.serialNo}:${item.routeId || item.route?.id || ''}${item.batchNo ? `:${item.batchNo}` : ''}${item.scheduleTaskId ? `:task${item.scheduleTaskId}` : ''}`
const current = computed(() => options.value.find((item) => key(item) === selected.value))
const selectedBatch = computed(() => current.value?.batchNo || props.batchNo)
const batchSerial = ref('')
const batchTaskId = ref<number | null>()
const scheduleTaskId = computed(() => current.value?.scheduleTaskId || batchTaskId.value)
const serialNo = computed(() => current.value?.serialNo || batchSerial.value)
const routeDocumentKinds = computed<('word' | 'drawing' | 'order')[] | undefined>(() => {
  if (!props.documentKind) return undefined
  return [props.documentKind === 'process' ? 'word' : props.documentKind]
})
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
  batchTaskId.value = undefined
  dispatchOrder.value = null
  error.value = ''
  loading.value = false
  if (!item && !selectedBatch.value) return
  loading.value = true
  try {
    const [transfer, providedRoute] = await Promise.all([
      selectedBatch.value && (!item?.scheduleTaskId || (!item?.route && !item?.routeId))
        ? materialTransferApi.get(selectedBatch.value)
        : undefined,
      item?.route || (item?.routeId ? processRouteApi.detail(item.routeId) : undefined),
    ])
    if (version !== generation) return
    if (transfer) {
      batchSerial.value = transfer.serial_no
      batchTaskId.value = transfer.schedule_task_id
    }
    const result =
      providedRoute ||
      (transfer?.process_route?.id
        ? await processRouteApi.detail(transfer.process_route.id)
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
    if (
      !props.availableOnly &&
      !selectedBatch.value &&
      (!props.documentKind || props.documentKind === 'order')
    ) {
      const order = await processRouteApi.dispatchOrder(
        sourceRoute.value?.id || result.id,
        serialNo.value,
        scheduleTaskId.value,
      )
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
  [
    () => (current.value ? key(current.value) : ''),
    () => current.value?.route,
    selectedBatch,
    () => props.documentKind,
  ],
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
  <aside
    class="serial-attachments"
    :class="{ 'serial-attachments--interactive': options.length > 1 || error || documentsError }"
    aria-label="流水号附件"
  >
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
    <strong
      v-else-if="current && !documentKind"
      class="serial-attachments-label"
      :title="current.serialNo || current.batchNo"
      >{{ current.serialNo || current.batchNo }}</strong
    >
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
      v-if="(selectedBatch || (availableOnly && route)) && !documentsLoading"
      :key="availableOnly ? selected : undefined"
      :available-only="availableOnly"
      :route="route"
      :source-route="sourceRoute"
      :serial-no="serialNo"
      :schedule-task-id="scheduleTaskId"
      :documents="receiptDocuments"
      :document-kind="documentKind"
      @error="documentsError = $event"
    />
    <ProcessRouteAttachments
      v-else-if="route && !selectedBatch"
      :key="selected"
      :route="route"
      :source-route="sourceRoute"
      :documents="routeDocumentKinds"
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
  font-size: var(--font-size-label);
  overflow-wrap: anywhere;
}
.serial-attachments-state {
  color: var(--muted);
  font-size: var(--font-size-meta);
  padding: 12px 0;
}
</style>
