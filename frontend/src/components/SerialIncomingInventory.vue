<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElOption, ElTableColumn, ElTag } from 'element-plus'
import AppAlert from './AppAlert.vue'
import AppButton from './AppButton.vue'
import AppDatePicker from './AppDatePicker.vue'
import AppInput from './AppInput.vue'
import AppSelect from './AppSelect.vue'
import FilterDialog from './FilterDialog.vue'
import LiveRefreshNotice from './LiveRefreshNotice.vue'
import MaterialTransferDrawer from './MaterialTransferDrawer.vue'
import StatePanel from './StatePanel.vue'
import TableExportButton from './TableExportButton.vue'
import WorkspaceDataPanel from './WorkspaceDataPanel.vue'
import WorkspaceDataToolbar from './WorkspaceDataToolbar.vue'
import WorkspacePagination from './WorkspacePagination.vue'
import WorkspaceTable from './WorkspaceTable.vue'
import { useLiveRefresh } from '@/composables/useLiveRefresh'
import { useTeamDirectoryStore } from '@/stores/teamDirectory'
import { materialTransferApi } from '@/services/materialTransferApi'
import {
  materialTypeLabel,
  materialTypeOptions,
  type MaterialTransfer,
  type MaterialTransferListParams,
  type MaterialTransferListResponse,
} from '@/types/materialTransfer'
import { sharedSerialLabel } from '@/types/sharedMaterial'
import { formatAmount, formatDateTime } from '@/utils/format'
import { loadExportPages, tableExportSource } from '@/utils/tableExport'

const route = useRoute(),
  router = useRouter(),
  directory = useTeamDirectoryStore()
const filterKeys = [
  'serial_no',
  'inventory_team_id',
  'source_team_id',
  'material_name',
  'material_type',
  'date_from',
  'date_to',
] as const
type Filters = Partial<Record<(typeof filterKeys)[number], string>>
const text = (key: string) => (typeof route.query[key] === 'string' ? String(route.query[key]) : '')
const filters = computed<Filters>(() =>
  Object.fromEntries(filterKeys.map((key) => [key, text(key)])),
)
const page = computed(() => Math.max(1, Number(text('page')) || 1))
const pageSize = computed(() =>
  [10, 20, 50, 100].includes(Number(text('page_size'))) ? Number(text('page_size')) : 20,
)
const params = computed<MaterialTransferListParams>(() => ({
  internal_only: true,
  status: 'pending',
  query: text('query') || undefined,
  serial_no: filters.value.serial_no || undefined,
  next_team_id: filters.value.inventory_team_id || undefined,
  source_team_id: filters.value.source_team_id || undefined,
  material_query: filters.value.material_name || undefined,
  material_type: (filters.value.material_type ||
    undefined) as MaterialTransferListParams['material_type'],
  date_from: filters.value.date_from || undefined,
  date_to: filters.value.date_to || undefined,
  page: page.value,
  page_size: pageSize.value,
}))
const result = ref<MaterialTransferListResponse | null>(null),
  loading = ref(false),
  error = ref(''),
  refreshError = ref('')
const queryDraft = ref(''),
  filtersOpen = ref(false),
  draft = ref<Filters>({}),
  filterError = ref('')
