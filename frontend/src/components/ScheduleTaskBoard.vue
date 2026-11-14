<script setup lang="ts">
import TableFilterFields from './TableFilterFields.vue'
import ScheduleShipmentProgress from './ScheduleShipmentProgress.vue'
import type { TableColumnCondition } from '@/types/tableQuery'

import { useTableQuery } from '@/composables/useTableQuery'
import { taskQueryColumns } from '@/utils/tableQueryColumns'
import ElAlert from '@/components/AppAlert.vue'
import ElSelect from '@/components/AppSelect.vue'
import PersonName from './PersonName.vue'
import WorkspaceTable from './WorkspaceTable.vue'
import InventoryColumnSettings from './InventoryColumnSettings.vue'
import ScheduleTeamPlanning from './ScheduleTeamPlanning.vue'
import AppTabs from './AppTabs.vue'
import ScheduleSerialProgress from './ScheduleSerialProgress.vue'
import type { InventoryColumnChoice } from '@/types/inventoryColumns'
import WorkspacePagination from './WorkspacePagination.vue'
import WorkspaceDataToolbar from './WorkspaceDataToolbar.vue'
import { plannedDueLabel } from '@/utils/schedulePlanning'
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElOption, ElTag, ElTableColumn, ElTabPane } from 'element-plus'
import ElTable from '@/components/watermelon/WatermelonDataTable.vue'
import ElButton from '@/components/AppButton.vue'
import { Plus } from '@element-plus/icons-vue'
import AppDialog from './AppDialog.vue'
import FilterDialog from './FilterDialog.vue'
import AppNumberInput from './AppNumberInput.vue'
import RecordDateFilter from './RecordDateFilter.vue'
import StatePanel from './StatePanel.vue'
import LiveRefreshNotice from './LiveRefreshNotice.vue'
import TableExportButton from './TableExportButton.vue'
import DeliverySchedules from './DeliverySchedules.vue'
const VTableScheduleTimeline = defineAsyncComponent(() => import('./VTableScheduleTimeline.vue'))
import ScheduleTaskEditor from './ScheduleTaskEditor.vue'
import ScheduleRouteLink from './ScheduleRouteLink.vue'
import ScheduleReworkPanel from './ScheduleReworkPanel.vue'
import ScheduleSelectionDialog from './ScheduleSelectionDialog.vue'
import ScheduleDocuments from './ScheduleDocuments.vue'
import { useAuthStore } from '@/stores/auth'
import { useTeamDirectoryStore } from '@/stores/teamDirectory'
import { useLiveRefresh } from '@/composables/useLiveRefresh'
import { productionScheduleApi } from '@/services/productionScheduleApi'
import {
  completionBasisLabels,
  scheduleExecutionLabels,
  scheduleStatusLabels,
  scheduleStatusTone,
  type ProductionSchedule,
  type ScheduleFilters,
  type ScheduleStatus,
  type ScheduleTask,
  type ScheduleSelection,
} from '@/types/productionSchedule'
import { formatAmount, formatDateTime } from '@/utils/format'
import { loadExportPages, tableExportSource } from '@/utils/tableExport'

const asTask = (row: unknown) => row as ScheduleTask
function taskQuantity(row: unknown) {
  const task = asTask(row)
  return task.delivery_batches?.length
    ? task.delivery_batches.reduce((sum, batch) => sum + batch.target_quantity, 0)
    : task.nodes.filter((node) => node.status !== 'cancelled').at(-1)?.target_quantity
}
const props = defineProps<{ fullscreen?: boolean; management?: boolean }>()
const auth = useAuthStore(),
  directory = useTeamDirectoryStore(),
  route = useRoute()
const canManage = computed(() => !!props.management && auth.isDispatch)
const teams = computed(() => directory.items.filter((team) => team.active))
const selectionKind = ref<'serial' | 'people' | null>(null),
  managingPeople = ref(false)
const serialSelection = ref<ScheduleSelection[]>([]),
  personSelection = ref<ScheduleSelection[]>([])
const rows = ref<ScheduleTask[]>([]),
  total = ref(0),
  page = ref(1),
  pageSize = ref(10),
  loading = ref(false),
  error = ref('')
const loadSize = ref(50),
  draftLoadSize = ref<number | undefined>(50),
  fetching = ref(false),
  loadingMore = ref(false),
  moreError = ref('')
const hasMore = computed(() => !props.management && rows.value.length < total.value)
const initialSerial = typeof route.query.serial_no === 'string' ? route.query.serial_no : ''
const query = ref(initialSerial),
  filters = ref<ScheduleFilters>({
    ...(initialSerial ? { query: initialSerial } : {}),
    ...(route.query.status === 'overdue' ? { status: 'overdue' } : {}),
  }),
  filterOpen = ref(false)
