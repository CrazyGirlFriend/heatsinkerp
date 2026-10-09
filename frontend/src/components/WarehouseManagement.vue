<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ElAlert, ElButton, ElCard, ElCheckbox, ElDialog, ElEmpty, ElForm, ElFormItem, ElIcon, ElInput, ElOption, ElPagination, ElSelect, ElSwitch, ElTable, ElTableColumn, ElTag, ElResult } from 'element-plus'
import { Clock, Lock, Plus, Refresh, Search, CircleClose } from '@element-plus/icons-vue'
import { showToast } from '@/stores/toast'
import { locationState, warehouseLocationApi, type WarehouseLocation, type WarehouseLocationFilter } from '@/services/warehouseLocationApi'
import WarehouseUnassigned from './WarehouseUnassigned.vue'
import BatchSelectionBar from './BatchSelectionBar.vue'
import { useBatchSelection } from '@/composables/useBatchSelection'
import { materialTypeLabel } from '@/types/materialTransfer'
import { formatDateTime } from '@/utils/format'

const props = defineProps<{ canManage: boolean; canDispatch?: boolean; teamId?: number; refreshKey?: unknown }>()
const emit = defineEmits<{ view: [batchNo: string]; dispatch: [batchNo: string]; batchDispatch: [sourceIds: number[]] }>()
const pageSize = ref(50), gridRows = ref(5), grid = ref<HTMLElement>()
type Batch = WarehouseLocation['batches'][number]
const section = ref<'locations' | 'unassigned'>('locations')
const rows = ref<WarehouseLocation[]>([]), total = ref(0), page = ref(1)
const query = ref(''), appliedQuery = ref(''), filter = ref<WarehouseLocationFilter>(), appliedFilter = ref<WarehouseLocationFilter>()
const error = ref(''), loading = ref(false), saving = ref(false), editorOpen = ref(false), formError = ref('')
const editing = ref<WarehouseLocation | null>(null), form = reactive({ name: '', active: true })
const editingTitle = computed(() => editing.value ? '编辑仓位' : '新增仓位')
const detailOpen = ref(false), detailId = ref<number>(), detailTab = ref<'received' | 'pending'>('received')
const detail = computed(() => rows.value.find(row => row.id === detailId.value))
const received = (row: WarehouseLocation) => row.batches.filter(batch => batch.status === 'received')
const pending = (row: WarehouseLocation) => row.batches.filter(batch => batch.status === 'pending')
const stocked = (row: WarehouseLocation) => received(row).some(batch => batch.quantity > 0 || batch.weight > 0)
const amount = (row: WarehouseLocation, key: 'quantity' | 'weight') => received(row).reduce((sum, batch) => sum + batch[key], 0).toLocaleString('zh-CN', { maximumFractionDigits: 3 })
const detailBatches = computed(() => detail.value ? (detailTab.value === 'received' ? received(detail.value) : pending(detail.value)) : [])
const detailIdentity = computed(() => {
  const batches = detail.value?.batches || []
  return {
    serial: [...new Set(batches.map(batch => batch.serial_no))].join('、'),
    material: [...new Set(batches.map(batch => batch.material_name).filter(Boolean))].join('、'),
    type: [...new Set(batches.map(batch => materialTypeLabel(batch.material_type)))].join('、'),
  }
})
const { selected, available, availableRows, checkedCount, allChecked, totals, toggle, toggleAll, reconcile } = useBatchSelection(detailBatches, row => String(row.id), row => ({
  quantity: row.status === 'received' ? row.available_quantity ?? null : null,
  weight: row.status === 'received' ? row.available_weight ?? null : null,
}))
function selectable(batch: Batch) { return available(batch) && (selected.has(String(batch.id)) || selected.size < 100) }
function batchDispatch() {
  if (!props.canDispatch || !selected.size || loading.value || error.value) return
  detailOpen.value = false
  emit('batchDispatch', [...selected.values()].map(row => row.id))
}
function view(batch: Batch) { detailOpen.value = false; emit('view', batch.batch_no) }
function dispatch(batch: Batch) {
  if (!props.canDispatch || !available(batch) || loading.value || error.value) return
  detailOpen.value = false; emit('dispatch', batch.batch_no)
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
function cardLabel(row: WarehouseLocation) {
  return [row.name, stocked(row) ? '有料' : '空仓', pending(row).length ? '待签收' : '', row.draft_locked ? '填写中' : '', !row.active ? '停用' : '', '查看详情'].filter(Boolean).join('，')
}
let version = 0, disposed = false
let timer: ReturnType<typeof setInterval> | undefined
let resizeObserver: ResizeObserver | undefined, resizeTimer: ReturnType<typeof setTimeout> | undefined
function fitGrid() {
  if (!grid.value || disposed || !props.canManage || section.value !== 'locations') return false
  const height = grid.value.clientHeight
  if (!height) return false
  const style = getComputedStyle(grid.value), columns = style.gridTemplateColumns.split(' ').length
  const gap = parseFloat(style.rowGap) || 0, minimum = parseFloat(style.getPropertyValue('--slot-height')) || 70
  // Keep cards compact and request only the slots that fit the available area.
  gridRows.value = Math.max(1, Math.min(Math.floor((height + gap) / (minimum + gap)), Math.floor(100 / columns)))
  const size = columns * gridRows.value
  if (size === pageSize.value) return false
  pageSize.value = size; page.value = 1; void load()
  return true
}
watch(grid, element => { resizeObserver?.disconnect(); if (element) { resizeObserver?.observe(element); fitGrid() } }, { flush: 'post' })
async function load(background = false) {
  if (!props.canManage || disposed || background && (loading.value || saving.value || editorOpen.value || section.value !== 'locations' || document.hidden)) return
  const current = ++version
  if (!background) loading.value = true
  try {
    const data = await warehouseLocationApi.list(appliedQuery.value.trim(), page.value, pageSize.value, appliedFilter.value)
    if (current !== version) return
    const nextIds = new Set(data.items.map(row => row.id))
    // Keep other pages selected, but drop batches removed from a refreshed slot.
    for (const row of rows.value) if (nextIds.has(row.id)) {
      for (const batch of row.batches) if (!data.items.some(item => item.batches.some(value => value.id === batch.id))) selected.delete(String(batch.id))
    }
    rows.value = data.items; reconcile(data.items.flatMap(row => row.batches)); total.value = data.total; error.value = ''
    if (detailOpen.value && !detail.value) detailOpen.value = false
  } catch (failure) { if (current === version) error.value = failure instanceof Error ? failure.message : '仓位加载失败' }
  finally { if (current === version) loading.value = false }
}
function search() { appliedQuery.value = query.value; appliedFilter.value = filter.value; page.value = 1; void load() }
function reset() { query.value = ''; filter.value = undefined; search() }
function edit(row: WarehouseLocation | null = null) {
  if (!props.canManage || row?.draft_locked) return
  detailOpen.value = false
  editing.value = row; form.name = row?.name || ''; form.active = row?.active ?? true
  formError.value = ''; editorOpen.value = true
}
async function save() {
  if (saving.value || !props.canManage) return
  if (!form.name.trim()) { formError.value = '请填写仓位名称'; return }
  saving.value = true; formError.value = ''
  try {
    await warehouseLocationApi.save({ name: form.name.trim(), active: form.active, ...(editing.value ? { expected_version: editing.value.version } : {}) }, editing.value?.id)
    if (disposed) return
    editorOpen.value = false; showToast('仓位已保存', 'success'); await load()
  } catch (failure) { if (!disposed) formError.value = failure instanceof Error ? failure.message : '保存失败' }
  finally { saving.value = false }
}
watch(() => props.canManage, value => {
  if (!value) { ++version; rows.value = []; total.value = 0; selected.clear(); editorOpen.value = false; detailOpen.value = false }
  else void load()
})
watch(() => [props.teamId, props.canDispatch, section.value], () => { selected.clear(); detailOpen.value = false })
watch(() => props.refreshKey, () => { void load(true) })
onMounted(() => {
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => { clearTimeout(resizeTimer); resizeTimer = setTimeout(fitGrid, 150) })
    if (grid.value) resizeObserver.observe(grid.value)
  }
  if (!fitGrid()) void load()
  timer = setInterval(() => void load(true), 10_000)
})
onBeforeUnmount(() => { disposed = true; ++version; clearInterval(timer); clearTimeout(resizeTimer); resizeObserver?.disconnect() })
</script>

