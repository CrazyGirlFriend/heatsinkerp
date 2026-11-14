<script setup lang="ts">
import { useTableQuery } from '@/composables/useTableQuery'
import { queryColumns } from '@/utils/tableQueryColumns'
import ElEmpty from '@/components/AppEmpty.vue'
import ElAlert from '@/components/AppAlert.vue'
import ElInput from '@/components/AppInput.vue'
import WatermelonWarehouseToolbar from './watermelon/WatermelonWarehouseToolbar.vue'
import WatermelonDataTable from './watermelon/WatermelonDataTable.vue'
import WatermelonDialog from './watermelon/WatermelonDialog.vue'
import WatermelonButton from './watermelon/WatermelonButton.vue'
import WatermelonBadge from './watermelon/WatermelonBadge.vue'
import WatermelonPagination from './watermelon/WatermelonPagination.vue'
import WatermelonSegmented from './watermelon/WatermelonSegmented.vue'
import WatermelonSwitch from './watermelon/WatermelonSwitch.vue'
import './watermelon/watermelon.css'
import { sharedSerialLabel } from '@/types/sharedMaterial'
import { formatAmount } from '@/utils/format'
import { useDialogValidation } from '@/composables/useDialogValidation'
import TableExportButton from './TableExportButton.vue'
import { loadExportPages, tableExportSource } from '@/utils/tableExport'
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ElCheckbox, ElForm, ElFormItem, ElTableColumn, ElResult } from 'element-plus'
import ElButton from '@/components/AppButton.vue'
import { IconPlus, IconPencil } from '@tabler/icons-vue'
import { showToast } from '@/stores/toast'
import {
  locationState,
  warehouseLocationApi,
  type WarehouseLocation,
} from '@/services/warehouseLocationApi'
import WarehousePlacementDialog from './WarehousePlacementDialog.vue'
import {
  loadWarehouseCatalog,
  catalogSerial,
  catalogAmount,
  type WarehouseCatalogRow,
  type WarehouseCatalogFilter,
} from '@/services/warehouseCatalog'
import type { StockBatch } from '@/types/teamMaterials'
import { dispatchableAmounts } from '@/utils/materialStock'
import BatchSelectionBar from './BatchSelectionBar.vue'
import { useBatchSelection } from '@/composables/useBatchSelection'
import { materialTypeLabel } from '@/types/materialTransfer'
import { formatDateTime } from '@/utils/format'

const props = defineProps<{
  canManage: boolean
  canDispatch?: boolean
  teamId?: number
  refreshKey?: unknown
}>()
const emit = defineEmits<{
  view: [batchNo: string]
  dispatch: [batchNo: string]
  batchDispatch: [sourceIds: number[]]
}>()
const pageSize = ref(20)
// The same detail view also accepts unassigned stock, which has no location yet.
type Batch = Omit<
  WarehouseLocation['batches'][number],
  'location_id' | 'available_quantity' | 'available_weight' | 'created_at' | 'received_at'
> & {
  available_quantity?: number
  available_weight?: number
  created_at?: string
  received_at?: string | null
}
const entries = ref<WarehouseCatalogRow[]>([])
const placement = ref<StockBatch | null>(null)
const rows = computed(() => entries.value.flatMap((row) => (row.location ? [row.location] : [])))
const total = ref(0),
  page = ref(1)
const query = ref(''),
  appliedQuery = ref(''),
  filter = ref<WarehouseCatalogFilter>(),
  appliedFilter = ref<WarehouseCatalogFilter>()
