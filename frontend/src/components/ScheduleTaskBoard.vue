<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import {
  ElButton,
  ElIcon,
  ElInput,
  ElOption,
  ElPagination,
  ElRadioButton,
  ElRadioGroup,
  ElSelect,
  ElTag,
} from 'element-plus'
import { Calendar, List, Plus, Refresh, Search } from '@element-plus/icons-vue'
import AppDialog from './AppDialog.vue'
import FilterDialog from './FilterDialog.vue'
import RecordDateFilter from './RecordDateFilter.vue'
import StatePanel from './StatePanel.vue'
import LiveRefreshNotice from './LiveRefreshNotice.vue'
import TableExportButton from './TableExportButton.vue'
import DeliverySchedules from './DeliverySchedules.vue'
import ProductionScheduleGantt from './ProductionScheduleGantt.vue'
import ProductionScheduleOverview from './ProductionScheduleOverview.vue'
import ScheduleTaskEditor from './ScheduleTaskEditor.vue'
import ScheduleSelectionDialog from './ScheduleSelectionDialog.vue'
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

defineProps<{ fullscreen?: boolean }>()
const auth = useAuthStore(),
  directory = useTeamDirectoryStore(),
  route = useRoute()
const canManage = computed(
  () => auth.isAdmin && !auth.currentUserError && auth.currentUser?.active !== false,
)
const teams = computed(() => directory.items.filter((team) => team.active))
const view = ref<'overview' | 'gantt'>('overview')
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
const query = ref(''),
  filters = ref<ScheduleFilters>({}),
  filterOpen = ref(false)
