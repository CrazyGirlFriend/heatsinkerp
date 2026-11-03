<script setup lang="ts">
import { sharedSerialLabel } from '@/types/sharedMaterial'
import { formatAmount } from '@/utils/format'
import WatermelonWarehouseToolbar from './WatermelonWarehouseToolbar.vue'
import WatermelonButton from './WatermelonButton.vue'
import WatermelonDialog from './WatermelonDialog.vue'
import WatermelonPagination from './WatermelonPagination.vue'
import WatermelonSegmented from './WatermelonSegmented.vue'
import WatermelonSwitch from './WatermelonSwitch.vue'
import { motion, useReducedMotion } from 'motion-v'
import {
  IconBox,
  IconArrowUpRight,
  IconPlus,
  IconCheck,
  IconCircle,
  IconClock,
  IconLock,
  IconCircleOff,
} from '@tabler/icons-vue'
import './warehouse-preview.css'
import { useDialogValidation } from '@/composables/useDialogValidation'
import TableExportButton from '@/components/TableExportButton.vue'
import { loadExportPages, tableExportSource } from '@/utils/tableExport'
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  ElAlert,
  ElButton,
  ElCheckbox,
  ElEmpty,
  ElForm,
  ElFormItem,
  ElInput,
  ElTable,
  ElTableColumn,
  ElTag,
  ElResult,
} from 'element-plus'
import { showToast } from '@/stores/toast'
import {
  locationState,
  warehouseLocationApi,
  type WarehouseLocation,
  type WarehouseLocationFilter,
} from '@/services/warehouseLocationApi'
import WarehouseUnassigned from '@/components/WarehouseUnassigned.vue'
import BatchSelectionBar from '@/components/BatchSelectionBar.vue'
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
const reduced = useReducedMotion()
const pageSize = ref(50),
  gridRows = ref(5),
  grid = ref<HTMLElement>()
type Batch = WarehouseLocation['batches'][number]
const section = ref<'locations' | 'unassigned'>('locations')
const rows = ref<WarehouseLocation[]>([]),
  total = ref(0),
  page = ref(1)
const query = ref(''),
  appliedQuery = ref(''),
  filter = ref<WarehouseLocationFilter>(),
  appliedFilter = ref<WarehouseLocationFilter>()
