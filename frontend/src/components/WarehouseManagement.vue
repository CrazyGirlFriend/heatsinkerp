<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ElAlert, ElButton, ElCard, ElCheckbox, ElDialog, ElForm, ElFormItem, ElInput, ElPagination, ElPopover, ElResult, ElSwitch, ElTable, ElTableColumn, ElTag } from 'element-plus'
import { Plus, Refresh, Search } from '@element-plus/icons-vue'
import { showToast } from '@/stores/toast'
import { locationState, warehouseLocationApi, type WarehouseLocation } from '@/services/warehouseLocationApi'
import WarehouseUnassigned from './WarehouseUnassigned.vue'
import BatchSelectionBar from './BatchSelectionBar.vue'
import { useBatchSelection } from '@/composables/useBatchSelection'
import { materialTypeLabel } from '@/types/materialTransfer'

const props = defineProps<{ canManage: boolean; canDispatch?: boolean; teamId?: number; refreshKey?: unknown }>()
const emit = defineEmits<{ view: [batchNo: string]; dispatch: [batchNo: string]; batchDispatch: [sourceIds: number[]] }>()
const section = ref<'locations' | 'unassigned'>('locations')
const rows = ref<WarehouseLocation[]>([]), total = ref(0), page = ref(1)
const query = ref(''), appliedQuery = ref(''), error = ref(''), loading = ref(false), saving = ref(false), editorOpen = ref(false), formError = ref('')
const editing = ref<WarehouseLocation | null>(null), form = reactive({ name: '', active: true })
const editingTitle = computed(() => editing.value ? '编辑仓位' : '新增仓位')
type Batch = WarehouseLocation['batches'][number]
const batches = computed(() => rows.value.flatMap(row => row.batches))
const { selected, available, availableRows, checkedCount, allChecked, totals, toggle, toggleAll, reconcile } = useBatchSelection(batches, row => String(row.id), row => ({
  quantity: row.status === 'received' ? row.available_quantity ?? null : null,
  weight: row.status === 'received' ? row.available_weight ?? null : null,
}))
function batchDispatch() { if (props.canDispatch && selected.size && !loading.value && !error.value) emit('batchDispatch', [...selected.values()].map(row => row.id)) }
function selectable(batch: Batch) { return available(batch) && (selected.has(String(batch.id)) || selected.size < 100) }
let version = 0, disposed = false
let timer: ReturnType<typeof setInterval> | undefined
async function load(background = false) {
  if (!props.canManage || disposed || background && (loading.value || saving.value || editorOpen.value || document.hidden)) return
  const current = ++version
  if (!background) loading.value = true
  try {
    const data = await warehouseLocationApi.list(appliedQuery.value.trim(), page.value)
    if (current !== version) return
    const nextIds = new Set(data.items.map(row => row.id))
    // A batch that disappeared from a refreshed slot is no longer selected.
    for (const row of rows.value) if (nextIds.has(row.id)) {
      for (const batch of row.batches) if (!data.items.some(item => item.batches.some(value => value.id === batch.id))) selected.delete(String(batch.id))
    }
    rows.value = data.items; reconcile(data.items.flatMap(row => row.batches)); total.value = data.total; error.value = ''
  } catch (failure) { if (current === version) error.value = failure instanceof Error ? failure.message : '仓位加载失败' }
  finally { if (current === version) loading.value = false }
}
function search() { appliedQuery.value = query.value; page.value = 1; void load() }
function edit(row: WarehouseLocation | null = null) {
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
const amount = (row: WarehouseLocation, key: 'quantity' | 'weight') => row.batches.length ? row.batches.filter(batch => batch.status === 'received').reduce((sum, batch) => sum + batch[key], 0).toLocaleString('zh-CN', { maximumFractionDigits: 3 }) : '—'
watch(() => props.canManage, value => { if (!value) { ++version; rows.value = []; selected.clear(); editorOpen.value = false } })
watch(() => [props.teamId, props.canDispatch, section.value], () => selected.clear())
watch(() => props.refreshKey, () => { void load(true) })
onMounted(() => { void load(); timer = setInterval(() => void load(true), 10_000) })
onBeforeUnmount(() => { disposed = true; ++version; clearInterval(timer) })
</script>

<template>
  <section class="warehouse-management">
    <ElResult v-if="!canManage" icon="warning" title="仅库房账号和管理员可以设置仓位" />
    <template v-else>
      <ElCard shadow="never" class="warehouse-card">
        <header class="warehouse-heading"><h2>仓库管理</h2><ElButton class="warehouse-add" type="primary" :icon="Plus" @click="edit()">新增仓位</ElButton></header>
        <nav v-if="teamId" class="warehouse-sections" aria-label="仓库管理视图"><ElButton :type="section === 'locations' ? 'primary' : 'default'" @click="section = 'locations'">仓位物料</ElButton><ElButton :type="section === 'unassigned' ? 'primary' : 'default'" @click="section = 'unassigned'">未分配仓位</ElButton></nav>
        <WarehouseUnassigned v-if="section === 'unassigned' && teamId" :team-id="teamId" :can-dispatch="canDispatch" :refresh-key="refreshKey" @view="emit('view', $event)" @dispatch="emit('dispatch', $event)" @batch-dispatch="emit('batchDispatch', $event)" @changed="load()" />
        <template v-else>
        <div class="warehouse-toolbar"><ElInput v-model="query" aria-label="搜索仓位" placeholder="搜索仓位" clearable :prefix-icon="Search" @keyup.enter="search" @clear="search" /><ElButton type="primary" @click="search">查询</ElButton><ElButton class="warehouse-refresh" :icon="Refresh" :loading="loading" text aria-label="刷新仓位" title="刷新" @click="load()" /></div>
        <ElAlert v-if="error" :title="error" type="error" :closable="false" />
        <BatchSelectionBar v-if="canDispatch" :count="selected.size" :quantity="totals.quantity" :weight="totals.weight" :all-checked="allChecked" :partial="checkedCount > 0 && !allChecked" :disabled="loading || !availableRows.length || (selected.size >= 100 && !checkedCount)" @all="toggleAll" @clear="selected.clear()"><ElButton type="primary" :disabled="!selected.size || loading || !!error" @click="batchDispatch">批量出库</ElButton></BatchSelectionBar>
        <ElTable :data="rows" row-key="id" empty-text="暂无仓位，点击新增仓位开始设置" class="warehouse-table">
          <ElTableColumn v-if="canDispatch" width="50"><template #default="{ row }"><ElCheckbox :aria-label="`选择仓位 ${row.name}`" :model-value="row.batches.length > 0 && row.batches.every((batch: Batch) => selected.has(String(batch.id)))" :disabled="loading || !row.batches.some((batch: Batch) => selectable(batch))" @change="row.batches.forEach((batch: Batch) => toggle(batch, $event))" /></template></ElTableColumn>
          <ElTableColumn prop="name" label="仓位" min-width="160" />
          <ElTableColumn label="状态" min-width="100"><template #default="{ row }"><ElTag :type="row.status === 'available' ? 'success' : row.status === 'locked' ? 'warning' : 'info'" effect="light">{{ locationState[row.status as keyof typeof locationState] }}</ElTag></template></ElTableColumn>
          <ElTableColumn label="批次号" min-width="200"><template #default="{ row }"><ElPopover v-if="row.batches.length > 1" trigger="click" :width="'min(560px, 90vw)'"><template #reference><ElButton link type="warning">{{ row.batches.length }} 批</ElButton></template><ElTable :data="row.batches" size="small" max-height="300"><ElTableColumn label="批次号" min-width="200"><template #default="{ row: batch }"><ElButton link type="primary" @click="emit('view', batch.batch_no)">{{ batch.batch_no }}</ElButton></template></ElTableColumn><ElTableColumn prop="quantity" label="件数" align="right" /><ElTableColumn prop="weight" label="重量（kg）" align="right" /><ElTableColumn label="状态"><template #default="{ row: batch }">{{ batch.status === 'received' ? '在库' : '待签收' }}</template></ElTableColumn></ElTable></ElPopover><template v-else>{{ row.batches[0]?.batch_no || '—' }}</template></template></ElTableColumn>
          <ElTableColumn label="流水号" min-width="140" show-overflow-tooltip><template #default="{ row }">{{ [...new Set(row.batches.map((batch: Batch) => batch.serial_no))].join('、') || '—' }}</template></ElTableColumn>
          <ElTableColumn label="材质" min-width="120"><template #default="{ row }">{{ [...new Set(row.batches.map((batch: Batch) => batch.material_name))].filter(Boolean).join('、') || '—' }}</template></ElTableColumn>
          <ElTableColumn label="类型" min-width="120"><template #default="{ row }">{{ [...new Set(row.batches.map((batch: Batch) => materialTypeLabel(batch.material_type)))].join('、') || '—' }}</template></ElTableColumn>
          <ElTableColumn label="库存件数" align="right" min-width="100"><template #default="{ row }">{{ amount(row as WarehouseLocation, 'quantity') }}</template></ElTableColumn>
          <ElTableColumn label="库存重量（kg）" align="right" min-width="130"><template #default="{ row }">{{ amount(row as WarehouseLocation, 'weight') }}</template></ElTableColumn>
          <ElTableColumn label="操作" :width="canDispatch ? 210 : 155" fixed="right"><template #default="{ row }"><ElButton v-if="row.batches.length === 1" link type="primary" @click="emit('view', row.batches[0].batch_no)">查看物料</ElButton><ElButton v-if="canDispatch && row.batches.length === 1 && row.has_stock" link type="primary" :disabled="!available(row.batches[0])" @click="emit('dispatch', row.batches[0].batch_no)">转出</ElButton><ElButton link type="primary" :disabled="row.draft_locked" :title="row.draft_locked ? '入库表单正在选择此仓位，暂不能修改' : '编辑仓位名称'" @click="edit(row as WarehouseLocation)">编辑</ElButton></template></ElTableColumn>
        </ElTable>
        <footer class="warehouse-footer"><span>共 {{ total }} 个仓位</span><ElPagination v-model:current-page="page" :page-size="20" :total="total" layout="prev, pager, next" @current-change="load()" /></footer>
        </template>
      </ElCard>
      <ElDialog v-model="editorOpen" :title="editingTitle" width="min(440px, 94vw)" :close-on-click-modal="!saving" :close-on-press-escape="!saving" :show-close="!saving">
        <ElForm label-position="top" @submit.prevent="save"><ElFormItem label="仓位名称" required><ElInput v-model="form.name" aria-label="仓位名称" placeholder="例如：A区-01" maxlength="80" :disabled="saving" /></ElFormItem><ElFormItem label="启用"><ElSwitch v-model="form.active" aria-label="启用仓位" :disabled="saving || !!editing?.batches.length" /><span v-if="editing?.batches.length">有料时可改名，不能停用</span></ElFormItem><p v-if="formError" class="warehouse-error" role="alert">{{ formError }}</p></ElForm>
        <template #footer><ElButton :disabled="saving" @click="editorOpen = false">取消</ElButton><ElButton type="primary" :loading="saving" @click="save">保存</ElButton></template>
      </ElDialog>
    </template>
  </section>
</template>

<style scoped>
.warehouse-management { display: flex; flex-direction: column; flex: 1 0 auto; min-height: 0; }
.warehouse-sections { display: flex; gap: 8px; margin-bottom: 12px; }
.warehouse-sections .el-button { margin-left: 0; }
.warehouse-heading, .warehouse-toolbar, .warehouse-footer { display: flex; align-items: center; gap: 12px; }
.warehouse-footer { justify-content: space-between; }
.warehouse-card { display: flex; flex-direction: column; flex: 1 0 auto; min-height: 0; border-color: var(--line); border-radius: 14px; }
.warehouse-toolbar { flex-shrink: 0; margin-bottom: 20px; flex-wrap: wrap; }
.warehouse-toolbar .el-input { max-width: 300px; }
.warehouse-card :deep(.el-card__body) { flex: 1 0 auto; min-height: 0; display: flex; flex-direction: column; }
.warehouse-table { flex: 1 0 auto; min-height: 0; }
.warehouse-heading { justify-content: space-between; flex-wrap: wrap; padding-bottom: 16px; margin-bottom: 14px; border-bottom: 1px solid var(--line); }
.warehouse-heading h2 { margin: 0; font-size: 16px; font-weight: 600; }
.warehouse-heading .el-button, .warehouse-toolbar .el-button { height: 36px; margin-left: 0; }
.warehouse-toolbar > .warehouse-refresh { width: 36px; margin-left: auto; padding: 0; }
.warehouse-footer { flex-shrink: 0; margin-top: auto; padding-top: 20px; color: var(--subtle); font-size: 13px; }
.warehouse-error { color: var(--danger); }
@media (max-width: 760px) {
  .warehouse-card :deep(.el-card__body) { padding: 12px; }
  .warehouse-toolbar .el-input { max-width: none; }
  .warehouse-footer { gap: 4px; flex-wrap: wrap; overflow-x: auto; }
  .warehouse-table :deep(.el-table-fixed-column--right) { position: relative !important; right: auto !important; }
  .warehouse-table :deep(.el-table-fixed-column--right::before) { box-shadow: none; }
  .warehouse-table :deep(.el-scrollbar__bar.is-horizontal) { opacity: 1; }
}
</style>
