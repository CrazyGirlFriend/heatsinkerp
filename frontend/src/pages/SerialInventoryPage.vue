<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElOption, ElTableColumn, ElTag } from 'element-plus'
import AppAlert from '@/components/AppAlert.vue'
import AppButton from '@/components/AppButton.vue'
import AppInput from '@/components/AppInput.vue'
import AppNumberInput from '@/components/AppNumberInput.vue'
import AppSelect from '@/components/AppSelect.vue'
import FilterDialog from '@/components/FilterDialog.vue'
import InventoryColumnSettings from '@/components/InventoryColumnSettings.vue'
import InventoryPendingDialog from '@/components/InventoryPendingDialog.vue'
import LiveRefreshNotice from '@/components/LiveRefreshNotice.vue'
import PageBackButton from '@/components/PageBackButton.vue'
import StatePanel from '@/components/StatePanel.vue'
import TableExportButton from '@/components/TableExportButton.vue'
import TeamInventoryDetail from '@/components/TeamInventoryDetail.vue'
import WorkspaceDataPanel from '@/components/WorkspaceDataPanel.vue'
import WorkspaceDataToolbar from '@/components/WorkspaceDataToolbar.vue'
import WorkspacePagination from '@/components/WorkspacePagination.vue'
import WorkspaceTable from '@/components/WorkspaceTable.vue'
import { useLiveRefresh } from '@/composables/useLiveRefresh'
import { useTeamDirectoryStore } from '@/stores/teamDirectory'
import { useAuthStore } from '@/stores/auth'
import {
  serialInventoryApi as api,
  type GlobalInventory,
  type GlobalInventoryParams,
  type GlobalInventoryRow,
} from '@/services/serialInventoryApi'
import { warehouseColumns, inventorySourceLabel } from '@/types/teamInventory'
import { sharedSerialLabel } from '@/types/sharedMaterial'
import { materialTypeOptions } from '@/types/materialTransfer'
import type { InventoryColumnChoice } from '@/types/inventoryColumns'
import { formatDateTime } from '@/utils/format'
import { loadExportPages, tableExportSource } from '@/utils/tableExport'

const route = useRoute(),
  router = useRouter(),
  directory = useTeamDirectoryStore(),
  auth = useAuthStore()
const text = (key: string) => (typeof route.query[key] === 'string' ? String(route.query[key]) : '')
const number = (key: string) =>
  text(key) !== '' && Number.isFinite(Number(text(key))) ? Number(text(key)) : undefined
const params = computed<GlobalInventoryParams>(() => ({
  query: text('query') || undefined,
  serial_no: text('serial_no') || undefined,
  team_id: number('inventory_team_id'),
  material_name: text('material_name') || undefined,
  material_type: text('material_type') || undefined,
  stock_age_min: number('stock_age_min'),
  stock_age_max: number('stock_age_max'),
  page: Math.max(1, number('page') || 1),
  page_size: [10, 20, 50, 100].includes(number('page_size') || 0) ? number('page_size') : 20,
}))
const result = ref<GlobalInventory | null>(null),
  loading = ref(false),
  error = ref(''),
  refreshError = ref('')
const queryDraft = ref(''),
  filtersOpen = ref(false),
  filterError = ref('')
const draft = ref<GlobalInventoryParams>({})
const detail = ref<GlobalInventoryRow | null>(null),
  pending = ref<GlobalInventoryRow | null>(null)
const columnSettings = ref<{ open: (anchor?: HTMLElement) => void }>()
let generation = 0
const total = computed(() => result.value?.total || 0)