type TaskSort = 'created_at' | 'final_due_at'
const sortBy = ref<TaskSort>('created_at')
const sortOrder = ref<'asc' | 'desc'>('desc')
const draftColumns = ref<TableColumnCondition[]>([])
const tableQuery = useTableQuery(taskQueryColumns, () => {
  page.value = 1
  void load()
})
const draftSortOrder = ref(`${sortBy.value}:${sortOrder.value}`)
const taskColumns = [
  { key: 'serial_no', label: '流水号', width: 150 },
  { key: 'quantity', label: '数量（件）', width: 110 },
  { key: 'delivery_batches', label: '交货批数', width: 100 },
  { key: 'final_due_at', label: '最终交期', width: 180 },
  { key: 'shipped_quantity', label: '客户发货', width: 190 },
  { key: 'order_completed', label: '订单完成', width: 110 },
  { key: 'order_overdue', label: '订单逾期', width: 110 },
  { key: 'team_planning', label: '班组排期', width: 280 },
  { key: 'created_at', label: '创建时间', width: 180 },
  { key: 'business_people', label: '业务人员', width: 140 },
  { key: 'locked', label: '订单锁定', width: 100 },
] as const
const selectableColumns = taskColumns.map((column) => ({ ...column, defaultVisible: true }))
type TaskColumn = (typeof taskColumns)[number]['key']
const columnSettings = ref<{ open: (anchor?: HTMLElement) => void }>()
const columnChoices = ref<InventoryColumnChoice<TaskColumn>[]>(
  taskColumns.map((column) => ({ key: column.key, visible: true })),
)
const visibleColumns = computed(() =>
  columnChoices.value
    .filter((column) => column.visible)
    .map((column) => taskColumns.find((item) => item.key === column.key)!),
)
const columnStorageKey = computed(() =>
  auth.currentUser?.id ? `heatsink.dispatch-columns.v1:${auth.currentUser.id}` : null,
)
const draftTeam = ref<number>(),
  draftStatus = ref<ScheduleStatus>(),
  draftScope = ref<'attention' | 'completed'>(),
  draftDates = ref({ from: '', to: '' }),
  draftSerialSelection = ref<ScheduleSelection[]>([]),
  draftPersonSelection = ref<ScheduleSelection[]>([])
const routeLinkOpen = ref(false)
const editorOpen = ref(false),
  editingTask = ref<ScheduleTask | null>(null)
const detailId = ref<number>(),
  detail = ref<ScheduleTask | null>(null),
  detailLoading = ref(false),
  detailError = ref('')
const detailTab = ref('task')
const nodeDetails = ref<{ openDetail: (id: number) => void }>()
let generation = 0,
  detailGeneration = 0,
  timer: ReturnType<typeof setInterval> | undefined