function exportSource() {
  const query = appliedQuery.value,
    state = appliedFilter.value
  const joined = (row: WarehouseLocation, field: 'serial_no' | 'material_name' | 'batch_no') =>
    [
      ...new Set(
        row.batches
          .map((batch) => (field === 'serial_no' ? sharedSerialLabel(batch) : batch[field]))
          .filter(Boolean),
      ),
    ].join('、')
  return tableExportSource(
    '仓位库存',
    total.value,
    [
      { key: 'name', label: '仓位', value: (row: WarehouseLocation) => row.name },
      { key: 'status', label: '状态', value: stateLabel },
      { key: 'serial_no', label: '流水号', value: (row) => joined(row, 'serial_no') },
      { key: 'material_name', label: '材质', value: (row) => joined(row, 'material_name') },
      {
        key: 'material_type',
        label: '物料类型',
        value: (row) =>
          [...new Set(row.batches.map((batch) => materialTypeLabel(batch.material_type)))].join(
            '、',
          ),
      },
      {
        key: 'quantity',
        label: '在库件数',
        value: (row) => received(row).reduce((sum, batch) => sum + batch.quantity, 0),
      },
      {
        key: 'weight',
        label: '在库重量 (kg)',
        value: (row) => received(row).reduce((sum, batch) => sum + batch.weight, 0),
      },
      { key: 'received', label: '在库批次', value: (row) => received(row).length },
      { key: 'pending', label: '待签收批次', value: (row) => pending(row).length },
      { key: 'batch_no', label: '批次号', value: (row) => joined(row, 'batch_no') },
    ],
    (signal, progress) =>
      loadExportPages(
        (page, pageSize) => warehouseLocationApi.list(query, page, pageSize, state),
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
const received = (row: WarehouseLocation) =>
  row.batches.filter((batch) => batch.status === 'received')
const pending = (row: WarehouseLocation) =>
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
const detailIdentity = computed(() => {
  const batches = detail.value?.batches || []
  return {
    serial: [...new Set(batches.map(sharedSerialLabel))].join('、'),
    material: [...new Set(batches.map((batch) => batch.material_name).filter(Boolean))].join('、'),
    type: [...new Set(batches.map((batch) => materialTypeLabel(batch.material_type)))].join('、'),
  }
})
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
function cardLabel(row: WarehouseLocation) {
  return [
    row.name,
    stocked(row) ? '有料' : '空仓',
    pending(row).length ? '待签收' : '',
    row.draft_locked ? '填写中' : '',
    !row.active ? '停用' : '',
    '查看详情',
  ]
    .filter(Boolean)
    .join('，')
}
let version = 0,
  disposed = false
let timer: ReturnType<typeof setInterval> | undefined
let resizeObserver: ResizeObserver | undefined,
  resizeTimer: ReturnType<typeof setTimeout> | undefined
function fitGrid() {
  if (!grid.value || disposed || !props.canManage || section.value !== 'locations') return false
  const height = grid.value.clientHeight
  if (!height) return false
  const style = getComputedStyle(grid.value),
    columns = style.gridTemplateColumns.split(' ').length
  const gap = parseFloat(style.rowGap) || 0,
    minimum = parseFloat(style.getPropertyValue('--slot-height')) || 70
  // Keep cards compact and request only the slots that fit the available area.
  gridRows.value = Math.max(
    1,
    Math.min(Math.floor((height + gap) / (minimum + gap)), Math.floor(100 / columns)),
  )
  const size = columns * gridRows.value
  if (size === pageSize.value) return false
  pageSize.value = size
  page.value = 1
  void load()
  return true
}
watch(
  grid,
  (element) => {
    resizeObserver?.disconnect()
    if (element) {
      resizeObserver?.observe(element)
      fitGrid()
    }
  },
  { flush: 'post' },
)
async function load(background = false) {
  if (
    !props.canManage ||
    disposed ||
    (background &&
      (loading.value ||
        saving.value ||
        editorOpen.value ||
        section.value !== 'locations' ||
        document.hidden))
  )
    return
  const current = ++version
  if (!background) loading.value = true
  try {
    const data = await warehouseLocationApi.list(
      appliedQuery.value.trim(),
      page.value,
      pageSize.value,
      appliedFilter.value,
    )
    if (current !== version) return
    const nextIds = new Set(data.items.map((row) => row.id))
    // Keep other pages selected, but drop batches removed from a refreshed slot.
    for (const row of rows.value)
      if (nextIds.has(row.id)) {
        for (const batch of row.batches)
          if (!data.items.some((item) => item.batches.some((value) => value.id === batch.id)))
            selected.delete(String(batch.id))
      }
    rows.value = data.items
    reconcile(data.items.flatMap((row) => row.batches))
    total.value = data.total
    error.value = ''
    if (detailOpen.value && !detail.value) detailOpen.value = false
  } catch (failure) {
    if (current === version)
      error.value = failure instanceof Error ? failure.message : '仓位加载失败'
  } finally {
    if (current === version) loading.value = false
  }
}
function applyState(value: WarehouseLocationFilter | undefined) {
  filter.value = value
  search()
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
      rows.value = []
      total.value = 0
      selected.clear()
      editorOpen.value = false
      detailOpen.value = false
    } else void load()
  },
)
watch(
  () => [props.teamId, props.canDispatch, section.value],
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
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(fitGrid, 150)
    })
    if (grid.value) resizeObserver.observe(grid.value)
  }
  if (!fitGrid()) void load()
  timer = setInterval(() => void load(true), 10_000)
})
onBeforeUnmount(() => {
  disposed = true
  ++version
  clearInterval(timer)
  clearTimeout(resizeTimer)
  resizeObserver?.disconnect()
})
</script>