const selected = ref<MaterialTransfer | null>(null)
let generation = 0
const total = ref(0)
const teamName = (id?: string) => directory.items.find((team) => String(team.id) === id)?.name || id
const chips = computed(() =>
  filterKeys
    .filter((key) => filters.value[key])
    .map((key) => ({
      key,
      label: {
        serial_no: `流水号 ${filters.value.serial_no}`,
        inventory_team_id: `接收班组 ${teamName(filters.value.inventory_team_id)}`,
        source_team_id: `来源班组 ${teamName(filters.value.source_team_id)}`,
        material_name: `材质 ${filters.value.material_name}`,
        material_type: materialTypeLabel(filters.value.material_type),
        date_from: `转出自 ${filters.value.date_from}`,
        date_to: `转出至 ${filters.value.date_to}`,
      }[key],
    })),
)
async function navigate(next: Record<string, string | number | undefined>) {
  await router.replace({
    path: route.path,
    query: Object.fromEntries(
      Object.entries({ view: 'incoming', ...next })
        .filter(([, value]) => value != null && value !== '')
        .map(([key, value]) => [key, String(value)]),
    ),
  })
}
function search() {
  const query = queryDraft.value.trim()
  if (query === text('query') && !text('serial_no')) return load(true)
  return navigate({
    ...filters.value,
    query,
    serial_no: undefined,
    page: 1,
    page_size: pageSize.value,
  })
}
function openFilters() {
  draft.value = { ...filters.value }
  filterError.value = ''
}
function resetFilters() {
  draft.value = {}
  filterError.value = ''
}
async function applyFilters() {
  if (draft.value.date_from && draft.value.date_to && draft.value.date_from > draft.value.date_to) {
    filterError.value = '开始日期不能晚于结束日期'
    return
  }
  filtersOpen.value = false
  await navigate({ ...draft.value, query: text('query'), page: 1, page_size: pageSize.value })
}
async function load(background = false) {
  const current = ++generation
  loading.value = true
  error.value = ''
  refreshError.value = ''
  if (!background) result.value = null
  try {
    const data = await materialTransferApi.list(params.value)
    if (current !== generation) return
    total.value = data.total
    if (page.value > 1 && !data.items.length) {
      await navigate({
        ...filters.value,
        query: text('query'),
        page: Math.max(1, Math.ceil(data.total / pageSize.value)),
        page_size: pageSize.value,
      })
      return
    }
    result.value = data
  } catch (e) {
    if (current !== generation) return
    if (background && result.value) refreshError.value = '待签收更新失败，当前为上次查询结果'
    else error.value = e instanceof Error ? e.message : '待签收读取失败，请重试'
  } finally {
    if (current === generation) loading.value = false
  }
}
watch(
  params,
  () => {
    queryDraft.value = text('query') || text('serial_no')
    selected.value = null
    void load()
  },
  { immediate: true },
)
const live = useLiveRefresh(() => load(true), { busy: () => loading.value || !!selected.value })
onBeforeUnmount(() => {
  ++generation
})
const columns = [
  {
    key: 'source',
    label: '来源班组',
    width: 120,
    value: (row: MaterialTransfer) => row.source_team.name,
  },
  {
    key: 'quantity',
    label: '待签收数量（件）',
    width: 145,
    numeric: true,
    value: (row: MaterialTransfer) => row.quantity,
  },
  {
    key: 'weight',
    label: '待签收重量（kg）',
    width: 150,
    numeric: true,
    value: (row: MaterialTransfer) => row.weight,
  },
  { key: 'batch_no', label: '批次号', width: 200, value: (row: MaterialTransfer) => row.batch_no },
  {
    key: 'material_name',
    label: '材质',
    width: 130,
    value: (row: MaterialTransfer) => row.material_name || '—',
  },
  {
    key: 'material_type',
    label: '物料类型',
    width: 110,
    value: (row: MaterialTransfer) => materialTypeLabel(row.material_type),
  },
  {
    key: 'transfer_specification',
    label: '实际尺寸',
    width: 150,
    value: (row: MaterialTransfer) => row.transfer_specification || '—',
  },
  {
    key: 'transferred_at',
    label: '转出时间',
    width: 170,
    value: (row: MaterialTransfer) => formatDateTime(row.transferred_at),
  },
]
function exportSource() {
  const snapshot = { ...params.value }
  return tableExportSource(
    '全厂待签收明细',
    total.value,
    [
      { key: 'serial_no', label: '流水号', value: sharedSerialLabel },
      { key: 'next_team', label: '接收班组', value: (row: MaterialTransfer) => row.next_team.name },
      ...columns,
    ],
    (signal, progress) =>
      loadExportPages(
        (page, page_size) => materialTransferApi.list({ ...snapshot, page, page_size }),
        signal,
        progress,
      ),
  )
}
</script>