const live = useLiveRefresh(() => load(true), {
  busy: () =>
    fetching.value || loadingMore.value || editorOpen.value || !!detailId.value || filterOpen.value,
})
const filterCount = computed(
  () =>
    Number(!!filters.value.query) +
    Number(!!filters.value.scope) +
    Number(!!filters.value.team_id) +
    Number(!!filters.value.status) +
    tableQuery.state.value.filters.length +
    Number(!!filters.value.due_from || !!filters.value.due_to) +
    Number(!!filters.value.serial_nos?.length) +
    Number(!!filters.value.business_person_ids?.length),
)
watch(
  [page, pageSize],
  () => {
    if (!props.management) return
    ++generation
    rows.value = []
  },
  { flush: 'sync' },
)
async function load(background = false) {
  const token = ++generation
  fetching.value = true
  loadingMore.value = false
  moreError.value = ''
  if (!background) loading.value = true
  error.value = ''
  try {
    const params = {
      ...filters.value,
      ...tableQuery.params.value,
      sort_by: sortBy.value,
      sort_order: sortOrder.value,
      page: props.management ? page.value : 1,
      page_size: props.management ? pageSize.value : loadSize.value,
    }
    const result = await productionScheduleApi.tasks(params)
    if (token !== generation) return
    if (!props.management) {
      const items = [...result.items]
      // A live refresh keeps the portion the user has already scrolled through.
      const pages = background ? Math.min(page.value, Math.ceil(result.total / loadSize.value)) : 1
      for (let nextPage = 2; nextPage <= pages; nextPage++) {
        const next = await productionScheduleApi.tasks({ ...params, page: nextPage })
        if (token !== generation) return
        items.push(...next.items)
      }
      rows.value = items
      total.value = result.total
      page.value = Math.max(1, pages)
      return
    }
    const last = Math.max(1, Math.ceil(result.total / pageSize.value))
    if (page.value > last) {
      page.value = last
      await load(background)
      return
    }
    rows.value = result.items
    total.value = result.total
  } catch (e) {
    if (token !== generation) return
    if (background) throw e
    error.value = e instanceof Error ? e.message : '生产排期读取失败'
  } finally {
    if (token === generation) {
      loading.value = false
      fetching.value = false
    }
  }
}
async function loadMore() {
  if (props.management || fetching.value || loadingMore.value || !hasMore.value) return
  const token = generation
  loadingMore.value = true
  moreError.value = ''
  try {
    const result = await productionScheduleApi.tasks({
      ...filters.value,
      ...tableQuery.params.value,
      sort_by: sortBy.value,
      sort_order: sortOrder.value,
      page: page.value + 1,
      page_size: loadSize.value,
    })
    if (token !== generation) return
    page.value++
    const existing = new Set(rows.value.map((task) => task.id))
    rows.value = [...rows.value, ...result.items.filter((task) => !existing.has(task.id))]
    total.value = result.total
  } catch (e) {
    if (token === generation) moreError.value = e instanceof Error ? e.message : '加载失败，请重试'
  } finally {
    if (token === generation) loadingMore.value = false
  }
}
function search() {
  filters.value = { ...filters.value, query: query.value.trim() || undefined }
  page.value = 1
  void load()
}
function pasteSearch(event: ClipboardEvent) {
  const input = event.target
  const text = event.clipboardData?.getData('text/plain')
  if (
    !(input instanceof HTMLInputElement) ||
    input.getAttribute('aria-label') !== '任务排期搜索' ||
    !text ||
    !/[\r\n\t]/.test(text)
  )
    return
  event.preventDefault()
  const start = input.selectionStart ?? query.value.length
  const end = input.selectionEnd ?? start
  query.value =
    query.value.slice(0, start) + text.replace(/[\r\n\t]+/g, ' ') + query.value.slice(end)
}
function openFilters() {
  draftColumns.value = tableQuery.state.value.filters.map((item) => ({ ...item }))
  draftLoadSize.value = loadSize.value
  draftSortOrder.value = `${sortBy.value}:${sortOrder.value}`
  draftScope.value = filters.value.scope
  draftTeam.value = filters.value.team_id
  draftStatus.value = filters.value.status
  draftDates.value = {
    from: filters.value.due_from?.slice(0, 10) || '',
    to: filters.value.due_to?.slice(0, 10) || '',
  }
  draftSerialSelection.value = [...serialSelection.value]
  draftPersonSelection.value = [...personSelection.value]
  filterOpen.value = true
}
function applyFilters() {
  tableQuery.state.value.filters = draftColumns.value
  if (!props.management)
    loadSize.value = Math.max(1, Math.min(100, Math.round(draftLoadSize.value ?? 50)))
  const [field, direction] = draftSortOrder.value.split(':')
  if (sortBy.value !== field || sortOrder.value !== direction)
    tableQuery.state.value.sort = undefined
  sortBy.value = field as TaskSort
  sortOrder.value = direction as 'asc' | 'desc'
  filters.value = {
    query: filters.value.query,
    scope: draftScope.value || undefined,
    serial_nos: draftSerialSelection.value.length
      ? draftSerialSelection.value.map((item) => String(item.value))
      : undefined,
    business_person_ids: draftPersonSelection.value.length
      ? draftPersonSelection.value.map((item) => Number(item.value))
      : undefined,
    team_id: draftTeam.value,
    status: draftStatus.value,
    due_from: draftDates.value.from ? `${draftDates.value.from}T00:00:00+08:00` : undefined,
    due_to: draftDates.value.to ? `${draftDates.value.to}T23:59:59+08:00` : undefined,
  }
  serialSelection.value = [...draftSerialSelection.value]
  personSelection.value = [...draftPersonSelection.value]
  page.value = 1
  filterOpen.value = false
  void load()
}
function resetFilters() {
  draftColumns.value = []
  draftLoadSize.value = 50
  draftScope.value = undefined
  draftTeam.value = undefined
  draftStatus.value = undefined
  draftDates.value = { from: '', to: '' }
  draftSerialSelection.value = []
  draftPersonSelection.value = []
}
const actionBusy = ref(false),
  actionError = ref(''),
  deleteTarget = ref<ScheduleTask | null>(null)
