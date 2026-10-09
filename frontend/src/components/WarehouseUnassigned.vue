<script setup lang="ts">
import WeightInput from './WeightInput.vue'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElAlert, ElButton, ElCheckbox, ElDialog, ElForm, ElFormItem, ElInput, ElInputNumber, ElOption, ElPagination, ElSelect, ElTable, ElTableColumn } from 'element-plus'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import { warehouseLocationApi, type WarehouseLocation } from '@/services/warehouseLocationApi'
import type { StockBatch } from '@/types/teamMaterials'
import { dispatchableAmounts, stockAvailable } from '@/utils/materialStock'
import { useBatchSelection } from '@/composables/useBatchSelection'
import BatchSelectionBar from './BatchSelectionBar.vue'
import { materialTypeLabel } from '@/types/materialTransfer'
import { showToast } from '@/stores/toast'

const props = defineProps<{ teamId: number; canDispatch?: boolean; refreshKey?: unknown }>()
const emit = defineEmits<{ view: [batchNo: string]; dispatch: [batchNo: string]; batchDispatch: [sourceIds: number[]]; changed: [] }>()
const rows = ref<StockBatch[]>([]), total = ref(0), page = ref(1), query = ref(''), error = ref(''), loading = ref(false)
const selected = ref<StockBatch | null>(null), slots = ref<WarehouseLocation[]>([]), locationId = ref<number>()
const currentSlot = computed(() => slots.value.find(slot => slot.id === locationId.value))
const slotAmount = (key: 'quantity' | 'weight') => (currentSlot.value?.batches.filter(batch => batch.status === 'received').reduce((sum, batch) => sum + batch[key], 0) || 0).toLocaleString('zh-CN', { maximumFractionDigits: 6 })
const quantity = ref<number>(), weight = ref<number>(), saving = ref(false), formError = ref('')
const { selected: checked, availableRows, checkedCount, allChecked, totals, toggle, toggleAll, reconcile } = useBatchSelection(rows, row => String(row.transfer.id), dispatchableAmounts)
function batchDispatch() { if (props.canDispatch && checked.size && !loading.value && !error.value) emit('batchDispatch', [...checked.values()].map(row => Number(row.transfer.id))) }
let generation = 0, slotGeneration = 0, disposed = false
function asStock(row: unknown) { return row as StockBatch }
async function load() {
  const current = ++generation
  loading.value = true
  try {
    const result = await teamMaterialApi.stock(props.teamId, { availability: 'all', location_status: 'unassigned', query: query.value, page: page.value, page_size: 10 })
    if (current !== generation) return
    rows.value = result.items; reconcile(result.items); total.value = result.total; error.value = ''
  } catch (e) { if (current === generation) error.value = e instanceof Error ? e.message : '未分配物料加载失败' }
  finally { if (current === generation) loading.value = false }
}
async function findSlots(query = '') {
  const current = ++slotGeneration
  const stock = selected.value?.transfer
  if (!stock) return
  try {
    const result = await teamMaterialApi.warehouseLocations(props.teamId, query, '', { serial_no: stock.serial_no, material_name: stock.material_name || '', material_type: stock.material_type || '' })
    if (current !== slotGeneration) return
    slots.value = result.items.filter(row => row.active && !row.draft_locked)
    if (!query && !locationId.value) locationId.value = slots.value[0]?.id
  }
  catch (e) { if (current === slotGeneration) formError.value = e instanceof Error ? e.message : '空闲仓位加载失败' }
}
function open(row: StockBatch) {
  selected.value = row; locationId.value = undefined; slots.value = []; formError.value = ''
  quantity.value = row.unassigned_quantity; weight.value = row.unassigned_weight; void findSlots()
}
async function assign() {
  const row = selected.value, slot = slots.value.find(item => item.id === locationId.value)
  if (!row || saving.value) return
  if (!slot) { formError.value = '请选择可用仓位'; return }
  if (quantity.value === undefined || weight.value === undefined || quantity.value < 0 || weight.value < 0 || quantity.value + weight.value <= 0) { formError.value = '请填写要放入仓位的件数和重量，不能同时为零'; return }
  saving.value = true; formError.value = ''
  try {
    await warehouseLocationApi.place(slot.id, { source_transfer_id: Number(row.transfer.id), expected_version: slot.version, quantity: quantity.value, weight: weight.value })
    if (disposed) return
    selected.value = null; showToast('仓位已安排', 'success'); emit('changed'); await load()
  } catch (e) { if (!disposed) formError.value = e instanceof Error ? e.message : '安排仓位失败' }
  finally { saving.value = false }
}
function search() { page.value = 1; void load() }
watch(() => [props.teamId, props.refreshKey], () => { if (!selected.value) void load() }, { immediate: true })
watch(() => [props.teamId, props.canDispatch], () => checked.clear())
onBeforeUnmount(() => { disposed = true; ++generation; ++slotGeneration })
</script>