<template>
  <WorkspaceDataPanel>
    <WorkspaceDataToolbar
      v-model="queryDraft"
      search-label="搜索待签收"
      placeholder="流水号、批次号或材质"
      :maxlength="160"
      :loading="loading"
      refresh-label="刷新待签收"
      @search="search"
      @refresh="load(true)"
    >
      <template #filters>
        <FilterDialog
          v-model="filtersOpen"
          :count="chips.length"
          @open="openFilters"
          @apply="applyFilters"
          @reset="resetFilters"
        >
          <label
            >流水号<AppInput
              v-model="draft.serial_no"
              aria-label="筛选流水号"
              placeholder="完整流水号"
              clearable
              maxlength="80"
          /></label>
          <label
            >接收班组<AppSelect
              v-model="draft.inventory_team_id"
              aria-label="接收班组"
              placeholder="全部班组"
              clearable
              filterable
              ><ElOption
                v-for="team in directory.items"
                :key="team.id"
                :value="String(team.id)"
                :label="team.name" /></AppSelect
          ></label>
          <label
            >来源班组<AppSelect
              v-model="draft.source_team_id"
              aria-label="来源班组"
              placeholder="全部来源班组"
              clearable
              filterable
              ><ElOption
                v-for="team in directory.items"
                :key="team.id"
                :value="String(team.id)"
                :label="team.name" /></AppSelect
          ></label>
          <label
            >材质<AppInput
              v-model="draft.material_name"
              aria-label="材质"
              placeholder="全部材质"
              clearable
              maxlength="160"
          /></label>
          <label
            >物料类型<AppSelect
              v-model="draft.material_type"
              aria-label="物料类型"
              placeholder="全部类型"
              clearable
              ><ElOption
                v-for="type in materialTypeOptions"
                :key="type.value"
                :value="type.value"
                :label="type.label" /></AppSelect
          ></label>
          <label
            >转出开始日期<AppDatePicker
              v-model="draft.date_from"
              aria-label="转出开始日期"
              type="date"
              value-format="YYYY-MM-DD"
          /></label>
          <label
            >转出结束日期<AppDatePicker
              v-model="draft.date_to"
              aria-label="转出结束日期"
              type="date"
              value-format="YYYY-MM-DD"
          /></label>
          <AppAlert
            v-if="filterError"
            class="filter-wide"
            :title="filterError"
            type="error"
            :closable="false"
          />
        </FilterDialog>
      </template>
      <template #tools
        ><TableExportButton :source="exportSource" :context="params" :disabled="loading || !total"
      /></template>
    </WorkspaceDataToolbar>
    <div v-if="chips.length" class="incoming-filter-chips">
      <ElTag
        v-for="chip in chips"
        :key="chip.key"
        closable
        @close="
          navigate({
            ...filters,
            query: text('query'),
            [chip.key]: undefined,
            page: 1,
            page_size: pageSize,
          })
        "
        >{{ chip.label }}</ElTag
      >
    </div>
    <LiveRefreshNotice :message="live.message.value" />
    <AppAlert v-if="refreshError" :title="refreshError" type="warning" :closable="false" />
    <StatePanel v-if="loading && !result" state="loading" title="正在读取待签收" />
    <StatePanel v-else-if="error" state="error" :title="error"
      ><AppButton @click="load()">重试</AppButton></StatePanel
    >
    <WorkspaceTable
      columns-key="SerialIncomingInventory-1"
      v-else
      :data="result?.items || []"
      row-key="id"
      aria-label="全厂待签收明细"
      empty-text="暂无符合条件的待签收物料"
    >
      <ElTableColumn label="流水号" fixed min-width="155"
        ><template #default="{ row }"
          ><AppButton link @click="selected = row as MaterialTransfer">{{
            sharedSerialLabel(row)
          }}</AppButton></template
        ></ElTableColumn
      >
      <ElTableColumn label="接收班组" fixed width="110"
        ><template #default="{ row }">{{ row.next_team.name }}</template></ElTableColumn
      >
      <ElTableColumn
        v-for="column in columns"
        :key="column.key"
        :label="column.label"
        :min-width="column.width"
        :align="column.numeric ? 'right' : 'left'"
        ><template #default="{ row }">{{
          column.numeric
            ? formatAmount(column.value(row as MaterialTransfer))
            : column.value(row as MaterialTransfer)
        }}</template></ElTableColumn
      >
      <ElTableColumn label="操作" width="90" fixed="right"
        ><template #default="{ row }"
          ><AppButton link @click="selected = row as MaterialTransfer">明细</AppButton></template
        ></ElTableColumn
      >
    </WorkspaceTable>
    <WorkspacePagination
      :current-page="page"
      :page-size="pageSize"
      :total="total"
      :disabled="loading"
      @change="
        (page, size) => navigate({ ...filters, query: text('query'), page, page_size: size })
      "
    />
    <MaterialTransferDrawer
      :model-value="!!selected"
      :transfer="selected"
      :show-history-group="false"
      @update:model-value="!$event && (selected = null)"
      @changed="load(true)"
    />
  </WorkspaceDataPanel>
</template>

<style scoped>
.incoming-filter-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding-block: 10px;
}
</style>