async function toggleLock(task: ScheduleTask) {
  if (actionBusy.value || !canManage.value) return
  actionBusy.value = true
  actionError.value = ''
  try {
    const updated = await productionScheduleApi.lockTask(task.id, {
      expected_version: task.version,
      locked: !task.locked_at,
    })
    if (detail.value?.id === updated.id) detail.value = updated
    await load()
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : '锁定操作失败'
  } finally {
    actionBusy.value = false
  }
}
async function removeTask() {
  if (!deleteTarget.value || !canManage.value || actionBusy.value) return
  actionBusy.value = true
  actionError.value = ''
  try {
    await productionScheduleApi.deleteTask(deleteTarget.value.id, deleteTarget.value.version)
    if (detail.value?.id === deleteTarget.value.id) closeTask()
    deleteTarget.value = null
    await load()
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : '删除排期失败'
  } finally {
    actionBusy.value = false
  }
}
function paginate(value: number) {
  page.value = value
  void load()
}
function applySelection(items: ScheduleSelection[]) {
  if (selectionKind.value === 'serial') {
    draftSerialSelection.value = items
  } else {
    draftPersonSelection.value = items
  }
  selectionKind.value = null
}
function resizePage(value: number) {
  pageSize.value = value
  page.value = 1
  void load()
}
function teamRoute(task: ScheduleTask) {
  return task.nodes.map((node) => node.team_name).join(' → ')
}
function target(node: ProductionSchedule) {
  const by = node.completion_basis || (node.target_quantity ? 'quantity' : 'weight')
  return [
    node.target_quantity == null
      ? ''
      : `${formatAmount(node.target_quantity)} 件${by === 'weight' ? '（参考）' : ''}`,
    node.target_weight == null
      ? ''
      : `${formatAmount(node.target_weight)} kg${by === 'quantity' ? '（参考）' : ''}`,
  ]
    .filter(Boolean)
    .join(' / ')
}
function basis(node: ProductionSchedule) {
  return completionBasisLabels[
    node.completion_basis || (node.target_quantity ? 'quantity' : 'weight')
  ]
}
function mainTarget(node: ProductionSchedule) {
  const by = node.completion_basis || (node.target_quantity ? 'quantity' : 'weight')
  return [
    by !== 'weight' && node.target_quantity != null
      ? `${formatAmount(node.target_quantity)} 件`
      : '',
    by !== 'quantity' && node.target_weight != null ? `${formatAmount(node.target_weight)} kg` : '',
  ]
    .filter(Boolean)
    .join(' / ')
}
function referenceTarget(node: ProductionSchedule) {
  const by = node.completion_basis || (node.target_quantity ? 'quantity' : 'weight')
  if (by === 'quantity' && node.target_weight != null)
    return `${formatAmount(node.target_weight)} kg（参考）`
  if (by === 'weight' && node.target_quantity != null)
    return `${formatAmount(node.target_quantity)} 件（参考）`
  return ''
}
function execution(node: ProductionSchedule) {
  return node.quality_held
    ? '质量暂扣'
    : node.execution_state
      ? scheduleExecutionLabels[node.execution_state]
      : scheduleStatusLabels[node.status]
}
function openNode(node: ProductionSchedule) {
  nodeDetails.value?.openDetail(node.id)
}
async function openTask(task: ScheduleTask | number) {
  const id = typeof task === 'number' ? task : task.id,
    token = ++detailGeneration
  if (detailId.value !== id) detailTab.value = 'task'
  detailId.value = id
  detail.value = null
  detailError.value = ''
  detailLoading.value = true
  try {
    const result = await productionScheduleApi.task(id)
    if (token === detailGeneration) detail.value = result
  } catch (e) {
    if (token === detailGeneration)
      detailError.value = e instanceof Error ? e.message : '任务详情读取失败'
  } finally {
    if (token === detailGeneration) detailLoading.value = false
  }
}
function closeTask() {
  ++detailGeneration
  detailId.value = undefined
  detail.value = null
}
function createTask() {
  editingTask.value = null
  editorOpen.value = true
}
function editTask(task: ScheduleTask) {
  editingTask.value = task
  editorOpen.value = true
}
function saved() {
  editorOpen.value = false
  editingTask.value = null
  closeTask()
  void load()
}
function nodeChanged() {
  void load()
  if (detailId.value) void openTask(detailId.value)
}
function exportSource() {
  const selected = {
    ...filters.value,
    ...tableQuery.params.value,
    sort_by: sortBy.value,
    sort_order: sortOrder.value,
  }
  const perNode = (task: ScheduleTask, value: (node: ProductionSchedule) => string) =>
    task.nodes.map((node, index) => `${index + 1}. ${node.team_name}：${value(node)}`).join('；')
  return tableExportSource(
    '生产排期任务',
    total.value,
    [
      { key: 'task_no', label: '任务编号', value: (task: ScheduleTask) => task.task_no },
      { key: 'title', label: '任务名称', value: (task) => task.title },
      { key: 'serial_no', label: '流水号', value: (task) => task.serial_no },
      {
        key: 'business_person',
        label: '业务人员',
        value: (task) =>
          task.business_people?.map((p) => p.name).join('、') ||
          task.business_person_name ||
          '未指定',
      },
      { key: 'status', label: '订单状态', value: (task) => scheduleStatusLabels[task.status] },
      {
        key: 'shipped_quantity',
        label: '客户已发货（件）',
        value: (task) => task.shipped_quantity,
      },
      {
        key: 'order_completed',
        label: '订单完成',
        value: (task) => (task.order_completed ? '已完成' : '未完成'),
      },
      {
        key: 'order_overdue',
        label: '订单逾期',
        value: (task) => (task.order_overdue ? '已逾期' : '未逾期'),
      },
      {
        key: 'final_due_at',
        label: '最终交货时间',
        value: (task) => formatDateTime(task.final_due_at),
      },
      { key: 'created_at', label: '创建时间', value: (task) => formatDateTime(task.created_at) },
      { key: 'route', label: '班组路线', value: teamRoute },
      {
        key: 'node_deadlines',
        label: '各站交货时间',
        value: (task) => perNode(task, (node) => formatDateTime(node.due_at)),
      },
      { key: 'node_targets', label: '各站交货目标', value: (task) => perNode(task, target) },
      { key: 'node_basis', label: '各站计量方式', value: (task) => perNode(task, basis) },
      { key: 'node_execution', label: '各站执行状态', value: (task) => perNode(task, execution) },
      { key: 'notes', label: '任务备注', value: (task) => task.notes },
    ],
    (signal, progress) =>
      loadExportPages(
        (page, page_size) => productionScheduleApi.tasks({ ...selected, page, page_size }),
        signal,
        progress,
      ),
  )
}
watch(
  () => route.query.task_id,
  (id) => {
    if (typeof id === 'string' && /^\d+$/.test(id)) void openTask(Number(id))
  },
  { immediate: true },
)
watch(canManage, (allowed) => {
  if (!allowed) editorOpen.value = false
})
onMounted(() => {
  void load()
  timer = setInterval(live.request, 60_000)
})
onBeforeUnmount(() => {
  ++generation
  ++detailGeneration
  clearInterval(timer)
})
</script>
<template>
  <section
    class="task-board"
    :class="{ 'task-board--fullscreen': fullscreen, 'task-board--overview': !management }"
    aria-label="生产排期任务"
    @paste="pasteSearch"
  >
    <div v-if="management && (!fullscreen || error)" class="task-board__toolbar">
      <slot name="heading"><strong class="task-board__title">交货进度</strong></slot>
      <div class="task-board__actions">
        <TableExportButton
          text
          v-if="!fullscreen"
          :source="exportSource"
          :context="JSON.stringify({ ...filters, sort_by: sortBy, sort_order: sortOrder })"
          :disabled="loading || !!error"
        />
        <slot name="view-actions" />
      </div>
    </div>
    <component
      :is="management ? 'div' : VTableScheduleTimeline"
      v-show="!error"
      class="task-board__surface"
      :class="{ 'task-board__surface--management': management }"
      v-bind="
        management ? {} : { tasks: rows, loading, loadingMore, hasMore, loadError: moreError }
      "
      @load-more="loadMore"
      @open-node="openNode"
      @open-task="openTask"
    >
      <WorkspaceDataToolbar
        v-if="!fullscreen"
        v-model="query"
        :loading="loading"
        search-label="任务排期搜索"
        :placeholder="management ? '搜索流水号、任务或批次号' : '搜索流水号，支持多个'"
        :maxlength="4096"
        refresh-label="刷新任务排期"
        :columns="management"
        @columns="columnSettings?.open($event)"
        @search="search"
        @refresh="load()"
      >
        <template #filters>
          <FilterDialog
            v-if="!fullscreen"
            v-model="filterOpen"
            title="排期筛选"
            :count="filterCount"
            @open="openFilters"
            @reset="resetFilters"
            @apply="applyFilters"
          >
            <div class="filter-fields">
              <label v-if="!management"
                >每次加载条数（1–100）
                <AppNumberInput
                  v-model="draftLoadSize"
                  aria-label="每次加载条数"
                  :min="1"
                  :max="100"
                  :precision="0"
                  :step="1"
                  placeholder="1–100"
                />
              </label>
              <label v-if="!management"
                >列表排序
                <ElSelect
                  v-if="!fullscreen && !management"
                  v-model="draftSortOrder"
                  aria-label="列表排序"
                  ><ElOption label="创建时间：最新在前" value="created_at:desc" />
                  <ElOption label="最终交期：由近到远" value="final_due_at:asc" />
                  <ElOption label="最终交期：由远到近" value="final_due_at:desc" />
                </ElSelect>
              </label>
              <label
                >任务范围<ElSelect
                  v-model="draftScope"
                  aria-label="任务范围筛选"
                  placeholder="全部任务"
                  clearable
                  ><ElOption label="需关注" value="attention" />
                  <ElOption label="已交完" value="completed" /></ElSelect
              ></label>
              <label
                >交货班组<ElSelect
                  v-model="draftTeam"
                  aria-label="交货班组筛选"
                  placeholder="全部班组"
                  clearable
                  ><ElOption
                    v-for="team in teams"
                    :key="team.id"
                    :value="Number(team.id)"
                    :label="team.name" /></ElSelect
              ></label>
              <label
                >任务状态<ElSelect
                  v-model="draftStatus"
                  aria-label="任务状态筛选"
                  placeholder="全部状态"
                  clearable
                  ><ElOption
                    v-for="(label, value) in scheduleStatusLabels"
                    :key="value"
                    :value="value"
                    :label="label" /></ElSelect
              ></label>
              <label
                >节点要求交货日期<RecordDateFilter v-model="draftDates" label="节点要求交货日期"
              /></label>
              <div class="schedule-filter-selection">
                <span>流水号</span>
                <ElButton @click="selectionKind = 'serial'">{{
                  draftSerialSelection.length
                    ? `已选 ${draftSerialSelection.length} 个流水号`
                    : '选择流水号'
                }}</ElButton>
                <div v-if="draftSerialSelection.length" class="schedule-filter-values">
                  <ElTag v-for="item in draftSerialSelection" :key="item.value">{{
                    item.label
                  }}</ElTag>
                </div>
              </div>
              <div class="schedule-filter-selection">
                <div class="schedule-filter-label">
                  <span>业务人员</span>
                  <ElButton v-if="auth.isAdmin" link type="primary" @click="managingPeople = true"
                    >管理业务人员</ElButton
                  >
                </div>
                <ElButton @click="selectionKind = 'people'">{{
                  draftPersonSelection.length
                    ? `已选 ${draftPersonSelection.length} 位业务人员`
                    : '选择业务人员'
                }}</ElButton>
                <div v-if="draftPersonSelection.length" class="schedule-filter-values">
                  <ElTag v-for="item in draftPersonSelection" :key="item.value">{{
                    item.label
                  }}</ElTag>
                </div>
              </div>
              <TableFilterFields
                v-model="draftColumns"
                :columns="taskQueryColumns"
                :exclude="['serial_no', 'business_people']"
              />
            </div> </FilterDialog
        ></template>
        <template v-if="management" #tools>
          <InventoryColumnSettings
            ref="columnSettings"
            :storage-key="columnStorageKey"
            :columns="selectableColumns"
            :show-trigger="false"
            description="勾选显示列，上下移动调整顺序；操作列固定在右侧。"
            choices-label="调度排期可选列"
            @change="columnChoices = $event"
          />
        </template>
        <template #primary-actions
          ><ElButton v-if="canManage" type="primary" :icon="Plus" @click="createTask"
            >新建任务排期</ElButton
          ></template
        >
      </WorkspaceDataToolbar>
      <template v-if="!management" #view-actions>
        <TableExportButton
          text
          :source="exportSource"
          :context="JSON.stringify({ ...filters, sort_by: sortBy, sort_order: sortOrder })"
          :disabled="loading || !!error"
        />
      </template>
      <template v-if="!management" #load-status>
        已显示 {{ rows.length }} / {{ total }} 条
      </template>
    </component>
    <ElAlert v-if="actionError" :title="actionError" type="error" :closable="false" />
    <LiveRefreshNotice :message="live.message.value" @retry="live.request" />
    <StatePanel v-if="error" state="error" :description="error" @retry="load" />
    <WorkspaceTable
      columns-key="ScheduleTaskBoard-1"
      :column-settings="false"
      v-else-if="management"
      :data="rows"
      border
      class="dispatch-task-table"
      aria-label="调度排期列表"
      row-key="id"
      :column-query="tableQuery.controller.value"
    >
      <ElTableColumn
        v-for="column in visibleColumns"
        :key="column.key"
        :label="column.label"
        :prop="column.key"
        :min-width="column.width"
        :class-name="column.key === 'serial_no' ? 'table-identity' : undefined"
        :align="column.key === 'quantity' ? 'right' : 'left'"
        :show-overflow-tooltip="column.key !== 'team_planning'"
      >
        <template #default="{ row }">
          <ElButton
            v-if="column.key === 'serial_no'"
            link
            type="primary"
            @click="openTask(asTask(row))"
            >{{ row.serial_no }}</ElButton
          >
          <template v-else-if="column.key === 'quantity'">{{
            formatAmount(taskQuantity(row))
          }}</template>
          <template v-else-if="column.key === 'delivery_batches'">{{
            row.delivery_batches?.length || 1
          }}</template>
          <template v-else-if="column.key === 'final_due_at' || column.key === 'created_at'">{{
            formatDateTime(row[column.key])
          }}</template>
          <ScheduleShipmentProgress
            v-else-if="column.key === 'shipped_quantity'"
            :shipped="row.shipped_quantity"
            :target="row.order_quantity ?? taskQuantity(row)"
            :status="row.shipment_status"
          />
          <ElTag
            v-else-if="column.key === 'order_completed'"
            :type="row.order_completed ? 'success' : 'info'"
            >{{ row.order_completed ? '已完成' : '未完成' }}</ElTag
          >
          <ElTag
            v-else-if="column.key === 'order_overdue'"
            :type="row.order_overdue ? 'danger' : 'info'"
            >{{ row.order_overdue ? '已逾期' : '未逾期' }}</ElTag
          >
          <ScheduleTeamPlanning v-else-if="column.key === 'team_planning'" :nodes="row.nodes" />
          <span v-else-if="column.key === 'business_people'" class="schedule-people">
            <template v-if="row.business_people?.length"
              ><PersonName
                v-for="person in row.business_people"
                :key="person.id"
                :name="person.name"
            /></template>
            <PersonName v-else :name="row.business_person_name" />
          </span>
          <ElTag v-else-if="column.key === 'locked'" :type="row.locked_at ? 'warning' : 'info'">{{
            row.locked_at ? '已锁定' : '未锁定'
          }}</ElTag>
        </template>
      </ElTableColumn>
      <ElTableColumn
        v-if="canManage"
        label="操作"
        width="264"
        fixed="right"
        :show-overflow-tooltip="false"
      >
        <template #default="{ row }">
          <div class="dispatch-task-actions">
            <ElButton
              link
              type="primary"
              :disabled="!!row.locked_at || actionBusy"
              @click="editTask(asTask(row))"
              >修改交期</ElButton
            >
            <ElButton link :disabled="actionBusy" @click="toggleLock(asTask(row))">{{
              row.locked_at ? '解锁' : '锁定'
            }}</ElButton>
            <ElButton
              link
              type="danger"
              :disabled="!!row.locked_at || actionBusy"
              @click="deleteTarget = asTask(row)"
              >删除</ElButton
            >
          </div>
        </template>
      </ElTableColumn>
    </WorkspaceTable>
    <WorkspacePagination
      v-if="management"
      :current-page="page"
      :page-size="pageSize"
      :total="total"
      :page-sizes="[10, 20, 50]"
      @current-change="paginate"
      @size-change="resizePage"
      >共 {{ total }} 项任务</WorkspacePagination
    >
    <AppDialog
      :model-value="!!detailId"
      title="任务详情"
      width="min(1180px, 96vw)"
      append-to-body
      @close="closeTask"
    >
      <StatePanel v-if="detailLoading" state="loading" compact /><StatePanel
        v-else-if="detailError"
        state="error"
        :description="detailError"
        @retry="detailId && openTask(detailId)"
      />
      <template v-else-if="detail">
        <AppTabs v-model="detailTab">
          <ElTabPane label="当前任务" name="task">
            <div class="task-detail__heading">
              <div>
                <strong>{{ detail.title }}</strong
                ><span>{{ detail.task_no }} · 流水号 {{ detail.serial_no }}</span>
                <span
                  >业务人员：<span class="schedule-people"
                    ><template v-if="detail.business_people?.length"
                      ><PersonName
                        v-for="person in detail.business_people"
                        :key="person.id"
                        :name="person.name" /></template
                    ><PersonName v-else :name="detail.business_person_name || '未指定'" /></span
                ></span>
              </div>
              <ElButton v-if="canManage && !detail.locked_at" @click="routeLinkOpen = true">{{
                detail.route_changed ? '核对工艺变更' : '关联工艺'
              }}</ElButton>
              <ElTag :type="scheduleStatusTone(detail.status)">{{
                scheduleStatusLabels[detail.status]
              }}</ElTag
              ><ElButton v-if="canManage && !detail.locked_at" @click="editTask(detail)"
                >修改交期</ElButton
              >
            </div>
            <div class="task-detail__meta">
              <div>
                <span>最终交货时间</span><strong>{{ formatDateTime(detail.final_due_at) }}</strong>
              </div>
              <span class="task-detail__created"
                >创建于 {{ formatDateTime(detail.created_at) }}</span
              >
            </div>
            <ScheduleDocuments
              :key="detail.id"
              :task-id="detail.id"
              :order-document="detail.order_document || null"
              :serial-no="detail.serial_no"
              :route-ids="detail.nodes.map((node) => node.process_route_id)"
            >
              <ElTable
                columns-key="ScheduleTaskBoard-2"
                v-if="detail.delivery_batches?.length"
                :data="detail.delivery_batches"
                border
                size="small"
                aria-label="订单交货要求"
              >
                <ElTableColumn label="交货批次" prop="batch_number" width="100" /><ElTableColumn
                  label="数量（件）"
                  prop="target_quantity"
                  width="120"
                /><ElTableColumn label="交期"
                  ><template #default="{ row }">{{
                    formatDateTime(row.due_at)
                  }}</template></ElTableColumn
                >
              </ElTable>
              <p v-if="detail.notes" class="task-detail__notes">
                <span>任务备注</span>{{ detail.notes }}
              </p>
              <div class="task-detail__route business-table" role="table" aria-label="班组交货路线">
                <div class="task-detail__route-head" role="row">
                  <span role="columnheader">工序 / 去向</span>
                  <span role="columnheader">要求交货时间</span>
                  <span role="columnheader">交货目标</span>
                  <span role="columnheader">实际进度</span>
                  <span role="columnheader">操作</span>
                </div>
                <article
                  v-for="(node, index) in detail.nodes"
                  :key="node.id"
                  class="task-detail__node"
                  role="row"
                >
                  <div class="task-detail__stage" role="cell">
                    <div>
                      <span class="task-detail__sequence">{{
                        String(index + 1).padStart(2, '0')
                      }}</span
                      ><strong>{{ node.team_name }}</strong>
                    </div>
                    <small>→ {{ node.next_team_name || node.external_destination }}</small>
                    <ElTag v-if="node.route_link?.state === 'changed'" type="warning" size="small"
                      >工艺有更新</ElTag
                    >
                  </div>
                  <div class="task-detail__due" role="cell">
                    <strong>{{ plannedDueLabel(node) }}</strong>
                    <ElTag :type="scheduleStatusTone(node.status)" size="small">{{
                      scheduleStatusLabels[node.status]
                    }}</ElTag>
                  </div>
                  <div class="task-detail__target" role="cell">
                    <strong>{{ mainTarget(node) }}</strong>
                    <small v-if="referenceTarget(node)">{{ referenceTarget(node) }}</small>
                  </div>
                  <div
                    class="task-detail__execution"
                    :class="{
                      'is-held': node.quality_held,
                      'is-ready':
                        !node.quality_held &&
                        ['ready', 'completed'].includes(node.execution_state || ''),
                    }"
                    role="cell"
                  >
                    <strong>{{ execution(node) }}</strong>
                    <small
                      >已转出 {{ formatAmount(node.dispatched_quantity) }} 件 /
                      {{ formatAmount(node.dispatched_weight) }} kg</small
                    >
                  </div>
                  <div role="cell">
                    <ElButton link type="primary" @click="openNode(node)">详情</ElButton>
                  </div>
                </article>
              </div>
              <ScheduleReworkPanel
                :task="detail"
                :manage="canManage && !detail.locked_at"
                @saved="
                  (task) => {
                    detail = task
                    void load()
                  }
                "
              />
            </ScheduleDocuments>
          </ElTabPane>
          <ElTabPane label="进度详情" name="progress" lazy>
            <ScheduleSerialProgress v-if="detailTab === 'progress'" :task-id="detail.id" />
          </ElTabPane>
        </AppTabs>
      </template>
    </AppDialog>
    <ScheduleRouteLink
      v-if="routeLinkOpen && detail"
      :task="detail"
      @close="routeLinkOpen = false"
      @saved="
        (task) => {
          detail = task
          void load()
        }
      "
    />
    <AppDialog
      :model-value="!!deleteTarget"
      title="删除排期"
      width="440px"
      append-to-body
      :close-on-click-modal="!actionBusy"
      @close="!actionBusy && (deleteTarget = null)"
    >
      <p>删除 {{ deleteTarget?.serial_no }} 的排期？已发生的加工、转料和变更记录将保留。</p>
      <ElAlert v-if="actionError" :title="actionError" type="error" :closable="false" />
      <template #footer
        ><ElButton :disabled="actionBusy" @click="deleteTarget = null">取消</ElButton
        ><ElButton type="danger" :loading="actionBusy" @click="removeTask"
          >删除排期</ElButton
        ></template
      >
    </AppDialog>
    <ScheduleTaskEditor
      v-if="editorOpen"
      :task="editingTask"
      @close="editorOpen = false"
      @saved="saved"
    />
    <DeliverySchedules ref="nodeDetails" manage detail-only @changed="nodeChanged" />
    <ScheduleSelectionDialog
      v-if="selectionKind"
      :kind="selectionKind"
      :selected="selectionKind === 'serial' ? draftSerialSelection : draftPersonSelection"
      @close="selectionKind = null"
      @apply="applySelection"
    />
    <ScheduleSelectionDialog
      v-if="managingPeople"
      kind="people"
      manage
      :selected="[]"
      @close="managingPeople = false"
      @apply="managingPeople = false"
    />
  </section>