<template>
  <section class="warehouse-management warehouse-watermelon">
    <ElResult v-if="!canManage" icon="warning" title="仅库房账号和管理员可以设置仓位" />
    <template v-else>
      <div class="warehouse-card">
        <WatermelonWarehouseToolbar
          v-model="query"
          :state="appliedFilter"
          :section="section"
          :show-unassigned="!!teamId"
          :loading="loading"
          @search="search"
          @refresh="load()"
          @reset="reset"
          @state="applyState"
          @section="(value) => (section = value)"
        >
          <template #tools
            ><TableExportButton
              v-if="section === 'locations'"
              :source="exportSource"
              :disabled="loading || !!error"
              :context="[teamId, section, appliedQuery, appliedFilter].join('|')"
          /></template>
          <template #actions>
            <ElButton
              v-if="canDispatch && selected.size"
              :disabled="loading || !!error"
              @click="batchDispatch"
              >批量出库（{{ selected.size }}）</ElButton
            >
          </template>
          <template #primary-actions
            ><WatermelonButton primary class="warehouse-add" @click="edit()"
              ><IconPlus :size="16" />新增仓位</WatermelonButton
            ></template
          >
        </WatermelonWarehouseToolbar>
        <WarehouseUnassigned
          v-if="section === 'unassigned' && teamId"
          :team-id="teamId"
          :can-dispatch="canDispatch"
          :refresh-key="refreshKey"
          @view="emit('view', $event)"
          @dispatch="emit('dispatch', $event)"
          @batch-dispatch="emit('batchDispatch', $event)"
          @changed="load()"
        />
        <template v-else>
          <ElAlert v-if="error" :title="error" type="error" :closable="false" />
          <div class="wm-grid-heading">
            <span>仓位分布</span><span>{{ total }} 个仓位</span>
          </div>
          <div
            ref="grid"
            class="warehouse-grid"
            role="group"
            aria-label="仓位卡片"
            :aria-busy="loading"
            :style="{ '--warehouse-rows': gridRows }"
          >
            <motion.button
              v-for="row in rows"
              :key="row.id"
              type="button"
              class="warehouse-slot"
              :class="{
                'is-stocked': stocked(row),
                'is-disabled': !row.active,
                'is-pending': pending(row).length,
              }"
              :disabled="loading || !!error"
              :aria-label="cardLabel(row)"
              aria-haspopup="dialog"
              :aria-expanded="detailOpen && detailId === row.id"
              :title="row.name"
              :while-hover="reduced ? {} : { y: -2 }"
              :while-press="reduced ? {} : { scale: 0.97 }"
              :transition="{ type: 'spring', stiffness: 400, damping: 28 }"
              @click="openDetail(row)"
            >
              <span class="warehouse-slot-name">{{ row.name }}</span>
              <span class="wm-slot-bottom"
                ><span class="wm-slot-state"
                  ><component
                    :is="
                      !row.active
                        ? IconCircleOff
                        : row.draft_locked
                          ? IconLock
                          : pending(row).length
                            ? IconClock
                            : stocked(row)
                              ? IconCheck
                              : IconCircle
                    "
                    :size="12"
                  />{{ stateLabel(row) }}</span
                ><IconArrowUpRight class="wm-slot-arrow" :size="14"
              /></span>
            </motion.button>
            <div v-if="!rows.length" class="warehouse-empty">
              <div class="wm-empty-icon"><IconBox :size="30" stroke="1.4" /></div>
              <strong>{{
                loading
                  ? '正在加载'
                  : appliedQuery || appliedFilter
                    ? '没有符合条件的仓位'
                    : '暂无仓位'
              }}</strong>
              <WatermelonButton
                v-if="!loading && !error && !appliedQuery && !appliedFilter"
                @click="edit()"
                ><IconPlus :size="16" />新增仓位</WatermelonButton
              >
              <WatermelonButton v-else-if="!loading && !error" @click="reset"
                >清除筛选</WatermelonButton
              >
            </div>
          </div>
          <WatermelonPagination
            label="仓位分页"
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
            ><span aria-live="polite"
              >共 {{ total }} 个仓位 · {{ pageSize }} 个/页</span
            ></WatermelonPagination
          >
        </template>
      </div>
      <WatermelonDialog
        v-model="detailOpen"
        class="wm-warehouse-dialog"
        :title="(detail?.name || '') + ' · 仓位明细'"
        width="min(760px, 94vw)"
      >
        <template #header
          ><div class="warehouse-detail-title">
            <span class="el-dialog__title">{{ detail?.name }} · 仓位明细</span
            ><ElTag
              v-if="detail"
              :type="detail.draft_locked ? 'warning' : stocked(detail) ? 'success' : 'info'"
              >{{ stateLabel(detail) }}</ElTag
            >
          </div></template
        >
        <template v-if="detail">
          <ElAlert v-if="error" :title="error" type="error" :closable="false" />
          <ElAlert
            v-if="detail.draft_locked"
            title="入库表单正在选择此仓位，暂不能修改"
            type="warning"
            :closable="false"
          />
          <template v-if="detail.batches.length">
            <div class="warehouse-detail-summary">
              <div class="warehouse-detail-identity">
                <strong>{{ detailIdentity.serial }}</strong>
                <div>
                  <span>{{ detailIdentity.material }}</span
                  ><ElTag effect="light">{{ detailIdentity.type }}</ElTag>
                </div>
              </div>
              <div class="warehouse-detail-totals">
                <div>
                  <small>库存件数</small><strong>{{ amount(detail, 'quantity') }}</strong>
                </div>
                <div>
                  <small>库存重量（kg）</small><strong>{{ amount(detail, 'weight') }}</strong>
                </div>
              </div>
            </div>
            <div class="warehouse-detail-controls">
              <WatermelonSegmented
                class="warehouse-detail-tabs"
                :model-value="detailTab"
                label="批次状态"
                :options="[
                  { value: 'received', label: `在库批次 ${received(detail).length}` },
                  { value: 'pending', label: `待签收 ${pending(detail).length}` },
                ]"
                @update:model-value="(value) => (detailTab = value as 'received' | 'pending')"
              />
              <BatchSelectionBar
                v-if="canDispatch && detailTab === 'received'"
                class="warehouse-detail-selection"
                :class="{ 'is-empty': !selected.size }"
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
                ><ElButton
                  type="primary"
                  :disabled="!selected.size || loading || !!error"
                  @click="batchDispatch"
                  >批量出库</ElButton
                ></BatchSelectionBar
              >
            </div>
            <ElTable
              :data="detailBatches"
              row-key="id"
              empty-text="暂无批次"
              class="business-table warehouse-detail-table"
              max-height="360"
            >
              <ElTableColumn v-if="canDispatch && detailTab === 'received'" width="44"
                ><template #default="{ row: batch }"
                  ><ElCheckbox
                    :aria-label="'选择批次 ' + batch.batch_no"
                    :model-value="selected.has(String(batch.id))"
                    :disabled="loading || !selectable(batch as Batch) || !!error"
                    @change="toggle(batch as Batch, $event)" /></template
              ></ElTableColumn>
              <ElTableColumn label="批次号" min-width="190"
                ><template #default="{ row: batch }"
                  ><ElButton link type="primary" @click="view(batch as Batch)">{{
                    batch.batch_no
                  }}</ElButton></template
                ></ElTableColumn
              >
              <ElTableColumn prop="quantity" label="件数" align="right" min-width="80" />
              <ElTableColumn prop="weight" label="重量（kg）" align="right" min-width="110" />
              <ElTableColumn
                :label="detailTab === 'received' ? '签收时间' : '提交时间'"
                min-width="160"
                ><template #default="{ row: batch }">{{
                  formatDateTime(detailTab === 'received' ? batch.received_at : batch.created_at)
                }}</template></ElTableColumn
              >
              <ElTableColumn v-if="canDispatch && detailTab === 'received'" label="操作" width="65"
                ><template #default="{ row: batch }"
                  ><ElButton
                    link
                    type="primary"
                    :disabled="!available(batch as Batch) || loading || !!error"
                    @click="dispatch(batch as Batch)"
                    >转出</ElButton
                  ></template
                ></ElTableColumn
              >
            </ElTable>
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
        class="wm-warehouse-dialog"
        :title="editingTitle"
        width="min(640px, 94vw)"
        :close-on-click-modal="!saving"
        :close-on-press-escape="!saving"
        :show-close="!saving"
      >
        <div class="wm-editor-layout">
          <ElForm ref="formRef" label-position="top" :show-message="false" @submit.prevent="save">
            <ElFormItem label="仓位名称" :error="fieldErrors.name" required>
              <ElInput
                v-model="form.name"
                aria-label="仓位名称"
                placeholder="例如：A区-01"
                maxlength="80"
                :disabled="saving"
                autofocus
              />
              <span v-if="fieldErrors.name" class="wm-field-error">{{ fieldErrors.name }}</span>
            </ElFormItem>
            <div class="wm-switch-row">
              <span>启用仓位</span>
              <WatermelonSwitch
                v-model="form.active"
                label="启用仓位"
                :disabled="saving || !!editing?.batches.length"
              />
            </div>
            <p v-if="editing?.batches.length" class="wm-field-hint">有料时不能停用</p>
            <p v-if="formError" class="warehouse-error" role="alert">{{ formError }}</p>
          </ElForm>
          <aside class="wm-slot-preview" aria-label="仓位预览">
            <span>仓位标识</span><IconBox :size="36" stroke="1.4" />
            <strong>{{ form.name || '仓位名称' }}</strong
            ><span class="wm-state-pill">{{ form.active ? '已启用' : '已停用' }}</span>
          </aside>
        </div>
        <template #footer
          ><WatermelonButton :disabled="saving" @click="editorOpen = false">取消</WatermelonButton
          ><WatermelonButton primary :loading="saving" @click="save"
            >保存仓位</WatermelonButton
          ></template
        >
      </WatermelonDialog>
    </template>
  </section>
</template>