function ageLabel(row: GlobalInventoryRow) {
  const hours = row.stock_age_hours
  if (hours == null) return '—'
  if (hours < 1) return '不足1小时'
  const days = Math.floor(hours / 24),
    rest = Math.floor(hours % 24)
  return days ? `${days}天${rest ? `${rest}小时` : ''}` : `${rest}小时`
}
const defaults = [
  'owned_quantity',
  'owned_weight',
  'material_name',
  'material_type',
  'transfer_specification',
]
const widths: Record<string, number> = {
  owned_quantity: 110,
  owned_weight: 125,
  material_name: 135,
  material_type: 110,
  transfer_specification: 150,
}
const columns = [
  ...warehouseColumns
    .filter((c) => !['delivery_due_at', 'delivery_schedule_status'].includes(c.key))
    .map((c) => ({
      ...c,
      width: widths[c.key] || c.width,
      defaultVisible: defaults.includes(c.key),
      format: (row: GlobalInventoryRow) =>
        c.key === 'source'
          ? inventorySourceLabel(row, row.team_code === 'FACTORY-WAREHOUSE')
          : c.format(row),
    })),
  { key: 'stock_age', label: '滞留时间', width: 135, defaultVisible: true, format: ageLabel },
]
// Keep quantities beside the serial, with supplementary properties available in column settings.
columns.sort((a, b) => {
  const order = [...defaults, 'stock_age']
  return (
    (order.indexOf(a.key) < 0 ? 99 : order.indexOf(a.key)) -
    (order.indexOf(b.key) < 0 ? 99 : order.indexOf(b.key))
  )
})
const choices = ref<InventoryColumnChoice<string>[]>(
  columns.map((c) => ({ key: c.key, visible: c.defaultVisible })),
)
const visibleColumns = computed(() =>
  choices.value
    .filter((c) => c.visible)
    .flatMap((c) => columns.filter((column) => column.key === c.key)),
)
const chips = computed(() => {
  const p = params.value
  const list: { keys: (keyof GlobalInventoryParams)[]; label: string }[] = []
  if (p.serial_no) list.push({ keys: ['serial_no'], label: `流水号 ${p.serial_no}` })
  if (p.team_id)
    list.push({
      keys: ['team_id'],
      label: directory.items.find((t) => Number(t.id) === p.team_id)?.name || `班组 ${p.team_id}`,
    })
  if (p.material_name) list.push({ keys: ['material_name'], label: `材质 ${p.material_name}` })
  if (p.material_type)
    list.push({
      keys: ['material_type'],
      label: materialTypeOptions.find((t) => t.value === p.material_type)?.label || p.material_type,
    })
  if (p.stock_age_min != null || p.stock_age_max != null)
    list.push({
      keys: ['stock_age_min', 'stock_age_max'],
      label: `滞留 ${p.stock_age_min ?? 0}${p.stock_age_max != null ? `～${p.stock_age_max}天` : '天及以上'}`,
    })
  return list
})
async function navigate(next: GlobalInventoryParams) {
  const query: Record<string, string> = {}
  for (const [key, value] of Object.entries(next)) {
    if (value != null && value !== '')
      query[key === 'team_id' ? 'inventory_team_id' : key] = String(value)
  }
  await router.replace({ path: route.path, query })
}
async function search() {
  const query = queryDraft.value.trim()
  if (query === (params.value.query || '') && !params.value.serial_no) return refresh()
  await navigate({ ...params.value, query: query || undefined, serial_no: undefined, page: 1 })
}
function openFilters() {
  draft.value = { ...params.value }
  filterError.value = ''
}
async function applyFilters() {
  const { stock_age_min: min, stock_age_max: max } = draft.value
  if (min != null && max != null && min > max) {
    filterError.value = '滞留时间下限不能大于上限'
    return
  }
  filtersOpen.value = false
  await navigate({ ...draft.value, page: 1 })
}
function resetFilters() {
  draft.value = { query: params.value.query, page_size: params.value.page_size }
  filterError.value = ''
}
async function removeChip(keys: (keyof GlobalInventoryParams)[]) {
  const next = { ...params.value, page: 1 }
  keys.forEach((key) => delete next[key])
  await navigate(next)
}
async function load(background = false) {
  const current = ++generation
  loading.value = true
  error.value = ''
  refreshError.value = ''
  if (!background) result.value = null
  try {
    const data = await api.stock(params.value)
    if (current !== generation) return
    if (data.total > 0 && !data.items.length && (params.value.page || 1) > 1) {
      await navigate({
        ...params.value,
        page: Math.max(1, Math.ceil(data.total / (params.value.page_size || 20))),
      })
      return
    }
    result.value = data
  } catch (e) {
    if (current !== generation) return
    if (background && result.value) refreshError.value = '库存更新失败，当前为上次查询结果'
    else error.value = e instanceof Error ? e.message : '库存读取失败，请重试'
  } finally {
    if (current === generation) loading.value = false
  }
}
async function refresh() {
  await load(true)
}
watch(
  params,
  () => {
    queryDraft.value = params.value.query || params.value.serial_no || ''
    detail.value = null
    pending.value = null
    void load()
  },
  { immediate: true },
)
const live = useLiveRefresh(refresh, {
  busy: () => loading.value || !!detail.value || !!pending.value,
})
onBeforeUnmount(() => {
  ++generation
})
function viewSchedule(id?: number, serialNo?: string) {
  if (!detail.value) return
  void router.push({
    path: `/team-workspaces/${detail.value.team_id}`,
    query: {
      tab: 'delivery-schedule',
      ...(id ? { schedule_id: String(id) } : {}),
      ...(serialNo ? { serial_no: serialNo } : {}),
    },
  })
}
function exportSource() {
  const filters = { ...params.value }
  const fields = [
    { key: 'serial_no', label: '流水号', selected: true, value: sharedSerialLabel },
    {
      key: 'team_name',
      label: '所在班组',
      selected: true,
      value: (row: GlobalInventoryRow) => row.team_name,
    },
    ...columns.map((c) => ({
      key: c.key,
      label: c.label,
      selected: visibleColumns.value.some((v) => v.key === c.key),
      value: (row: GlobalInventoryRow) => {
        const value = c.format(row)
        const numeric = 'numeric' in c && c.numeric ? Number(value.replaceAll(',', '')) : NaN
        return Number.isFinite(numeric) ? numeric : value
      },
    })),
  ]
  return tableExportSource('全厂库存明细', total.value, fields, (signal, progress) =>
    loadExportPages(
      (page, pageSize) => api.stock({ ...filters, page, page_size: pageSize }),
      signal,
      progress,
    ),
  )
}
</script>

