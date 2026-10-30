<script setup lang="ts">
import { awaitingReview, plannedDueLabel, planLabel } from '@/utils/schedulePlanning'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import {
  ElAlert,
  ElButton,
  ElInput,
  ElOption,
  ElPagination,
  ElSelect,
  ElTag,
  ElTable,
  ElTableColumn,
} from 'element-plus'
import { Filter, Plus, Refresh, Search } from '@element-plus/icons-vue'
import AppDialog from './AppDialog.vue'
import AppDrawer from './AppDrawer.vue'
import RecordDateFilter from './RecordDateFilter.vue'
import StatePanel from './StatePanel.vue'
import LiveRefreshNotice from './LiveRefreshNotice.vue'
import TableExportButton from './TableExportButton.vue'
import DeliverySchedules from './DeliverySchedules.vue'
import ProductionScheduleOverview from './ProductionScheduleOverview.vue'
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
const peopleLabel = (row: unknown) => {
  const task = asTask(row)
  return task.business_people?.map((p) => p.name).join('、') || task.business_person_name || '—'
}
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
const initialSerial = typeof route.query.serial_no === 'string' ? route.query.serial_no : ''
const query = ref(initialSerial),
  filters = ref<ScheduleFilters>(initialSerial ? { query: initialSerial } : {}),
  filterOpen = ref(false)
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
const nodeDetails = ref<{ openDetail: (id: number) => void }>()
let generation = 0,
  detailGeneration = 0,
  timer: ReturnType<typeof setInterval> | undefined
