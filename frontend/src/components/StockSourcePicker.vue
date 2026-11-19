<script setup lang="ts">
import ElInput from '@/components/AppInput.vue'
import WorkspacePagination from '@/components/WorkspacePagination.vue'
import AppDialog from '@/components/AppDialog.vue'
import { sharedSerialLabel } from '@/types/sharedMaterial'
import FilterDialog from './FilterDialog.vue'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Search } from '@element-plus/icons-vue'
import { ElTableColumn, ElTag } from 'element-plus'
import ElTable from '@/components/watermelon/WatermelonDataTable.vue'
import ElButton from '@/components/AppButton.vue'
import { inventoryAmount } from '@/types/teamInventory'
import RecordDateFilter from './RecordDateFilter.vue'
import StatePanel from './StatePanel.vue'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import type { StockBatch } from '@/types/teamMaterials'
import { processingRoleLabels, type ProcessingRole } from '@/types/materialProcessing'
import { isScrapType, materialTypeLabel } from '@/types/materialTransfer'
import { dispatchableAmounts, stockSelectable } from '@/utils/materialStock'
import { currentLocations } from '@/utils/warehousePlacement'
import { formatScheduleBatch } from '@/utils/scheduleBatch'

const props = defineProps<{
  teamId: number
  mode: 'reallocate' | 'loss' | 'shipment'
  processing?: boolean
}>()
const emit = defineEmits<{ close: []; selected: [source: StockBatch] }>()
const labels = computed(
  () =>
    ({
      loss: { title: '登记丢失', action: '登记丢失', search: '丢失库存搜索' },
      reallocate: { title: '流水号转投', action: '转投', search: '转投库存搜索' },
      shipment: { title: '汇总发货', action: '选择', search: '发货库存搜索' },
    })[props.mode],
)
function singleSelectable(row: StockBatch) {
  if (!stockSelectable(row)) return false
  if (props.mode === 'shipment')
    return !row.transfer.shared_unallocated && !isScrapType(row.transfer.material_type)
  return props.mode !== 'reallocate' || !row.transfer.shared_unallocated
}
const visible = ref(true)
const query = ref(''),
  appliedQuery = ref(''),
  page = ref(1),
  pageSize = ref(20)
const rows = ref<StockBatch[]>([]),
  total = ref(0),
  loading = ref(false),
  error = ref('')
const dates = ref({ from: '', to: '' })
const filterOpen = ref(false),
  dateDraft = ref({ from: '', to: '' })
const filterCount = computed(() => Number(Boolean(dates.value.from || dates.value.to)))
function syncFilters() {
  dateDraft.value = { ...dates.value }
}
function applyFilters() {
  dates.value = { ...dateDraft.value }
  filterOpen.value = false
  search()
}
const filtered = computed(() => !!(appliedQuery.value || dates.value.from || dates.value.to))
const emptyTitle = computed(() => (filtered.value ? '没有符合筛选条件的来源批次' : '暂无来源批次'))
let version = 0
function asStock(row: unknown) {
  return row as StockBatch
}
function search() {
  appliedQuery.value = query.value.trim()
  page.value = 1
  void load()
}
function paginate(value: number, size = pageSize.value) {
  page.value = value
  pageSize.value = size
  void load()
}
async function load() {
  const current = ++version
  loading.value = true
  error.value = ''
  rows.value = []
  try {
    const result = await teamMaterialApi.stock(props.teamId, {
      availability: 'dispatchable',
      date_from: dates.value.from || undefined,
      date_to: dates.value.to || undefined,
      query: appliedQuery.value || undefined,
      page: page.value,
      page_size: pageSize.value,
    })
    if (current !== version) return
    rows.value = result.items
    total.value = result.total
  } catch (e) {
    if (current === version) error.value = e instanceof Error ? e.message : '库存加载失败，请重试'
  } finally {
    if (current === version) loading.value = false
  }
}
function chooseSource(row: StockBatch) {
  if (!loading.value && !error.value && singleSelectable(row)) emit('selected', row)
}
watch(
  () => props.teamId,
  () => {
    dates.value = { from: '', to: '' }
    page.value = 1
    query.value = ''
    appliedQuery.value = ''
    void load()
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  ++version
})
</script>

