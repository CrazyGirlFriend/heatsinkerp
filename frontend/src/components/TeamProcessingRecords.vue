<script setup lang="ts">
import { useTableQuery } from '@/composables/useTableQuery'
import { processingQueryColumns } from '@/utils/tableQueryColumns'
import { processingParameterFields, formatProcessingParameter } from '@/config/processingParameters'

import ElSelect from '@/components/AppSelect.vue'
import ProcessingPeople from './ProcessingPeople.vue'
import { formatProcessingMinutes } from '@/utils/processingDuration'
import WorkspaceDataPanel from './WorkspaceDataPanel.vue'
import WorkspaceTable from './WorkspaceTable.vue'
import ProductionReportTable from './ProductionReportTable.vue'
import WorkspacePagination from './WorkspacePagination.vue'
import WorkspaceDataToolbar from './WorkspaceDataToolbar.vue'
import WatermelonSegmented from './watermelon/WatermelonSegmented.vue'
import { sharedSerialLabel } from '@/types/sharedMaterial'
import { computed, defineAsyncComponent, onBeforeUnmount, ref, watch } from 'vue'
import { useProcessRouteView } from '@/composables/useProcessRouteView'
import { useRoute, useRouter } from 'vue-router'
import { ElTableColumn } from 'element-plus'
import ElButton from '@/components/AppButton.vue'
import FilterDialog from './FilterDialog.vue'
import { ElOption } from 'element-plus'
import RecordDateFilter from './RecordDateFilter.vue'
import StatePanel from './StatePanel.vue'
import LiveRefreshNotice from './LiveRefreshNotice.vue'
import ProcessingStockStatus from './ProcessingStockStatus.vue'
import QuantityAdjustmentDialog from './QuantityAdjustmentDialog.vue'
import ProcessingPersonInput from './ProcessingPersonInput.vue'
import type { ProcessingDailyRow } from '@/types/materialProcessing'
import { useLiveRefresh } from '@/composables/useLiveRefresh'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import type { ProcessingRecord } from '@/types/materialProcessing'
import { materialTypeLabel } from '@/types/materialTransfer'
import { inventoryAmount } from '@/types/teamInventory'
import TableExportButton from './TableExportButton.vue'
import { loadExportPages, tableExportSource } from '@/utils/tableExport'
import {
  processingStateLabels,
  processingProgressLabels,
  processingRoleLabels,
} from '@/types/materialProcessing'
import { formatDateTime } from '@/utils/format'
import { formatScheduleBatch } from '@/utils/scheduleBatch'
import {
  createProductionWorkbook,
  productionTemplates,
  productionRecordData,
} from '@/utils/productionWorkbook'

const props = defineProps<{
  teamId: number
  teamCode?: string
  canWrite?: boolean
  fullscreen?: boolean
  refreshKey?: unknown
  dispatchingRecordId?: number
}>()
const reportTemplates = computed(() => productionTemplates(props.teamCode))
const isInspectionTeam = computed(() => props.teamCode === 'FACTORY-QC')
function latestInspection(row: ProcessingRecord) {
  return row.report_inspections?.filter((check) => check.kind === 'inspection').at(-1)
}
const ProcessRouteEditor = defineAsyncComponent(() => import('./ProcessRouteEditor.vue'))
const {
  route: viewedRoute,
  loading: routeLoading,
  open: viewRoute,
  close: closeRoute,
} = useProcessRouteView()
const emit = defineEmits<{ register: []; changed: []; dispatch: [record: ProcessingRecord] }>()
const route = useRoute(),
  router = useRouter()
const text = (key: string) => (typeof route.query[key] === 'string' ? String(route.query[key]) : '')
const canViewProduction = computed(() => props.canWrite && reportTemplates.value.length > 0)
const reportTemplate = computed(() =>
  canViewProduction.value && text('processing_view') === 'production'
    ? reportTemplates.value[0]
    : undefined,
)
const page = computed(() => Math.max(1, Number.parseInt(text('page')) || 1))
const pageSize = computed(() =>
  [10, 20, 50, 100].includes(Number(text('page_size'))) ? Number(text('page_size')) : 10,
)
const selectingProcessor = ref(false)
const query = ref(''),
  dates = ref({ from: '', to: '' }),
  filtersOpen = ref(false)
