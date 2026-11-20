<script setup lang="ts">
import { usePagedRecords } from '@/composables/usePagedRecords'
import { useTableQuery } from '@/composables/useTableQuery'
import { inspectionQueryColumns, queryColumns } from '@/utils/tableQueryColumns'
import TableFilterFields from './TableFilterFields.vue'
import type { TableColumnCondition } from '@/types/tableQuery'
import ElSelect from '@/components/AppSelect.vue'
import WorkspaceDataPanel from './WorkspaceDataPanel.vue'
import WorkspaceTable from './WorkspaceTable.vue'
import WorkspacePagination from './WorkspacePagination.vue'
import WorkspaceDataToolbar from './WorkspaceDataToolbar.vue'
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import { ElOption, ElTableColumn, ElTag } from 'element-plus'
import AppDialog from './AppDialog.vue'
import { ElDescriptions, ElDescriptionsItem } from 'element-plus'
import ElButton from '@/components/AppButton.vue'
import { useRoute } from 'vue-router'
import FilterDialog from './FilterDialog.vue'
import InspectionProblemFilter from './InspectionProblemFilter.vue'
import RecordDateFilter from './RecordDateFilter.vue'
import StatePanel from './StatePanel.vue'
import TableExportButton from './TableExportButton.vue'
import QualityFeedbackDetail from './QualityFeedbackDetail.vue'
import LiveRefreshNotice from './LiveRefreshNotice.vue'
import { useLiveRefresh } from '@/composables/useLiveRefresh'
import { useTeamDirectoryStore } from '@/stores/teamDirectory'
import {
  qualityFeedbackApi,
  qualityRecordStates,
  type ProcessingQuality,
  dispositions,
  type QualityRow,
  qualitySourceLabels,
  qualityProblemLabel,
  type QualityFilters,
} from '@/services/qualityFeedbackApi'
import { formatDateTime } from '@/utils/format'
const TeamProblemDetail = defineAsyncComponent(() => import('./TeamProblemDetail.vue'))
import { loadExportPages, tableExportSource } from '@/utils/tableExport'
const props = defineProps<{ teamId?: number; showAll?: boolean }>()
const emit = defineEmits<{ count: [value: number] }>()
const route = useRoute(),
  directory = useTeamDirectoryStore()
const { rows, result, total, page, size, loading, error, load } = usePagedRecords(
  (pagination) => qualityFeedbackApi.records({ ...params(), ...pagination }),
  { errorMessage: '质量反馈读取失败', clearOnError: false },
)
const pending = computed(() => result.value?.pending_count ?? 0)
const query = ref(''),
  selected = ref<number>()
const selectedProblem = ref<number>()
const selectedWork = ref<ProcessingQuality>()
function involvedTeams(row: QualityRow) {
  return row.kind === 'processing'
    ? row.team_name
    : row.involved_teams.map((t) => t.name).join('、')
}
function replyCount(row: QualityRow) {
  if (row.kind === 'processing') return '—'
  return `${row.involved_teams.filter((t) => t.replied).length} / ${row.involved_teams.length}`
}
function openRecord(row: QualityRow) {
  if (row.kind === 'processing') selectedWork.value = row
  else if (row.kind === 'team_report') selectedProblem.value = row.id
  else selected.value = row.id
}
const filtersOpen = ref(false),
  draftStatus = ref<QualityFilters['status']>(),
  draftKind = ref<QualityFilters['kind']>(),
  draftTeam = ref<number>(),
  draftProblem = ref<number>(),
  dates = ref({ from: '', to: '' }),
  applied = ref<QualityFilters>({})