</template>
<style scoped>
.dispatch-task-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
.dispatch-task-actions :deep(.el-button) {
  flex: 0 0 auto;
  margin: 0;
}

.task-board__surface--management {
  flex: 0 0 auto;
}

.schedule-people {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  max-width: 100%;
  overflow: hidden;
  vertical-align: middle;
}
.task-board {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 14px;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}
.task-board--overview {
  gap: 8px;
}
.task-board__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  flex-shrink: 0;
}
.task-board__toolbar :deep(.el-button) {
  margin-left: 0;
}
.task-board__actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-left: auto;
}
.task-board__title {
  color: var(--text);
  font-size: 14px;
  font-weight: 600;
}
.schedule-filter-selection {
  display: grid;
  gap: 8px;
  min-width: 0;
  color: var(--muted);
  font-size: 13px;
}
.schedule-filter-label {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: space-between;
}
.schedule-filter-selection > .el-button {
  margin-left: 0;
}
.schedule-filter-values {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 120px;
  overflow: auto;
}
.schedule-filter-values :deep(.el-tag) {
  max-width: 100%;
}
.schedule-filter-values :deep(.el-tag__content) {
  overflow: hidden;
  text-overflow: ellipsis;
}

.task-detail__heading {
  display: flex;
  gap: 16px;
  align-items: center;
  margin: 4px 0 18px;
}
.task-detail__heading > div {
  flex: 1;
  min-width: 0;
}
.task-detail__heading strong {
  display: block;
  font-size: 20px;
  font-weight: 600;
  color: var(--text);
}
.task-detail__heading > div > span {
  display: block;
  margin-top: 6px;
  color: var(--muted);
  font-size: 13px;
}
.task-detail__meta,
.task-detail__meta > div {
  display: flex;
  align-items: baseline;
  gap: 12px;
}
.task-detail__meta {
  justify-content: space-between;
  flex-wrap: wrap;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--line);
  font-size: 13px;
  color: var(--muted);
}
.task-detail__meta strong {
  color: var(--text);
  font-size: 15px;
  font-weight: 550;
  font-variant-numeric: tabular-nums;
}
.task-detail__created {
  font-size: var(--business-table-meta, 12px);
}
.task-detail__notes {
  display: flex;
  gap: 12px;
  margin: 14px 0;
  font-size: 13px;
  color: var(--text);
  white-space: pre-wrap;
}
.task-detail__notes > span {
  flex-shrink: 0;
  color: var(--muted);
}
.task-detail__route {
  margin: 18px 0 4px;
  overflow-x: auto;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--surface);
  font-family: var(--font-body);
  font-variant-numeric: tabular-nums;
}
.task-detail__route-head,
.task-detail__node {
  display: grid;
  grid-template-columns:
    minmax(160px, 1fr) minmax(175px, 1.1fr) minmax(155px, 1fr) minmax(190px, 1.2fr)
    70px;
  gap: 16px;
  min-width: 845px;
  align-items: center;
  padding: 12px 16px;
  text-align: center;
}
.task-detail__route-head {
  min-height: 42px;
  padding-block: 10px;
  background: var(--table-glass-header, var(--surface-soft));
  font-size: var(--business-table-meta, 12px);
  font-weight: 500;
  color: var(--muted);
}
.task-detail__node {
  min-height: 84px;
  border-top: 1px solid var(--line);
  color: var(--text);
  font-size: var(--business-table-font, 14px);
}
.task-detail__node > [role='cell'] {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.task-detail__node strong {
  font-weight: 550;
}
.task-detail__node small,
.task-detail__target > span {
  font-size: var(--business-table-meta, 12px);
  color: var(--muted);
  line-height: 18px;
}
.task-detail__stage > div {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.task-detail__sequence {
  font-size: 12px;
  color: var(--muted);
}
.task-detail__due > strong {
  font-size: 13px;
  white-space: nowrap;
}
.task-detail__target > strong {
  font-size: 15px;
}
.task-detail__execution.is-ready > strong {
  color: var(--primary);
}
.task-detail__execution.is-held > strong {
  color: var(--danger);
}
</style>
