<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { Refresh, Search, Plus } from '@element-plus/icons-vue'
import {
  ElAlert,
  ElButton,
  ElCollapse,
  ElCollapseItem,
  ElDescriptions,
  ElDescriptionsItem,
  ElInput,
  ElOption,
  ElPagination,
  ElSelect,
  ElTable,
  ElTableColumn,
  ElTag,
} from 'element-plus'
import AppDialog from './AppDialog.vue'
import FilterDialog from './FilterDialog.vue'
import RecordDateFilter from './RecordDateFilter.vue'
import StatePanel from './StatePanel.vue'
import TableExportButton from './TableExportButton.vue'
import MaterialTransferDrawer from './MaterialTransferDrawer.vue'
import MaterialTransferStatus from './MaterialTransferStatus.vue'
import type { MaterialTransferStatus as TransferStatus } from '@/types/materialTransfer'
import ProductionScheduleEditor from './ProductionScheduleEditor.vue'
import LiveRefreshNotice from './LiveRefreshNotice.vue'
import { useLiveRefresh } from '@/composables/useLiveRefresh'
import { useTeamDirectoryStore } from '@/stores/teamDirectory'
import { useAuthStore } from '@/stores/auth'
import { productionScheduleApi } from '@/services/productionScheduleApi'
import {
  scheduleStatusLabels,
  scheduleStatusTone,
  completionBasisLabels,
  scheduleExecutionLabels,
  type ScheduleTask,
  type ProductionSchedule,
  type ScheduleFilters,
  type ScheduleSourceOption,
  type ScheduleStatus,
  type ScheduleWrite,
} from '@/types/productionSchedule'
import { formatAmount, formatDateTime } from '@/utils/format'
import { loadExportPages, tableExportSource } from '@/utils/tableExport'
import { showToast } from '@/stores/toast'

const props = defineProps<{
  teamId?: number
  manage?: boolean
  fullscreen?: boolean
  refreshKey?: unknown
  detailOnly?: boolean
}>()
const emit = defineEmits<{
  dispatch: [schedule: ProductionSchedule, sourceId: number]
  changed: []
}>()
const route = useRoute(),
  auth = useAuthStore(),
  directory = useTeamDirectoryStore()
const canManage = computed(() =>
  Boolean(
    props.manage && auth.isAdmin && !auth.currentUserError && auth.currentUser?.active !== false,
  ),
)
const canDispatch = computed(() =>
  Boolean(
    props.teamId &&
    auth.isTeamAccount &&
    Number(auth.currentUser?.team_id) === props.teamId &&
    !auth.currentUserError &&
    auth.currentUser?.active !== false,
  ),
)
const canEditCommitment = computed(() => canManage.value || canDispatch.value)
const teams = computed(() => directory.items.filter((team) => team.active))
const rows = ref<ProductionSchedule[]>([]),
  total = ref(0),
  loading = ref(false),
  error = ref(''),
  page = ref(1),
  pageSize = ref(10)
const query = ref(''),
  filters = ref<ScheduleFilters>({}),
  filterOpen = ref(false)
const draftTeam = ref<number>(),
  draftStatus = ref<ScheduleStatus>(),
  draftDates = ref({ from: '', to: '' })
const detail = ref<ProductionSchedule | null>(null),
  detailId = ref<number>(),
  detailLoading = ref(false),
  detailError = ref('')
const taskContext = ref<ScheduleTask | null>(null),
  taskLoading = ref(false),
  taskError = ref('')
const editing = ref(false),
  editingSchedule = ref<ProductionSchedule | null>(null),
  predecessor = ref<ProductionSchedule | null>(null)
const cancelTarget = ref<ProductionSchedule | null>(null),
  cancelReason = ref(''),
  cancelling = ref(false),
  cancelError = ref('')
const batchNo = ref(''),
  batchOpen = ref(false)
let generation = 0,
  detailGeneration = 0,
  taskGeneration = 0
