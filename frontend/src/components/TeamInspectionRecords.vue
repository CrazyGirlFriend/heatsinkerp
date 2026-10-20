<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  ElButton,
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
import { Refresh, Search } from '@element-plus/icons-vue'
import AppDialog from './AppDialog.vue'
import QualityFeedbackDetail from './QualityFeedbackDetail.vue'
import FilterDialog from './FilterDialog.vue'
import InspectionProblemFilter from './InspectionProblemFilter.vue'
import RecordDateFilter from './RecordDateFilter.vue'
import StatePanel from './StatePanel.vue'
import TableExportButton from './TableExportButton.vue'
import LiveRefreshNotice from './LiveRefreshNotice.vue'
import InspectionRegistrationDialog from './InspectionRegistrationDialog.vue'
import { useLiveRefresh } from '@/composables/useLiveRefresh'
import { useAuthStore } from '@/stores/auth'
import { useTeamDirectoryStore } from '@/stores/teamDirectory'
import { teamCanProcess } from '@/config/teamWorkspaces'
import {
  inspectionApi,
  inspectionStatusLabels,
  inspectionMethodLabels,
  inspectionItemLabels,
  inspectionProblemLabel,
  type InspectionFilters,
  type InspectionRecord,
} from '@/services/inspectionApi'
import { formatDateTime } from '@/utils/format'
import { loadExportPages, tableExportSource } from '@/utils/tableExport'
const props = defineProps<{
  teamId: number
  sourceId?: number
  showAll?: boolean
  fullscreen?: boolean
  compact?: boolean
  kind?: InspectionRecord['kind']
}>()
const title = computed(() =>
  props.kind === 'inspection' ? '检验' : props.sourceId ? '检查' : '巡检',
)
const feedbackId = ref<number>()
const auth = useAuthStore(),
  directory = useTeamDirectoryStore()
const teams = computed(() => directory.items.filter((team) => team.active && teamCanProcess(team)))
const qc = computed(() => directory.items.find((team) => team.code === 'FACTORY-QC' && team.active))
const canWrite = computed(
  () =>
    auth.isTeamAccount &&
    !!qc.value &&
    String(qc.value.id) === String(auth.currentUser?.team_id) &&
    auth.currentUser?.active !== false &&
    !auth.currentUserError,
)
const rows = ref<InspectionRecord[]>([]),
  total = ref(0),
  page = ref(1),
  size = ref(10),
  loading = ref(false),
  error = ref('')
const query = ref(''),
  filtersOpen = ref(false),
  draftTeam = ref<number>(),
  draftStatus = ref<InspectionRecord['status']>(),
  draftProblem = ref<number>(),
  draftDates = ref({ from: '', to: '' })
const applied = ref<InspectionFilters>({}),
  sourceFilter = ref<number>()
const registration = ref(false),
  recheck = ref<InspectionRecord | null>(null),
  detail = ref<InspectionRecord | null>(null)
