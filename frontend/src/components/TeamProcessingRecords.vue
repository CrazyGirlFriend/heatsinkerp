<script setup lang="ts">
import { sharedSerialLabel } from '@/types/sharedMaterial'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Refresh, Search } from '@element-plus/icons-vue'
import { ElButton, ElInput, ElLoading, ElPagination, ElTable, ElTableColumn } from 'element-plus'
import FilterDialog from './FilterDialog.vue'
import ProcessingBatchPicker from './ProcessingBatchPicker.vue'
import { ElSelect, ElOption, ElMessage } from 'element-plus'
import RecordDateFilter from './RecordDateFilter.vue'
import StatePanel from './StatePanel.vue'
import LiveRefreshNotice from './LiveRefreshNotice.vue'
import ProcessingStockStatus from './ProcessingStockStatus.vue'
import QuantityAdjustmentDialog from './QuantityAdjustmentDialog.vue'
import ProcessingPersonInput from './ProcessingPersonInput.vue'
import type { ProcessingDailyRow, ProcessingRecordSummary } from '@/types/materialProcessing'
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

const props = defineProps<{
  teamId: number
  canWrite?: boolean
  fullscreen?: boolean
  refreshKey?: unknown
}>()
const vLoading = ElLoading.directive
const emit = defineEmits<{ register: []; changed: [] }>()
const route = useRoute(),
  router = useRouter()
const text = (key: string) => (typeof route.query[key] === 'string' ? String(route.query[key]) : '')
const page = computed(() => Math.max(1, Number.parseInt(text('page')) || 1))
const pageSize = computed(() =>
  [10, 20, 50, 100].includes(Number(text('page_size'))) ? Number(text('page_size')) : 10,
)
const query = ref(''),
  dates = ref({ from: '', to: '' }),
  filtersOpen = ref(false)
const workKind = ref('')
const reworkMode = ref(false),
  reworkRecordId = ref<number | null>(null),
  reworkBusy = ref(false)
const processorId = ref<number | null>(null)
const processors = ref<{ id: number; name: string }[]>([])
const processorName = computed({
  get: () => processors.value.find((person) => person.id === processorId.value)?.name || '',
  set: (name: string) => {
    processorId.value = processors.value.find((person) => person.name === name)?.id || null
  },
})
const summary = ref<ProcessingRecordSummary | null>(null)
const filterCount = computed(
  () =>
    Number(Boolean(text('date_from') || text('date_to') || text('work_date'))) +
    Number(Boolean(text('processor_id'))) +
    Number(Boolean(text('work_kind'))),
)
const rows = ref<ProcessingRecord[]>([]),
  total = ref(0),
  loading = ref(false),
  error = ref('')
