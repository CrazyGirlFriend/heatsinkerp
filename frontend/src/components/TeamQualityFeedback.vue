<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  ElButton,
  ElInput,
  ElSelect,
  ElOption,
  ElTable,
  ElTableColumn,
  ElTag,
  ElPagination,
} from 'element-plus'
import { Refresh, Search } from '@element-plus/icons-vue'
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
  feedbackStates,
  dispositions,
  type QualityFeedback,
  type QualityFilters,
} from '@/services/qualityFeedbackApi'
import { formatDateTime } from '@/utils/format'
import { inspectionProblemLabel } from '@/services/inspectionApi'
import { loadExportPages, tableExportSource } from '@/utils/tableExport'
const props = defineProps<{ teamId: number; showAll?: boolean }>()
const emit = defineEmits<{ count: [value: number] }>()
const route = useRoute(),
  directory = useTeamDirectoryStore()
const rows = ref<QualityFeedback[]>([]),
  total = ref(0),
  page = ref(1),
  size = ref(10),
  query = ref(''),
  error = ref(''),
  loading = ref(false),
  selected = ref<number>()
const filtersOpen = ref(false),
  draftStatus = ref<QualityFilters['status']>(),
  draftKind = ref<QualityFilters['kind']>(),
  draftTeam = ref<number>(),
  draftProblem = ref<number>(),
  dates = ref({ from: '', to: '' }),
  applied = ref<QualityFilters>({})