let generation = 0
const live = useLiveRefresh(() => load(true), {
  teamId: () => (props.showAll ? undefined : props.teamId),
  busy: () => loading.value || registration.value || !!detail.value,
})
const filterCount = computed(
  () =>
    Number(!!applied.value.team_id) +
    Number(!!applied.value.status) +
    Number(!!applied.value.problem_type_id) +
    Number(!!applied.value.date_from || !!applied.value.date_to),
)
function params(): InspectionFilters {
  return {
    ...applied.value,
    kind: props.kind ?? (props.sourceId ? undefined : 'patrol'),
    team_id: props.sourceId ? undefined : props.showAll ? applied.value.team_id : props.teamId,
    source_transfer_id: props.sourceId ?? sourceFilter.value,
  }
}
async function load(background = false) {
  const token = ++generation
  if (!background) loading.value = true
  error.value = ''
  try {
    const result = await inspectionApi.records({
      ...params(),
      page: page.value,
      page_size: size.value,
    })
    if (token !== generation) return
    const last = Math.max(1, Math.ceil(result.total / size.value))
    if (page.value > last) {
      page.value = last
      await load(background)
      return
    }
    rows.value = result.items
    total.value = result.total
  } catch (e) {
    if (token === generation) {
      if (background) throw e
      rows.value = []
      error.value = e instanceof Error ? e.message : '巡检记录读取失败'
    }
  } finally {
    if (token === generation) loading.value = false
  }
}
function search() {
  applied.value = { ...applied.value, query: query.value.trim() || undefined }
  page.value = 1
  void load()
}
function openFilters() {
  draftTeam.value = applied.value.team_id
  draftStatus.value = applied.value.status
  draftProblem.value = applied.value.problem_type_id
  draftDates.value = { from: applied.value.date_from || '', to: applied.value.date_to || '' }
}
function applyFilters() {
  applied.value = {
    query: query.value.trim() || undefined,
    team_id: draftTeam.value,
    status: draftStatus.value,
    problem_type_id: draftProblem.value,
    date_from: draftDates.value.from || undefined,
    date_to: draftDates.value.to || undefined,
  }
  filtersOpen.value = false
  page.value = 1
  void load()
}
function resetFilters() {
  draftTeam.value = undefined
  draftStatus.value = undefined
  draftProblem.value = undefined
  draftDates.value = { from: '', to: '' }
}
function clearSource() {
  sourceFilter.value = undefined
  page.value = 1
  void load()
}
function changePage(value: number) {
  page.value = value
  void load()
}
function changeSize(value: number) {
  size.value = value
  changePage(1)
}
function register(row?: InspectionRecord) {
  recheck.value = row || null
  registration.value = true
}
function saved() {
  registration.value = false
  detail.value = null
  void load()
}
function batchRecords(row: InspectionRecord) {
  sourceFilter.value = row.source_transfer_id
  applied.value = {}
  query.value = ''
  page.value = 1
  void load()
}
function exportSource() {
  const filters = params()
  return tableExportSource(
    `${title.value}记录`,
    total.value,
    [
      { key: 'serial_no', label: '流水号', value: (row: InspectionRecord) => row.serial_no },
      { key: 'checked_at', label: '检查时间', value: (row) => formatDateTime(row.checked_at) },
      { key: 'team_name', label: '被检班组', value: (row) => row.team_name },
      { key: 'material_name', label: '材质', value: (row) => row.material_name },
      { key: 'inspector_name', label: '检验人', value: (row) => row.inspector_name },
      { key: 'processor_name', label: '原加工人', value: (row) => row.processor_name || '未登记' },
      {
        key: 'kind',
        label: '检查类型',
        value: (row) => (row.parent_id ? '复检' : row.kind === 'inspection' ? '检验' : '巡检'),
      },
      { key: 'batch_quantity', label: '检查时在库件数', value: (row) => row.batch_quantity },
      { key: 'sample_quantity', label: '检查件数', value: (row) => row.sample_quantity },
      { key: 'passed_quantity', label: '检查合格件数', value: (row) => row.passed_quantity },
      { key: 'failed_quantity', label: '检查不合格件数', value: (row) => row.failed_quantity },
      { key: 'status', label: '处理状态', value: (row) => inspectionStatusLabels[row.status] },
      { key: 'scope', label: '检验范围', value: (row) => (row.scope === 'full' ? '全检' : '抽检') },
      {
        key: 'methods',
        label: '检查手段',
        value: (row) => (row.methods || []).map((m) => inspectionMethodLabels[m]).join('、'),
      },
      {
        key: 'items',
        label: '检查项目',
        value: (row) => (row.items || []).map((i) => inspectionItemLabels[i]).join('、'),
      },
      { key: 'dimension_result', label: '尺寸要求与实测', value: (row) => row.dimension_result },
      { key: 'weight_result', label: '重量要求与实测', value: (row) => row.weight_result },
      { key: 'notes', label: '检查与处理说明', value: (row) => row.notes },
      { key: 'problems', label: '检验问题', value: inspectionProblemLabel },
      { key: 'parent_id', label: '原巡检记录编号', value: (row) => row.parent_id },
      { key: 'batch_no', label: '批次号', value: (row) => row.batch_no },
    ],
    (signal, progress) =>
      loadExportPages(
        (page, pageSize) => inspectionApi.records({ ...filters, page, page_size: pageSize }),
        signal,
        progress,
      ),
  )
}
watch(
  () => [props.teamId, props.sourceId, props.showAll, props.kind],
  () => {
    ++generation
    rows.value = []
    sourceFilter.value = undefined
    applied.value = {}
    query.value = ''
    page.value = 1
    registration.value = false
    detail.value = null
    void load()
  },
  { immediate: true },
)
watch(canWrite, (value) => {
  if (!value) registration.value = false
})
onBeforeUnmount(() => {
  ++generation
})
</script>
<template>
  <section
    class="inspection-records"
    :class="{
      'inspection-records--compact': compact,
      'inspection-records--fullscreen': fullscreen,
    }"
  >
    <div class="inspection-toolbar">
      <ElInput
        v-model="query"
        :prefix-icon="Search"
        clearable
        placeholder="流水号、批次、材质或检验人"
        aria-label="检查搜索"
        @keyup.enter="search"
        @clear="search"
      />
      <FilterDialog
        v-model="filtersOpen"
        :count="filterCount"
        @open="openFilters"
        @apply="applyFilters"
        @reset="resetFilters"
      >
        <label v-if="showAll"
          >被检班组<ElSelect v-model="draftTeam" clearable placeholder="全部班组"
            ><ElOption
              v-for="team in teams"
              :key="team.id"
              :value="Number(team.id)"
              :label="team.name" /></ElSelect
        ></label>
        <label
          >处理状态<ElSelect v-model="draftStatus" clearable placeholder="全部状态"
            ><ElOption
              v-for="(label, key) in inspectionStatusLabels"
              :key="key"
              :value="key"
              :label="label" /></ElSelect
        ></label>
        <label>检查日期<RecordDateFilter v-model="draftDates" label="检查日期" /></label>
        <label>检验问题<InspectionProblemFilter v-if="filtersOpen" v-model="draftProblem" /></label>
      </FilterDialog>
      <ElButton class="action-warm" @click="search">查询</ElButton>
      <TableExportButton
        :source="exportSource"
        :disabled="loading || !!error"
        :context="JSON.stringify(params())"
      />
      <ElButton
        :icon="Refresh"
        :loading="loading"
        :aria-label="`刷新${title}记录`"
        @click="load()"
      />
      <ElButton v-if="canWrite && !sourceId" type="primary" @click="register()"
        >{{ title }}登记</ElButton
      >
    </div>
    <div v-if="sourceFilter && !sourceId" class="inspection-scope">
      <span>当前显示所选批次的检查与复检记录</span
      ><ElButton link @click="clearSource">返回全部记录</ElButton>
    </div>
    <LiveRefreshNotice :message="live.message.value" @retry="live.request" />
    <StatePanel v-if="error" state="error" :description="error" @retry="load" />
    <ElTable
      v-else
      :data="rows"
      class="business-table inspection-table"
      height="100%"
      flexible
      row-key="id"
      :empty-text="`暂无${title}记录`"
      :aria-label="`${title}记录`"
    >
      <ElTableColumn
        prop="serial_no"
        label="流水号"
        min-width="145"
        align="center"
        show-overflow-tooltip
      />
      <ElTableColumn label="检查时间" min-width="170" align="center"
        ><template #default="{ row }">{{ formatDateTime(row.checked_at) }}</template></ElTableColumn
      >
      <ElTableColumn prop="team_name" label="被检班组" min-width="105" align="center" />
      <ElTableColumn
        prop="material_name"
        label="材质"
        min-width="110"
        align="center"
        show-overflow-tooltip
      />
      <ElTableColumn prop="inspector_name" label="检验人" min-width="110" align="center" />
      <ElTableColumn label="检查类型" width="90" align="center"
        ><template #default="{ row }">{{
          row.parent_id ? '复检' : row.kind === 'inspection' ? '检验' : '巡检'
        }}</template></ElTableColumn
      >
      <ElTableColumn label="检验范围" width="90" align="center"
        ><template #default="{ row }">{{
          row.scope === 'full' ? '全检' : '抽检'
        }}</template></ElTableColumn
      >
      <ElTableColumn prop="sample_quantity" label="检查件数" width="100" align="center" />
      <ElTableColumn prop="passed_quantity" label="合格件数" width="100" align="center" />
      <ElTableColumn prop="failed_quantity" label="不合格件数" width="115" align="center" />
      <ElTableColumn label="检验问题" min-width="180" align="center" show-overflow-tooltip>
        <template #default="{ row }">{{
          inspectionProblemLabel(row as InspectionRecord)
        }}</template>
      </ElTableColumn>
      <ElTableColumn label="检查结果" min-width="175" align="center"
        ><template #default="{ row }"
          ><ElTag
            :type="row.status === 'pending' || row.status === 'failed' ? 'danger' : 'success'"
            effect="light"
            >{{ inspectionStatusLabels[row.status as InspectionRecord['status']] }}</ElTag
          ></template
        ></ElTableColumn
      >
      <ElTableColumn prop="batch_no" label="批次号" min-width="205" align="center" />
      <ElTableColumn label="操作" :width="canWrite ? 300 : 225" align="center" fixed="right"
        ><template #default="{ row }"
          ><ElButton link type="primary" @click="detail = row as InspectionRecord">明细</ElButton
          ><ElButton v-if="!sourceId" link @click="batchRecords(row as InspectionRecord)"
            >本批记录</ElButton
          ><ElButton
            v-if="canWrite && row.failed_quantity > 0 && !row.parent_id"
            link
            type="primary"
            @click="register(row as InspectionRecord)"
            >复检</ElButton
          ><ElButton
            v-if="row.quality_issue_id"
            link
            type="primary"
            @click="feedbackId = row.quality_issue_id"
            >质量反馈</ElButton
          ></template
        ></ElTableColumn
      >
    </ElTable>
    <footer>
      <span>共 {{ total }} 次检查 · 抽检数量不代表整批合格数量</span
      ><ElPagination
        :current-page="page"
        :page-size="size"
        :page-sizes="[10, 20, 50, 100]"
        :total="total"
        layout="sizes, prev, pager, next"
        @current-change="changePage"
        @size-change="changeSize"
      />
    </footer>
    <InspectionRegistrationDialog
      v-if="registration && canWrite && qc"
      :inspection-team-id="Number(qc.id)"
      :kind="kind || 'patrol'"
      :initial-team-id="kind === 'inspection' ? teamId : showAll ? applied.team_id : teamId"
      :recheck="recheck"
      @close="registration = false"
      @saved="saved"
    />
    <AppDialog
      :model-value="!!detail"
      :title="`${title}明细`"
      width="min(900px, calc(100vw - 40px))"
      align-center
      append-to-body
      @close="detail = null"
    >
      <ElDescriptions v-if="detail" :column="2" border>
        <ElDescriptionsItem label="流水号">{{ detail.serial_no }}</ElDescriptionsItem
        ><ElDescriptionsItem label="批次号">{{ detail.batch_no }}</ElDescriptionsItem>
        <ElDescriptionsItem label="被检班组">{{ detail.team_name }}</ElDescriptionsItem
        ><ElDescriptionsItem label="材质 / 尺寸"
          >{{ detail.material_name }} / {{ detail.specification || '—' }}</ElDescriptionsItem
        >
        <ElDescriptionsItem label="检验人">{{ detail.inspector_name }}</ElDescriptionsItem
        ><ElDescriptionsItem label="检查时间">{{
          formatDateTime(detail.checked_at)
        }}</ElDescriptionsItem>
        <ElDescriptionsItem label="原加工人">{{
          detail.processor_name || '未登记'
        }}</ElDescriptionsItem
        ><ElDescriptionsItem label="加工记录编号">{{
          detail.processing_record_id || '历史未关联'
        }}</ElDescriptionsItem>
        <ElDescriptionsItem label="检查时在库">{{ detail.batch_quantity }} 件</ElDescriptionsItem
        ><ElDescriptionsItem label="检查结果"
          >{{ detail.sample_quantity }} 件中，合格 {{ detail.passed_quantity }} 件，不合格
          {{ detail.failed_quantity }} 件</ElDescriptionsItem
        >
        <ElDescriptionsItem label="状态">{{
          inspectionStatusLabels[detail.status]
        }}</ElDescriptionsItem
        ><ElDescriptionsItem label="原检查编号">{{
          detail.parent_id || '首次检查'
        }}</ElDescriptionsItem>
        <ElDescriptionsItem label="历史锁定解除时间">{{
          formatDateTime(detail.released_at)
        }}</ElDescriptionsItem
        ><ElDescriptionsItem label="登记账号">{{ detail.created_by }}</ElDescriptionsItem>
        <ElDescriptionsItem label="范围">{{
          detail.scope === 'full' ? '全检' : '抽检'
        }}</ElDescriptionsItem>
        <ElDescriptionsItem label="检查手段">{{
          (detail.methods || []).map((m) => inspectionMethodLabels[m]).join('、') || '历史未记录'
        }}</ElDescriptionsItem>
        <ElDescriptionsItem label="检查项目" :span="2">{{
          (detail.items || []).map((i) => inspectionItemLabels[i]).join('、') || '历史未记录'
        }}</ElDescriptionsItem>
        <ElDescriptionsItem v-if="detail.dimension_result" label="尺寸要求 / 实测" :span="2">{{
          detail.dimension_result
        }}</ElDescriptionsItem>
        <ElDescriptionsItem v-if="detail.weight_result" label="重量要求 / 实测" :span="2">{{
          detail.weight_result
        }}</ElDescriptionsItem>
        <ElDescriptionsItem label="检验问题" :span="2">{{
          inspectionProblemLabel(detail)
        }}</ElDescriptionsItem>
        <ElDescriptionsItem label="补充说明" :span="2">{{
          detail.notes || '—'
        }}</ElDescriptionsItem>
      </ElDescriptions>
      <template #footer><ElButton @click="detail = null">关闭</ElButton></template>
    </AppDialog>
    <QualityFeedbackDetail
      v-if="feedbackId"
      :issue-id="feedbackId"
      @close="feedbackId = undefined"
      @changed="load()"
    />
  </section>
</template>
<style scoped>
.inspection-records {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
  height: 100%;
  gap: 16px;
}
.inspection-toolbar {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
  flex-shrink: 0;
}
.inspection-toolbar > .el-input {
  flex: 1;
  min-width: 220px;
}
.inspection-toolbar :deep(.el-button) {
  margin-left: 0;
}
.inspection-table {
  flex: 1;
  min-height: 260px;
}
.inspection-records--compact {
  height: min(540px, 65dvh);
}
.inspection-records--fullscreen {
  padding: 0;
}
.inspection-scope,
footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
footer {
  flex-shrink: 0;
  padding: 8px 0;
  color: var(--muted);
  font-size: 13px;
}
</style>