<template>
  <AppDialog
    v-model="visible"
    :title="`${labels.title} · 选择来源批次`"
    width="min(1040px, 94vw)"
    top="6vh"
    class="stock-source-picker"
    @closed="emit('close')"
  >
    <div class="picker-toolbar">
      <ElInput
        v-model="query"
        :prefix-icon="Search"
        :aria-label="labels.search"
        placeholder="搜索流水号、批次号、材质或仓位"
        clearable
        @keyup.enter="search"
        @clear="search"
      />
      <FilterDialog
        v-slot="{ appendTo }"
        v-model="filterOpen"
        title="来源批次筛选"
        :count="filterCount"
        @open="syncFilters"
        @cancel="syncFilters"
        @apply="applyFilters"
        @reset="
          () => {
            dateDraft = { from: '', to: '' }
          }
        "
        ><label
          >接收日期<RecordDateFilter
            :append-to="appendTo"
            v-model="dateDraft"
            label="接收日期" /></label
      ></FilterDialog>
      <ElButton class="action-warm" @click="search">查询</ElButton>
    </div>
    <div class="picker-table">
      <StatePanel v-if="error" state="error" :description="error" @retry="load" />
      <StatePanel v-else-if="loading" state="loading" title="正在读取可用库存" />
      <ElTable
        columns-key="StockSourcePicker-1"
        class="business-table"
        v-else
        :data="rows"
        row-key="transfer.id"
        height="100%"
        stripe
      >
        <template #empty
          ><div class="picker-empty" role="status">
            <strong>{{ emptyTitle }}</strong>
            <p>{{ filtered ? '请调整搜索条件或日期后重试。' : '暂无已签收来源批次。' }}</p>
          </div></template
        >
        <ElTableColumn label="流水号" min-width="245" show-overflow-tooltip
          ><template #default="{ row }">{{
            sharedSerialLabel(row.transfer)
          }}</template></ElTableColumn
        >
        <ElTableColumn prop="transfer.task_batch_number" label="排期批次" min-width="130">
          <template #default="{ row }">{{
            row.transfer.task_batch_number ? formatScheduleBatch(row.transfer) : '未关联排期'
          }}</template>
        </ElTableColumn>
        <ElTableColumn label="来源批次" min-width="170" show-overflow-tooltip
          ><template #default="{ row }">{{ row.transfer.batch_no }}</template></ElTableColumn
        >
        <ElTableColumn
          v-if="rows.some((item) => item.transfer.next_team.code === 'FACTORY-WAREHOUSE')"
          label="当前仓位"
          min-width="160"
          show-overflow-tooltip
          ><template #default="{ row }">{{
            currentLocations(asStock(row))
          }}</template></ElTableColumn
        >
        <ElTableColumn label="加工任务" min-width="120" show-overflow-tooltip
          ><template #default="{ row }">{{
            row.transfer.purpose_name || '未分类'
          }}</template></ElTableColumn
        >
        <ElTableColumn label="材质" min-width="140" show-overflow-tooltip
          ><template #default="{ row }">{{
            row.transfer.material_name || '—'
          }}</template></ElTableColumn
        >
        <ElTableColumn label="物料类型" min-width="110" show-overflow-tooltip
          ><template #default="{ row }">{{
            materialTypeLabel(row.transfer.material_type)
          }}</template></ElTableColumn
        >
        <ElTableColumn
          v-if="
            processing && rows.some((row) => row.processing_role || row.transfer.processing_role)
          "
          label="加工分类"
          min-width="110"
          show-overflow-tooltip
          ><template #default="{ row }">{{
            processingRoleLabels[
              (row.processing_role || row.transfer.processing_role) as ProcessingRole
            ] || '—'
          }}</template></ElTableColumn
        >
        <ElTableColumn
          v-if="
            rows.some((row) => row.current_specification || row.transfer.transfer_specification)
          "
          label="尺寸"
          min-width="180"
          show-overflow-tooltip
          ><template #default="{ row }">{{
            row.current_specification ?? row.transfer.transfer_specification ?? '—'
          }}</template></ElTableColumn
        >
        <ElTableColumn
          v-if="rows.some((row) => row.inspection_hold_id)"
          label="巡检状态"
          min-width="180"
          align="center"
        >
          <template #default="{ row }"
            ><ElTag v-if="row.inspection_hold_id" type="danger">待处理 · 禁止转出</ElTag
            ><span v-else>—</span></template
          >
        </ElTableColumn>
        <ElTableColumn label="账面件数" min-width="130" align="center"
          ><template #default="{ row }">{{
            inventoryAmount(dispatchableAmounts(asStock(row)).quantity)
          }}</template></ElTableColumn
        >
        <ElTableColumn label="账面重量 (kg)" min-width="160" align="center"
          ><template #default="{ row }">{{
            inventoryAmount(dispatchableAmounts(asStock(row)).weight)
          }}</template></ElTableColumn
        >
        <ElTableColumn label="操作" width="100" align="center" fixed="right">
          <template #default="{ row }">
            <ElButton
              link
              type="primary"
              :disabled="!singleSelectable(asStock(row))"
              :aria-label="`${labels.action} ${row.transfer.batch_no}`"
              @click="chooseSource(asStock(row))"
              >{{ labels.action }}</ElButton
            >
          </template>
        </ElTableColumn>
      </ElTable>
    </div>
    <div class="picker-pagination">
      <WorkspacePagination
        :current-page="page"
        :page-size="pageSize"
        :page-sizes="[20, 50, 100]"
        :total="total"
        layout="sizes, prev, pager, next"
        @current-change="paginate($event)"
        @size-change="paginate(1, $event)"
        >共 {{ total }} 个来源批次</WorkspacePagination
      >
    </div>
    <template #footer><ElButton @click="visible = false">取消</ElButton></template>
  </AppDialog>
</template>

<style scoped>
.picker-toolbar,
.picker-pagination {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.picker-toolbar {
  margin-bottom: 12px;
}
.picker-toolbar > .el-input {
  flex: 1 1 180px;
  max-width: 390px;
}
.picker-toolbar > span {
  margin-left: auto;
}
.picker-toolbar :deep(.el-button + .el-button) {
  margin-left: 0;
}
.picker-toolbar > span,
.picker-pagination > span {
  color: var(--muted);
  font-size: 12px;
}
.picker-table {
  height: min(52vh, 520px);
}
.picker-table :deep(.el-table__empty-text) {
  width: 100%;
  line-height: 1.6;
}
.picker-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 32px 20px;
  white-space: normal;
}
.picker-empty strong {
  color: var(--text);
  font-size: 17px;
  font-weight: 600;
}
.picker-empty p {
  margin: 0;
  color: var(--muted);
  font-size: 14px;
}
.picker-pagination {
  justify-content: space-between;
  padding-top: 12px;
}
.picker-pagination :deep(.el-pagination) {
  max-width: 100%;
  overflow-x: auto;
}
</style>
