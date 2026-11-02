<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElSkeleton, ElSkeletonItem } from 'element-plus'
import StatePanel from './StatePanel.vue'
import ProcessRouteAttachments from './ProcessRouteAttachments.vue'
import ScheduleRouteSelect from './ScheduleRouteSelect.vue'
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
watch([() => routeIds.value.join(','), () => props.taskId], load, { immediate: true })
onBeforeUnmount(() => ++generation)
</script>

<template>
  <div class="schedule-documents" :class="{ 'schedule-documents--layout': !!$slots.default }">
    <aside class="schedule-document-rail" aria-label="排期附件缩略图" :aria-busy="loading">
      <slot name="upload" />
      <Transition name="schedule-document" mode="out-in">
        <div v-if="loading" key="loading" class="schedule-document-loading" role="status">
          <span>加载工艺资料…</span>
          <ElSkeleton animated :throttle="0">
            <template #template>
              <div v-for="index in 2" :key="index" class="schedule-document-skeleton">
                <ElSkeletonItem variant="image" class="schedule-document-skeleton-image" />
                <ElSkeletonItem variant="text" />
              </div>
            </template>
          </ElSkeleton>
        </div>
        <StatePanel
          v-else-if="error"
          key="error"
          state="error"
          :description="error"
          @retry="load"
        />
        <div v-else-if="route" :key="route.id" class="schedule-document-preview">
          <ScheduleRouteSelect
            v-if="routes.length > 1"
            v-model="selectedId"
            :options="routes"
            label="查看关联工艺"
          />
          <ProcessRouteAttachments
            :route="route"
            :order-document="order"
            :order-file="orderFile"
            :order-download="orderDownload"
          />
        </div>
        <StatePanel
          v-else
          key="empty"
          state="empty"
          :title="serialNo ? '未关联工艺' : '选择工艺后显示资料'"
          compact
        />
      </Transition>
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
.schedule-document-preview {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.schedule-document-loading > span {
  display: block;
  margin-bottom: 10px;
  color: var(--muted);
  font-size: 12px;
}
.schedule-document-skeleton {
  display: grid;
  gap: 10px;
  margin-bottom: 12px;
  padding: 8px;
  border: 1px solid var(--line);
  border-radius: 12px;
}
.schedule-document-skeleton-image {
  width: 100%;
  height: 128px;
}
.schedule-document-enter-active,
.schedule-document-leave-active {
  transition:
    opacity 160ms ease,
    transform 160ms ease;
}
.schedule-document-leave-active {
  pointer-events: none;
}
.schedule-document-enter-from,
.schedule-document-leave-to {
  opacity: 0;
  transform: translateY(5px);
}
@media (prefers-reduced-motion: reduce) {
  .schedule-document-enter-active,
  .schedule-document-leave-active {
    transition: none;
  }
  .schedule-document-loading :deep(.el-skeleton.is-animated .el-skeleton__item) {
    animation: none;
  }
}
@media (max-width: 760px) {
  .schedule-documents--layout {
    grid-template-columns: minmax(0, 1fr);
    gap: 16px;
  }
}
</style>
