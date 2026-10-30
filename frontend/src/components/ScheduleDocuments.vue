<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, ref, watch } from 'vue'
import {
  ElButton,
  ElDescriptions,
  ElDescriptionsItem,
  ElOption,
  ElSelect,
  ElTabPane,
  ElTabs,
} from 'element-plus'
import { Document, FullScreen, Picture, Tickets } from '@element-plus/icons-vue'
import AppDialog from './AppDialog.vue'
import StatePanel from './StatePanel.vue'
import ProcessRouteSteps from './ProcessRouteSteps.vue'
import { processRouteApi } from '@/services/processRouteApi'
import type { ProcessRoute } from '@/types/processRoute'
import { formatDateTime } from '@/utils/format'

const WordDocumentPreview = defineAsyncComponent(() => import('./WordDocumentPreview.vue'))
const ProcessRouteDrawingPreview = defineAsyncComponent(
  () => import('./ProcessRouteDrawingPreview.vue'),
)
const props = defineProps<{
  serialNo: string
  routeIds: (number | null | undefined)[]
}>()
type Tab = 'info' | 'word' | 'drawing'
const visible = ref(false),
  tab = ref<Tab>('info'),
  loading = ref(false),
  error = ref('')
const routes = ref<ProcessRoute[]>([]),
  selectedId = ref<number>(),
  drawingId = ref<number>()
const routeIds = computed(() => [...new Set(props.routeIds.filter((id): id is number => !!id))])
const route = computed(() => routes.value.find((item) => item.id === selectedId.value))
const fields = computed(() =>
  Object.entries(route.value?.source_data.receipt_fields || {}).filter(
    ([key]) => key !== 'serial_no',
  ),
)
const drawing = computed(() => route.value?.drawings?.find((item) => item.id === drawingId.value))
const wordPreview = ref<{ ready: boolean; open: () => void }>()
const drawingPreview = ref<{ ready: boolean; open: () => void }>()
const preview = computed(() => (tab.value === 'word' ? wordPreview.value : drawingPreview.value))
let generation = 0
async function load() {
  const current = ++generation
  loading.value = true
  error.value = ''
  routes.value = []
  try {
    const result = await Promise.all(routeIds.value.map((id) => processRouteApi.detail(id)))
    if (current !== generation) return
    routes.value = result
    selectedId.value = result[0]?.id
  } catch (e) {
    if (current === generation) error.value = e instanceof Error ? e.message : '资料读取失败'
  } finally {
    if (current === generation) loading.value = false
  }
}
function open(value: Tab) {
  tab.value = value
  visible.value = true
  void load()
}
watch(route, (value) => {
  drawingId.value = value?.drawings?.[0]?.id
})
watch(visible, (value) => {
  if (!value) ++generation
})
watch(
  () => [props.serialNo, routeIds.value.join(',')],
  () => {
    visible.value = false
  },
)
onBeforeUnmount(() => ++generation)
</script>

<template>
  <div class="schedule-documents" role="group" aria-label="排期资料">
    <ElButton :icon="Tickets" :disabled="!serialNo" @click="open('info')">流水号信息</ElButton>
    <ElButton :icon="Document" :disabled="!serialNo" @click="open('word')">工艺原件</ElButton>
    <ElButton :icon="Picture" :disabled="!serialNo" @click="open('drawing')">图纸</ElButton>
  </div>
  <AppDialog
    v-model="visible"
    :title="`${serialNo} · 资料`"
    width="min(1100px, 94vw)"
    append-to-body
    destroy-on-close
  >
    <StatePanel v-if="loading" state="loading" compact />
    <StatePanel v-else-if="error" state="error" :description="error" @retry="load" />
    <StatePanel v-else-if="!route" state="empty" title="未关联工艺" compact />
    <template v-else>
      <ElSelect
        v-if="routes.length > 1"
        v-model="selectedId"
        aria-label="查看关联工艺"
        class="schedule-document-route"
      >
        <ElOption
          v-for="item in routes"
          :key="item.id"
          :value="item.id"
          :label="`${item.title} · ${formatDateTime(item.updated_at || item.created_at)}`"
        />
      </ElSelect>
      <ElTabs v-model="tab" aria-label="排期资料分类">
        <ElTabPane label="流水号信息" name="info" />
        <ElTabPane label="工艺原件" name="word" />
        <ElTabPane label="图纸" name="drawing" />
      </ElTabs>
      <section v-if="tab === 'info'" class="schedule-document-info">
        <ElDescriptions :column="2" border aria-label="流水号资料">
          <ElDescriptionsItem label="流水号">{{ serialNo }}</ElDescriptionsItem>
          <ElDescriptionsItem label="工艺人员">{{
            route.engineering_employee_name || '未记录'
          }}</ElDescriptionsItem>
          <ElDescriptionsItem v-for="[key, field] in fields" :key="key" :label="field.label">{{
            field.value === '' ? '—' : field.value
          }}</ElDescriptionsItem>
        </ElDescriptions>
        <h3>工艺路线</h3>
        <ProcessRouteSteps :route="route" />
      </section>
      <section v-else class="schedule-document-preview">
        <div class="schedule-document-tools">
          <ElSelect
            v-if="tab === 'drawing' && route.drawings?.length"
            v-model="drawingId"
            aria-label="选择图纸"
          >
            <ElOption
              v-for="item in route.drawings"
              :key="item.id"
              :value="item.id"
              :label="item.filename"
            />
          </ElSelect>
          <ElButton :icon="FullScreen" :disabled="!preview?.ready" @click="preview?.open()"
            >放大查看</ElButton
          >
        </div>
        <template v-if="tab === 'word'">
          <WordDocumentPreview
            v-if="route.filename"
            ref="wordPreview"
            :key="route.id"
            :route="route"
            compact
          />
          <StatePanel v-else state="empty" title="暂无工艺原件" compact />
        </template>
        <template v-else>
          <ProcessRouteDrawingPreview
            v-if="drawing"
            ref="drawingPreview"
            :route-id="route.id"
            :drawing="drawing"
          />
          <StatePanel v-else state="empty" title="暂无图纸" compact />
        </template>
      </section>
    </template>
    <template #footer><ElButton @click="visible = false">关闭</ElButton></template>
  </AppDialog>
</template>

<style scoped>
.schedule-documents {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-block: 12px;
}
.schedule-documents .el-button + .el-button {
  margin-left: 0;
}
.schedule-document-route {
  width: 100%;
  margin-bottom: 12px;
}
.schedule-document-info h3 {
  margin: 16px 0 10px;
  font-size: 14px;
}
.schedule-document-preview {
  display: flex;
  flex-direction: column;
  height: min(600px, 65vh);
  min-height: 320px;
}
.schedule-document-tools {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-bottom: 8px;
}
.schedule-document-tools .el-select {
  flex: 1;
  min-width: 0;
}
</style>