const detailOpen = ref(false),
  sourceId = ref<number | null>(null)
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
}
function resetFilters() {
  workKind.value = ''
  dates.value = { from: '', to: '' }
  processorId.value = null
}
function filters() {
  return {
    query: text('query') || undefined,
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
      work_kind: (applyFilters ? workKind.value : text('work_kind')) || undefined,
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
    summary.value = null
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
    total.value = result.total
    summary.value = result.summary || null
    processors.value = result.processors || []
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
      { key: 'material_name', label: '材质', value: (row) => row.material_name },
      {
        key: 'work_kind',
        label: '加工性质',
        value: (row) => (row.work_kind === 'rework' ? '返工' : '首次加工'),
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
      { key: 'completed_weight', label: '本次完成重量 (kg)', value: (row) => row.completed_weight },
      { key: 'input_quantity', label: '本次投入件数', value: (row) => row.input_quantity },
      { key: 'input_weight', label: '本次投入重量 (kg)', value: (row) => row.input_weight },
      { key: 'scrap_quantity', label: '本次废料件数', value: (row) => row.scrap_quantity },
      { key: 'scrap_weight', label: '本次废料重量 (kg)', value: (row) => row.scrap_weight },
      {
        key: 'processor_employee_id',
        label: '员工编号',
        value: (row) => row.processor_employee_id,
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
        label: '登记后实际尺寸',
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
      { key: 'reason', label: '加工说明', value: (row) => row.reason },
      { key: 'batch_no', label: '来源批次号', value: (row) => row.batch_no },
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
    value: (r: ProcessingDailyRow) => r.processor_employee_id,
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
    label: '首次加工完成件数',
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
function exportVariants() {
  if (!summary.value) return []
  const id = props.teamId,
    params = filters()
  return [
    tableExportSource(
      '按加工人汇总',
      summary.value.employee_day_count,
      dailyColumns,
      (signal, progress) =>
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
async function startRework(recordId: number) {
  if (reworkBusy.value) return
  reworkBusy.value = true
  try {
    const result = await teamMaterialApi.processingSources(props.teamId, {
      rework_record_id: recordId,
      page_size: 2,
    })
    if (!result.total) ElMessage.info('本记录已无可返工的在库料')
    else if (result.total === 1) selectRework(Number(result.items[0]!.transfer.id))
    else reworkRecordId.value = recordId
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '返工批次读取失败')
  } finally {
    reworkBusy.value = false
  }
}
function selectRework(id: number) {
  reworkRecordId.value = null
  sourceId.value = id
  reworkMode.value = true
  detailOpen.value = true
}
function detail(row: unknown) {
  reworkMode.value = false
  sourceId.value = (row as ProcessingRecord).source_transfer_id
  detailOpen.value = true
}
watch(
  () => [props.teamId, route.fullPath],
  (values, previous) => {
    if (previous && values[0] !== previous[0]) {
      ++generation
      processors.value = []
      summary.value = null
      if (text('processor_id')) {
        void router.replace({
          path: route.path,
          query: { ...route.query, processor_id: undefined, page: undefined },
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
  <section
    class="processing-records workspace-data-panel"
    :class="{ 'processing-records--fullscreen': fullscreen }"
    aria-label="加工记录"
  >
    <div class="processing-records-toolbar workspace-data-toolbar">
      <ElInput
        v-model="query"
        :prefix-icon="Search"
        clearable
        aria-label="加工记录搜索"
        placeholder="流水号、批次号、加工人或加工说明"
        @keyup.enter="apply()"
        @clear="apply()"
      />
      <FilterDialog
        v-model="filtersOpen"
        title="加工记录筛选"
        :count="filterCount"
        @open="syncFilters"
        @cancel="syncFilters"
        @apply="apply(1, pageSize, true)"
        @reset="resetFilters"
      >
        <label
          >加工性质<ElSelect
            v-model="workKind"
            clearable
            placeholder="全部加工"
            aria-label="加工性质筛选"
            ><ElOption label="首次加工" value="initial" /><ElOption
              label="返工"
              value="rework" /></ElSelect
        ></label>
        <label>实际加工日期<RecordDateFilter v-model="dates" label="加工日期" /></label>
        <label
          >加工人（不选为全部）<ProcessingPersonInput
            v-model="processorName"
            :options="processors.map((person) => person.name)"
            label="加工人"
            :loading="loading"
        /></label>
      </FilterDialog>
      <ElButton class="workspace-query action-warm" @click="apply()">查询</ElButton
      ><TableExportButton
        :source="exportSource"
        :variants="exportVariants"
        :disabled="loading || !!error"
        :context="route.fullPath"
      /><ElButton :icon="Refresh" :loading="loading" aria-label="刷新加工记录" @click="load()" />
      <ElButton v-if="canWrite && !fullscreen" type="primary" @click="emit('register')"
        >加工登记</ElButton
      >
    </div>
    <div v-if="summary && !error" class="processing-totals" aria-label="筛选结果产量合计">
      <span class="summary-label">筛选结果合计</span>
      <span
        >首次完成 <strong>{{ inventoryAmount(summary.completed_quantity) }}</strong> 件 /
        <strong>{{ inventoryAmount(summary.completed_weight) }}</strong> kg</span
      >
      <span
        >废料 <strong>{{ inventoryAmount(summary.scrap_quantity) }}</strong> 件 /
        <strong>{{ inventoryAmount(summary.scrap_weight) }}</strong> kg</span
      >
      <span
        >返工 <strong>{{ inventoryAmount(summary.rework_quantity || 0) }}</strong> 件次 /
        {{ inventoryAmount(summary.rework_weight || 0) }} kg</span
      >
      <span class="summary-note">{{ summary.record_count }} 笔有效加工 · 按实际加工日期</span>
      <span v-if="summary.unreported_count" class="summary-note"
        >{{ summary.unreported_count }} 笔历史记录信息不全，未计入产量</span
      >
    </div>
    <LiveRefreshNotice :message="live.message.value" @retry="live.request" />
    <StatePanel v-if="error" state="error" :description="error" @retry="load" />
    <ElTable
      v-else
      v-loading="loading"
      :data="rows"
      row-key="id"
      class="business-table processing-records-table"
      height="100%"
      flexible
      empty-text="暂无加工登记记录"
      aria-label="班组加工记录"
    >
      <ElTableColumn label="流水号" min-width="150" fixed show-overflow-tooltip
        ><template #default="{ row }">{{ sharedSerialLabel(row) }}</template></ElTableColumn
      >
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
        <template #default="{ row }">{{ row.processor_name || '未登记' }}</template>
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
        label="登记后实际尺寸"
        min-width="180"
        show-overflow-tooltip
      />
      <ElTableColumn prop="reason" label="加工说明" min-width="170" show-overflow-tooltip />
      <ElTableColumn label="登记时间" min-width="170" show-overflow-tooltip
        ><template #default="{ row }">{{ formatDateTime(row.created_at) }}</template></ElTableColumn
      >
      <ElTableColumn prop="batch_no" label="来源批次号" min-width="205" show-overflow-tooltip />
      <ElTableColumn label="操作" width="140" fixed="right" align="center"
        ><template #default="{ row }"
          ><ElButton link type="primary" @click="detail(row)">记录</ElButton
          ><ElButton
            v-if="canWrite"
            link
            type="primary"
            :disabled="reworkBusy || row.on_hand_quantity <= 0"
            @click="startRework(row.id)"
            >返工</ElButton
          ></template
        ></ElTableColumn
      >
    </ElTable>
    <footer>
      <span>共 {{ total }} 条记录</span
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
    <QuantityAdjustmentDialog
      v-model="detailOpen"
      :team-id="teamId"
      :source-id="sourceId"
      processing
      :can-write="canWrite && reworkMode"
      :rework="reworkMode"
      @saved="saved"
    />
    <ProcessingBatchPicker
      v-if="reworkRecordId"
      :team-id="teamId"
      :rework-record-id="reworkRecordId"
      @close="reworkRecordId = null"
      @selected="selectRework"
    />
  </section>
</template>

<style scoped>
.processing-records {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--card-radius);
  background: var(--surface);
  padding: 0 16px;
}
.processing-records-toolbar {
  display: flex;
  flex: 0 0 auto;
  gap: 8px;
  align-items: center;
  padding: 14px 0;
}
.processing-records-toolbar .el-input {
  flex: 1;
  min-width: 0;
}
.processing-records-toolbar .el-button {
  margin-left: 0;
}
.processing-totals {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  flex-shrink: 0;
  gap: 8px 24px;
  padding: 0 0 14px;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.processing-totals strong {
  color: var(--primary);
  font-size: 16px;
}
.summary-label,
.summary-note {
  color: var(--muted);
}
.processing-records-table {
  flex: 1;
  min-height: 0;
}
footer {
  display: flex;
  flex: 0 0 auto;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
}
.processing-records--fullscreen {
  border-radius: 0;
  border: 0;
}
@media (max-width: 600px) {
  .processing-records {
    padding-inline: 10px;
  }
  .processing-records-toolbar {
    flex-wrap: wrap;
  }
  .processing-records-toolbar .el-input {
    flex-basis: 100%;
  }
  footer {
    flex-wrap: wrap;
  }
  footer .el-pagination {
    max-width: 100%;
    overflow-x: auto;
  }
}
</style>