<template>
  <section class="unassigned-stock">
    <div class="unassigned-tools"><ElInput v-model="query" aria-label="搜索未分配物料" placeholder="流水号、批次或材质" clearable @keyup.enter="search" @clear="search" /><ElButton :loading="loading" @click="search">查询</ElButton></div>
    <ElAlert v-if="error" :title="error" type="error" :closable="false" />
    <BatchSelectionBar v-if="canDispatch" :count="checked.size" :quantity="totals.quantity" :weight="totals.weight" :all-checked="allChecked" :partial="checkedCount > 0 && !allChecked" :disabled="loading || !availableRows.length || (checked.size >= 100 && !checkedCount)" @all="toggleAll" @clear="checked.clear()"><ElButton type="primary" :disabled="!checked.size || loading || !!error" @click="batchDispatch">批量出库</ElButton></BatchSelectionBar>
    <ElTable :data="rows" row-key="transfer.id" class="business-table" empty-text="没有未分配仓位的物料">
      <ElTableColumn v-if="canDispatch" width="50"><template #default="{ row }"><ElCheckbox :aria-label="`选择未分配物料 ${row.transfer.batch_no}`" :model-value="checked.has(String(row.transfer.id))" :disabled="loading || !stockAvailable(asStock(row)) || (checked.size >= 100 && !checked.has(String(row.transfer.id)))" @change="toggle(asStock(row), $event)" /></template></ElTableColumn>
      <ElTableColumn label="批次号" min-width="200"><template #default="{ row }"><ElButton link type="primary" @click="emit('view', row.transfer.batch_no)">{{ row.transfer.batch_no }}</ElButton></template></ElTableColumn>
      <ElTableColumn label="流水号" min-width="150" prop="transfer.serial_no" />
      <ElTableColumn label="材质" min-width="130" prop="transfer.material_name" />
      <ElTableColumn label="类型" min-width="120"><template #default="{ row }">{{ materialTypeLabel(row.transfer.material_type) }}</template></ElTableColumn>
      <ElTableColumn label="未分配件数" min-width="130" prop="unassigned_quantity" align="center" />
      <ElTableColumn label="未分配重量（kg）" min-width="170" prop="unassigned_weight" align="center" />
      <ElTableColumn label="操作" :width="canDispatch ? 180 : 110" fixed="right"><template #default="{ row }"><ElButton link type="primary" @click="open(asStock(row))">安排仓位</ElButton><ElButton v-if="canDispatch" link type="primary" :disabled="!stockAvailable(asStock(row))" @click="emit('dispatch', row.transfer.batch_no)">转出</ElButton></template></ElTableColumn>
    </ElTable>
    <footer><span>共 {{ total }} 批</span><ElPagination v-model:current-page="page" :page-size="10" :total="total" layout="prev, pager, next" @current-change="load" /></footer>
    <ElDialog :model-value="!!selected" title="安排仓位" width="min(480px, 94vw)" :close-on-click-modal="!saving" :show-close="!saving" :close-on-press-escape="!saving" @update:model-value="!$event && (selected = null)">
      <ElForm label-position="top"><p>{{ selected?.transfer.batch_no }}</p>
        <ElFormItem label="仓位" required><ElSelect v-model="locationId" filterable remote :remote-method="findSlots" aria-label="选择空闲仓位" placeholder="选择或搜索仓位" :disabled="saving"><ElOption v-for="slot in slots" :key="slot.id" :value="slot.id" :label="slot.name" /></ElSelect></ElFormItem>
        <p v-if="currentSlot?.batches.length">当前库存 {{ slotAmount('quantity') }} 件 · {{ slotAmount('weight') }} kg · {{ currentSlot.batches.length }} 批</p>
        <div class="dialog-form-grid">
        <ElFormItem label="件数" required><ElInputNumber v-model="quantity" :min="0" :max="selected?.unassigned_quantity" :precision="0" :disabled="saving" aria-label="安排仓位件数" controls-position="right"><template #suffix><span class="dialog-input-unit">件</span></template></ElInputNumber></ElFormItem>
        <ElFormItem label="重量" required><WeightInput v-model="weight" :max="selected?.unassigned_weight" :disabled="saving" ariaLabel="安排仓位重量" /></ElFormItem>
        </div>
        <ElAlert v-if="formError" :title="formError" type="error" :closable="false" />
      </ElForm>
      <template #footer><ElButton :disabled="saving" @click="selected = null">取消</ElButton><ElButton type="primary" :loading="saving" @click="assign">确认安排</ElButton></template>
    </ElDialog>
  </section>
</template>

<style scoped>
.unassigned-stock { display: flex; flex: 1; flex-direction: column; min-height: 0; }
.unassigned-tools, footer { display: flex; align-items: center; gap: 12px; margin-block: 12px; }
.unassigned-tools .el-input { max-width: 320px; }
footer { justify-content: space-between; margin-top: auto; padding-top: 20px; color: var(--muted); }
.el-select { width: 100%; }
</style>
