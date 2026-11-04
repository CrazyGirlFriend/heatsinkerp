<script setup lang="ts">
import PersonName from './PersonName.vue'
import { useWatermelonAppearance } from '@/composables/useWorkspaceAppearance'
import WatermelonDataTable from './watermelon/WatermelonDataTable.vue'
import WatermelonButton from './watermelon/WatermelonButton.vue'
import WatermelonSearch from './watermelon/WatermelonSearch.vue'
import WorkspacePagination from './WorkspacePagination.vue'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { ElAlert, ElInput, ElLoading, ElTable, ElTableColumn } from 'element-plus'
import ElButton from '@/components/AppButton.vue'
import AppDialog from './AppDialog.vue'
import { processRouteApi } from '@/services/processRouteApi'
import type { ProcessRoute } from '@/types/processRoute'
import { formatDateTime } from '@/utils/format'
const vLoading = ElLoading.directive
const watermelon = useWatermelonAppearance()
const props = defineProps<{ serialNo?: string }>()
const emit = defineEmits<{ selected: [route: ProcessRoute]; close: [] }>()
const visible = ref(true),
  query = ref(props.serialNo || ''),
  appliedQuery = ref(query.value),
  page = ref(1),
  total = ref(0),
  items = ref<ProcessRoute[]>([]),
  loading = ref(false),
  busy = ref(false),
  error = ref('')
let generation = 0
async function load() {
  const current = ++generation
  loading.value = true
  error.value = ''
  try {
    const result = await processRouteApi.list(appliedQuery.value, page.value, 'published')
    if (current !== generation) return
    items.value = result.items
    total.value = result.total
  } catch (reason) {
    if (current === generation)
      error.value = reason instanceof Error ? reason.message : '工艺读取失败'
  } finally {
    if (current === generation) loading.value = false
  }
}
function search() {
  appliedQuery.value = query.value.trim()
  page.value = 1
  void load()
}
function changePage(value: number) {
  page.value = value
  void load()
}
async function choose(id: number) {
  if (busy.value) return
  const current = ++generation
  busy.value = true
  error.value = ''
  try {
    const route = await processRouteApi.detail(id)
    if (current !== generation) return
    if (route.state !== 'published') throw new Error('请选择工艺')
    emit('selected', route)
    visible.value = false
  } catch (reason) {
    if (current === generation)
      error.value = reason instanceof Error ? reason.message : '工艺读取失败'
  } finally {
    if (current === generation) busy.value = false
  }
}
onMounted(load)
onBeforeUnmount(() => {
  ++generation
})
</script>
<template>
  <AppDialog
    v-model="visible"
    title="选择工艺"
    width="min(1000px, 94vw)"
    append-to-body
    :close-on-click-modal="!busy"
    :close-on-press-escape="!busy"
    :show-close="!busy"
    @closed="emit('close')"
  >
    <ElAlert v-if="error" :title="error" type="error" :closable="false" />
    <div class="route-picker-search">
      <WatermelonSearch
        v-if="watermelon"
        v-model="query"
        label="工艺搜索"
        placeholder="搜索流水号、工艺人员"
        :disabled="busy"
        @search="search"
      />
      <ElInput
        v-else
        v-model="query"
        placeholder="搜索流水号、工艺人员"
        aria-label="工艺搜索"
        clearable
        :disabled="busy"
        @keyup.enter="search"
        @clear="search"
      /><component
        :is="watermelon ? WatermelonButton : ElButton"
        :disabled="loading || busy"
        @click="search"
        >查询</component
      >
    </div>
    <component
      :is="watermelon ? WatermelonDataTable : ElTable"
      v-loading="loading"
      :data="items"
      :class="watermelon ? '' : 'business-table'"
      max-height="440"
      row-key="id"
    >
      <ElTableColumn label="流水号" min-width="260" align="center"
        ><template #default="{ row }">{{ row.serial_nos.join('、') }}</template></ElTableColumn
      >
      <ElTableColumn label="工艺人员" width="140" align="center"
        ><template #default="{ row }"
          ><PersonName :name="row.engineering_employee_name || '—'" /></template
      ></ElTableColumn>
      <ElTableColumn label="导入时间" width="180" align="center"
        ><template #default="{ row }">{{ formatDateTime(row.created_at) }}</template></ElTableColumn
      >
      <ElTableColumn label="操作" width="100" align="center"
        ><template #default="{ row }"
          ><ElButton type="primary" link :disabled="busy || loading" @click="choose(row.id)"
            >选择</ElButton
          ></template
        ></ElTableColumn
      >
    </component>
    <WorkspacePagination
      :current-page="page"
      :page-size="20"
      :total="total"
      :disabled="busy || loading"
      layout="total, prev, pager, next"
      @current-change="changePage"
    />
    <template #footer
      ><component
        :is="watermelon ? WatermelonButton : ElButton"
        :disabled="busy"
        @click="visible = false"
        >取消</component
      ></template
    >
  </AppDialog>
</template>
<style scoped>
.route-picker-search {
  display: flex;
  gap: 10px;
  margin-block: 12px 16px;
}
.route-picker-search > :first-child {
  flex: 1;
  min-width: 0;
}
.wm-pagination {
  margin-top: 16px;
}
.el-pagination {
  justify-content: flex-end;
  margin-top: 16px;
}
</style>