const workKind = ref('')
const processorId = ref<number | null>(null)
const taskId = ref<number | null>(null)
const tasks = ref<{ id: number; name: string }[]>([])
const columnSettingsTarget = ref<HTMLElement | null>(null)
const processors = ref<{ id: number; name: string }[]>([])
const processorName = computed({
  get: () => processors.value.find((person) => person.id === processorId.value)?.name || '',
  set: (name: string) => {
    processorId.value = processors.value.find((person) => person.name === name)?.id || null
  },
})
const filterCount = computed(
  () =>
    Number(Boolean(text('date_from') || text('date_to') || text('work_date'))) +
    Number(Boolean(text('processor_id'))) +
    Number(Boolean(text('work_kind'))) +
    Number(Boolean(text('processing_task_id'))) +
    Number(Boolean(text('purpose_id'))),
)
const rows = ref<ProcessingRecord[]>([]),
  total = ref(0),
  loading = ref(false),
  error = ref('')
const detailOpen = ref(false),
  sourceId = ref<number | null>(null)
const parameterKeys = ref<string[]>([])
const parameterFields = computed(() => processingParameterFields(parameterKeys.value))
const parameterColumns = computed(() => parameterFields.value.filter((field) => field.column))
let generation = 0
const live = useLiveRefresh(() => load(true), {
  teamId: () => props.teamId,
  busy: () => loading.value || detailOpen.value,
})
function syncFilters() {
  workKind.value = text('work_kind')
  dates.value = {
    from: text('date_from') || text('work_date'),
    to: text('date_to') || text('work_date'),
  }
  processorId.value = Number(text('processor_id')) || null
  taskId.value = Number(text('processing_task_id')) || null
}
function resetFilters() {
  workKind.value = ''
  dates.value = { from: '', to: '' }
  processorId.value = null
  taskId.value = null
}
const tableQuery = useTableQuery(
  processingQueryColumns,
  () => {
    if (page.value !== 1) paginate(1)
    else void load()
  },
  (table_query) => teamMaterialApi.processingRecords(props.teamId, { ...filters(), table_query }),
)
function filters() {
  return {
    ...tableQuery.params.value,
    query: text('query') || undefined,
    processing_task_id: Number(text('processing_task_id')) || undefined,
    purpose_id: Number(text('purpose_id')) || undefined,
    work_kind: text('work_kind') || undefined,
    processor_id: Number(text('processor_id')) || undefined,
    work_date: text('work_date') || undefined,
    date_from: text('date_from') || undefined,
    date_to: text('date_to') || undefined,
  }
}
function apply(nextPage = 1, size = pageSize.value, applyFilters = false) {
  filtersOpen.value = false
  void router.replace({
    path: route.path,
    query: {
      tab: 'processing',
      processing_view: reportTemplate.value ? 'production' : undefined,
      work_kind: (applyFilters ? workKind.value : text('work_kind')) || undefined,
      processing_task_id: applyFilters
        ? taskId.value || undefined
        : text('processing_task_id') || undefined,
      purpose_id: applyFilters ? undefined : text('purpose_id') || undefined,
      query: query.value.trim() || undefined,
      processor_id: applyFilters
        ? processorId.value || undefined
        : text('processor_id') || undefined,
      work_date: applyFilters ? undefined : text('work_date') || undefined,
      date_from: applyFilters ? dates.value.from || undefined : text('date_from') || undefined,
      date_to: applyFilters ? dates.value.to || undefined : text('date_to') || undefined,
      page: nextPage > 1 ? String(nextPage) : undefined,
      page_size: size !== 10 ? String(size) : undefined,
    },
  })
}
function selectProcessingView(view: string) {
  void router.replace({
    path: route.path,
    query: {
      ...route.query,
      processing_view: view === 'production' ? 'production' : undefined,
    },
  })
}
function paginate(nextPage: number, size = pageSize.value) {
  void router.replace({
    path: route.path,
    query: {
      ...route.query,
      page: nextPage > 1 ? String(nextPage) : undefined,
      page_size: size !== 10 ? String(size) : undefined,
    },
  })
}
async function load(background = false) {
  const current = ++generation
  if (!background) {
    loading.value = true
    rows.value = []
    parameterKeys.value = []
  }
  error.value = ''
  try {
    const result = await teamMaterialApi.processingRecords(props.teamId, {
      ...filters(),
      page: page.value,
      page_size: pageSize.value,
    })
    if (current !== generation) return
    const last = Math.max(1, Math.ceil(result.total / pageSize.value))
    if (page.value > last) {
      paginate(last)
      return
    }
    rows.value = result.items
    parameterKeys.value = result.parameter_fields || []
    total.value = result.total
    processors.value = result.processors || []
    tasks.value = result.processing_tasks || []
  } catch (e) {
    if (current === generation) {
      if (background) throw e
      error.value = e instanceof Error ? e.message : '加工记录读取失败'
    }
  } finally {
    if (current === generation) loading.value = false
  }
}
function exportSource() {
  const id = props.teamId,
    params = filters()
  return tableExportSource(
    '逐笔加工明细',
    total.value,
    [
      {
        key: 'serial_no',
        label: '流水号',
        value: (row: ProcessingRecord) => sharedSerialLabel(row),
      },
      { key: 'task_batch_number', label: '排期批次', value: formatScheduleBatch },
      { key: 'material_name', label: '材质', value: (row) => row.material_name },
      { key: 'finished_quantity', label: '订单数量', value: (row) => row.finished_quantity },
      {
        key: 'processing_task_name',
        label: '加工任务',
        value: (row) => row.processing_task_name || '未登记',
      },
      {
        key: 'work_kind',
        label: '加工性质',
        value: (row) => (row.work_kind === 'rework' ? '返工' : '首次加工'),
      },
      { key: 'process_step_name', label: '工艺工序', value: (row) => row.process_step_name || '—' },
      {
        key: 'process_step_instructions',
        label: '本道工艺要求',
        value: (row) =>
          row.process_step_instructions?.trim() ? row.process_step_instructions : '历史未登记',
      },
      { key: 'rework_of_id', label: '关联加工记录', value: (row) => row.rework_of_id },
      { key: 'rework_round', label: '返工次数', value: (row) => row.rework_round },
      { key: 'created_at', label: '登记时间', value: (row) => formatDateTime(row.created_at) },
      {
        key: 'processing_date',
        label: '实际加工日期',
        value: (row) => row.processing_date || '未登记',
      },
      { key: 'completed_quantity', label: '本次完成件数', value: (row) => row.completed_quantity },
      ...(isInspectionTeam.value
        ? [
            {
              key: 'sample_quantity',
              label: '检验件数',
              value: (row: ProcessingRecord) => latestInspection(row)?.sample_quantity,
            },
            {
              key: 'passed_quantity',
              label: '合格件数',
              value: (row: ProcessingRecord) => latestInspection(row)?.passed_quantity,
            },
            {
              key: 'failed_quantity',
              label: '不合格件数',
              value: (row: ProcessingRecord) => latestInspection(row)?.failed_quantity,
            },
          ]
        : []),
      { key: 'completed_weight', label: '本次完成重量 (kg)', value: (row) => row.completed_weight },
      { key: 'input_quantity', label: '本次投入件数', value: (row) => row.input_quantity },
      { key: 'input_weight', label: '本次投入重量 (kg)', value: (row) => row.input_weight },
      { key: 'scrap_quantity', label: '本次废料件数', value: (row) => row.scrap_quantity },
      { key: 'scrap_weight', label: '本次废料重量 (kg)', value: (row) => row.scrap_weight },
      {
        key: 'processor_employee_id',
        label: '员工编号',
        value: (row) =>
          row.processors?.map((person) => person.id).join('、') || row.processor_employee_id,
      },
      { key: 'before_quantity', label: '加工前件数', value: (row) => row.before_quantity },
      { key: 'after_quantity', label: '加工后件数', value: (row) => row.after_quantity },
      {
        key: 'after_weight',
        label: '加工后重量 (kg)',
        value: (row) => row.after_weight ?? row.weight,
      },
      {
        key: 'outputs',
        label: '加工实物明细',
        value: (row) =>
          row.outputs
            ?.map(
              (output) =>
                `${output.batch_no} · ${processingRoleLabels[output.role]} · ${materialTypeLabel(output.material_type)} · ${output.quantity} 件 / ${output.weight} kg · ${output.transfer_specification || ''}`,
            )
            .join('；') || '',
      },
      {
        key: 'processing_status',
        label: '登记时进度',
        value: (row) =>
          row.processing_status ? processingProgressLabels[row.processing_status] : '未标明',
      },
      {
        key: 'after_specification',
        label: '加工后尺寸',
        value: (row) => row.after_specification || '',
      },
      { key: 'on_hand_quantity', label: '当前未转出件数', value: (row) => row.on_hand_quantity },
      { key: 'on_hand_weight', label: '当前未转出重量 (kg)', value: (row) => row.on_hand_weight },
      {
        key: 'processing_state',
        label: '当前状态',
        value: (row) => processingStateLabels[row.processing_state],
      },
      { key: 'processor_name', label: '加工人', value: (row) => row.processor_name || '未登记' },
      {
        key: 'processing_minutes',
        label: '加工工时（分钟）',
        value: (row) => row.labor_minutes,
      },
      ...parameterFields.value.map((field) => ({
        key: field.key,
        label: field.key === 'holding_minutes' ? '保温时长（分钟）' : field.label,
        value: (row: ProcessingRecord) => row[field.key],
      })),
      { key: 'reason', label: '备注', value: (row) => row.reason },
      { key: 'batch_no', label: '来源批次号', value: (row) => row.batch_no },
      ...(['quantity', 'weight'] as const).map((unit) => ({
        key: `remaining_${unit}`,
        label: unit === 'quantity' ? '本次余料件数' : '本次余料重量 (kg)',
        value: (row: ProcessingRecord) =>
          row.outputs
            ?.filter((output) => output.role === 'remaining')
            .reduce((sum, output) => sum + output[unit], 0),
      })),
    ],
    (signal, progress) =>
      loadExportPages(
        (page, pageSize) =>
          teamMaterialApi.processingRecords(id, { ...params, page, page_size: pageSize }),
        signal,
        progress,
      ),
  )
}
const dailyColumns = [
  {
    key: 'processing_minutes',
    label: '加工工时（分钟）',
    value: (r: ProcessingDailyRow) => r.labor_minutes,
  },
  {
    key: 'duration_record_count',
    label: '已填时长笔数',
    value: (r: ProcessingDailyRow) => r.duration_record_count,
  },
  {
    key: 'processing_task_name',
    label: '加工任务',
    value: (r: ProcessingDailyRow) => r.processing_task_name || '未登记',
  },
  {
    key: 'rework_quantity',
    label: '返工件次',
    value: (r: ProcessingDailyRow) => r.rework_quantity || 0,
  },
  {
    key: 'rework_weight',
    label: '返工工作量 (kg)',
    value: (r: ProcessingDailyRow) => r.rework_weight || 0,
  },
  {
    key: 'work_quantity',
    label: '总加工件次',
    value: (r: ProcessingDailyRow) => r.work_quantity ?? r.completed_quantity,
  },
  { key: 'team_name', label: '班组', value: (r: ProcessingDailyRow) => r.team_name },
  {
    key: 'processing_date',
    label: '加工日期',
    value: (r: ProcessingDailyRow) => r.processing_date,
  },
  {
    key: 'processor_name',
    label: '加工人',
    value: (r: ProcessingDailyRow) => r.processor_name,
  },
  {
    key: 'processor_employee_id',
    label: '员工编号',
    value: (r: ProcessingDailyRow) =>
      r.processors?.map((person) => person.id).join('、') || r.processor_employee_id,
  },
  {
    key: 'processing_mode',
    label: '加工方式',
    value: (r: ProcessingDailyRow) => (r.processing_mode === 'unit' ? '按件加工' : '拆分加工'),
  },
  {
    key: 'record_count',
    label: '登记笔数',
    value: (r: ProcessingDailyRow) => r.record_count,
  },
  {
    key: 'input_quantity',
    label: '投入件数',
    value: (r: ProcessingDailyRow) => r.input_quantity,
  },
  {
    key: 'completed_quantity',
    label: '首次任务完成件次',
    value: (r: ProcessingDailyRow) => r.completed_quantity,
  },
  {
    key: 'input_weight',
    label: '投入重量 (kg)',
    value: (r: ProcessingDailyRow) => r.input_weight,
  },
  {
    key: 'completed_weight',
    label: '首次加工完成重量 (kg)',
    value: (r: ProcessingDailyRow) => r.completed_weight,
  },
  {
    key: 'scrap_quantity',
    label: '废料件数',
    value: (r: ProcessingDailyRow) => r.scrap_quantity,
  },
  {
    key: 'scrap_weight',
    label: '废料重量 (kg)',
    value: (r: ProcessingDailyRow) => r.scrap_weight,
  },
]
function exportSources() {
  const id = props.teamId,
    params = filters()
  const templates = reportTemplates.value.map((template) => ({
    title: template.label,
    total: total.value,
    fields: [],
    load: async (signal: AbortSignal, progress: (loaded: number, total: number) => void) =>
      (
        await loadExportPages(
          (page, pageSize) =>
            teamMaterialApi.processingRecords(id, { ...params, page, page_size: pageSize }),
          signal,
          progress,
        )
      ).map(productionRecordData),
    workbook: (rows: Record<string, import('@/utils/tableExport').ExportValue>[]) =>
      createProductionWorkbook(template.key, rows),
  }))
  if (reportTemplate.value) return templates
  const sources = [exportSource(), ...templates]
  return [
    ...sources,
    tableExportSource('按参与人员和任务汇总', null, dailyColumns, (signal, progress) =>
      loadExportPages(
        (page, pageSize) =>
          teamMaterialApi.processingDaily(id, { ...params, page, page_size: pageSize }),
        signal,
        progress,
      ),
    ),
  ]
}
function saved() {
  void load()
  emit('changed')
}
function detail(row: unknown) {
  sourceId.value = (row as ProcessingRecord).source_transfer_id
  detailOpen.value = true
}
watch(
  () => [props.teamId, route.fullPath],
  (values, previous) => {
    closeRoute()
    if (previous && values[0] !== previous[0]) {
      ++generation
      processors.value = []
      tasks.value = []
      if (text('processor_id') || text('processing_task_id') || text('purpose_id')) {
        void router.replace({
          path: route.path,
          query: {
            ...route.query,
            processor_id: undefined,
            processing_task_id: undefined,
            purpose_id: undefined,
            page: undefined,
          },
        })
        return
      }
    }
    detailOpen.value = false
    query.value = text('query')
    syncFilters()
    void load()
  },
  { immediate: true },
)
watch(
  () => props.refreshKey,
  () => {
    if (!loading.value) void live.request()
  },
)
onBeforeUnmount(() => {
  ++generation
})
</script>