<template>
  <section class="warehouse-management">
    <ElResult v-if="!canManage" icon="warning" title="仅库房账号和管理员可以设置仓位" />
    <template v-else>
      <ElCard shadow="never" class="warehouse-card">
        <div class="warehouse-toolbar">
          <template v-if="section === 'locations'">
            <ElInput v-model="query" aria-label="搜索仓位" placeholder="仓位、流水号或材质" clearable :prefix-icon="Search" maxlength="80" @keyup.enter="search" @clear="search" />
            <ElSelect v-model="filter" aria-label="仓位状态" placeholder="全部状态" clearable><ElOption label="有料" value="occupied" /><ElOption label="空闲" value="available" /><ElOption label="待签收" value="pending" /><ElOption label="填写中" value="draft" /><ElOption label="停用" value="disabled" /></ElSelect>
            <ElButton type="primary" @click="search">查询</ElButton><ElButton text @click="reset">重置</ElButton>
          </template>
          <div class="warehouse-actions">
            <ElButton v-if="canDispatch && selected.size" :disabled="loading || !!error" @click="batchDispatch">批量出库（{{ selected.size }}）</ElButton>
            <ElButton v-if="teamId" text @click="section = section === 'locations' ? 'unassigned' : 'locations'">{{ section === 'locations' ? '未分配仓位' : '返回仓位' }}</ElButton>
            <ElButton class="warehouse-add" :icon="Plus" @click="edit()">新增仓位</ElButton>
            <ElButton v-if="section === 'locations'" class="warehouse-refresh" :icon="Refresh" :loading="loading" text aria-label="刷新仓位" title="刷新" @click="load()" />
          </div>
        </div>
        <WarehouseUnassigned v-if="section === 'unassigned' && teamId" :team-id="teamId" :can-dispatch="canDispatch" :refresh-key="refreshKey" @view="emit('view', $event)" @dispatch="emit('dispatch', $event)" @batch-dispatch="emit('batchDispatch', $event)" @changed="load()" />
        <template v-else>
          <ElAlert v-if="error" :title="error" type="error" :closable="false" />
          <div class="warehouse-legend" aria-label="仓位状态图例"><span><i class="warehouse-swatch stocked" aria-hidden="true" />有料</span><span><i class="warehouse-swatch" aria-hidden="true" />空仓</span><span class="pending"><ElIcon aria-hidden="true"><Clock /></ElIcon>待签收</span><span class="draft"><ElIcon aria-hidden="true"><Lock /></ElIcon>填写中</span><span class="disabled"><ElIcon aria-hidden="true"><CircleClose /></ElIcon>停用</span></div>
          <div ref="grid" class="warehouse-grid" role="group" aria-label="仓位卡片" :aria-busy="loading" :style="{ '--warehouse-rows': gridRows }">
            <button v-for="row in rows" :key="row.id" type="button" class="warehouse-slot" :class="{ 'is-stocked': stocked(row), 'is-disabled': !row.active }" :disabled="loading || !!error" :aria-label="cardLabel(row)" aria-haspopup="dialog" :aria-expanded="detailOpen && detailId === row.id" :title="row.name" @click="openDetail(row)">
              <span class="warehouse-slot-name">{{ row.name }}</span>
              <span class="warehouse-slot-markers" aria-hidden="true"><ElIcon v-if="!row.active" class="disabled"><CircleClose /></ElIcon><template v-else><ElIcon v-if="pending(row).length" class="pending"><Clock /></ElIcon><ElIcon v-if="row.draft_locked" class="draft"><Lock /></ElIcon></template></span>
            </button>
            <ElEmpty v-if="!rows.length" class="warehouse-empty" :description="loading ? '正在加载仓位' : '没有符合条件的仓位'" :image-size="64" />
          </div>
          <footer class="warehouse-footer"><span aria-live="polite">共 {{ total }} 个仓位</span><div><span>{{ pageSize }} 个/页</span><ElPagination v-model:current-page="page" :page-size="pageSize" :total="total" layout="prev, pager, next" @current-change="load()" /></div></footer>
        </template>
      </ElCard>
      <ElDialog v-model="detailOpen" :title="(detail?.name || '') + ' · 仓位明细'" width="min(760px, 94vw)" class="warehouse-detail-dialog">
        <template v-if="detail">
          <ElAlert v-if="error" :title="error" type="error" :closable="false" />
          <div class="warehouse-detail-heading"><div v-if="detail.batches.length" class="warehouse-detail-identity"><strong>{{ detailIdentity.serial }}</strong><span>{{ detailIdentity.material }}</span><ElTag effect="light">{{ detailIdentity.type }}</ElTag></div><ElTag :type="detail.draft_locked ? 'warning' : 'info'">{{ stateLabel(detail) }}</ElTag></div>
          <ElAlert v-if="detail.draft_locked" title="入库表单正在选择此仓位，暂不能修改" type="warning" :closable="false" />
          <template v-if="detail.batches.length">
            <div class="warehouse-detail-totals"><div><small>库存件数</small><strong>{{ amount(detail, 'quantity') }}</strong></div><div><small>库存重量（kg）</small><strong>{{ amount(detail, 'weight') }}</strong></div></div>
            <nav class="warehouse-detail-tabs" aria-label="批次状态"><ElButton text :class="{ 'is-current': detailTab === 'received' }" :aria-pressed="detailTab === 'received'" @click="detailTab = 'received'">在库批次 {{ received(detail).length }}</ElButton><ElButton text :class="{ 'is-current': detailTab === 'pending' }" :aria-pressed="detailTab === 'pending'" @click="detailTab = 'pending'">待签收 {{ pending(detail).length }}</ElButton></nav>
            <BatchSelectionBar v-if="canDispatch && detailTab === 'received'" :count="selected.size" :quantity="totals.quantity" :weight="totals.weight" :all-checked="allChecked" :partial="checkedCount > 0 && !allChecked" :disabled="loading || !!error || !availableRows.length || (selected.size >= 100 && !checkedCount)" @all="toggleAll" @clear="selected.clear()"><ElButton type="primary" :disabled="!selected.size || loading || !!error" @click="batchDispatch">批量出库</ElButton></BatchSelectionBar>
            <ElTable :data="detailBatches" row-key="id" empty-text="暂无批次" class="warehouse-detail-table" max-height="360">
              <ElTableColumn v-if="canDispatch && detailTab === 'received'" width="44"><template #default="{ row: batch }"><ElCheckbox :aria-label="'选择批次 ' + batch.batch_no" :model-value="selected.has(String(batch.id))" :disabled="loading || !selectable(batch as Batch) || !!error" @change="toggle(batch as Batch, $event)" /></template></ElTableColumn>
              <ElTableColumn label="批次号" min-width="190"><template #default="{ row: batch }"><ElButton link type="primary" @click="view(batch as Batch)">{{ batch.batch_no }}</ElButton></template></ElTableColumn>
              <ElTableColumn prop="quantity" label="件数" align="right" min-width="80" />
              <ElTableColumn prop="weight" label="重量（kg）" align="right" min-width="110" />
              <ElTableColumn :label="detailTab === 'received' ? '签收时间' : '提交时间'" min-width="160"><template #default="{ row: batch }">{{ formatDateTime(detailTab === 'received' ? batch.received_at : batch.created_at) }}</template></ElTableColumn>
              <ElTableColumn v-if="canDispatch && detailTab === 'received'" label="操作" width="65"><template #default="{ row: batch }"><ElButton link type="primary" :disabled="!available(batch as Batch) || loading || !!error" @click="dispatch(batch as Batch)">转出</ElButton></template></ElTableColumn>
            </ElTable>
          </template>
          <ElEmpty v-else :description="detail.draft_locked ? '仓位正在被入库表单占用' : detail.active ? '当前仓位没有物料' : '此仓位已停用'" :image-size="64" />
        </template>
        <template #footer><ElButton :disabled="!detail || detail.draft_locked" @click="detail && edit(detail)">编辑仓位</ElButton><ElButton type="primary" @click="detailOpen = false">关闭</ElButton></template>
      </ElDialog>
      <ElDialog v-model="editorOpen" :title="editingTitle" width="min(440px, 94vw)" :close-on-click-modal="!saving" :close-on-press-escape="!saving" :show-close="!saving">
        <ElForm label-position="top" @submit.prevent="save"><ElFormItem label="仓位名称" required><ElInput v-model="form.name" aria-label="仓位名称" placeholder="例如：A区-01" maxlength="80" :disabled="saving" /></ElFormItem><ElFormItem label="启用"><ElSwitch v-model="form.active" aria-label="启用仓位" :disabled="saving || !!editing?.batches.length" /><span v-if="editing?.batches.length">有料时可改名，不能停用</span></ElFormItem><p v-if="formError" class="warehouse-error" role="alert">{{ formError }}</p></ElForm>
        <template #footer><ElButton :disabled="saving" @click="editorOpen = false">取消</ElButton><ElButton type="primary" :loading="saving" @click="save">保存</ElButton></template>
      </ElDialog>
    </template>
  </section>