const live = useLiveRefresh(() => load(true), {
  busy: () => loading.value || editorOpen.value || !!detailId.value || filterOpen.value,
})
const filterCount = computed(
  () =>
    Number(!!filters.value.query) +
    Number(!!filters.value.scope) +
    Number(!!filters.value.team_id) +
    Number(!!filters.value.status) +
    Number(!!filters.value.due_from || !!filters.value.due_to) +
    Number(!!filters.value.serial_nos?.length) +
    Number(!!filters.value.business_person_ids?.length),
)
async function load(background = false) {
  const token = ++generation
  if (!background) loading.value = true
  error.value = ''
  try {
    const result = await productionScheduleApi.tasks({
      ...filters.value,
      page: page.value,
      page_size: pageSize.value,
    })
    if (token !== generation) return
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
    if (token === generation) loading.value = false
  }
}
function openFilters() {
  query.value = filters.value.query || ''
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
  filters.value = {
    scope: draftScope.value || undefined,
    serial_nos: draftSerialSelection.value.length
      ? draftSerialSelection.value.map((item) => String(item.value))
      : undefined,
    business_person_ids: draftPersonSelection.value.length
      ? draftPersonSelection.value.map((item) => Number(item.value))
      : undefined,
    query: query.value.trim() || undefined,
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
  query.value = ''
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
function saved(task: ScheduleTask) {
  editorOpen.value = false
  void load()
  void openTask(task.id)
}
function nodeChanged() {
  void load()
  if (detailId.value) void openTask(detailId.value)
}
function exportSource() {
  const selected = { ...filters.value }
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
      { key: 'status', label: '任务状态', value: (task) => scheduleStatusLabels[task.status] },
      {
        key: 'final_due_at',
        label: '最终交货时间',
        value: (task) => formatDateTime(task.final_due_at),
      },
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
    :class="{ 'task-board--fullscreen': fullscreen }"
    aria-label="生产排期任务"
  >
    <div v-if="!fullscreen || error" class="workspace-data-toolbar task-board__toolbar">
      <slot name="heading"><strong class="task-board__title">交货进度</strong></slot>
      <div class="task-board__actions">
        <slot name="view-actions" />
        <ElButton
          v-if="!fullscreen"
          class="task-board__filter"
          :class="{ 'action-cool': filterCount > 0 }"
          :icon="Filter"
          :aria-expanded="filterOpen"
          aria-label="排期筛选"
          @click="openFilters"
          >筛选<span v-if="filterCount" class="task-board__filter-count">{{
            filterCount
          }}</span></ElButton
        >
        <TableExportButton
          v-if="!fullscreen"
          :source="exportSource"
          :context="JSON.stringify(filters)"
          :disabled="loading || !!error"
        />
        <ElButton
          v-if="!fullscreen"
          :icon="Refresh"
          :loading="loading"
          aria-label="刷新任务排期"
          @click="load()"
        />
        <ElButton v-if="!fullscreen && canManage" type="primary" :icon="Plus" @click="createTask"
          >新建任务排期</ElButton
        >
      </div>
    </div>
    <ElAlert v-if="actionError" :title="actionError" type="error" :closable="false" />
    <LiveRefreshNotice :message="live.message.value" @retry="live.request" />
    <StatePanel v-if="error" state="error" :description="error" @retry="load" />
    <ElTable
      v-else-if="management"
      :data="rows"
      border
      height="100%"
      class="business-table dispatch-task-table"
      aria-label="调度排期列表"
      row-key="id"
    >
      <ElTableColumn label="流水号" min-width="150"
        ><template #default="{ row }"
          ><ElButton link type="primary" @click="openTask(asTask(row))">{{
            row.serial_no
          }}</ElButton></template
        ></ElTableColumn
      >
      <ElTableColumn label="数量（件）" width="110" align="right"
        ><template #default="{ row }">{{
          formatAmount(taskQuantity(row))
        }}</template></ElTableColumn
      >
      <ElTableColumn label="交货批数" width="95" align="center"
        ><template #default="{ row }">{{
          row.delivery_batches?.length || 1
        }}</template></ElTableColumn
      >
      <ElTableColumn label="最终交期" min-width="170"
        ><template #default="{ row }">{{
          formatDateTime(row.final_due_at)
        }}</template></ElTableColumn
      >
      <ElTableColumn label="业务人员" min-width="140" show-overflow-tooltip
        ><template #default="{ row }">{{ peopleLabel(row) }}</template></ElTableColumn
      >
      <ElTableColumn label="待填班组" width="95" align="center"
        ><template #default="{ row }">{{
          new Set(
            row.nodes
              .filter((n: ProductionSchedule) => n.planning_state === 'pending')
              .map((n: ProductionSchedule) => n.team_id),
          ).size
        }}</template></ElTableColumn
      >
      <ElTableColumn label="待确认" width="95" align="center"
        ><template #default="{ row }"
          ><ElButton
            link
            :type="
              row.nodes.some((n: ProductionSchedule) => awaitingReview(n)) ? 'warning' : undefined
            "
            @click="openTask(asTask(row))"
            >{{ row.nodes.filter((n: ProductionSchedule) => awaitingReview(n)).length }}</ElButton
          ></template
        ></ElTableColumn
      >
      <ElTableColumn label="订单锁定" width="95" align="center"
        ><template #default="{ row }"
          ><ElTag :type="row.locked_at ? 'warning' : 'info'">{{
            row.locked_at ? '已锁定' : '未锁定'
          }}</ElTag></template
        ></ElTableColumn
      >
      <ElTableColumn v-if="canManage" label="操作" width="205" fixed="right"
        ><template #default="{ row }"
          ><ElButton
            link
            type="primary"
            :disabled="!!row.locked_at || actionBusy"
            @click="editTask(asTask(row))"
            >修改交期</ElButton
          ><ElButton link :disabled="actionBusy" @click="toggleLock(asTask(row))">{{
            row.locked_at ? '解锁' : '锁定'
          }}</ElButton
          ><ElButton
            link
            type="danger"
            :disabled="!!row.locked_at || actionBusy"
            @click="deleteTarget = asTask(row)"
            >删除</ElButton
          ></template
        ></ElTableColumn
      >
    </ElTable>
    <ProductionScheduleOverview
      v-else
      :tasks="rows"
      :loading="loading"
      @open-node="openNode"
      @open-task="openTask"
    >
      <template v-if="fullscreen" #view-actions><slot name="view-actions" /></template>
    </ProductionScheduleOverview>
    <footer class="task-board__footer">
      <span>共 {{ total }} 项任务</span
      ><ElPagination
        :current-page="page"
        :page-size="pageSize"
        :total="total"
        :page-sizes="[10, 20, 50]"
        layout="sizes, prev, pager, next"
        @current-change="paginate"
        @size-change="resizePage"
      />
    </footer>
    <AppDrawer
      v-model="filterOpen"
      title="排期筛选"
      direction="rtl"
      size="min(420px, 94vw)"
      append-to-body
      class="schedule-filter-drawer"
    >
      <div class="schedule-filter-fields">
        <label
          >关键词<ElInput
            v-model="query"
            :prefix-icon="Search"
            aria-label="任务排期搜索"
            placeholder="任务、流水号或批次号"
            clearable
            @keyup.enter="applyFilters"
        /></label>
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
            <ElTag v-for="item in draftSerialSelection" :key="item.value">{{ item.label }}</ElTag>
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
            <ElTag v-for="item in draftPersonSelection" :key="item.value">{{ item.label }}</ElTag>
          </div>
        </div>
      </div>
      <template #footer>
        <div class="schedule-filter-footer">
          <ElButton class="schedule-filter-reset" @click="resetFilters">重置</ElButton>
          <ElButton @click="filterOpen = false">取消</ElButton>
          <ElButton type="primary" @click="applyFilters">应用筛选</ElButton>
        </div>
      </template>
    </AppDrawer>
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
      <template v-else-if="detail"
        ><div class="task-detail__heading">
          <div>
            <strong>{{ detail.title }}</strong
            ><span>{{ detail.task_no }} · 流水号 {{ detail.serial_no }}</span>
            <span
              >业务人员：{{
                detail.business_people?.map((p) => p.name).join('、') ||
                detail.business_person_name ||
                '未指定'
              }}</span
            >
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
          <span class="task-detail__created">创建于 {{ formatDateTime(detail.created_at) }}</span>
        </div>
        <ScheduleDocuments
          :key="detail.id"
          :serial-no="detail.serial_no"
          :route-ids="detail.nodes.map((node) => node.process_route_id)"
        />
        <ElTable
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
            ><template #default="{ row }">{{ formatDateTime(row.due_at) }}</template></ElTableColumn
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
                <span class="task-detail__sequence">{{ String(index + 1).padStart(2, '0') }}</span
                ><strong>{{ node.team_name }}</strong>
              </div>
              <small>→ {{ node.next_team_name || node.external_destination }}</small>
              <ElTag v-if="node.route_link?.state === 'changed'" type="warning" size="small"
                >工艺有更新</ElTag
              >
            </div>
            <div class="task-detail__due" role="cell">
              <strong>{{ plannedDueLabel(node) }}</strong>
              <ElTag v-if="node.planning_state === 'revision_pending'" type="warning">{{
                planLabel(node)
              }}</ElTag>
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
                  !node.quality_held && ['ready', 'completed'].includes(node.execution_state || ''),
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
.task-board {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 14px;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
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
.task-board__filter-count {
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--primary-soft);
  color: var(--primary);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.task-board__title {
  color: var(--text);
  font-size: 14px;
  font-weight: 600;
}
.schedule-filter-fields {
  display: grid;
  gap: 18px;
}
.schedule-filter-fields > label,
.schedule-filter-selection {
  display: grid;
  gap: 8px;
  min-width: 0;
  color: var(--muted);
  font-size: 13px;
}
.schedule-filter-fields :is(.el-select, .record-date-trigger) {
  width: 100%;
  min-width: 0;
}
.schedule-filter-label,
.schedule-filter-footer {
  display: flex;
  align-items: center;
  gap: 8px;
}
.schedule-filter-label {
  justify-content: space-between;
}
.schedule-filter-selection > .el-button,
.schedule-filter-footer > .el-button {
  margin-left: 0;
}
.schedule-filter-reset {
  margin-right: auto;
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
.task-board__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  color: var(--muted);
  font-size: 13px;
  flex-shrink: 0;
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