<template>
  <WorkspaceDataPanel
    class="processing-records workspace-data-panel"
    :class="{ 'processing-records--fullscreen': fullscreen }"
    :aria-label="reportTemplate ? '产量登记' : '加工记录'"
  >
    <WorkspaceDataToolbar
      v-model="query"
      :loading="loading"
      search-label="加工记录搜索"
      placeholder="流水号、批次号、加工人或备注"
      @search="apply()"
      @refresh="load()"
    >
      <template #filters>
        <FilterDialog
          v-slot="{ appendTo }"
          v-model="filtersOpen"
          title="加工记录筛选"
          :suspended="selectingProcessor"
          :count="filterCount"
          @open="syncFilters"
          @cancel="syncFilters"
          @apply="apply(1, pageSize, true)"
          @reset="resetFilters"
        >
          <label
            >加工性质<ElSelect
              :append-to="appendTo"
              v-model="workKind"
              clearable
              placeholder="全部加工"
              aria-label="加工性质筛选"
              ><ElOption label="首次加工" value="initial" /><ElOption
                label="返工"
                value="rework" /></ElSelect
          ></label>
          <label
            >实际加工日期<RecordDateFilter :append-to="appendTo" v-model="dates" label="加工日期"
          /></label>
          <label
            >加工任务<ElSelect
              :append-to="appendTo"
              v-model="taskId"
              clearable
              filterable
              placeholder="全部任务"
              aria-label="加工任务筛选"
            >
              <ElOption
                v-for="item in tasks"
                :key="item.id"
                :value="item.id"
                :label="item.name"
              /> </ElSelect
          ></label>
          <label
            >加工人（不选为全部）<ProcessingPersonInput
              @open-change="selectingProcessor = $event"
              v-model="processorName"
              :options="processors.map((person) => person.name)"
              label="加工人"
              :loading="loading"
          /></label>
        </FilterDialog>
      </template>
      <template #query-actions><div ref="columnSettingsTarget" /></template>
      <template #tools>
        <WatermelonSegmented
          v-if="canViewProduction"
          label="加工视图"
          :model-value="reportTemplate ? 'production' : 'records'"
          :options="[
            { value: 'records', label: '加工记录' },
            { value: 'production', label: '产量登记' },
          ]"
          @change="selectProcessingView" />
        <TableExportButton
          :source="() => exportSources()[0]!"
          :variants="() => exportSources().slice(1)"
          :disabled="loading || !!error"
          :context="route.fullPath"
      /></template>
      <template #primary-actions
        ><ElButton v-if="canWrite && !fullscreen" @click="emit('register')"
          >加工登记</ElButton
        ></template
      >
    </WorkspaceDataToolbar>
    <LiveRefreshNotice :message="live.message.value" @retry="live.request" />
    <StatePanel v-if="error" state="error" :description="error" @retry="load" />
    <ProductionReportTable
      v-else-if="reportTemplate"
      :template-key="reportTemplate.key"
      :records="rows"
      :loading="loading"
      :column-settings-target="columnSettingsTarget"
    />
    <WorkspaceTable
      columns-key="TeamProcessingRecords-1"
      :column-settings-target="columnSettingsTarget"
      :column-query="tableQuery.controller.value"
      v-else
      :loading="loading"
      :data="rows"
      row-key="id"
      class="processing-records-table"
      empty-text="暂无加工登记记录"
      aria-label="班组加工记录"
    >
      <ElTableColumn type="expand" label="详情" width="54" fixed>
        <template #default="{ row }">
          <section class="processing-record-detail" :aria-label="`加工记录 #${row.id} 工艺详情`">
            <dl>
              <div v-for="field in parameterFields" :key="field.key">
                <dt>{{ field.label }}</dt>
                <dd>{{ formatProcessingParameter(field.key, row) }}</dd>
              </div>
              <div>
                <dt>工艺工序</dt>
                <dd>{{ row.process_step_name || '历史未登记' }}</dd>
              </div>
              <div>
                <dt>加工任务</dt>
                <dd>{{ row.processing_task_name || '历史未登记' }}</dd>
              </div>
              <div v-if="row.rework_of_id">
                <dt>返工原记录</dt>
                <dd>#{{ row.rework_of_id }}</dd>
              </div>
              <div class="processing-record-requirements">
                <dt>本道工艺要求</dt>
                <dd>
                  {{
                    row.process_step_instructions?.trim()
                      ? row.process_step_instructions
                      : '历史未登记'
                  }}
                </dd>
              </div>
            </dl>
            <dl v-for="check in row.report_inspections" :key="check.id">
              <div>
                <dt>检验时间</dt>
                <dd>{{ formatDateTime(check.checked_at) }}</dd>
              </div>
              <div>
                <dt>检验方式</dt>
                <dd>{{ check.scope === 'full' ? '全检' : '抽检' }}</dd>
              </div>
              <div>
                <dt>检验件数</dt>
                <dd>{{ check.sample_quantity }}</dd>
              </div>
              <div>
                <dt>合格件数</dt>
                <dd>{{ check.passed_quantity }}</dd>
              </div>
              <div>
                <dt>不合格件数</dt>
                <dd>{{ check.failed_quantity }}</dd>
              </div>
              <div v-if="check.failed_quantity">
                <dt>不合格问题</dt>
                <dd>{{ check.problem_names.join('、') }}</dd>
              </div>
              <div v-if="check.notes" class="processing-record-requirements">
                <dt>问题说明</dt>
                <dd>{{ check.notes }}</dd>
              </div>
            </dl>
          </section>
        </template>
      </ElTableColumn>
      <ElTableColumn
        class-name="table-identity"
        label="流水号"
        min-width="150"
        fixed
        show-overflow-tooltip
        ><template #default="{ row }">{{ sharedSerialLabel(row) }}</template></ElTableColumn
      >
      <ElTableColumn prop="task_batch_number" label="排期批次" min-width="120" align="center">
        <template #default="{ row }">{{ formatScheduleBatch(row) }}</template>
      </ElTableColumn>
      <ElTableColumn label="加工性质" width="125" align="center"
        ><template #default="{ row }">{{
          row.work_kind === 'rework' ? `返工 · 第 ${row.rework_round} 次` : '首次加工'
        }}</template></ElTableColumn
      >
      <ElTableColumn prop="processing_date" label="实际加工日期" min-width="145" align="center" />
      <ElTableColumn
        prop="processor_name"
        label="加工人"
        min-width="110"
        align="center"
        show-overflow-tooltip
      >
        <template #default="{ row }"
          ><ProcessingPeople :people="row.processors" :fallback="row.processor_name" />
        </template>
      </ElTableColumn>
      <ElTableColumn
        v-for="field in parameterColumns"
        :key="field.key"
        :prop="field.key"
        :label="field.label"
        min-width="140"
        show-overflow-tooltip
      >
        <template #default="{ row }">{{ formatProcessingParameter(field.key, row) }}</template>
      </ElTableColumn>
      <ElTableColumn prop="labor_minutes" label="加工工时" min-width="140">
        <template #default="{ row }">{{ formatProcessingMinutes(row.labor_minutes) }}</template>
      </ElTableColumn>
      <ElTableColumn label="工艺工序" min-width="160" align="center"
        ><template #default="{ row }">
          <ElButton
            v-if="row.work_kind === 'rework' && row.process_route_id"
            link
            type="primary"
            :disabled="routeLoading"
            :aria-label="`查看加工记录 #${row.id} 的返工工艺`"
            @click="viewRoute(row.process_route_id)"
            >{{ row.process_step_name || '返工工艺' }}</ElButton
          ><span v-else>{{ row.process_step_name || '—' }}</span>
        </template></ElTableColumn
      >
      <ElTableColumn label="加工任务" min-width="140" align="center" show-overflow-tooltip>
        <template #default="{ row }">{{ row.processing_task_name || '未登记' }}</template>
      </ElTableColumn>
      <ElTableColumn label="物料类型" min-width="115"
        ><template #default="{ row }">{{
          materialTypeLabel(row.material_type)
        }}</template></ElTableColumn
      >
      <ElTableColumn label="本次完成件数" min-width="135" align="center"
        ><template #default="{ row }">{{
          inventoryAmount(row.completed_quantity)
        }}</template></ElTableColumn
      >
      <template v-if="isInspectionTeam">
        <ElTableColumn label="检验件数" min-width="110" align="right">
          <template #default="{ row }">{{
            inventoryAmount(latestInspection(row as ProcessingRecord)?.sample_quantity)
          }}</template>
        </ElTableColumn>
        <ElTableColumn label="合格件数" min-width="110" align="right">
          <template #default="{ row }">{{
            inventoryAmount(latestInspection(row as ProcessingRecord)?.passed_quantity)
          }}</template>
        </ElTableColumn>
        <ElTableColumn label="不合格件数" min-width="120" align="right">
          <template #default="{ row }"
            ><span
              :class="{
                'inspection-failed': latestInspection(row as ProcessingRecord)?.failed_quantity,
              }"
              >{{
                inventoryAmount(latestInspection(row as ProcessingRecord)?.failed_quantity)
              }}</span
            ></template
          >
        </ElTableColumn>
      </template>
      <ElTableColumn label="本次完成重量 (kg)" min-width="175" align="center"
        ><template #default="{ row }">{{
          inventoryAmount(row.completed_weight)
        }}</template></ElTableColumn
      >
      <ElTableColumn label="加工前件数" min-width="110" align="right"
        ><template #default="{ row }">{{
          inventoryAmount(row.before_quantity)
        }}</template></ElTableColumn
      >
      <ElTableColumn label="加工后件数" min-width="110" align="right"
        ><template #default="{ row }">{{
          inventoryAmount(row.after_quantity)
        }}</template></ElTableColumn
      >
      <ElTableColumn label="加工后重量 (kg)" min-width="160" align="right"
        ><template #default="{ row }">{{
          inventoryAmount(row.after_weight ?? row.weight)
        }}</template></ElTableColumn
      >
      <ElTableColumn
        v-if="rows.some((row) => row.outputs?.length)"
        label="加工实物明细"
        min-width="240"
        ><template #default="{ row }"
          ><ElButton v-if="row.outputs?.length" link type="primary" @click="detail(row)"
            >{{ row.outputs.length }} 个实物子批 · 查看明细</ElButton
          ><span v-else>统一件数登记</span></template
        ></ElTableColumn
      >
      <ElTableColumn label="当前未转出件数" min-width="145" align="right"
        ><template #default="{ row }">{{
          inventoryAmount(row.on_hand_quantity)
        }}</template></ElTableColumn
      >
      <ElTableColumn label="当前未转出重量 (kg)" min-width="185" align="right"
        ><template #default="{ row }">{{
          inventoryAmount(row.on_hand_weight)
        }}</template></ElTableColumn
      >
      <ElTableColumn label="当前状态" min-width="185" align="center"
        ><template #default="{ row }"
          ><ProcessingStockStatus
            compact
            :state="row.processing_state"
            :material-type="row.material_type" /></template
      ></ElTableColumn>
      <ElTableColumn label="登记时进度" min-width="145"
        ><template #default="{ row }">{{
          row.processing_status
            ? processingProgressLabels[row.processing_status as 'partial' | 'complete']
            : '未标明'
        }}</template></ElTableColumn
      >
      <ElTableColumn
        prop="after_specification"
        label="加工后尺寸"
        min-width="180"
        show-overflow-tooltip
      />
      <ElTableColumn prop="reason" label="备注" min-width="170" show-overflow-tooltip />
      <ElTableColumn label="登记时间" min-width="170" show-overflow-tooltip
        ><template #default="{ row }">{{ formatDateTime(row.created_at) }}</template></ElTableColumn
      >
      <ElTableColumn prop="batch_no" label="来源批次号" min-width="205" show-overflow-tooltip />
      <ElTableColumn label="操作" width="180" fixed="right" align="center"
        ><template #default="{ row }"
          ><ElButton link type="primary" @click="detail(row)">记录</ElButton>
          <ElButton
            v-if="canWrite"
            link
            type="primary"
            :loading="dispatchingRecordId === row.id"
            :disabled="
              Boolean(dispatchingRecordId) || !(row.on_hand_quantity > 0 || row.on_hand_weight > 0)
            "
            @click="emit('dispatch', row as ProcessingRecord)"
            >转出</ElButton
          ></template
        ></ElTableColumn
      >
    </WorkspaceTable>
    <WorkspacePagination
      :current-page="page"
      :page-size="pageSize"
      :total="total"
      @current-change="paginate($event)"
      @size-change="paginate(1, $event)"
    >
      共 {{ total }} 条记录
    </WorkspacePagination>
    <QuantityAdjustmentDialog
      v-model="detailOpen"
      :team-id="teamId"
      :source-id="sourceId"
      processing
      :can-write="false"
      @saved="saved"
      @changed="saved"
    />
    <ProcessRouteEditor v-if="viewedRoute" :route="viewedRoute" view-only @close="closeRoute" />
  </WorkspaceDataPanel>
</template>

<style scoped>
.inspection-failed {
  color: var(--el-color-danger);
  font-weight: var(--font-weight-semibold);
}
.processing-record-detail {
  margin: 8px 16px 12px;
  padding: 14px 16px;
  border: 1px solid var(--glass-border);
  border-radius: 12px;
  background: var(--glass-surface);
}
.processing-record-detail dl {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 24px;
  margin: 0;
}
.processing-record-detail dl > div {
  display: flex;
  gap: 12px;
  min-width: 0;
}
.processing-record-detail dt {
  color: var(--muted);
  white-space: nowrap;
}
.processing-record-detail dd {
  margin: 0;
  color: var(--text);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  line-height: 1.65;
}
.processing-record-requirements {
  grid-column: 1 / -1;
}

.processing-records--fullscreen {
  border-radius: 0;
  border: 0;
}
@media (max-width: 600px) {
  footer .el-pagination {
    max-width: 100%;
    overflow-x: auto;
  }
}
</style>