const tableQuery = useTableQuery(
  {
    ...queryColumns([
      ['仓位', 'name'],
      ['流水号', 'serial_no'],
      ['在库件数', 'quantity', 'number'],
      ['在库重量（kg）', 'weight', 'number'],
      ['在库批次', 'received', 'number'],
      ['待签收批次', 'pending', 'number'],
    ]),
    分配状态: {
      field: 'assignment',
      kind: 'select',
      options: [
        { value: 'assigned', label: '已分配' },
        { value: 'unassigned', label: '未分配' },
        { value: 'empty', label: '空仓位' },
      ],
    },
    仓位状态: {
      field: 'status',
      kind: 'select',
      options: [
        { value: 'occupied', label: '有料' },
        { value: 'available', label: '空闲' },
        { value: 'pending', label: '待签收' },
        { value: 'draft', label: '填写中' },
        { value: 'disabled', label: '停用' },
      ],
    },
  },
  () => {
    page.value = 1
    void load()
  },
)
function exportSource() {
  const query = appliedQuery.value,
    state = appliedFilter.value,
    teamId = props.teamId,
    columnQuery = tableQuery.params.value.table_query
  return tableExportSource(
    '仓位库存',
    total.value,
    [
      {
        key: 'name',
        label: '仓位',
        value: (row: WarehouseCatalogRow) => row.location?.name || '—',
      },
      { key: 'serial_no', label: '流水号', value: catalogSerial },
      {
        key: 'material_name',
        label: '材质',
        value: (row) =>
          row.stock?.transfer.material_name ||
          [
            ...new Set(row.location?.batches.map((batch) => batch.material_name).filter(Boolean)),
          ].join('、'),
      },
      {
        key: 'material_type',
        label: '物料类型',
        value: (row) =>
          row.stock
            ? materialTypeLabel(row.stock.transfer.material_type)
            : [
                ...new Set(
                  row.location!.batches.map((batch) => materialTypeLabel(batch.material_type)),
                ),
              ].join('、'),
      },
      { key: 'assignment', label: '分配状态', value: assignmentLabel },
      {
        key: 'status',
        label: '仓位状态',
        value: (row) => (row.location ? stateLabel(row.location) : '—'),
      },
      { key: 'quantity', label: '在库件数', value: (row) => catalogAmount(row, 'quantity') },
      { key: 'weight', label: '在库重量 (kg)', value: (row) => catalogAmount(row, 'weight') },
      {
        key: 'received',
        label: '在库批次',
        value: (row) => (row.stock ? 1 : received(row.location!).length),
      },
      {
        key: 'pending',
        label: '待签收批次',
        value: (row) => (row.stock ? 0 : pending(row.location!).length),
      },
      {
        key: 'batch_no',
        label: '批次号',
        value: (row) =>
          row.stock?.transfer.batch_no ||
          row.location!.batches.map((batch) => batch.batch_no).join('、'),
      },
    ],
    (signal, progress) =>
      loadExportPages(
        (page, pageSize) => loadWarehouseCatalog(query, page, pageSize, state, teamId, columnQuery),
        signal,
        progress,
      ),
  )
}
const error = ref(''),
  loading = ref(false),
  saving = ref(false),
  editorOpen = ref(false),
  formError = ref('')
const editing = ref<WarehouseLocation | null>(null),
  form = reactive({ name: '', active: true })
const editingTitle = computed(() => (editing.value ? '编辑仓位' : '新增仓位'))
const detailOpen = ref(false),
  detailId = ref<number>(),
  detailTab = ref<'received' | 'pending'>('received')
const detail = computed(() => rows.value.find((row) => row.id === detailId.value))
const received = (row: WarehouseLocation): Batch[] =>
  row.batches.filter((batch) => batch.status === 'received')
const pending = (row: WarehouseLocation): Batch[] =>
  row.batches.filter((batch) => batch.status === 'pending')
const stocked = (row: WarehouseLocation) =>
  received(row).some((batch) => batch.quantity > 0 || batch.weight > 0)
const amount = (row: WarehouseLocation, key: 'quantity' | 'weight') =>
  formatAmount(received(row).reduce((sum, batch) => sum + batch[key], 0))
