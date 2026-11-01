<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElAlert, ElButton, ElOption, ElSelect } from 'element-plus'
import ProcessRouteAttachments from './ProcessRouteAttachments.vue'
import { processRouteApi } from '@/services/processRouteApi'
import { productionScheduleApi } from '@/services/productionScheduleApi'
import type { ProcessRoute, RouteOrderDocument } from '@/types/processRoute'

const props = defineProps<{
  items: { serialNo: string; routeId?: number | null; route?: ProcessRoute }[]
}>()
const options = computed(() =>
  props.items.filter(
    (item, index, all) =>
      item.serialNo &&
      all.findIndex(
        (other) => other.serialNo === item.serialNo && other.routeId === item.routeId,
      ) === index,
  ),
)
const selected = ref('')
const key = (item: (typeof props.items)[number]) =>
  `${item.serialNo}:${item.routeId || item.route?.id || ''}`
const current = computed(() => options.value.find((item) => key(item) === selected.value))
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
let generation = 0
async function load() {
  const version = ++generation
  const item = current.value
  route.value = item?.route
  dispatchOrder.value = null
  error.value = ''
  loading.value = false
  if (!item) return
  loading.value = true
  try {
    const result =
      item.route ||
      (item.routeId
        ? await processRouteApi.detail(item.routeId)
        : await processRouteApi.resolve(item.serialNo))
    if (version !== generation) return
    route.value = result
    const order = await processRouteApi.dispatchOrder(result.id, item.serialNo)
    if (version === generation) dispatchOrder.value = order
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
watch([() => (current.value ? key(current.value) : ''), () => current.value?.route], load, {
  immediate: true,
})
onBeforeUnmount(() => ++generation)
</script>

<template>
  <aside class="serial-attachments" aria-label="流水号附件">
    <ElSelect v-if="options.length > 1" v-model="selected" aria-label="切换附件流水号">
      <ElOption
        v-for="item in options"
        :key="key(item)"
        :value="key(item)"
        :label="item.serialNo"
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
    <ProcessRouteAttachments
      v-if="route"
      :key="selected"
      :route="route"
      :order-document="dispatchOrder?.document"
      :order-download="orderDownload"
    />
    <span v-else-if="!loading && !error" class="serial-attachments-state"
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