</template>

<style scoped>
.warehouse-management { display: flex; flex-direction: column; flex: 1; min-height: 0; min-width: 0; }
.warehouse-card { display: flex; flex-direction: column; flex: 1; min-height: 0; border-color: var(--line); border-radius: 14px; container-type: inline-size; }
.warehouse-card :deep(.el-card__body) { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.warehouse-toolbar, .warehouse-actions, .warehouse-footer, .warehouse-footer > div { display: flex; align-items: center; gap: 10px; }
.warehouse-toolbar { flex-wrap: wrap; margin-bottom: 18px; }
.warehouse-toolbar > .el-input { flex: 1 1 190px; max-width: 270px; }
.warehouse-toolbar > .el-select { width: 126px; }
.warehouse-toolbar .el-button { height: 36px; margin-left: 0; }
.warehouse-actions { margin-left: auto; flex-wrap: wrap; }
.warehouse-refresh { width: 36px; padding: 0; }
.warehouse-legend { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; margin-bottom: 18px; color: var(--muted); font-size: 12px; }
.warehouse-legend > span { display: inline-flex; align-items: center; gap: 6px; }
.warehouse-swatch { width: 12px; height: 12px; border-radius: 3px; border: 1px solid var(--line); background: var(--surface); }
.warehouse-swatch.stocked { background: #d8ebdf; border-color: #d8ebdf; }
.pending { color: #56899f; }
.draft { color: #a28249; }
.disabled { color: #8b9890; }
.warehouse-grid { --slot-height: 70px; display: grid; flex: 1; min-height: 0; grid-template-columns: repeat(10, minmax(0, 1fr)); grid-template-rows: repeat(var(--warehouse-rows), minmax(var(--slot-height), 1fr)); gap: 12px 10px; }
.warehouse-empty { grid-column: 1 / -1; grid-row: 1 / -1; }
.warehouse-slot { position: relative; display: flex; align-items: center; justify-content: center; min-width: 0; min-height: 70px; padding: 15px 7px 8px; border: 1px solid var(--line); border-radius: 7px; background: var(--surface); color: var(--muted); font: inherit; font-size: 14px; font-weight: 500; cursor: pointer; transition: background-color var(--motion-fast) ease, transform var(--motion-fast) ease; }
.warehouse-slot.is-stocked { background: #d8ebdf; border-color: #d8ebdf; color: #34784b; }
.warehouse-slot:not(:disabled):hover { background: #f2f7f3; transform: translateY(-1px); }
.warehouse-slot.is-stocked:not(:disabled):hover { background: #cce4d5; border-color: #cce4d5; }
.warehouse-slot:focus-visible { outline: 2px solid var(--primary); outline-offset: 3px; }
.warehouse-slot.is-disabled:not(.is-stocked) { background: #f3f5f3; color: #9aa69e; }
.warehouse-slot:disabled { cursor: default; }
.warehouse-slot-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.warehouse-slot-markers { display: flex; gap: 4px; position: absolute; right: 6px; top: 6px; }
.warehouse-slot-markers .el-icon { width: 15px; height: 15px; padding: 1px; border-radius: 3px; background: rgb(255 255 255 / 55%); font-size: 12px; }
.warehouse-footer { justify-content: space-between; flex-shrink: 0; margin-top: auto; padding-top: 24px; color: var(--muted); font-size: 12px; }
.warehouse-footer > div { gap: 16px; }
.warehouse-detail-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 18px; }
.warehouse-detail-identity { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; color: var(--muted); }
.warehouse-detail-identity strong { color: var(--text); font-size: 17px; font-weight: 500; }
.warehouse-detail-totals { display: flex; gap: 40px; padding-block: 8px 22px; font-variant-numeric: tabular-nums; }
.warehouse-detail-totals small { display: block; color: var(--muted); font-size: 12px; margin-bottom: 5px; }
.warehouse-detail-totals strong { font-size: 27px; color: var(--primary); font-weight: 500; }
.warehouse-detail-tabs { display: flex; gap: 20px; border-bottom: 1px solid var(--line); margin-bottom: 18px; }
.warehouse-detail-tabs .el-button { position: relative; margin: 0; padding: 10px 0 14px; height: auto; border-radius: 0; }
.warehouse-detail-tabs .is-current { color: var(--primary); }
.warehouse-detail-tabs .is-current::after { content: ''; position: absolute; bottom: 0; left: 0; right: 0; height: 2px; background: var(--primary); }
.warehouse-detail-table { font-variant-numeric: tabular-nums; }
.warehouse-error { color: var(--danger); }
@container (max-width: 1100px) { .warehouse-grid { grid-template-columns: repeat(8, minmax(0, 1fr)); } }
@container (max-width: 840px) { .warehouse-grid { grid-template-columns: repeat(6, minmax(0, 1fr)); } }
@container (max-width: 600px) { .warehouse-grid { --slot-height: 66px; grid-template-columns: repeat(5, minmax(0, 1fr)); } .warehouse-slot { min-height: 66px; } }
@container (max-width: 390px) { .warehouse-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 9px; } }
@media (max-width: 760px) {
  .warehouse-card :deep(.el-card__body) { padding: 12px; }
  .warehouse-toolbar > .el-input { max-width: none; }
  .warehouse-actions { width: 100%; justify-content: flex-end; }
  .warehouse-legend { gap: 10px 14px; }
  .warehouse-footer { flex-wrap: wrap; gap: 12px; }
  .warehouse-footer > div { gap: 8px; flex-wrap: wrap; }
  .warehouse-detail-totals { gap: 25px; }
  .warehouse-detail-table :deep(.el-scrollbar__bar.is-horizontal) { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) { .warehouse-slot { transition: none; } .warehouse-slot:not(:disabled):hover { transform: none; } }
</style>