const draftTeam = ref<number>(),
  draftStatus = ref<ScheduleStatus>(),
  draftDates = ref({ from: '', to: '' })
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
    Number(!!filters.value.team_id) +
    Number(!!filters.value.status) +
    Number(!!filters.value.due_from || !!filters.value.due_to),
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
function search() {
  filters.value = { ...filters.value, query: query.value.trim() || undefined }
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
    scope: filters.value.scope,
    serial_nos: filters.value.serial_nos,
    business_person_ids: filters.value.business_person_ids,
    query: query.value.trim() || undefined,
    team_id: draftTeam.value,
    status: draftStatus.value,
    due_from: draftDates.value.from ? `${draftDates.value.from}T00:00:00+08:00` : undefined,
    due_to: draftDates.value.to ? `${draftDates.value.to}T23:59:59+08:00` : undefined,
  }
  page.value = 1
  filterOpen.value = false
  void load()
}
function resetFilters() {
  draftTeam.value = undefined
  draftStatus.value = undefined
  draftDates.value = { from: '', to: '' }
  applyFilters()
}
function paginate(value: number) {
  page.value = value
  void load()
}
function setScope(scope?: 'attention' | 'completed') {
  filters.value = { ...filters.value, scope }
  page.value = 1
  void load()
}
function applySelection(items: ScheduleSelection[]) {
  if (selectionKind.value === 'serial') {
    serialSelection.value = items
    filters.value = { ...filters.value, serial_nos: items.map((item) => String(item.value)) }
  } else {
    personSelection.value = items
    filters.value = {
      ...filters.value,
      business_person_ids: items.map((item) => Number(item.value)),
    }
  }
  selectionKind.value = null
  page.value = 1
  void load()
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
        value: (task) => task.business_person_name || '未指定',
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
      { key: 'node_basis', label: '各站完成依据', value: (task) => perNode(task, basis) },
      { key: 'node_execution', label: '各站执行状态', value: (task) => perNode(task, execution) },
      { key: 'notes', label: '任务说明', value: (task) => task.notes },
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
    <div class="workspace-data-toolbar task-board__toolbar">
      <ElInput
        v-model="query"
        :prefix-icon="Search"
        aria-label="任务排期搜索"
        placeholder="搜索任务、流水号或批次号"
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
        <label
          >交货班组<ElSelect v-model="draftTeam" placeholder="全部班组" clearable
            ><ElOption
              v-for="team in teams"
              :key="team.id"
              :value="Number(team.id)"
              :label="team.name" /></ElSelect
        ></label>
        <label
          >任务状态<ElSelect v-model="draftStatus" placeholder="全部状态" clearable
            ><ElOption
              v-for="(label, value) in scheduleStatusLabels"
              :key="value"
              :value="value"
              :label="label" /></ElSelect
        ></label>
        <label class="filter-wide"
          >节点要求交货日期<RecordDateFilter v-model="draftDates" label="节点要求交货日期"
        /></label>
      </FilterDialog>
      <ElButton class="action-warm" @click="search">查询</ElButton>
      <TableExportButton
        :source="exportSource"
        :context="JSON.stringify(filters)"
        :disabled="loading || !!error"
      />
      <ElButton :icon="Refresh" :loading="loading" aria-label="刷新任务排期" @click="load()" />
      <ElButton v-if="canManage" type="primary" :icon="Plus" @click="createTask"
        >新建任务排期</ElButton
      >
    </div>
    <div class="task-board__view">
      <div class="task-board__scopes" role="group" aria-label="任务范围">
        <button type="button" :aria-pressed="!filters.scope" @click="setScope()">全部任务</button>
        <button
          type="button"
          :aria-pressed="filters.scope === 'attention'"
          @click="setScope('attention')"
        >
          需关注
        </button>
        <button
          type="button"
          :aria-pressed="filters.scope === 'completed'"
          @click="setScope('completed')"
        >
          已交完
        </button>
      </div>
      <ElButton @click="selectionKind = 'serial'">{{
        serialSelection.length ? `显示 ${serialSelection.length} 个流水号` : '显示流水号'
      }}</ElButton>
      <ElButton @click="selectionKind = 'people'">{{
        personSelection.length ? `业务人员 ${personSelection.length} 人` : '全部业务人员'
      }}</ElButton>
      <ElButton v-if="canManage" link type="primary" @click="managingPeople = true"
        >管理业务人员</ElButton
      >
      <ElRadioGroup v-model="view" class="task-board__view-switch" aria-label="排期视图"
        ><ElRadioButton value="overview"
          ><ElIcon><List /></ElIcon>交货进度</ElRadioButton
        ><ElRadioButton value="gantt"
          ><ElIcon><Calendar /></ElIcon>路线甘特图</ElRadioButton
        ></ElRadioGroup
      >
      <span class="task-board__view-note">{{
        view === 'overview' ? '点击任务展开路线' : '按任务展开班组路线 · 点击节点查看详情'
      }}</span>
    </div>
    <LiveRefreshNotice :message="live.message.value" @retry="live.request" />
    <StatePanel v-if="error" state="error" :description="error" @retry="load" />
    <ProductionScheduleGantt
      v-else-if="view === 'gantt'"
      :tasks="rows"
      :loading="loading"
      @open-node="openNode"
      @open-task="openTask"
    />
    <ProductionScheduleOverview
      v-else
      :tasks="rows"
      :loading="loading"
      @open-node="openNode"
      @open-task="openTask"
    />
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
            <span>业务人员：{{ detail.business_person_name || '未指定' }}</span>
          </div>
          <ElTag :type="scheduleStatusTone(detail.status)">{{
            scheduleStatusLabels[detail.status]
          }}</ElTag
          ><ElButton v-if="canManage" @click="editTask(detail)">修改任务信息</ElButton>
        </div>
        <div class="task-detail__meta">
          <div>
            <span>最终交货时间</span><strong>{{ formatDateTime(detail.final_due_at) }}</strong>
          </div>
          <span class="task-detail__created">创建于 {{ formatDateTime(detail.created_at) }}</span>
        </div>
        <p v-if="detail.notes" class="task-detail__notes">
          <span>任务说明</span>{{ detail.notes }}
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
            </div>
            <div class="task-detail__due" role="cell">
              <strong>{{ formatDateTime(node.due_at) }}</strong>
              <ElTag :type="scheduleStatusTone(node.status)" size="small">{{
                scheduleStatusLabels[node.status]
              }}</ElTag>
            </div>
            <div class="task-detail__target" role="cell">
              <strong>{{ mainTarget(node) }}</strong>
              <span>{{ basis(node) }}</span>
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
      </template>
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
      :selected="selectionKind === 'serial' ? serialSelection : personSelection"
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
.task-board__scopes {
  display: flex;
  padding: 4px;
  gap: 4px;
  border: 1px solid #e6eeea;
  border-radius: 11px;
  background: linear-gradient(160deg, #f3f8f5, #f9fbfa);
  box-shadow: inset 0 1px 0 #fff;
}
.task-board__scopes button {
  padding: 6px 12px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--muted);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  transition:
    background var(--motion-fast),
    box-shadow var(--motion-fast);
}
.task-board__scopes button[aria-pressed='true'] {
  background: #fff;
  color: var(--primary);
  box-shadow:
    0 1px 4px #244e3512,
    inset 0 0 0 1px #dfece4;
}
.task-board__scopes button:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
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
.task-board__toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  flex-shrink: 0;
}
.task-board__toolbar > .el-input {
  flex: 1 1 260px;
  width: auto;
  min-width: 260px;
}
.task-board__toolbar :deep(.el-button) {
  margin-left: 0;
}
.task-board__view {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  flex-wrap: wrap;
  gap: 10px;
  flex-shrink: 0;
}
.task-board__view-switch {
  padding: 3px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--glass-chrome-fill);
  box-shadow: inset 0 1px 0 #fff;
}
.task-board__view-switch :deep(.el-radio-button__inner) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  height: 32px;
  padding: 0 15px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--muted);
  font-size: 13px;
  box-shadow: none;
  transition:
    color var(--motion-fast),
    background var(--motion-fast),
    box-shadow var(--motion-fast);
}
.task-board__view-switch :deep(.el-radio-button.is-active .el-radio-button__inner) {
  color: var(--primary);
  background: var(--glass-selected-fill);
  box-shadow: var(--glass-selected-shadow);
  font-weight: 550;
}
.task-board__view-switch :deep(.el-radio-button:not(.is-active):hover .el-radio-button__inner) {
  color: var(--text);
  background: var(--glass-hover-fill);
}
.task-board__view-note {
  color: var(--muted);
  font-size: var(--business-table-meta, 12px);
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
