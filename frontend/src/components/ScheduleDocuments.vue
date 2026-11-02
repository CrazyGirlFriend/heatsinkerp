<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElOption, ElSelect } from 'element-plus'
import StatePanel from './StatePanel.vue'
import ProcessRouteAttachments from './ProcessRouteAttachments.vue'
import { processRouteApi } from '@/services/processRouteApi'
import { productionScheduleApi } from '@/services/productionScheduleApi'
import type { ProcessRoute, RouteOrderDocument } from '@/types/processRoute'

const props = defineProps<{
  serialNo: string
  routeIds: (number | null | undefined)[]
  taskId?: number
  orderDocument?: RouteOrderDocument | null
  orderFile?: File
}>()
const loading = ref(false),
  error = ref('')
const routes = ref<ProcessRoute[]>([]),
  selectedId = ref<number>()
const routeIds = computed(() => [...new Set(props.routeIds.filter((id): id is number => !!id))])
const route = computed(() => routes.value.find((item) => item.id === selectedId.value))
const savedOrder = ref<RouteOrderDocument | null>()
const order = computed(() =>
  props.orderDocument === undefined ? savedOrder.value : props.orderDocument,
)
const orderDownload = computed(() =>
  props.taskId && order.value
    ? () => productionScheduleApi.downloadOrder(props.taskId!, order.value!.filename)
    : undefined,
)
let generation = 0
async function load() {
  const current = ++generation
  loading.value = true
  error.value = ''
  routes.value = []
  savedOrder.value = undefined
  try {
    const [result, task] = await Promise.all([
      Promise.all(routeIds.value.map((id) => processRouteApi.detail(id))),
      props.taskId && props.orderDocument === undefined
        ? productionScheduleApi.task(props.taskId)
        : Promise.resolve(null),
    ])
    if (current !== generation) return
    savedOrder.value = task?.order_document || undefined
    routes.value = result
    selectedId.value = result[0]?.id
  } catch (e) {
    if (current === generation) error.value = e instanceof Error ? e.message : '资料读取失败'
  } finally {
    if (current === generation) loading.value = false
  }
}
watch(() => [props.serialNo, routeIds.value.join(','), props.taskId], load, { immediate: true })
onBeforeUnmount(() => ++generation)
</script>

<template>
  <div class="schedule-documents" :class="{ 'schedule-documents--layout': !!$slots.default }">
    <aside class="schedule-document-rail" aria-label="排期附件缩略图">
      <slot name="upload" />
      <StatePanel v-if="loading" state="loading" compact />
      <StatePanel v-else-if="error" state="error" :description="error" @retry="load" />
      <template v-else-if="route">
        <ElSelect v-if="routes.length > 1" v-model="selectedId" aria-label="查看关联工艺">
          <ElOption v-for="item in routes" :key="item.id" :value="item.id" :label="item.title" />
        </ElSelect>
        <ProcessRouteAttachments
          :key="route.id"
          :route="route"
          :order-document="order"
          :order-file="orderFile"
          :order-download="orderDownload"
        />
      </template>
      <StatePanel
        v-else
        state="empty"
        :title="serialNo ? '未关联工艺' : '选择流水号后显示工艺资料'"
        compact
      />
    </aside>
    <section v-if="$slots.default" class="schedule-document-content"><slot /></section>
  </div>
</template>

<style scoped>
.schedule-documents,
.schedule-document-content {
  min-width: 0;
}
.schedule-documents--layout {
  display: grid;
  grid-template-columns: 180px minmax(0, 1fr);
  align-items: start;
  gap: 20px;
  margin-top: 20px;
}
.schedule-document-rail {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
@media (max-width: 760px) {
  .schedule-documents--layout {
    grid-template-columns: minmax(0, 1fr);
    gap: 16px;
  }
}
</style>