const detailBatches = computed(() =>
  detail.value
    ? detailTab.value === 'received'
      ? received(detail.value)
      : pending(detail.value)
    : [],
)
const {
  selected,
  available,
  availableRows,
  checkedCount,
  allChecked,
  totals,
  toggle,
  toggleAll,
  reconcile,
} = useBatchSelection(
  detailBatches,
  (row) => String(row.id),
  (row) => ({
    quantity: row.status === 'received' ? (row.available_quantity ?? null) : null,
    weight: row.status === 'received' ? (row.available_weight ?? null) : null,
  }),
)
function assignmentLabel(row: WarehouseCatalogRow) {
  return row.stock ? '未分配' : row.location!.batches.length ? '已分配' : '—'
}
function stockBatch(stock: StockBatch): Batch {
  const available = dispatchableAmounts(stock)
  return {
    ...stock.transfer,
    id: Number(stock.transfer.id),
    material_name: stock.transfer.material_name ?? null,
    material_type: stock.transfer.material_type ?? null,
    shared_group_id: stock.transfer.shared_group_id ?? null,
    shared_unallocated: stock.transfer.shared_unallocated ?? false,
    status: 'received',
    quantity: stock.unassigned_quantity ?? 0,
    weight: stock.unassigned_weight ?? 0,
    available_quantity: available.quantity ?? undefined,
    available_weight: available.weight ?? undefined,
  }
}
const unassignedBatches = computed(() =>
  entries.value.flatMap((row) => (row.stock ? [stockBatch(row.stock)] : [])),
)
const selectableUnassigned = computed(() => unassignedBatches.value.filter(available))
const unassignedCheckedCount = computed(
  () => selectableUnassigned.value.filter((row) => selected.has(String(row.id))).length,
)
const allUnassignedChecked = computed(
  () =>
    !!selectableUnassigned.value.length &&
    unassignedCheckedCount.value === selectableUnassigned.value.length,
)
function toggleUnassigned(checked: string | number | boolean) {
  selectableUnassigned.value.forEach((row) => toggle(row, checked))
}
function selectable(batch: Batch) {
  return available(batch) && (selected.has(String(batch.id)) || selected.size < 100)
}
function batchDispatch() {
  if (!props.canDispatch || !selected.size || loading.value || error.value) return
  detailOpen.value = false
  emit(
    'batchDispatch',
    [...selected.values()].map((row) => row.id),
  )
}
function view(batch: Batch) {
  detailOpen.value = false
  emit('view', batch.batch_no)
}
function dispatch(batch: Batch) {
  if (!props.canDispatch || !available(batch) || loading.value || error.value) return
  detailOpen.value = false
  emit('dispatch', batch.batch_no)
}
function openDetail(row: WarehouseLocation) {
  detailId.value = row.id
  detailTab.value = received(row).length ? 'received' : pending(row).length ? 'pending' : 'received'
  detailOpen.value = true
}
function stateLabel(row: WarehouseLocation) {
  if (!row.active) return '停用'
  if (row.draft_locked) return '填写中'
  if (!stocked(row) && pending(row).length) return '待签收'
  return locationState[row.status]
}
function stateTone(row: WarehouseLocation) {
  if (!row.active) return 'neutral'
  if (row.draft_locked) return 'warning'
  if (stocked(row)) return 'success'
  return pending(row).length ? 'info' : 'neutral'
}
let version = 0,
  disposed = false
let timer: ReturnType<typeof setInterval> | undefined
async function load(background = false) {
  if (
    !props.canManage ||
    disposed ||
    (background &&
      (loading.value || saving.value || editorOpen.value || !!placement.value || document.hidden))
  )
    return
  const current = ++version
  if (!background) loading.value = true
  try {
    const data = await loadWarehouseCatalog(
      appliedQuery.value.trim(),
      page.value,
      pageSize.value,
      appliedFilter.value,
      props.teamId,
      tableQuery.params.value.table_query,
    )
    if (current !== version) return
    const locations = data.items.flatMap((row) => (row.location ? [row.location] : []))
    const nextIds = new Set(locations.map((row) => row.id))
    // Keep other pages selected, but drop batches removed from a refreshed slot.
    for (const row of rows.value)
      if (nextIds.has(row.id)) {
        for (const batch of row.batches)
          if (
            !locations.some((item) => item.batches.some((value) => value.id === batch.id)) &&
            !data.items.some((item) => item.stock && Number(item.stock.transfer.id) === batch.id)
          )
            selected.delete(String(batch.id))
      }
    entries.value = data.items
    reconcile([...locations.flatMap((row) => row.batches), ...unassignedBatches.value])
    total.value = data.total
    error.value = ''
    if (page.value > 1 && !data.items.length) {
      page.value = Math.max(1, Math.ceil(data.total / pageSize.value))
      await load()
      return
    }
    if (detailOpen.value && !detail.value) detailOpen.value = false
  } catch (failure) {
    if (current === version)
      error.value = failure instanceof Error ? failure.message : '仓位加载失败'
  } finally {
    if (current === version) loading.value = false
  }
}
function search() {
  appliedQuery.value = query.value
  appliedFilter.value = filter.value
  page.value = 1
  void load()
}
function reset() {
  query.value = ''
  filter.value = undefined
  search()
}

