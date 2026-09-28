<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Search } from '@element-plus/icons-vue'
import { ElButton, ElCheckbox, ElDialog, ElInput, ElPagination, ElTable, ElTableColumn } from 'element-plus'
import { inventoryAmount } from '@/types/teamInventory'
import RecordDateFilter from './RecordDateFilter.vue'
import SerialUrgencyBadge from './SerialUrgencyBadge.vue'
import StatePanel from './StatePanel.vue'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import type { StockBatch } from '@/types/teamMaterials'
import { materialTypeLabel } from '@/types/materialTransfer'
import { dispatchableAmounts, stockAvailable } from '@/utils/materialStock'
import { currentLocations } from '@/utils/warehousePlacement'
import { useBatchSelection } from '@/composables/useBatchSelection'
import BatchSelectionBar from './BatchSelectionBar.vue'

const props = defineProps<{ teamId: number; groupId?: number; groupLabel?: string }>()
const emit = defineEmits<{ close: []; selected: [sources: StockBatch[]]; outbound: [] }>()
const query = ref(''), appliedQuery = ref(''), page = ref(1), pageSize = ref(20)
const rows = ref<StockBatch[]>([]), total = ref(0), loading = ref(false), error = ref('')
const dates = ref({ from: '', to: '' }), urgentOnly = ref(false)
const filtered = computed(() => !!(appliedQuery.value || dates.value.from || dates.value.to || urgentOnly.value))
const pendingSummary = ref<{ count: number; quantity: number; weight: number; internal: boolean; external: boolean } | null>(null)
const emptyTitle = computed(() => {
  if (filtered.value) return '没有符合筛选条件的可出库物料'
  if (!pendingSummary.value) return '暂无可出库物料'
  return `当前库存已全部转出，等待${pendingSummary.value.external ? pendingSummary.value.internal ? '下序签收或对外确认' : '对外确认' : '下序签收'}`
})
const { selected, availableRows, checkedCount, allChecked, totals, toggle, toggleAll, reconcile } = useBatchSelection(rows, row => String(row.transfer.id), dispatchableAmounts)
let version = 0
function asStock(row: unknown) { return row as StockBatch }
function search() { appliedQuery.value = query.value.trim(); page.value = 1; void load() }
function paginate(value: number, size = pageSize.value) { page.value = value; pageSize.value = size; void load() }
async function load() {
  const current = ++version
  loading.value = true; error.value = ''; rows.value = []; pendingSummary.value = null
  try {
    const params = { date_from: dates.value.from || undefined, date_to: dates.value.to || undefined, urgent_only: urgentOnly.value || undefined, query: appliedQuery.value || undefined, page: page.value, page_size: pageSize.value }
    const result = props.groupId ? await teamMaterialApi.inventorySources(props.teamId, props.groupId, { ...params, current_only: true }) : await teamMaterialApi.stock(props.teamId, { ...params, availability: 'dispatchable' })
    if (current !== version) return
    rows.value = result.items; total.value = result.total
    reconcile(result.items)
    if (!props.groupId && !filtered.value && result.total === 0) {
      const teamId = props.teamId
      const overview = await teamMaterialApi.overview(teamId)
      if (current !== version) return
      const balance = overview.totals
      if (balance.on_hand_quantity === 0 && balance.on_hand_weight === 0 && balance.reserved_quantity != null && balance.reserved_weight != null && (balance.reserved_quantity > 0 || balance.reserved_weight > 0)) {
        const outbound = await teamMaterialApi.dispatches(teamId, { status: 'pending', page: 1, page_size: 1 })
        if (current !== version) return
        if (outbound.total > 0) pendingSummary.value = { count: outbound.total, quantity: balance.reserved_quantity, weight: balance.reserved_weight,
          internal: (balance.in_transit_quantity ?? 0) > 0 || (balance.in_transit_weight ?? 0) > 0,
          external: (balance.external_pending_quantity ?? 0) > 0 || (balance.external_pending_weight ?? 0) > 0 }
      }
    }
  } catch (e) { if (current === version) error.value = e instanceof Error ? e.message : '库存加载失败，请重试' }
  finally { if (current === version) loading.value = false }
}
function proceed() { if (!loading.value && !error.value && selected.size) emit('selected', [...selected.values()]) }
watch(() => [props.teamId, props.groupId], () => { selected.clear(); dates.value = { from: '', to: '' }; urgentOnly.value = false; page.value = 1; query.value = ''; appliedQuery.value = ''; void load() }, { immediate: true })
onBeforeUnmount(() => { ++version })
</script>