const count = computed(
  () =>
    Number(!!applied.value.status) +
    Number(!!applied.value.kind) +
    Number(!!applied.value.team_id) +
    Number(!!applied.value.problem_type_id) +
    Number(!!applied.value.date_from || !!applied.value.date_to),
)
let generation = 0
const live = useLiveRefresh(() => load(true), {
  teamId: () => (props.showAll ? undefined : props.teamId),
  busy: () => loading.value || !!selected.value,
})
function params(): QualityFilters {
  return { ...applied.value, team_id: props.showAll ? applied.value.team_id : props.teamId }
}
async function load(background = false) {
  const token = ++generation
  if (!background) loading.value = true
  error.value = ''
  try {
    const result = await qualityFeedbackApi.records({
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
      error.value = e instanceof Error ? e.message : '质量反馈读取失败'
    }
  } finally {
    if (token === generation) loading.value = false
  }
}
function search() {
  applied.value.query = query.value.trim() || undefined
  page.value = 1
  void load()
}
function openFilters() {
  draftStatus.value = applied.value.status
  draftKind.value = applied.value.kind
  draftTeam.value = applied.value.team_id
  draftProblem.value = applied.value.problem_type_id
  dates.value = { from: applied.value.date_from || '', to: applied.value.date_to || '' }
}
function apply() {
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
      { key: 'serial_no', label: '流水号', value: (r: QualityFeedback) => r.serial_no },
      { key: 'checked_at', label: '发现时间', value: (r) => formatDateTime(r.checked_at) },
      { key: 'kind', label: '来源', value: (r) => (r.kind === 'inspection' ? '检验' : '巡检') },
      { key: 'team_name', label: '发现班组', value: (r) => r.team_name },
      { key: 'scope', label: '检验范围', value: (r) => (r.scope === 'full' ? '全检' : '抽检') },
      { key: 'sample_quantity', label: '检查件数', value: (r) => r.sample_quantity },
      { key: 'failed_quantity', label: '不合格件数', value: (r) => r.failed_quantity },
      {
        key: 'involved',
        label: '涉及班组',
        value: (r) => r.involved_teams.map((t) => t.name).join('、'),
      },
      { key: 'notes', label: '问题说明', value: (r) => r.notes },
      { key: 'problems', label: '检验问题', value: inspectionProblemLabel },
      {
        key: 'feedback_status',
        label: '处理状态',
        value: (r) => feedbackStates[r.feedback_status],
      },
      {
        key: 'disposition',
        label: '处理方式',
        value: (r) => dispositions[r.disposition as keyof typeof dispositions],
      },
      { key: 'decision_notes', label: '处理意见', value: (r) => r.decision_notes },
      { key: 'batch_no', label: '批次号', value: (r) => r.batch_no },
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
  () => [props.teamId, props.showAll],
  () => {
    applied.value = {}
    query.value = ''
    page.value = 1
    selected.value = undefined
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
onBeforeUnmount(() => {
  ++generation
})
</script>
<template>
  <section class="quality-feedback-records">
    <div class="quality-feedback-toolbar">
      <ElInput
        v-model="query"
        :prefix-icon="Search"
        placeholder="流水号、批次号、材质或问题说明"
        clearable
        @keyup.enter="search"
        @clear="search"
      />
      <FilterDialog
        v-model="filtersOpen"
        :count="count"
        @open="openFilters"
        @apply="apply"
        @reset="reset"
      >
        <label
          >问题来源<ElSelect v-model="draftKind" clearable placeholder="全部"
            ><ElOption label="巡检" value="patrol" /><ElOption
              label="检验"
              value="inspection" /></ElSelect
        ></label>
        <label
          >处理状态<ElSelect v-model="draftStatus" clearable placeholder="全部"
            ><ElOption
              v-for="(name, key) in feedbackStates"
              :key="key"
              :value="key"
              :label="name" /></ElSelect
        ></label>
        <label v-if="showAll"
          >涉及班组<ElSelect v-model="draftTeam" clearable placeholder="全部"
            ><ElOption
              v-for="t in directory.items"
              :key="t.id"
              :label="t.name"
              :value="Number(t.id)" /></ElSelect
        ></label>
        <label>发现日期<RecordDateFilter v-model="dates" label="发现日期" /></label>
        <label>检验问题<InspectionProblemFilter v-if="filtersOpen" v-model="draftProblem" /></label>
      </FilterDialog>
      <ElButton class="action-warm" @click="search">查询</ElButton>
      <TableExportButton
        :source="exportSource"
        :disabled="loading || !!error"
        :context="JSON.stringify(params())"
      />
      <ElButton :icon="Refresh" :loading="loading" aria-label="刷新质量反馈" @click="load()" />
    </div>
    <LiveRefreshNotice :message="live.message.value" @retry="live.request" />
    <StatePanel v-if="error" state="error" :description="error" @retry="load()" />
    <ElTable
      v-else
      :data="rows"
      class="business-table quality-feedback-table"
      height="100%"
      flexible
      row-key="id"
      empty-text="暂无质量反馈"
    >
      <ElTableColumn
        prop="serial_no"
        label="流水号"
        min-width="150"
        align="center"
        show-overflow-tooltip
      />
      <ElTableColumn label="发现时间" min-width="170" align="center"
        ><template #default="{ row }">{{ formatDateTime(row.checked_at) }}</template></ElTableColumn
      >
      <ElTableColumn label="来源" width="80" align="center"
        ><template #default="{ row }">{{
          row.kind === 'inspection' ? '检验' : '巡检'
        }}</template></ElTableColumn
      >
      <ElTableColumn prop="team_name" label="发现班组" min-width="100" align="center" />
      <ElTableColumn label="范围" width="80" align="center"
        ><template #default="{ row }">{{
          row.scope === 'full' ? '全检' : '抽检'
        }}</template></ElTableColumn
      >
      <ElTableColumn prop="failed_quantity" label="不合格件数" width="110" align="center" />
      <ElTableColumn label="检验问题" min-width="180" align="center" show-overflow-tooltip>
        <template #default="{ row }">{{ inspectionProblemLabel(row as QualityFeedback) }}</template>
      </ElTableColumn>
      <ElTableColumn label="涉及班组" min-width="180" align="center" show-overflow-tooltip
        ><template #default="{ row }">{{
          (row as QualityFeedback).involved_teams.map((t) => t.name).join('、') || '待指定'
        }}</template></ElTableColumn
      >
      <ElTableColumn label="班组反馈" width="110" align="center"
        ><template #default="{ row }"
          >{{ (row as QualityFeedback).involved_teams.filter((t) => t.replied).length }} /
          {{ row.involved_teams.length }}</template
        ></ElTableColumn
      >
      <ElTableColumn label="处理状态" width="110" align="center"
        ><template #default="{ row }"
          ><ElTag :type="row.feedback_status === 'closed' ? 'success' : 'warning'">{{
            feedbackStates[row.feedback_status as keyof typeof feedbackStates]
          }}</ElTag></template
        ></ElTableColumn
      >
      <ElTableColumn prop="batch_no" label="批次号" min-width="205" align="center" />
      <ElTableColumn label="操作" width="110" fixed="right" align="center"
        ><template #default="{ row }"
          ><ElButton link type="primary" @click="selected = row.id">查看 / 处理</ElButton></template
        ></ElTableColumn
      >
    </ElTable>
    <footer>
      <span>共 {{ total }} 条问题 · 多班组关联不重复计数</span
      ><ElPagination
        :current-page="page"
        :page-size="size"
        :page-sizes="[10, 20, 50, 100]"
        :total="total"
        layout="sizes, prev, pager, next"
        @current-change="changePage"
        @size-change="
          (value) => {
            size = value
            changePage(1)
          }
        "
      />
    </footer>
    <QualityFeedbackDetail
      v-if="selected"
      :issue-id="selected"
      @close="selected = undefined"
      @changed="changed"
    />
  </section>
</template>
<style scoped>
.quality-feedback-records {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  height: 100%;
  gap: 16px;
}
.quality-feedback-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.quality-feedback-toolbar > .el-input {
  flex: 1;
  min-width: 220px;
}
.quality-feedback-toolbar :deep(.el-button) {
  margin-left: 0;
}
.quality-feedback-table {
  flex: 1;
  min-height: 260px;
}
footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  color: var(--muted);
  font-size: 13px;
}
</style>