<template>
  <section class="page workspace-page serial-inventory-page">
    <header class="inventory-header">
      <PageBackButton />
      <h1>流水号查询</h1>
    </header>
    <WorkspaceDataPanel>
      <WorkspaceDataToolbar
        v-model="queryDraft"
        search-label="搜索库存"
        placeholder="流水号、材质、规格或业务"
        :maxlength="160"
        :loading="loading"
        columns
        refresh-label="刷新库存"
        @search="search"
        @refresh="refresh"
        @columns="columnSettings?.open($event)"
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
              >所在班组<AppSelect
                v-model="draft.team_id"
                aria-label="所在班组"
                placeholder="全部班组"
                clearable
                filterable
                ><ElOption
                  v-for="team in directory.items"
                  :key="team.id"
                  :value="Number(team.id)"
                  :label="team.name" /></AppSelect
            ></label>
            <label
              >流水号<AppInput
                v-model="draft.serial_no"
                aria-label="筛选流水号"
                placeholder="完整流水号"
                clearable
                maxlength="80"
            /></label>
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
              >滞留至少（天）<AppNumberInput
                v-model="draft.stock_age_min"
                aria-label="滞留至少（天）"
                :min="0"
                :max="36500"
                :precision="1"
                :controls="false"
                placeholder="不限"
            /></label>
            <label
              >滞留至多（天）<AppNumberInput
                v-model="draft.stock_age_max"
                aria-label="滞留至多（天）"
                :min="0"
                :max="36500"
                :precision="1"
                :controls="false"
                placeholder="不限"
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
          ><TableExportButton
            :source="exportSource"
            :context="params"
            :disabled="loading || !total"
        /></template>
      </WorkspaceDataToolbar>
      <InventoryColumnSettings
        ref="columnSettings"
        :storage-key="`global-inventory-columns:${auth.currentUser?.id || 'local'}`"
        :columns="columns"
        :show-trigger="false"
        @change="choices = $event"
      />
      <div v-if="chips.length" class="inventory-filter-chips">
        <ElTag
          v-for="chip in chips"
          :key="chip.keys.join()"
          closable
          @close="removeChip(chip.keys)"
          >{{ chip.label }}</ElTag
        >
      </div>
      <LiveRefreshNotice :message="live.message.value" />
      <AppAlert v-if="refreshError" :title="refreshError" type="warning" :closable="false" />
      <StatePanel v-if="loading && !result" state="loading" title="正在读取库存" />
      <StatePanel v-else-if="error" state="error" :title="error"
        ><AppButton @click="load()">重试</AppButton></StatePanel
      >
      <WorkspaceTable
        v-else
        :data="result?.items || []"
        row-key="group_id"
        aria-label="全厂库存明细"
        empty-text="暂无符合条件的库存"
      >
        <ElTableColumn label="流水号" fixed min-width="155"
          ><template #default="{ row }"
            ><AppButton link class="inventory-serial" @click="detail = row as GlobalInventoryRow">{{
              sharedSerialLabel(row)
            }}</AppButton></template
          ></ElTableColumn
        >
        <ElTableColumn prop="team_name" label="所在班组" width="100" fixed />
        <ElTableColumn
          v-for="column in visibleColumns"
          :key="column.key"
          :label="column.label"
          :min-width="column.width"
          :align="'numeric' in column && column.numeric ? 'right' : 'left'"
        >
          <template #default="{ row }"
            ><span
              :title="
                column.key === 'stock_age'
                  ? `最早在库批次接收于 ${formatDateTime(row.oldest_received_at)}`
                  : undefined
              "
              >{{ column.format(row as GlobalInventoryRow) }}</span
            ></template
          >
        </ElTableColumn>
        <ElTableColumn label="操作" width="100" fixed="right"
          ><template #default="{ row }"
            ><AppButton link @click="detail = row as GlobalInventoryRow">明细</AppButton></template
          ></ElTableColumn
        >
      </WorkspaceTable>
      <WorkspacePagination
        :current-page="params.page || 1"
        :page-size="params.page_size || 20"
        :total="total"
        :disabled="loading"
        @change="(page, size) => navigate({ ...params, page, page_size: size })"
      />
    </WorkspaceDataPanel>
    <TeamInventoryDetail
      v-if="detail"
      :team-id="detail.team_id"
      :group="detail"
      :warehouse="detail.team_code === 'FACTORY-WAREHOUSE'"
      :processing="detail.team_code !== 'FACTORY-WAREHOUSE'"
      @close="detail = null"
      @pending="pending = detail"
      @schedule="viewSchedule"
    />
    <InventoryPendingDialog
      v-if="pending"
      :team-id="pending.team_id"
      :group="pending"
      @close="pending = null"
    />
  </section>
</template>

<style scoped>
.serial-inventory-page {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  gap: 16px;
}
.inventory-header {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}
.inventory-header h1 {
  margin: 0;
  font-size: 20px;
}
.inventory-filter-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding-block: 10px;
}
.inventory-serial {
  font-weight: 600;
}
</style>