<template>
  <ElDialog :model-value="true" title="新建出库 · 选择库存物料" width="min(1040px, 94vw)" top="6vh" class="stock-source-picker" @close="emit('close')">
    <p v-if="groupLabel" class="picker-scope">{{ groupLabel }}</p>
    <div class="picker-toolbar">
      <ElInput v-model="query" :prefix-icon="Search" aria-label="出库库存搜索" placeholder="搜索流水号、批次、材质或仓位" clearable @keyup.enter="search" @clear="search" />
      <RecordDateFilter v-model="dates" label="接收日期" @update:model-value="search" /><ElCheckbox v-model="urgentOnly" @change="search">仅看加急</ElCheckbox>
      <ElButton @click="search">查询</ElButton>
    </div>
    <BatchSelectionBar :count="selected.size" :quantity="totals.quantity" :weight="totals.weight" :all-checked="allChecked" :partial="checkedCount > 0 && !allChecked" :disabled="loading || !availableRows.length || (selected.size >= 100 && !checkedCount)" @all="toggleAll" @clear="selected.clear()" />
    <div class="picker-table">
      <StatePanel v-if="error" state="error" :description="error" @retry="load" />
      <StatePanel v-else-if="loading" state="loading" title="正在读取可用库存" />
      <ElTable class="business-table" v-else :data="rows" row-key="transfer.id" height="100%" stripe>
        <template #empty><div class="picker-empty" role="status"><strong>{{ emptyTitle }}</strong><p v-if="pendingSummary">共 {{ inventoryAmount(pendingSummary.count) }} 批，{{ inventoryAmount(pendingSummary.quantity) }} 件，{{ inventoryAmount(pendingSummary.weight) }} kg，不能重复出库。</p><p v-else>{{ filtered ? '请调整搜索条件或日期后重试。' : '可以刷新查询，或返回库存明细核对物料状态。' }}</p><ElButton v-if="pendingSummary" type="primary" plain @click="emit('outbound')">查看出库记录</ElButton></div></template>
        <ElTableColumn width="46" class-name="stock-selection-column">
          <template #header><ElCheckbox aria-label="选择本页出库物料" :model-value="allChecked" :indeterminate="checkedCount > 0 && !allChecked" :disabled="!availableRows.length || (selected.size >= 100 && !checkedCount)" @change="toggleAll" /></template>
          <template #default="{ row }"><ElCheckbox :aria-label="`选择出库 ${row.transfer.batch_no}`" :model-value="selected.has(String(row.transfer.id))" :disabled="!stockAvailable(asStock(row)) || (selected.size >= 100 && !selected.has(String(row.transfer.id)))" @change="toggle(asStock(row), $event)" /></template>
        </ElTableColumn>
        <ElTableColumn label="流水号" min-width="245" show-overflow-tooltip><template #default="{ row }">{{ row.transfer.serial_no }}<SerialUrgencyBadge :urgency="row.transfer.urgency" /></template></ElTableColumn>
        <ElTableColumn label="来源批次" min-width="170" show-overflow-tooltip><template #default="{ row }">{{ row.transfer.batch_no }}</template></ElTableColumn>
        <ElTableColumn v-if="rows.some(item => item.transfer.next_team.code === 'FACTORY-WAREHOUSE')" label="当前仓位" min-width="160" show-overflow-tooltip><template #default="{ row }">{{ currentLocations(asStock(row)) }}</template></ElTableColumn>
        <ElTableColumn label="本班组业务" min-width="120" show-overflow-tooltip><template #default="{ row }">{{ row.transfer.purpose_name || '未分类' }}</template></ElTableColumn>
        <ElTableColumn label="材质" min-width="140" show-overflow-tooltip><template #default="{ row }">{{ row.transfer.material_name || '—' }}</template></ElTableColumn>
        <ElTableColumn label="物料类型" min-width="110" show-overflow-tooltip><template #default="{ row }">{{ materialTypeLabel(row.transfer.material_type) }}</template></ElTableColumn>
        <ElTableColumn label="可出库件数" min-width="130" align="center"><template #default="{ row }">{{ inventoryAmount(dispatchableAmounts(asStock(row)).quantity) }}</template></ElTableColumn>
        <ElTableColumn label="可出库重量 (kg)" min-width="160" align="center"><template #default="{ row }">{{ inventoryAmount(dispatchableAmounts(asStock(row)).weight) }}</template></ElTableColumn>
      </ElTable>
    </div>
    <div class="picker-pagination"><span>共 {{ total }} 个来源批次</span><ElPagination :current-page="page" :page-size="pageSize" :page-sizes="[20, 50, 100]" :total="total" layout="sizes, prev, pager, next" @current-change="paginate($event)" @size-change="paginate(1, $event)" /></div>
    <template #footer><span class="picker-batch-note">每条物料独立批次、独立条码，可合并打印</span><ElButton @click="emit('close')">取消</ElButton><ElButton type="primary" :disabled="!selected.size || loading || !!error" @click="proceed">下一步：填写出库</ElButton></template>
  </ElDialog>
</template>

<style scoped>
.picker-toolbar, .picker-pagination { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.picker-scope { margin: 0 0 16px; font-size: 16px; color: var(--text); }
.picker-toolbar { margin-bottom: 12px; }.picker-toolbar > .el-input { flex: 1 1 180px; max-width: 390px; }
.picker-toolbar > span { margin-left: auto; }.picker-toolbar :deep(.el-button + .el-button) { margin-left: 0; }
.picker-toolbar > span, .picker-pagination > span { color: var(--muted); font-size: 12px; }
.picker-table { height: min(52vh, 520px); }
.picker-table :deep(.el-table__empty-text) { width: 100%; line-height: 1.6; }
.picker-empty { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 32px 20px; white-space: normal; }
.picker-empty strong { color: var(--text); font-size: 17px; font-weight: 600; }
.picker-empty p { margin: 0; color: var(--muted); font-size: 14px; }
.picker-batch-note { float: left; color: var(--muted); font-size: 13px; line-height: 32px; }
.picker-pagination { justify-content: space-between; padding-top: 12px; }.picker-pagination :deep(.el-pagination) { max-width: 100%; overflow-x: auto; }
</style>