const columnSettingsTarget = ref<HTMLElement | null>(null)
const draftColumns = ref<TableColumnCondition[]>([])
const dispositionColumns = {
  处理方式: {
    field: 'disposition',
    kind: 'select' as const,
    options: Object.entries(dispositions).map(([value, label]) => ({ value, label })),
  },
  工艺状态: {
    field: 'route_state',
    kind: 'select' as const,
    options: [
      { value: 'draft', label: '未填写' },
      { value: 'published', label: '已制定' },
    ],
  },
}
const count = computed(
  () =>
    Number(!!applied.value.status) +
    Number(!!applied.value.kind) +
    Number(!!applied.value.team_id) +
    Number(!!applied.value.problem_type_id) +
    Number(!!applied.value.date_from || !!applied.value.date_to) +
    tableQuery.state.value.filters.length,
)
const live = useLiveRefresh(() => load(true), {
  teamId: () => (props.showAll ? undefined : props.teamId),
  busy: () => loading.value || !!selected.value || !!selectedProblem.value || !!selectedWork.value,
})
const tableQuery = useTableQuery(
  {
    ...inspectionQueryColumns,
    ...queryColumns([
      ['发现班组', 'team_name'],
      ['问题说明', 'notes'],
    ]),
    ...dispositionColumns,
    处理状态: {
      field: 'feedback_status',
      kind: 'select',
      options: Object.entries(qualityRecordStates).map(([value, label]) => ({ value, label })),
    },
    来源: {
      field: 'kind',
      kind: 'select',
      options: Object.entries(qualitySourceLabels).map(([value, label]) => ({ value, label })),
    },
  },
  () => {
    page.value = 1
    void load()
  },
  (table_query) => qualityFeedbackApi.records({ ...params(), table_query }),
)
function params(): QualityFilters {
  return {
    ...tableQuery.params.value,
    ...applied.value,
    team_id: props.showAll ? applied.value.team_id : props.teamId,
  }
}
function search() {
  applied.value.query = query.value.trim() || undefined
  page.value = 1
  void load()
}
function openFilters() {
  draftColumns.value = tableQuery.state.value.filters.map((item) => ({ ...item }))
  draftStatus.value = applied.value.status
  draftKind.value = applied.value.kind
  draftTeam.value = applied.value.team_id
  draftProblem.value = applied.value.problem_type_id
  dates.value = { from: applied.value.date_from || '', to: applied.value.date_to || '' }
}
function apply() {
  tableQuery.state.value.filters = draftColumns.value
  applied.value = {
    query: query.value.trim() || undefined,
    status: draftStatus.value,
    kind: draftKind.value,
    team_id: draftTeam.value,
    problem_type_id: draftProblem.value,
    date_from: dates.value.from || undefined,
    date_to: dates.value.to || undefined,
  }
  filtersOpen.value = false
  page.value = 1
  void load()
}
function reset() {
  draftColumns.value = []
  draftStatus.value = undefined
  draftKind.value = undefined
  draftTeam.value = undefined
  draftProblem.value = undefined
  dates.value = { from: '', to: '' }
}
function changePage(value: number) {
  page.value = value
  void load()
}
function exportSource() {
  const filters = params()
  return tableExportSource(
    '质量反馈',
    total.value,
    [
      { key: 'serial_no', label: '流水号', value: (r: QualityRow) => r.serial_no },
      { key: 'checked_at', label: '发现时间', value: (r) => formatDateTime(r.checked_at) },
      { key: 'kind', label: '来源', value: (r) => qualitySourceLabels[r.kind] },
      { key: 'team_name', label: '发现班组', value: (r) => r.team_name },
      {
        key: 'scope',
        label: '检验方式',
        value: (r) => ('scope' in r ? (r.scope === 'full' ? '全检' : '抽检') : '—'),
      },
      {
        key: 'sample_quantity',
        label: '检查件数',
        value: (r) => ('sample_quantity' in r ? r.sample_quantity : ''),
      },
      { key: 'failed_quantity', label: '不合格件数', value: (r) => r.failed_quantity },
      {
        key: 'involved',
        label: '涉及班组',
        value: involvedTeams,
      },
      { key: 'notes', label: '问题说明', value: (r) => r.notes },
      { key: 'problems', label: '检验问题', value: qualityProblemLabel },
      {
        key: 'feedback_status',
        label: '处理状态',
        value: (r) => qualityRecordStates[r.feedback_status],
      },
      {
        key: 'route_state',
        label: '工艺状态',
        value: (r) =>
          r.kind === 'team_report' ? (r.route_state === 'published' ? '已制定' : '未填写') : '',
      },
      {
        key: 'disposition',
        label: '处理方式',
        value: (r) =>
          r.kind === 'processing' ? '' : dispositions[r.disposition as keyof typeof dispositions],
      },
      {
        key: 'decision_notes',
        label: '处理意见',
        value: (r) => ('decision_notes' in r ? r.decision_notes : ''),
      },
      { key: 'batch_no', label: '批次号', value: (r) => r.batch_no },
      {
        key: 'failed_weight',
        label: '自检不合格重量（kg）',
        value: (r) => (r.kind === 'processing' ? r.failed_weight : null),
      },
      {
        key: 'processor_name',
        label: '自检加工人',
        value: (r) => (r.kind === 'processing' ? r.processor_name : ''),
      },
    ],
    (signal, progress) =>
      loadExportPages(
        (page, page_size) => qualityFeedbackApi.records({ ...filters, page, page_size }),
        signal,
        progress,
      ),
  )
}
async function changed() {
  void load()
  const result = await qualityFeedbackApi
    .records({ team_id: props.showAll ? undefined : props.teamId, page: 1, page_size: 1 })
    .catch(() => null)
  if (result) emit('count', result.pending_count)
}
watch(
  () => [
    props.teamId,
    props.showAll,
    route.query.status,
    route.query.team_id,
    route.query.date_from,
    route.query.date_to,
  ],
  () => {
    const status = route.query.status
    const teamId = Number(route.query.team_id)
    const date = (value: unknown) =>
      typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined
    applied.value = {
      status:
        typeof status === 'string' && Object.hasOwn(qualityRecordStates, status)
          ? (status as QualityFilters['status'])
          : undefined,
      team_id: props.showAll && Number.isInteger(teamId) && teamId > 0 ? teamId : undefined,
      date_from: date(route.query.date_from),
      date_to: date(route.query.date_to),
    }
    query.value = ''
    page.value = 1
    selected.value = undefined
    selectedProblem.value = undefined
    selectedWork.value = undefined
    void load()
  },
  { immediate: true },
)
watch(
  () => route.query.issue,
  (value) => {
    const id = Number(value)
    if (Number.isInteger(id) && id > 0) selected.value = id
  },
  { immediate: true },
)
</script>
<template>
  <WorkspaceDataPanel class="quality-feedback-records workspace-data-panel">
    <WorkspaceDataToolbar
      v-model="query"
      :loading="loading"
      search-label="质量反馈搜索"
      placeholder="流水号、批次号、材质或问题说明"
      @search="search"
      @refresh="load()"
    >
      <template #filters>
        <FilterDialog
          v-slot="{ appendTo }"
          v-model="filtersOpen"
          :count="count"
          @open="openFilters"
          @apply="apply"
          @reset="reset"
        >
          <label
            >问题来源<ElSelect
              :append-to="appendTo"
              v-model="draftKind"
              clearable
              placeholder="全部"
            >
              <ElOption
                v-for="(label, value) in qualitySourceLabels"
                :key="value"
                :value="value"
                :label="label" /></ElSelect
          ></label>
          <label
            >处理状态<ElSelect
              :append-to="appendTo"
              v-model="draftStatus"
              clearable
              placeholder="全部"
              ><ElOption
                v-for="(name, key) in qualityRecordStates"
                :key="key"
                :value="key"
                :label="name" /></ElSelect
          ></label>
          <label v-if="showAll"
            >涉及班组<ElSelect
              :append-to="appendTo"
              v-model="draftTeam"
              clearable
              placeholder="全部"
              ><ElOption
                v-for="t in directory.items"
                :key="t.id"
                :label="t.name"
                :value="Number(t.id)" /></ElSelect
          ></label>
          <label
            >发现日期<RecordDateFilter :append-to="appendTo" v-model="dates" label="发现日期"
          /></label>
          <label
            >检验问题<InspectionProblemFilter
              :append-to="appendTo"
              v-if="filtersOpen"
              v-model="draftProblem"
          /></label>
          <TableFilterFields
            :append-to="appendTo"
            v-model="draftColumns"
            :columns="dispositionColumns"
          />
        </FilterDialog>
      </template>
      <template #query-actions><div ref="columnSettingsTarget" /></template>
      <template #tools
        ><TableExportButton
          :source="exportSource"
          :disabled="loading || !!error"
          :context="JSON.stringify(params())"
      /></template>
    </WorkspaceDataToolbar>
    <LiveRefreshNotice :message="live.message.value" @retry="live.request" />
    <StatePanel v-if="error" state="error" :description="error" @retry="load()" />
    <WorkspaceTable
      :columns-key="showAll ? 'QualityManagement-1' : 'TeamQualityFeedback-1'"
      :column-settings-target="columnSettingsTarget"
      :column-query="tableQuery.controller.value"
      v-else
      :data="rows"
      :loading="loading"
      class="quality-feedback-table"
      :row-key="(row: QualityRow) => `${row.kind}:${row.id}`"
      empty-text="暂无质量反馈"
    >
      <ElTableColumn
        prop="serial_no"
        class-name="table-identity"
        label="流水号"
        min-width="150"
        align="center"
        show-overflow-tooltip
      />
      <ElTableColumn label="检验问题" min-width="180" align="center" show-overflow-tooltip>
        <template #default="{ row }">{{ qualityProblemLabel(row as QualityRow) }}</template>
      </ElTableColumn>
      <ElTableColumn prop="failed_quantity" label="不合格件数" width="110" align="center" />
      <ElTableColumn label="涉及班组" min-width="180" align="center" show-overflow-tooltip
        ><template #default="{ row }">{{
          involvedTeams(row as QualityRow) || '待指定'
        }}</template></ElTableColumn
      >
      <ElTableColumn label="处理状态" width="110" align="center"
        ><template #default="{ row }"
          ><ElTag
            :type="['closed', 'recorded'].includes(row.feedback_status) ? 'success' : 'warning'"
            >{{
              qualityRecordStates[row.feedback_status as keyof typeof qualityRecordStates]
            }}</ElTag
          ></template
        ></ElTableColumn
      >
      <ElTableColumn label="工艺状态" width="110" align="center">
        <template #default="{ row }"
          ><ElTag
            v-if="row.kind === 'team_report'"
            :type="row.route_state === 'published' ? 'success' : 'info'"
            >{{ row.route_state === 'published' ? '已制定' : '未填写' }}</ElTag
          ><span v-else>—</span></template
        >
      </ElTableColumn>
      <ElTableColumn label="处理方式" width="120" align="center">
        <template #default="{ row }">{{
          dispositions[row.disposition as keyof typeof dispositions] || '—'
        }}</template>
      </ElTableColumn>
      <ElTableColumn label="发现时间" min-width="170" align="center"
        ><template #default="{ row }">{{ formatDateTime(row.checked_at) }}</template></ElTableColumn
      >
      <ElTableColumn prop="notes" label="问题说明" min-width="220" show-overflow-tooltip />
      <ElTableColumn label="来源" width="80" align="center"
        ><template #default="{ row }">{{
          qualitySourceLabels[(row as QualityRow).kind]
        }}</template></ElTableColumn
      >
      <ElTableColumn prop="team_name" label="发现班组" min-width="100" align="center" />
      <ElTableColumn label="检验方式" width="120" align="center"
        ><template #default="{ row }">{{
          row.kind === 'processing' || row.kind === 'team_report'
            ? '—'
            : row.scope === 'full'
              ? '全检'
              : '抽检'
        }}</template></ElTableColumn
      >
      <ElTableColumn label="班组反馈" width="110" align="center"
        ><template #default="{ row }">{{ replyCount(row as QualityRow) }}</template></ElTableColumn
      >
      <ElTableColumn prop="batch_no" label="批次号" min-width="205" align="center" />
      <ElTableColumn label="操作" width="110" fixed="right" align="center"
        ><template #default="{ row }"
          ><ElButton link type="primary" @click="openRecord(row as QualityRow)">{{
            row.kind === 'processing' ? '查看' : '查看 / 处理'
          }}</ElButton></template
        ></ElTableColumn
      >
    </WorkspaceTable>
    <WorkspacePagination
      :current-page="page"
      :page-size="size"
      :total="total"
      @current-change="changePage"
      @size-change="
        (value) => {
          size = value
          changePage(1)
        }
      "
      >共 {{ total }} 条问题 · {{ pending }} 条未结束</WorkspacePagination
    >
    <AppDialog
      v-if="selectedWork"
      :model-value="true"
      title="加工自检"
      @update:model-value="selectedWork = undefined"
    >
      <ElDescriptions :column="2" border>
        <ElDescriptionsItem label="班组">{{ selectedWork.team_name }}</ElDescriptionsItem>
        <ElDescriptionsItem label="加工人">{{ selectedWork.processor_name }}</ElDescriptionsItem>
        <ElDescriptionsItem label="批次号">{{ selectedWork.batch_no }}</ElDescriptionsItem>
        <ElDescriptionsItem label="流水号">{{ selectedWork.serial_no || '—' }}</ElDescriptionsItem>
        <ElDescriptionsItem label="不合格件数">{{
          selectedWork.failed_quantity
        }}</ElDescriptionsItem>
        <ElDescriptionsItem label="不合格重量"
          >{{ selectedWork.failed_weight }} kg</ElDescriptionsItem
        >
        <ElDescriptionsItem label="加工日期">{{ selectedWork.processing_date }}</ElDescriptionsItem>
        <ElDescriptionsItem label="登记时间">{{
          formatDateTime(selectedWork.checked_at)
        }}</ElDescriptionsItem>
        <ElDescriptionsItem label="不合格原因" :span="2">{{
          selectedWork.notes
        }}</ElDescriptionsItem>
      </ElDescriptions>
    </AppDialog>
    <TeamProblemDetail
      v-if="selectedProblem"
      :route-id="selectedProblem"
      @close="selectedProblem = undefined"
      @changed="changed"
    />
    <QualityFeedbackDetail
      v-if="selected"
      :issue-id="selected"
      @close="selected = undefined"
      @changed="changed"
    />
  </WorkspaceDataPanel>
</template>