const validation = useDialogValidation((): Record<string, string> =>
  form.name.trim() ? {} : { name: '请填写仓位名称' },
)
const { formRef, fieldErrors } = validation
function edit(row: WarehouseLocation | null = null) {
  if (!props.canManage || row?.draft_locked) return
  detailOpen.value = false
  editing.value = row
  form.name = row?.name || ''
  form.active = row?.active ?? true
  formError.value = ''
  validation.reset()
  editorOpen.value = true
}
async function save() {
  if (saving.value || !props.canManage) return
  formError.value = ''
  if (!validation.validate()) return
  saving.value = true
  formError.value = ''
  try {
    await warehouseLocationApi.save(
      {
        name: form.name.trim(),
        active: form.active,
        ...(editing.value ? { expected_version: editing.value.version } : {}),
      },
      editing.value?.id,
    )
    if (disposed) return
    editorOpen.value = false
    showToast('仓位已保存', 'success')
    await load()
  } catch (failure) {
    if (!disposed) formError.value = failure instanceof Error ? failure.message : '保存失败'
  } finally {
    saving.value = false
  }
}
watch(
  () => props.canManage,
  (value) => {
    if (!value) {
      ++version
      entries.value = []
      placement.value = null
      total.value = 0
      selected.clear()
      editorOpen.value = false
      detailOpen.value = false
    } else void load()
  },
)
watch(
  () => [props.teamId, props.canDispatch],
  () => {
    selected.clear()
    detailOpen.value = false
  },
)
watch(
  () => props.refreshKey,
  () => {
    void load(true)
  },
)
onMounted(() => {
  void load()
  timer = setInterval(() => void load(true), 10_000)
})
onBeforeUnmount(() => {
  disposed = true
  ++version
  clearInterval(timer)
})
</script>