let clockRefresh: ReturnType<typeof setInterval> | undefined
const live = useLiveRefresh(() => load(true), {
  teamId: () => props.teamId,
  busy: () => loading.value || editing.value || !!cancelTarget.value || !!detailId.value,
})
const filterCount = computed(
  () =>
    Number(!!filters.value.team_id) +
    Number(!!filters.value.status) +
    Number(!!filters.value.due_from || !!filters.value.due_to),
)
function params() {
  return { ...filters.value, team_id: props.teamId ?? filters.value.team_id }
}
async function load(background = false) {
  if (props.detailOnly) return
  const token = ++generation
  if (!background) loading.value = true
  error.value = ''
  try {
    const result = await productionScheduleApi.list({
      ...params(),
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
    error.value = e instanceof Error ? e.message : '交货排期读取失败'
  } finally {
    if (token === generation) loading.value = false
  }
}
function search() {
  const exact = filters.value.serial_no === query.value.trim() ? filters.value.serial_no : undefined
  filters.value = {
    ...filters.value,
    serial_no: exact,
    query: exact ? undefined : query.value.trim() || undefined,
  }
  page.value = 1
  void load()
}
function openFilters() {
  draftTeam.value = filters.value.team_id
  draftStatus.value = filters.value.status
  draftDates.value = {
    from: filters.value.due_from?.slice(0, 10) || '',
    to: filters.value.due_to?.slice(0, 10) || '',
  }
}
function applyFilters() {
  filters.value = {
    serial_no: filters.value.serial_no === query.value.trim() ? filters.value.serial_no : undefined,
    query:
      filters.value.serial_no === query.value.trim() ? undefined : query.value.trim() || undefined,
    team_id: draftTeam.value,
    status: draftStatus.value,
    due_from: draftDates.value.from ? `${draftDates.value.from}T00:00:00+08:00` : undefined,
    due_to: draftDates.value.to ? `${draftDates.value.to}T23:59:59+08:00` : undefined,
  }
  filterOpen.value = false
  page.value = 1
  void load()
}
function resetFilters() {
  draftTeam.value = undefined
  draftStatus.value = undefined
  draftDates.value = { from: '', to: '' }
}
function paginate(next: number, size = pageSize.value) {
  page.value = next
  pageSize.value = size
  void load()
}
function destination(row: ProductionSchedule) {
  return row.next_team_name || row.external_destination || '—'
}
async function openDetail(id: number) {
  const token = ++detailGeneration
  detailId.value = id
  detail.value = null
  taskContext.value = null
  taskError.value = ''
  taskLoading.value = false
  detailLoading.value = true
  detailError.value = ''
  try {
    const result = await productionScheduleApi.detail(id)
    if (token === detailGeneration) {
      detail.value = result
      if (result.task_id) void loadTask(result.task_id, token)
    }
  } catch (e) {
    if (token === detailGeneration)
      detailError.value = e instanceof Error ? e.message : '排期详情读取失败'
  } finally {
    if (token === detailGeneration) detailLoading.value = false
  }
}
async function loadTask(id: number, token = detailGeneration) {
  const taskToken = ++taskGeneration
  taskLoading.value = true
  taskError.value = ''
  try {
    const result = await productionScheduleApi.task(id)
    if (token === detailGeneration && taskToken === taskGeneration) taskContext.value = result
  } catch (e) {
    if (token === detailGeneration && taskToken === taskGeneration)
      taskError.value = e instanceof Error ? e.message : '任务路线读取失败'
  } finally {
    if (token === detailGeneration && taskToken === taskGeneration) taskLoading.value = false
  }
}
function closeDetail() {
  ++detailGeneration
  detailId.value = undefined
  detail.value = null
  taskContext.value = null
  taskLoading.value = false
}
function newSchedule() {
  editingSchedule.value = predecessor.value = null
  editing.value = true
}
function editSchedule(row: ProductionSchedule) {
  editingSchedule.value = row
  predecessor.value = null
  editing.value = true
}
function nextSchedule(row: ProductionSchedule) {
  editingSchedule.value = null
  predecessor.value = row
  editing.value = true
}
function saved(row: ProductionSchedule) {
  editing.value = false
  void load()
  void openDetail(row.id)
  emit('changed')
  showToast('交货排期已保存', 'success')
}
function startCancel(row: ProductionSchedule) {
  cancelTarget.value = row
  cancelReason.value = ''
  cancelError.value = ''
}
async function cancel() {
  if (!cancelTarget.value || !canManage.value || cancelling.value) return
  cancelling.value = true
  cancelError.value = ''
  try {
    const result = await productionScheduleApi.cancel(cancelTarget.value.id, {
      expected_version: cancelTarget.value.version,
      reason: cancelReason.value.trim() || undefined,
    })
    cancelTarget.value = null
    detail.value = result
    if (result.task_id) void loadTask(result.task_id)
    emit('changed')
    void load()
    showToast('排期已取消，实际收发记录仍保留', 'success')
  } catch (e) {
    cancelError.value = e instanceof Error ? e.message : '取消失败，请刷新重试'
  } finally {
    cancelling.value = false
  }
}
function viewBatch(batch: string) {
  batchNo.value = batch
  batchOpen.value = true
}
const dispatchTarget = ref<ProductionSchedule | null>(null),
  dispatchSources = ref<ScheduleSourceOption[]>([])
const dispatchLoading = ref(false),
  dispatchError = ref(''),
  dispatchPage = ref(1),
  dispatchTotal = ref(0)
let dispatchGeneration = 0
async function loadDispatchSources(autoChoose = false) {
  if (!dispatchTarget.value || !canDispatch.value) return
  const target = dispatchTarget.value,
    token = ++dispatchGeneration
  dispatchLoading.value = true
  dispatchError.value = ''
  try {
    const result = await productionScheduleApi.sources({
      team_id: target.team_id,
      serial_no: target.serial_no,
      schedule_id: target.id,
      page: dispatchPage.value,
      page_size: 10,
    })
    if (token !== dispatchGeneration) return
    dispatchSources.value = result.items
    dispatchTotal.value = result.total
    if (autoChoose && result.total === 1 && result.items[0])
      dispatch(target, result.items[0].source_transfer_id)
  } catch (e) {
    if (token === dispatchGeneration)
      dispatchError.value = e instanceof Error ? e.message : '可转出批次读取失败'
  } finally {
    if (token === dispatchGeneration) dispatchLoading.value = false
  }
}
function prepareDispatch(row: ProductionSchedule) {
  if (!canDispatch.value || row.team_id !== props.teamId) return
  dispatchTarget.value = row
  dispatchPage.value = 1
  dispatchSources.value = []
  void loadDispatchSources(true)
}
function closeDispatch() {
  ++dispatchGeneration
  dispatchTarget.value = null
  dispatchLoading.value = false
}
function paginateDispatch(value: number) {
  dispatchPage.value = value
  void loadDispatchSources()
}
function dispatch(row: ProductionSchedule, sourceId: number) {
  if (!canDispatch.value || row.team_id !== props.teamId) return
  closeDispatch()
  closeDetail()
  emit('dispatch', row, sourceId)
}
function exportSource() {
  const selected = params()
  return tableExportSource(
    '交货排期',
    total.value,
    [
      { key: 'id', label: '排期编号', value: (row: ProductionSchedule) => row.id },
      { key: 'serial_no', label: '流水号', value: (row) => row.serial_no },
      { key: 'task_no', label: '交货任务编号', value: (row) => row.task_no },
      { key: 'task_title', label: '交货任务', value: (row) => row.task_title },
      {
        key: 'execution_state',
        label: '执行情况',
        value: (row) => (row.execution_state ? scheduleExecutionLabels[row.execution_state] : '—'),
      },
      { key: 'quality_held', label: '质量冻结', value: (row) => (row.quality_held ? '是' : '否') },
      {
        key: 'completion_basis',
        label: '计量方式',
        value: (row) => (row.completion_basis ? completionBasisLabels[row.completion_basis] : '—'),
      },
      { key: 'team_name', label: '交货班组', value: (row) => row.team_name },
      { key: 'destination', label: '接收去向', value: destination },
      { key: 'due_at', label: '要求交货时间', value: (row) => formatDateTime(row.due_at) },
      { key: 'status', label: '排期状态', value: (row) => scheduleStatusLabels[row.status] },
      { key: 'quantity', label: '计划件数', value: (row) => row.target_quantity },
      { key: 'weight', label: '计划重量（kg）', value: (row) => row.target_weight },
      {
        key: 'processed_quantity',
        label: '已加工件数',
        value: (row) => (row.assessment_enabled === false ? null : row.processed_quantity),
      },
      { key: 'dispatched_quantity', label: '已转出件数', value: (row) => row.dispatched_quantity },
      {
        key: 'dispatched_weight',
        label: '已转出重量（kg）',
        value: (row) => row.dispatched_weight,
      },
      {
        key: 'remaining_quantity',
        label: '待交件数',
        value: (row) => (row.completion_basis === 'weight' ? null : row.remaining_quantity),
      },
      {
        key: 'remaining_weight',
        label: '待交重量（kg）',
        value: (row) => (row.completion_basis === 'quantity' ? null : row.remaining_weight),
      },
      { key: 'received_quantity', label: '下序签收件数', value: (row) => row.received_quantity },
      { key: 'received_weight', label: '下序签收重量（kg）', value: (row) => row.received_weight },
      {
        key: 'completed_at',
        label: '实际交完时间',
        value: (row) => formatDateTime(row.completed_at),
      },
      {
        key: 'sources',
        label: '关联批次',
        value: (row) =>
          (row.linked_batches?.length ? row.linked_batches : row.sources)
            .map((source) => source.batch_no)
            .filter(Boolean)
            .join('、'),
      },
      { key: 'notes', label: '排期备注', value: (row) => row.notes },
    ],
    (signal, progress) =>
      loadExportPages(
        (page, page_size) => productionScheduleApi.list({ ...selected, page, page_size }),
        signal,
        progress,
      ),
  )
}
const auditFields: [keyof ScheduleWrite, string][] = [
  ['serial_no', '流水号'],
  ['team_id', '交货班组'],
  ['next_team_id', '接收班组'],
  ['external_destination', '外部去向'],
  ['due_at', '要求交货时间'],
  ['target_quantity', '计划件数'],
  ['target_weight', '计划重量（kg）'],
  ['completion_basis', '计量方式'],
  ['predecessor_id', '上序排期'],
  ['sources', '关联批次'],
  ['notes', '备注'],
]
function auditValue(key: keyof ScheduleWrite, data?: Partial<ScheduleWrite> | null) {
  const value = data?.[key]
  if (value == null || value === '') return '—'
  if (key === 'due_at') return formatDateTime(String(value))
  if (key === 'completion_basis')
    return completionBasisLabels[value as keyof typeof completionBasisLabels] || String(value)
  if (key === 'team_id' || key === 'next_team_id')
    return directory.items.find((team) => Number(team.id) === Number(value))?.name || String(value)
  if (key === 'sources' && Array.isArray(value))
    return (
      value
        .map(
          (source) =>
            `${source.batch_no || `批次 #${source.source_transfer_id}`}：${source.quantity == null ? '—' : formatAmount(Number(source.quantity))} 件 / ${source.weight == null ? '—' : formatAmount(Number(source.weight))} kg`,
        )
        .join('；') || '未关联'
    )
  return String(value)
}
function changes(event: NonNullable<ProductionSchedule['history']>[number]) {
  const items = auditFields
    .filter(([key]) => JSON.stringify(event.before?.[key]) !== JSON.stringify(event.after?.[key]))
    .map(([key, label]) => ({
      label,
      before: auditValue(key, event.before),
      after: auditValue(key, event.after),
    }))
  if (event.after?.reason) items.push({ label: '取消原因', before: '—', after: event.after.reason })
  for (const [key, label] of [
    ['task_title', '任务名称'],
    ['task_notes', '任务备注'],
  ] as const) {
    if (event.before?.[key] !== event.after?.[key])
      items.push({ label, before: event.before?.[key] || '—', after: event.after?.[key] || '—' })
  }
  return items
}
function actionLabel(action: string) {
  return (
    (
      {
        create: '新建',
        created: '新建',
        update: '调整',
        updated: '调整',
        cancel: '取消',
        cancelled: '取消',
        task_updated: '调整任务信息',
        route_linked: '关联工艺',
        rework_linked: '关联返工',
      } as Record<string, string>
    )[action] || action
  )
}
watch(
  () => [props.teamId, route.query.serial_no],
  () => {
    if (props.detailOnly) return
    const serial = typeof route.query.serial_no === 'string' ? route.query.serial_no.trim() : ''
    query.value = serial
    filters.value = serial ? { serial_no: serial } : {}
    page.value = 1
    closeDetail()
    void load()
  },
  { immediate: true },
)
watch(
  () => props.refreshKey,
  () => {
    live.request()
  },
)
watch(
  () => route.query.schedule_id,
  (id) => {
    if (typeof id === 'string' && /^\d+$/.test(id)) void openDetail(Number(id))
  },
  { immediate: true },
)
watch(canManage, (value) => {
  if (!value) {
    editing.value = false
    cancelTarget.value = null
  }
})
onMounted(() => {
  if (!props.detailOnly) clockRefresh = setInterval(live.request, 60_000)
})
onBeforeUnmount(() => {
  ++generation
  ++detailGeneration
  ++dispatchGeneration
  clearInterval(clockRefresh)
})
defineExpose({ exportSource, openDetail })
</script>

<template>
  <section
    class="delivery-schedules"
    :class="{
      'delivery-schedules--fullscreen': fullscreen,
      'delivery-schedules--detail-only': detailOnly,
    }"
    aria-label="交货排期"
  >
    <template v-if="!detailOnly">
      <div class="workspace-data-toolbar schedule-toolbar">
        <ElInput
          v-model="query"
          :prefix-icon="Search"
          placeholder="搜索流水号、批次号"
          aria-label="排期搜索"
          clearable
          @keyup.enter="search"
          @clear="search"
        />
        <FilterDialog
          v-model="filterOpen"
          :count="filterCount"
          @open="openFilters"
          @apply="applyFilters"
          @reset="resetFilters"
        >
          <label v-if="!teamId"
            >交货班组<ElSelect v-model="draftTeam" clearable placeholder="全部班组"
              ><ElOption
                v-for="team in teams"
                :key="team.id"
                :value="Number(team.id)"
                :label="team.name" /></ElSelect
          ></label>
          <label
            >排期状态<ElSelect v-model="draftStatus" clearable placeholder="全部状态"
              ><ElOption
                v-for="(label, status) in scheduleStatusLabels"
                :key="status"
                :value="status"
                :label="label" /></ElSelect
          ></label>
          <label class="filter-wide"
            >要求交货日期<RecordDateFilter v-model="draftDates" label="要求交货日期"
          /></label>
        </FilterDialog>
        <ElButton class="action-warm" @click="search">查询</ElButton>
        <TableExportButton
          v-if="!teamId"
          :source="exportSource"
          :disabled="loading || !!error"
          :context="JSON.stringify(params())"
        />
        <ElButton :icon="Refresh" :loading="loading" aria-label="刷新交货排期" @click="load()" />
        <ElButton v-if="canManage" type="primary" :icon="Plus" @click="newSchedule"
          >新建排期</ElButton
        >
      </div>
      <LiveRefreshNotice :message="live.message.value" @retry="live.request" />
      <StatePanel v-if="error" state="error" :description="error" @retry="load" />
      <ElTable
        v-else
        :data="rows"
        row-key="id"
        class="business-table schedule-table"
        height="100%"
        flexible
        empty-text="暂无交货排期"
        aria-label="交货排期列表"
      >
        <ElTableColumn
          label="流水号"
          prop="serial_no"
          min-width="150"
          align="center"
          show-overflow-tooltip
        />
        <ElTableColumn label="交货任务" min-width="170" align="center" show-overflow-tooltip>
          <template #default="{ row }">{{ row.task_title || row.task_no || '—' }}</template>
        </ElTableColumn>
        <ElTableColumn
          v-if="!teamId"
          label="交货班组"
          prop="team_name"
          min-width="110"
          align="center"
        />
        <ElTableColumn label="接收去向" min-width="110" align="center"
          ><template #default="{ row }">{{
            destination(row as ProductionSchedule)
          }}</template></ElTableColumn
        >
        <ElTableColumn label="要求交货时间" min-width="175" align="center"
          ><template #default="{ row }"
            ><ElButton
              link
              :class="{ 'schedule-late': row.status === 'overdue' }"
              @click="openDetail(row.id)"
              >{{ formatDateTime(row.due_at) }}</ElButton
            ></template
          ></ElTableColumn
        >
        <ElTableColumn label="排期状态" min-width="120" align="center"
          ><template #default="{ row }"
            ><ElTag :type="scheduleStatusTone(row.status)" effect="light">{{
              scheduleStatusLabels[row.status as ScheduleStatus]
            }}</ElTag></template
          ></ElTableColumn
        >
        <ElTableColumn label="执行情况" min-width="135" align="center">
          <template #default="{ row }">
            <span>{{
              row.execution_state
                ? scheduleExecutionLabels[
                    row.execution_state as keyof typeof scheduleExecutionLabels
                  ]
                : '—'
            }}</span>
            <ElTag v-if="row.quality_held" type="danger" size="small" class="schedule-held"
              >质量冻结</ElTag
            >
          </template>
        </ElTableColumn>
        <ElTableColumn label="计量方式" min-width="110" align="center">
          <template #default="{ row }">{{
            row.completion_basis
              ? completionBasisLabels[row.completion_basis as keyof typeof completionBasisLabels]
              : '—'
          }}</template>
        </ElTableColumn>
        <ElTableColumn label="计划件数" min-width="100" align="center"
          ><template #default="{ row }">{{
            formatAmount(row.target_quantity)
          }}</template></ElTableColumn
        >
        <ElTableColumn label="已加工件数" min-width="110" align="center"
          ><template #default="{ row }">{{
            row.assessment_enabled === false ? '—' : formatAmount(row.processed_quantity)
          }}</template></ElTableColumn
        >
        <ElTableColumn label="已转出件数" min-width="110" align="center"
          ><template #default="{ row }">{{
            formatAmount(row.dispatched_quantity)
          }}</template></ElTableColumn
        >
        <ElTableColumn label="待交件数" min-width="100" align="center"
          ><template #default="{ row }">{{
            formatAmount(row.completion_basis === 'weight' ? null : row.remaining_quantity)
          }}</template></ElTableColumn
        >
        <ElTableColumn label="计划 / 参考重量（kg）" min-width="130" align="center"
          ><template #default="{ row }">{{
            formatAmount(row.target_weight)
          }}</template></ElTableColumn
        >
        <ElTableColumn label="待交重量（kg）" min-width="130" align="center"
          ><template #default="{ row }">{{
            formatAmount(row.completion_basis === 'quantity' ? null : row.remaining_weight)
          }}</template></ElTableColumn
        >
        <ElTableColumn label="关联批次" min-width="100" align="center"
          ><template #default="{ row }">{{
            row.linked_batches?.length || row.sources.length
              ? `${row.linked_batches?.length || row.sources.length} 个批次`
              : row.predecessor_id
                ? '衔接上序'
                : '待关联'
          }}</template></ElTableColumn
        >
        <ElTableColumn label="操作" width="90" fixed="right" align="center"
          ><template #default="{ row }"
            ><ElButton link type="primary" @click="openDetail(row.id)">明细</ElButton></template
          ></ElTableColumn
        >
      </ElTable>
      <footer class="schedule-footer">
        <span>共 {{ total }} 条</span
        ><ElPagination
          :current-page="page"
          :page-size="pageSize"
          :page-sizes="[10, 20, 50, 100]"
          :total="total"
          layout="sizes, prev, pager, next"
          @current-change="paginate($event)"
          @size-change="paginate(1, $event)"
        />
      </footer>
    </template>
    <AppDialog
      :model-value="!!detailId"
      title="交货排期明细"
      width="min(1120px, 94vw)"
      class="schedule-detail"
      append-to-body
      @close="closeDetail"
    >
      <StatePanel v-if="detailLoading" state="loading" title="正在读取交货排期" />
      <StatePanel
        v-else-if="detailError"
        state="error"
        :description="detailError"
        @retry="detailId && openDetail(detailId)"
      />
      <template v-else-if="detail">
        <div class="schedule-detail__heading">
          <strong>{{ detail.serial_no }}</strong
          ><span>{{ detail.team_name }} → {{ destination(detail) }}</span
          ><ElTag :type="scheduleStatusTone(detail.status)">{{
            scheduleStatusLabels[detail.status]
          }}</ElTag>
        </div>
        <div v-if="detail.task_id" class="schedule-task-context">
          <div class="schedule-task-context__heading">
            <strong>{{ detail.task_title || '交货任务' }}</strong>
            <span>{{ detail.task_no }}</span>
            <ElTag v-if="detail.quality_held" type="danger" size="small">质量冻结</ElTag>
            <span v-if="taskLoading">正在读取任务路线</span>
          </div>
          <p v-if="taskError" role="alert">
            {{ taskError }} <ElButton link @click="loadTask(detail.task_id)">重试</ElButton>
          </p>
          <ol v-if="taskContext" class="schedule-task-route" aria-label="整项任务交货路线">
            <li v-for="node in taskContext.nodes" :key="node.id">
              <button
                type="button"
                :class="{ 'is-current': node.id === detail.id }"
                :aria-current="node.id === detail.id ? 'step' : undefined"
                @click="openDetail(node.id)"
              >
                <strong>{{ node.team_name }}</strong>
                <span>{{ formatDateTime(node.due_at) }}</span>
                <span :class="`schedule-task-route__status--${scheduleStatusTone(node.status)}`">{{
                  scheduleStatusLabels[node.status]
                }}</span>
              </button>
            </li>
          </ol>
        </div>
        <p
          v-if="detail.initial_due_at && detail.initial_due_at !== detail.due_at"
          class="schedule-original-deadline"
        >
          原交货时间：{{ formatDateTime(detail.initial_due_at) }}
        </p>
        <ElDescriptions :column="3" border>
          <ElDescriptionsItem label="计量方式">{{
            detail.completion_basis ? completionBasisLabels[detail.completion_basis] : '—'
          }}</ElDescriptionsItem>
          <ElDescriptionsItem label="执行情况">{{
            detail.execution_state ? scheduleExecutionLabels[detail.execution_state] : '—'
          }}</ElDescriptionsItem>
          <ElDescriptionsItem label="节点顺序">{{ detail.sequence_no }}</ElDescriptionsItem>
          <ElDescriptionsItem label="要求交货时间">{{
            formatDateTime(detail.due_at)
          }}</ElDescriptionsItem>
          <ElDescriptionsItem label="实际交完时间">{{
            formatDateTime(detail.completed_at)
          }}</ElDescriptionsItem>
          <ElDescriptionsItem label="排期编号"
            >#{{ detail.id
            }}<ElButton v-if="detail.predecessor_id" link @click="openDetail(detail.predecessor_id)"
              >上序 #{{ detail.predecessor_id }}</ElButton
            ></ElDescriptionsItem
          >
          <ElDescriptionsItem label="计划件数">{{
            formatAmount(detail.target_quantity)
          }}</ElDescriptionsItem
          ><ElDescriptionsItem label="已转出件数">{{
            formatAmount(detail.dispatched_quantity)
          }}</ElDescriptionsItem
          ><ElDescriptionsItem label="待交件数">{{
            formatAmount(
              detail.assessment_enabled === false || detail.completion_basis === 'weight'
                ? null
                : detail.remaining_quantity,
            )
          }}</ElDescriptionsItem>
          <ElDescriptionsItem label="计划 / 参考重量（kg）">{{
            formatAmount(detail.target_weight)
          }}</ElDescriptionsItem
          ><ElDescriptionsItem label="已转出重量（kg）">{{
            formatAmount(detail.dispatched_weight)
          }}</ElDescriptionsItem
          ><ElDescriptionsItem label="待交重量（kg）">{{
            formatAmount(
              detail.assessment_enabled === false || detail.completion_basis === 'quantity'
                ? null
                : detail.remaining_weight,
            )
          }}</ElDescriptionsItem>
          <ElDescriptionsItem label="下序签收件数">{{
            formatAmount(detail.received_quantity)
          }}</ElDescriptionsItem
          ><ElDescriptionsItem label="下序签收重量（kg）">{{
            formatAmount(detail.received_weight)
          }}</ElDescriptionsItem
          ><ElDescriptionsItem label="更新时间">{{
            formatDateTime(detail.updated_at)
          }}</ElDescriptionsItem>
          <ElDescriptionsItem label="备注" :span="3">{{ detail.notes || '—' }}</ElDescriptionsItem>
        </ElDescriptions>
        <div class="schedule-section-heading">
          <h3>批次计划</h3>
          <RouterLink
            :to="{
              path: `/team-workspaces/${detail.team_id}`,
              query: { tab: 'stock', serial_no: detail.serial_no },
            }"
            >查看本班组库存</RouterLink
          >
        </div>
        <ElTable
          :data="detail.sources"
          class="business-table"
          :empty-text="detail.predecessor_id ? '随上序来料' : '暂无关联批次'"
        >
          <ElTableColumn label="来源批次" min-width="200" align="center"
            ><template #default="{ row }"
              ><ElButton v-if="row.batch_no" link type="primary" @click="viewBatch(row.batch_no)">{{
                row.batch_no
              }}</ElButton
              ><span v-else>—</span></template
            ></ElTableColumn
          >
          <ElTableColumn label="分配计划件数" min-width="140" align="center"
            ><template #default="{ row }">{{ formatAmount(row.quantity) }}</template></ElTableColumn
          >
          <ElTableColumn label="分配计划重量（kg）" min-width="160" align="center"
            ><template #default="{ row }">{{ formatAmount(row.weight) }}</template></ElTableColumn
          >
        </ElTable>
        <template v-if="detail.linked_batches?.length">
          <div class="schedule-section-heading">
            <h3>来料记录</h3>
          </div>
          <ElTable :data="detail.linked_batches" class="business-table">
            <ElTableColumn label="来料批次" min-width="200" align="center"
              ><template #default="{ row }"
                ><ElButton link type="primary" @click="viewBatch(row.batch_no)">{{
                  row.batch_no
                }}</ElButton></template
              ></ElTableColumn
            >
            <ElTableColumn label="材质" prop="material_name" min-width="110" align="center" />
            <ElTableColumn label="来料件数" min-width="100" align="center"
              ><template #default="{ row }">{{
                formatAmount(row.quantity)
              }}</template></ElTableColumn
            >
            <ElTableColumn label="来料重量（kg）" min-width="130" align="center"
              ><template #default="{ row }">{{ formatAmount(row.weight) }}</template></ElTableColumn
            >
            <ElTableColumn label="签收时间" min-width="170" align="center"
              ><template #default="{ row }">{{
                formatDateTime(row.received_at)
              }}</template></ElTableColumn
            >
            <ElTableColumn label="来料状态" min-width="120" align="center"
              ><template #default="{ row }"
                ><MaterialTransferStatus :status="row.status as TransferStatus" /></template
            ></ElTableColumn>
          </ElTable>
        </template>
        <div class="schedule-section-heading">
          <h3>转出记录</h3>
        </div>
        <ElTable :data="detail.deliveries || []" class="business-table" empty-text="暂无转出记录">
          <ElTableColumn label="转出批次" min-width="200" align="center"
            ><template #default="{ row }"
              ><ElButton link type="primary" @click="viewBatch(row.batch_no)">{{
                row.batch_no
              }}</ElButton></template
            ></ElTableColumn
          >
          <ElTableColumn label="件数" min-width="90" align="center"
            ><template #default="{ row }">{{ formatAmount(row.quantity) }}</template></ElTableColumn
          >
          <ElTableColumn label="重量（kg）" min-width="120" align="center"
            ><template #default="{ row }">{{ formatAmount(row.weight) }}</template></ElTableColumn
          >
          <ElTableColumn label="实际转出时间" min-width="170" align="center"
            ><template #default="{ row }">{{
              formatDateTime(row.transferred_at)
            }}</template></ElTableColumn
          >
          <ElTableColumn label="签收时间" min-width="170" align="center"
            ><template #default="{ row }">{{
              formatDateTime(row.received_at)
            }}</template></ElTableColumn
          >
          <ElTableColumn label="单据状态" min-width="130" align="center"
            ><template #default="{ row }"
              ><MaterialTransferStatus :status="row.status as TransferStatus" outgoing /></template
          ></ElTableColumn>
          <ElTableColumn label="计入交货" min-width="100" align="center"
            ><template #default="{ row }">{{
              detail.assessment_enabled === false ? '—' : row.counts_toward_delivery ? '是' : '否'
            }}</template></ElTableColumn
          >
        </ElTable>
        <div class="schedule-section-heading"><h3>排期调整记录</h3></div>
        <ElCollapse class="schedule-audit"
          ><ElCollapseItem v-for="event in detail.history || []" :key="event.id" :name="event.id"
            ><template #title
              ><span
                >{{ formatDateTime(event.occurred_at) }} · {{ event.actor }} ·
                {{ actionLabel(event.action) }}</span
              ></template
            ><ElTable
              :data="changes(event)"
              class="business-table"
              empty-text="本次操作未改变计划字段"
              ><ElTableColumn
                label="调整内容"
                prop="label"
                width="160"
                align="center" /><ElTableColumn
                label="调整前"
                prop="before"
                min-width="250"
                align="center" /><ElTableColumn
                label="调整后"
                prop="after"
                min-width="250"
                align="center" /></ElTable></ElCollapseItem
        ></ElCollapse>
      </template>
      <template #footer
        ><div
          v-if="
            detail &&
            canEditCommitment &&
            (canManage || detail.team_id === teamId) &&
            detail.status !== 'cancelled'
          "
          class="schedule-detail__manage"
        >
          <ElButton v-if="canManage" type="danger" plain @click="startCancel(detail)"
            >取消排期</ElButton
          ><ElButton v-if="canManage && detail.next_team_id" @click="nextSchedule(detail)"
            >添加下序节点</ElButton
          ><ElButton type="primary" @click="editSchedule(detail)">调整排期</ElButton>
        </div>
        <ElButton
          v-if="
            detail &&
            canDispatch &&
            detail.team_id === teamId &&
            !['cancelled', 'completed', 'completed_late'].includes(detail.status)
          "
          type="primary"
          @click="prepareDispatch(detail)"
          >出库</ElButton
        ><ElButton @click="closeDetail">关闭</ElButton></template
      >
    </AppDialog>
    <ProductionScheduleEditor
      v-if="editing && canEditCommitment"
      :schedule="editingSchedule"
      :predecessor="predecessor"
      @close="editing = false"
      @saved="saved"
    />
    <AppDialog
      :model-value="!!cancelTarget"
      title="取消交货排期"
      width="min(520px,94vw)"
      append-to-body
      :close-on-click-modal="!cancelling"
      :show-close="!cancelling"
      @close="!cancelling && (cancelTarget = null)"
      ><ElAlert v-if="cancelError" :title="cancelError" type="error" :closable="false" />
      <p>
        取消 {{ cancelTarget?.serial_no }} 在
        {{ cancelTarget?.team_name }} 的交货安排，已有收发记录继续保留。
      </p>
      <ElInput
        v-model="cancelReason"
        type="textarea"
        :rows="3"
        maxlength="1000"
        placeholder="取消原因（选填）"
        aria-label="取消排期原因"
      /><template #footer
        ><ElButton :disabled="cancelling" @click="cancelTarget = null">保留排期</ElButton
        ><ElButton type="danger" :loading="cancelling" @click="cancel">确认取消</ElButton></template
      ></AppDialog
    >
    <MaterialTransferDrawer v-model="batchOpen" :batch-no="batchNo" />
    <AppDialog
      :model-value="!!dispatchTarget"
      title="选择本次出库物料"
      width="min(880px, 94vw)"
      append-to-body
      @close="closeDispatch"
    >
      <p class="schedule-dispatch-scope">
        {{ dispatchTarget?.serial_no }} · {{ dispatchTarget?.team_name }} →
        {{ dispatchTarget ? destination(dispatchTarget) : '' }} ·
        {{ formatDateTime(dispatchTarget?.due_at) }}
      </p>
      <StatePanel v-if="dispatchLoading" state="loading" title="正在读取当前可转出批次" />
      <StatePanel
        v-else-if="dispatchError"
        state="error"
        :description="dispatchError"
        @retry="loadDispatchSources()"
      />
      <ElTable
        v-else
        :data="dispatchSources"
        class="business-table"
        empty-text="该排期暂无当前可转出的物料，请核对来料、加工及库存状态"
      >
        <ElTableColumn label="当前物料批次" prop="batch_no" min-width="200" align="center" />
        <ElTableColumn label="材质" prop="material_name" min-width="100" align="center" />
        <ElTableColumn label="可转出件数" min-width="120" align="center"
          ><template #default="{ row }">{{
            formatAmount(row.on_hand_quantity)
          }}</template></ElTableColumn
        >
        <ElTableColumn label="可转出重量（kg）" min-width="160" align="center"
          ><template #default="{ row }">{{
            formatAmount(row.on_hand_weight)
          }}</template></ElTableColumn
        >
        <ElTableColumn label="操作" width="90" align="center"
          ><template #default="{ row }"
            ><ElButton
              link
              type="primary"
              @click="dispatchTarget && dispatch(dispatchTarget, row.source_transfer_id)"
              >出库</ElButton
            ></template
          ></ElTableColumn
        >
      </ElTable>
      <template #footer
        ><ElPagination
          :current-page="dispatchPage"
          :total="dispatchTotal"
          :page-size="10"
          layout="total, prev, pager, next"
          @current-change="paginateDispatch"
        /><ElButton @click="closeDispatch">关闭</ElButton></template
      >
    </AppDialog>
  </section>
