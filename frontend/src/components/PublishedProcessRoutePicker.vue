<script setup lang="ts">
import { useTableQuery } from '@/composables/useTableQuery'
import { queryColumns } from '@/utils/tableQueryColumns'
import ElAlert from '@/components/AppAlert.vue'
import ElInput from '@/components/AppInput.vue'
import PersonName from './PersonName.vue'
import { useWatermelonAppearance } from '@/composables/useWorkspaceAppearance'
import WorkspaceTable from './WorkspaceTable.vue'
import WatermelonSearch from './watermelon/WatermelonSearch.vue'
import WorkspacePagination from './WorkspacePagination.vue'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { ElLoading, ElTableColumn } from 'element-plus'
import ElButton from '@/components/AppButton.vue'
import AppDialog from './AppDialog.vue'
import { processRouteApi } from '@/services/processRouteApi'
import type { ProcessRoute } from '@/types/processRoute'
import { formatDateTime } from '@/utils/format'
const vLoading = ElLoading.directive
const watermelon = useWatermelonAppearance()
const props = defineProps<{ serialNo?: string; pendingRework?: boolean }>()
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
const tableQuery = useTableQuery(
  queryColumns(
    props.pendingRework
      ? [
          ['流水号', 'serial_nos'],
          ['提交班组', 'requesting_team_name'],
          ['轮次', 'rework_round', 'number'],
          ['提交时间', 'created_at', 'date'],
        ]
      : [
          ['流水号', 'serial_nos'],
          ['工艺人员', 'engineering_employee_name'],
          ['导入时间', 'created_at', 'date'],
        ],
  ),
  () => {
    page.value = 1
    void load()
  },
  (table_query) =>
    processRouteApi.list(
      appliedQuery.value,
      1,
      props.pendingRework ? 'draft' : 'published',
      'desc',
      20,
      props.pendingRework ? 'rework' : 'normal',
      props.pendingRework ? 'open' : 'all',
      table_query,
    ),
)
let generation = 0
async function load() {
  const current = ++generation
  loading.value = true
  error.value = ''
  try {
    const result = await processRouteApi.list(
      appliedQuery.value,
      page.value,
      props.pendingRework ? 'draft' : 'published',
      'desc',
      20,
      props.pendingRework ? 'rework' : 'normal',
      props.pendingRework ? 'open' : 'all',
      tableQuery.params.value.table_query,
    )
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
    if (props.pendingRework) {
      if (route.route_kind !== 'rework' || route.state !== 'draft')
        throw new Error('该问题的返工工艺已制定，请刷新后重新选择')
    } else if (route.state !== 'published') throw new Error('请选择工艺')
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
    :title="pendingRework ? '选择返工问题' : '选择工艺'"
    class="route-picker-dialog"
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
        :placeholder="
          pendingRework ? '搜索流水号、批次号、问题或班组' : '搜索流水号、批次号、工艺人员'
        "
        :disabled="busy"
        @search="search"
      />
      <ElInput
        v-else
        v-model="query"
        :placeholder="
          pendingRework ? '搜索流水号、批次号、问题或班组' : '搜索流水号、批次号、工艺人员'
        "
        aria-label="工艺搜索"
        clearable
        :disabled="busy"
        @keyup.enter="search"
        @clear="search"
      /><ElButton :disabled="loading || busy" @click="search">查询</ElButton>
    </div>
    <WorkspaceTable
      :columns-key="pendingRework ? 'PendingReworkRoutePicker' : 'PublishedProcessRoutePicker-1'"
      :column-query="tableQuery.controller.value"
      height="100%"
      fill
      :embedded="false"
      v-loading="!watermelon && loading"
      :loading="watermelon ? loading : undefined"
      :data="items"
      :class="watermelon ? '' : 'business-table'"
      row-key="id"
    >
      <template v-if="pendingRework" #empty>暂无待制定的返工问题</template>
      <ElTableColumn label="流水号" :min-width="pendingRework ? 160 : 260" align="center"
        ><template #default="{ row }">{{ row.serial_nos.join('、') }}</template></ElTableColumn
      >
      <template v-if="pendingRework">
        <ElTableColumn label="问题" min-width="190" show-overflow-tooltip>
          <template #default="{ row }">{{
            row.rework_request?.problem_names?.join('、') || row.rework_request?.reason || '—'
          }}</template>
        </ElTableColumn>
        <ElTableColumn label="提交班组" width="110">
          <template #default="{ row }">{{
            row.rework_request?.requesting_team_name || '—'
          }}</template>
        </ElTableColumn>
        <ElTableColumn label="返工件数" width="100" align="right">
          <template #default="{ row }">{{ row.rework_request?.quantity ?? '—' }}</template>
        </ElTableColumn>
        <ElTableColumn label="轮次" width="75" align="center">
          <template #default="{ row }">{{ row.rework_request?.round ?? '—' }}</template>
        </ElTableColumn>
      </template>
      <ElTableColumn v-else label="工艺人员" width="140" align="center"
        ><template #default="{ row }"
          ><PersonName :name="row.engineering_employee_name || '—'" /></template
      ></ElTableColumn>
      <ElTableColumn :label="pendingRework ? '提交时间' : '导入时间'" width="180" align="center"
        ><template #default="{ row }">{{ formatDateTime(row.created_at) }}</template></ElTableColumn
      >
      <ElTableColumn label="操作" width="100" align="center"
        ><template #default="{ row }"
          ><ElButton type="primary" link :disabled="busy || loading" @click="choose(row.id)">{{
            pendingRework ? '制定' : '选择'
          }}</ElButton></template
        ></ElTableColumn
      >
    </WorkspaceTable>
    <WorkspacePagination
      :current-page="page"
      :page-size="20"
      :total="total"
      :disabled="busy || loading"
      layout="total, prev, pager, next"
      @current-change="changePage"
    />
    <template #footer><ElButton :disabled="busy" @click="visible = false">取消</ElButton></template>
  </AppDialog>
</template>
<style scoped>
:global(.route-picker-dialog .el-dialog__body) {
  display: flex;
  flex-direction: column;
  height: min(584px, calc(100dvh - 220px));
  overflow: hidden;
}
.route-picker-search {
  display: flex;
  flex-shrink: 0;
  gap: 10px;
  margin-block: 12px 16px;
}
.route-picker-search > :first-child {
  flex: 1;
  min-width: 0;
}
.wm-pagination {
  flex-shrink: 0;
  margin-top: 16px;
}
.el-pagination {
  flex-shrink: 0;
  justify-content: flex-end;
  margin-top: 16px;
}
</style>