<template>
  <section class="warehouse-management wm-scope">
    <ElResult v-if="!canManage" icon="warning" title="仅库房账号和管理员可以设置仓位" />
    <template v-else>
      <div class="warehouse-card">
        <WatermelonWarehouseToolbar
          v-model="query"
          :state="appliedFilter"
          :loading="loading"
          @search="search"
          @refresh="load()"
          @reset="reset"
          @state="
            (value) => {
              filter = value
              search()
            }
          "
        >
          <template #tools>
            <TableExportButton
              :source="exportSource"
              :disabled="loading || !!error"
              :context="[teamId, appliedQuery, appliedFilter].join('|')"
            />
          </template>
          <template #actions>
            <WatermelonButton
              v-if="canDispatch && selected.size"
              :disabled="loading || !!error"
              @click="batchDispatch"
              >批量出库（{{ selected.size }}）</WatermelonButton
            >
          </template>
          <template #primary-actions>
            <WatermelonButton class="warehouse-add" primary @click="edit()"
              ><IconPlus :size="16" />新增仓位</WatermelonButton
            >
          </template>
        </WatermelonWarehouseToolbar>
        <ElAlert v-if="error" :title="error" type="error" :closable="false" />
        <WatermelonDataTable
          columns-key="WarehouseManagement-1"
          :column-query="tableQuery.controller.value"
          :data="entries"
          :loading="loading"
          fill
          embedded
          row-key="key"
          class="warehouse-table"
          :empty-text="loading ? '正在加载仓位' : '没有符合条件的记录'"
        >
          <ElTableColumn
            v-if="canDispatch && selectableUnassigned.length"
            width="46"
            fixed="left"
            class-name="wm-table-selection"
          >
            <template #header
              ><ElCheckbox
                aria-label="选择本页未分配物料"
                :model-value="allUnassignedChecked"
                :indeterminate="unassignedCheckedCount > 0 && !allUnassignedChecked"
                :disabled="loading || !!error || !selectableUnassigned.length"
                @change="toggleUnassigned"
            /></template>
            <template #default="{ row }"
              ><ElCheckbox
                v-if="row.stock"
                :aria-label="`选择未分配物料 ${row.stock.transfer.batch_no}`"
                :model-value="selected.has(String(row.stock.transfer.id))"
                :disabled="loading || !!error || !selectable(stockBatch(row.stock))"
                @change="toggle(stockBatch(row.stock), $event)"
            /></template>
          </ElTableColumn>
          <ElTableColumn label="仓位" min-width="124" fixed="left">
            <template #default="{ row }">
              <ElButton
                v-if="row.location"
                class="warehouse-location-link wm-table-primary"
                link
                :disabled="loading || !!error"
                :aria-label="`${row.location.name}，查看详情`"
                aria-haspopup="dialog"
                @click="openDetail(row.location)"
                >{{ row.location.name }}</ElButton
              >
              <span v-else class="wm-table-muted">—</span>
            </template>
          </ElTableColumn>
          <ElTableColumn label="流水号" min-width="168" show-overflow-tooltip>
            <template #default="{ row }"
              ><ElButton
                v-if="row.stock"
                class="wm-table-primary"
                link
                @click="emit('view', row.stock.transfer.batch_no)"
                >{{ catalogSerial(row as WarehouseCatalogRow) }}</ElButton
              ><span v-else>{{ catalogSerial(row as WarehouseCatalogRow) }}</span></template
            >
          </ElTableColumn>
          <ElTableColumn label="分配状态" width="104">
            <template #default="{ row }"
              ><WatermelonBadge
                v-if="assignmentLabel(row as WarehouseCatalogRow) !== '—'"
                :tone="row.stock ? 'warning' : 'success'"
                >{{ assignmentLabel(row as WarehouseCatalogRow) }}</WatermelonBadge
              ><span v-else class="wm-table-muted">—</span></template
            >
          </ElTableColumn>
          <ElTableColumn label="仓位状态" width="104">
            <template #default="{ row }"
              ><WatermelonBadge v-if="row.location" :tone="stateTone(row.location)">{{
                stateLabel(row.location)
              }}</WatermelonBadge
              ><span v-else class="wm-table-muted">—</span></template
            >
          </ElTableColumn>
          <ElTableColumn label="在库件数" min-width="112" align="right">
            <template #default="{ row }"
              ><span
                :class="{
                  'wm-table-muted': !catalogAmount(row as WarehouseCatalogRow, 'quantity'),
                }"
                >{{ formatAmount(catalogAmount(row as WarehouseCatalogRow, 'quantity')) }}</span
              ></template
            ></ElTableColumn
          >
          <ElTableColumn label="在库重量（kg）" min-width="144" align="right">
            <template #default="{ row }"
              ><span
                :class="{ 'wm-table-muted': !catalogAmount(row as WarehouseCatalogRow, 'weight') }"
                >{{ formatAmount(catalogAmount(row as WarehouseCatalogRow, 'weight')) }}</span
              ></template
            ></ElTableColumn
          >
          <ElTableColumn label="在库批次" width="100" align="right">
            <template #default="{ row }"
              ><span :class="{ 'wm-table-muted': !row.stock && !received(row.location).length }">{{
                row.stock ? 1 : received(row.location).length
              }}</span></template
            ></ElTableColumn
          >
          <ElTableColumn label="待签收批次" width="120" align="right">
            <template #default="{ row }"
              ><span
                :class="{
                  'warehouse-pending': row.location && pending(row.location).length,
                  'wm-table-muted': !row.location || !pending(row.location).length,
                }"
                >{{ row.location ? pending(row.location).length : 0 }}</span
              ></template
            ></ElTableColumn
          >
          <ElTableColumn
            label="操作"
            :width="canDispatch ? 154 : 112"
            align="center"
            fixed="right"
            class-name="warehouse-actions-column"
          >
            <template #default="{ row }">
              <template v-if="row.stock"
                ><ElButton
                  class="wm-table-action"
                  link
                  :disabled="loading || !!error"
                  @click="placement = row.stock"
                  >安排仓位</ElButton
                ><ElButton
                  v-if="canDispatch"
                  class="wm-table-action"
                  link
                  :disabled="loading || !!error || !available(stockBatch(row.stock))"
                  @click="dispatch(stockBatch(row.stock))"
                  >转出</ElButton
                ></template
              >
              <ElButton
                v-else
                class="wm-table-action"
                link
                :disabled="loading || !!error || row.location.draft_locked"
                :aria-label="`编辑仓位 ${row.location.name}`"
                @click="edit(row.location)"
                ><IconPencil :size="15" />编辑</ElButton
              >
            </template>
          </ElTableColumn>
        </WatermelonDataTable>
        <WatermelonPagination
          :current-page="page"
          :page-size="pageSize"
          :total="total"
          :disabled="loading"
          @current-change="
            (value) => {
              page = value
              load()
            }
          "
          @size-change="
            (value) => {
              pageSize = value
              page = 1
              load()
            }
          "
        />
      </div>
      <WarehousePlacementDialog
        v-if="teamId"
        v-model="placement"
        :team-id="teamId"
        @changed="load()"
      />
      <WatermelonDialog
        v-model="detailOpen"
        :title="(detail?.name || '') + ' · 仓位明细'"
        width="min(1120px, 94vw)"
        class="warehouse-detail-dialog"
      >
        <template #header
          ><div class="warehouse-detail-title">
            <h2>{{ detail?.name }} · 仓位明细</h2>
            <WatermelonBadge v-if="detail" :tone="stateTone(detail)">{{
              stateLabel(detail)
            }}</WatermelonBadge>
          </div></template
        >
        <template v-if="detail">
          <ElAlert v-if="error" :title="error" type="error" :closable="false" />
          <ElAlert
            v-if="detail.draft_locked"
            title="入库填写中，暂不能修改仓位"
            type="warning"
            :closable="false"
          />
          <template v-if="detail.batches.length">
            <div class="warehouse-detail-controls">
              <WatermelonSegmented
                v-model="detailTab"
                class="warehouse-detail-tabs"
                label="仓位批次"
                :options="[
                  { value: 'received', label: `在库 ${received(detail).length}` },
                  { value: 'pending', label: `待签收 ${pending(detail).length}` },
                ]"
              />
              <div class="warehouse-detail-totals">
                <span
                  >库存件数<strong>{{ amount(detail, 'quantity') }}</strong></span
                ><span
                  >库存重量（kg）<strong>{{ amount(detail, 'weight') }}</strong></span
                >
              </div>
            </div>
            <BatchSelectionBar
              v-if="canDispatch && detailTab === 'received'"
              class="warehouse-detail-selection"
              :count="selected.size"
              :quantity="totals.quantity"
              :weight="totals.weight"
              :all-checked="allChecked"
              :partial="checkedCount > 0 && !allChecked"
              :disabled="
                loading ||
                !!error ||
                !availableRows.length ||
                (selected.size >= 100 && !checkedCount)
              "
              @all="toggleAll"
              @clear="selected.clear()"
            >
              <WatermelonButton
                primary
                :disabled="!selected.size || loading || !!error"
                @click="batchDispatch"
                >批量出库</WatermelonButton
              >
            </BatchSelectionBar>
            <WatermelonDataTable
              columns-key="WarehouseManagement-2"
              :data="detailBatches"
              row-key="key"
              empty-text="暂无批次"
              class="warehouse-detail-table"
              max-height="360"
            >
              <ElTableColumn v-if="canDispatch && detailTab === 'received'" width="46" fixed="left"
                ><template #default="{ row: batch }"
                  ><ElCheckbox
                    :aria-label="'选择批次 ' + batch.batch_no"
                    :model-value="selected.has(String(batch.id))"
                    :disabled="loading || !selectable(batch as Batch) || !!error"
                    @change="toggle(batch as Batch, $event)" /></template
              ></ElTableColumn>
              <ElTableColumn label="批次号" min-width="170" fixed="left"
                ><template #default="{ row: batch }"
                  ><ElButton class="wm-table-primary" link @click="view(batch as Batch)">{{
                    batch.batch_no
                  }}</ElButton></template
                ></ElTableColumn
              >
              <ElTableColumn label="流水号" min-width="150"
                ><template #default="{ row: batch }">{{
                  sharedSerialLabel(batch)
                }}</template></ElTableColumn
              >
              <ElTableColumn prop="material_name" label="材质" min-width="105" />
              <ElTableColumn label="类型" min-width="100"
                ><template #default="{ row: batch }">{{
                  materialTypeLabel(batch.material_type)
                }}</template></ElTableColumn
              >
              <ElTableColumn prop="quantity" label="件数" align="right" min-width="80" />
              <ElTableColumn prop="weight" label="重量（kg）" align="right" min-width="115" />
              <ElTableColumn
                :label="detailTab === 'received' ? '签收时间' : '提交时间'"
                min-width="165"
                ><template #default="{ row: batch }">{{
                  formatDateTime(detailTab === 'received' ? batch.received_at : batch.created_at)
                }}</template></ElTableColumn
              >
              <ElTableColumn
                v-if="canDispatch && detailTab === 'received'"
                label="操作"
                width="70"
                align="center"
                fixed="right"
                ><template #default="{ row: batch }"
                  ><ElButton
                    class="wm-table-action"
                    link
                    :disabled="!available(batch as Batch) || loading || !!error"
                    @click="dispatch(batch as Batch)"
                    >转出</ElButton
                  ></template
                ></ElTableColumn
              >
            </WatermelonDataTable>
          </template>
          <ElEmpty
            v-else
            :description="
              detail.draft_locked
                ? '仓位正在被入库表单占用'
                : detail.active
                  ? '当前仓位没有物料'
                  : '此仓位已停用'
            "
            :image-size="64"
          />
        </template>
        <template #footer
          ><WatermelonButton
            :disabled="!detail || detail.draft_locked"
            @click="detail && edit(detail)"
            >编辑仓位</WatermelonButton
          ><WatermelonButton primary @click="detailOpen = false">关闭</WatermelonButton></template
        >
      </WatermelonDialog>
      <WatermelonDialog
        v-model="editorOpen"
        :title="editingTitle"
        width="min(440px, 94vw)"
        :close-on-click-modal="!saving"
        :close-on-press-escape="!saving"
        :show-close="!saving"
      >
        <ElForm ref="formRef" label-position="top" :show-message="false" @submit.prevent="save">
          <ElFormItem label="仓位名称" :error="fieldErrors.name" required
            ><ElInput
              v-model="form.name"
              aria-label="仓位名称"
              placeholder="例如：A区-01"
              maxlength="80"
              :disabled="saving"
            />
            <p v-if="fieldErrors.name" class="wm-field-error" role="alert">
              {{ fieldErrors.name }}
            </p></ElFormItem
          >
          <div class="warehouse-enabled">
            <span>启用仓位</span
            ><WatermelonSwitch
              v-model="form.active"
              label="启用仓位"
              :disabled="saving || !!editing?.batches.length"
            />
          </div>
          <p v-if="editing?.batches.length" class="warehouse-hint">有料时不能停用</p>
          <p v-if="formError" class="wm-field-error" role="alert">{{ formError }}</p>
        </ElForm>
        <template #footer
          ><WatermelonButton :disabled="saving" @click="editorOpen = false">取消</WatermelonButton
          ><WatermelonButton primary :loading="saving" @click="save"
            >保存</WatermelonButton
          ></template
        >
      </WatermelonDialog>
    </template>
  </section>