</template>

<style scoped>
.delivery-schedules {
  display: flex;
  flex-direction: column;
  flex: 1;
  height: 100%;
  min-width: 0;
  min-height: 0;
  gap: 14px;
}
.delivery-schedules--detail-only {
  display: contents;
}
.schedule-held {
  margin-left: 6px;
}
.schedule-task-context {
  margin-bottom: 18px;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.66);
}
.schedule-task-context__heading {
  display: flex;
  align-items: center;
  gap: 10px;
}
.schedule-task-context__heading > span {
  color: var(--muted);
  font-size: 12px;
}
.schedule-task-route {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  list-style: none;
  padding: 12px 0 0;
  margin: 0;
}
.schedule-task-route li {
  display: flex;
  align-items: center;
}
.schedule-task-route li + li::before {
  content: '→';
  color: var(--muted);
  margin-right: 8px;
}
.schedule-task-route button {
  display: grid;
  gap: 4px;
  min-width: 160px;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 10px 14px;
  background: var(--surface, #fff);
  color: var(--text);
  font: inherit;
  cursor: pointer;
  text-align: left;
}
.schedule-task-route button > span {
  font-size: 12px;
}
.schedule-task-route button.is-current {
  border-color: var(--primary);
  background: rgba(231, 244, 237, 0.7);
}
.schedule-task-route button:hover,
.schedule-task-route button:focus-visible {
  border-color: var(--primary);
  outline: 2px solid rgba(54, 124, 99, 0.15);
  outline-offset: 2px;
}
.schedule-task-route__status--danger {
  color: var(--el-color-danger);
}
.schedule-task-route__status--warning {
  color: var(--el-color-warning);
}
.schedule-task-route__status--success {
  color: var(--primary);
}
.schedule-toolbar {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-shrink: 0;
  flex-wrap: wrap;
}
.schedule-toolbar > :deep(.el-input) {
  flex: 1 1 260px;
}
.schedule-toolbar :deep(.el-button) {
  margin-left: 0;
}
.schedule-table {
  flex: 1;
  min-height: 180px;
}
.schedule-table :deep(.schedule-late) {
  color: var(--el-color-danger);
}
.schedule-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 4px 0;
}
.schedule-footer > span {
  color: var(--muted);
  font-size: 12px;
}
.schedule-detail__heading {
  display: flex;
  gap: 18px;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 18px;
}
.schedule-detail__heading strong {
  font-size: 20px;
  color: var(--primary);
}
.schedule-detail__heading > span {
  color: var(--muted);
}
.schedule-section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 22px 0 10px;
}
.schedule-section-heading h3 {
  margin: 0;
  font-size: 15px;
}
.schedule-section-heading > span,
.schedule-section-heading > a {
  font-size: 13px;
}
.schedule-section-heading > span {
  color: var(--muted);
}
.schedule-detail__manage {
  display: flex;
  gap: 8px;
  margin-right: auto;
}
.schedule-audit :deep(.el-collapse-item__header) {
  color: var(--muted);
}
.schedule-original-deadline,
.schedule-dispatch-scope {
  color: var(--muted);
  font-size: 13px;
  margin: 0 0 16px;
}
</style>