</template>

<style scoped>
.warehouse-management,
.warehouse-card {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.warehouse-card {
  padding: 20px;
  overflow: hidden;
  border: 1px solid var(--wm-border);
  border-radius: 12px;
  background: var(--wm-bg);
  box-shadow: 0 1px 2px #00000005;
}
.warehouse-card :deep(.warehouse-actions-column .cell) {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding-inline: 8px;
}
.warehouse-card :deep(.warehouse-actions-column .el-button + .el-button) {
  margin-left: 0;
}
.warehouse-card > .el-alert {
  flex-shrink: 0;
  margin-bottom: 12px;
}
.warehouse-pending {
  color: var(--wm-info-text, #356d9f);
  font-weight: 600;
}
.warehouse-detail-title,
.warehouse-detail-controls {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}
.warehouse-detail-controls {
  justify-content: space-between;
  margin-bottom: 16px;
}
.warehouse-detail-totals {
  display: flex;
  gap: 20px;
  font-size: 13px;
  color: var(--wm-muted, #71717a);
}
.warehouse-detail-totals strong {
  color: var(--wm-text, #18181b);
  font-size: 14px;
  margin-left: 8px;
  font-variant-numeric: tabular-nums;
}
.warehouse-detail-selection {
  margin-bottom: 12px;
}
.warehouse-enabled {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.warehouse-hint {
  color: var(--wm-muted, #71717a);
  font-size: 12px;
  margin: 8px 0 0;
}
</style>
