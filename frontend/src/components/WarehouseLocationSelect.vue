<script setup lang="ts">
import AppDetailTable from './AppDetailTable.vue'
import WatermelonButton from './watermelon/WatermelonButton.vue'
import WatermelonDialog from './watermelon/WatermelonDialog.vue'
import WatermelonDataTable from './watermelon/WatermelonDataTable.vue'
import WatermelonSearch from './watermelon/WatermelonSearch.vue'
import WatermelonPagination from './watermelon/WatermelonPagination.vue'
import { formatAmount as amount } from '@/utils/format'

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElTableColumn } from 'element-plus'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import {
  locationState,
  warehouseLocationApi,
  type WarehouseLease,
  type WarehouseLocation,
  type WarehouseLeaseGroup,
  type WarehouseMaterial,
} from '@/services/warehouseLocationApi'
import { materialTypeLabel } from '@/types/materialTransfer'

const props = withDefaults(
  defineProps<{
    modelValue: string
    reservationKey?: string
    teamId: number
    active?: boolean
    disabled?: boolean
    required?: boolean
    showStockPreview?: boolean
    serialNo?: string
    materialName?: string
    materialType?: string
    specification?: string
    leaseGroup?: WarehouseLeaseGroup
  }>(),
  { active: true, reservationKey: '', showStockPreview: true },
)
const emit = defineEmits<{
  'update:modelValue': [value: string]
  'update:reservationKey': [value: string]
  busyChange: [value: boolean]
}>()
const items = ref<WarehouseLocation[]>([]),
  lease = ref<WarehouseLease | null>(null),
  selection = ref<WarehouseLocation>()
const pickerOpen = ref(false),
  pickerMounted = ref(false),
  query = ref(''),
  appliedQuery = ref(''),
  page = ref(1),
  total = ref(0)
const columnTools = ref<HTMLElement | null>(null)
const loading = ref(false),
  choosing = ref(false),
  loaded = ref(false),
  error = ref('')
const now = ref(Date.now())
const material = computed<WarehouseMaterial | undefined>(() =>
  props.materialName?.trim() && props.materialType
    ? {
        ...(props.serialNo?.trim() ? { serial_no: props.serialNo.trim() } : {}),
        ...(props.specification !== undefined
          ? { transfer_specification: props.specification.trim() }
          : {}),
        material_name: props.materialName.trim(),
        material_type: props.materialType,
      }
    : undefined,
)
const owner = Symbol('warehouse-line')
const selectedStock = computed(() =>
  selection.value?.name === props.modelValue
    ? selection.value
    : items.value.find((item) => item.name === props.modelValue),
)
const currentStock = computed(
  () => selectedStock.value?.batches.filter((batch) => batch.status === 'received') || [],
)

const currentQuantity = computed(() =>
  amount(currentStock.value.reduce((sum, batch) => sum + batch.quantity, 0)),
)
const currentWeight = computed(() =>
  amount(currentStock.value.reduce((sum, batch) => sum + batch.weight, 0)),
)
function selectable(item: WarehouseLocation) {
  const shared = props.leaseGroup?.get(item.id)
  return item.active && (!item.draft_locked || !!shared || lease.value?.id === item.id)
}
const remainingSeconds = computed(() =>
  lease.value?.hold_until
    ? Math.max(0, Math.ceil((Date.parse(lease.value.hold_until) - now.value) / 1000))
    : 0,
)
const countdown = computed(
  () =>
    `${String(Math.floor(remainingSeconds.value / 60)).padStart(2, '0')}:${String(remainingSeconds.value % 60).padStart(2, '0')}`,
)
let generation = 0,
  searchVersion = 0
let heartbeat: ReturnType<typeof setInterval> | undefined
let deadlineTimer: ReturnType<typeof setTimeout> | undefined
let countdownTimer: ReturnType<typeof setInterval> | undefined
const key = () =>
  globalThis.crypto?.randomUUID?.() ||
  `warehouse-${Date.now()}-${Math.random().toString(16).slice(2)}`
function busy(value: boolean) {
  choosing.value = value
  emit('busyChange', value)
}
async function release(value: WarehouseLease | null) {
  const shared = value && props.leaseGroup?.get(value.id)
  if (shared && value && shared.key === value.key) {
    shared.owners.delete(owner)
    if (shared.owners.size) return
    props.leaseGroup!.delete(value.id)
  }
  if (value)
    await warehouseLocationApi.release(value.id, value.key, true).catch(() => {
      /* The bounded lease also releases after a lost connection. */
    })
}
async function search(searchQuery = appliedQuery.value) {
  const version = ++searchVersion,
    team = props.teamId
  if (!team || !props.active) return
  loading.value = true
  try {
    const result = await teamMaterialApi.warehouseLocations(
      team,
      searchQuery.slice(0, 80),
      props.modelValue,
      material.value,
      page.value,
    )
    if (version !== searchVersion || !props.active) return
    items.value = [...result.items]
    total.value = result.total ?? result.items.length
    loaded.value = true
    // A saved uncertain submission keeps its original key for safe retries.
    const selected = items.value.find((item) => item.name === props.modelValue)
    if (selected) selection.value = selected
    if (!lease.value && selected && props.reservationKey)
      lease.value = {
        id: selected.id,
        name: selected.name,
        key: props.reservationKey,
        expires_at: '',
        hold_until: '',
      }
  } catch (failure) {
    if (version === searchVersion)
      error.value = failure instanceof Error ? failure.message : '仓位读取失败，请重新展开重试'
  } finally {
    if (version === searchVersion) loading.value = false
  }
}
function openPicker() {
  pickerMounted.value = true
  pickerOpen.value = true
  query.value = appliedQuery.value = ''
  page.value = 1
  void search()
}
function findLocations() {
  appliedQuery.value = query.value.trim()
  page.value = 1
  void search()
}
function changePage(value: number) {
  page.value = value
  void search()
}
async function choose(name: string) {
  if (props.disabled || choosing.value) return
  const version = ++generation,
    previous = lease.value
  error.value = ''
  if (!name) {
    lease.value = null
    emit('update:modelValue', '')
    emit('update:reservationKey', '')
    await release(previous)
    await search()
    return
  }
  if (previous?.name === name) {
    pickerOpen.value = false
    return
  }
  const item = items.value.find((item) => item.name === name && selectable(item))
  if (!item) {
    error.value = '该仓位已不可选，请刷新后重新选择'
    await search()
    return
  }
  busy(true)
  const shared = props.leaseGroup?.get(item.id)
  const claimKey = shared?.key || key()
  if (props.leaseGroup) {
    const entry = shared || {
      key: claimKey,
      owners: new Set<symbol>(),
    }
    entry.owners.add(owner)
    props.leaseGroup.set(item.id, entry)
  }
  try {
    const claimed = await warehouseLocationApi.reserve(item.id, claimKey, material.value)
    if (version !== generation || !props.active) {
      await release(claimed)
      return
    }
    lease.value = claimed
    selection.value = item
    pickerOpen.value = false
    scheduleDeadline()
    emit('update:modelValue', claimed.name)
    emit('update:reservationKey', claimed.key)
    await release(previous)
  } catch (failure) {
    await release({ id: item.id, name, key: claimKey, expires_at: '', hold_until: '' })
    if (version === generation)
      error.value = failure instanceof Error ? failure.message : '仓位锁定失败，请重新选择'
  } finally {
    if (version === generation) {
      busy(false)
      await search()
    }
  }
}
async function renew() {
  const current = lease.value,
    version = generation
  if (!current || !props.active || props.disabled || choosing.value) return
  try {
    const renewed = await warehouseLocationApi.reserve(current.id, current.key, material.value)
    if (version === generation && lease.value === current) {
      lease.value = renewed
      scheduleDeadline()
    } else await release(renewed)
  } catch (failure) {
    if (version !== generation || lease.value !== current) return
    lease.value = null
    emit('update:modelValue', '')
    emit('update:reservationKey', '')
    error.value = failure instanceof Error ? failure.message : '仓位锁定已失效，请重新选择'
    await release(current)
    await search()
  }
}
function scheduleDeadline() {
  now.value = Date.now()
  clearTimeout(deadlineTimer)
  const current = lease.value
  if (!current?.hold_until || !props.active || props.disabled) return
  const remaining = Date.parse(current.hold_until) - Date.now()
  if (remaining > 0) {
    deadlineTimer = setTimeout(scheduleDeadline, remaining)
    return
  }
  lease.value = null
  emit('update:modelValue', '')
  emit('update:reservationKey', '')
  error.value = '10 分钟未提交，仓位已释放，请重新选择'
  void release(current).then(() => search())
}
watch(
  () => props.disabled,
  (value) => {
    scheduleDeadline()
    if (!value && !props.modelValue) void search()
  },
)
function cleanup() {
  ++generation
  ++searchVersion
  clearTimeout(deadlineTimer)
  loading.value = false
  pickerOpen.value = false
  busy(false)
  const previous = lease.value
  lease.value = null
  void release(previous)
}
function pagehide() {
  cleanup()
  emit('update:modelValue', '')
  emit('update:reservationKey', '')
}
watch(
  () => [props.active, props.teamId],
  () => {
    const selected = lease.value
    cleanup()
    if (selected) {
      emit('update:modelValue', '')
      emit('update:reservationKey', '')
    }
    items.value = []
    selection.value = undefined
    page.value = 1
    appliedQuery.value = ''
    loaded.value = false
    error.value = ''
    if (props.active) void search(props.modelValue)
  },
  { immediate: true },
)
watch(
  () => props.modelValue,
  (value) => {
    if (!value && lease.value) cleanup()
  },
)
onMounted(() => {
  countdownTimer = setInterval(() => {
    now.value = Date.now()
  }, 1000)
  heartbeat = setInterval(() => void renew(), 45_000)
  window.addEventListener('pagehide', pagehide)
})
onBeforeUnmount(() => {
  cleanup()
  clearInterval(heartbeat)
  clearInterval(countdownTimer)
  window.removeEventListener('pagehide', pagehide)
})
</script>

<template>
  <div class="warehouse-location-select">
    <div class="location-selection">
      <WatermelonButton
        class="location-trigger"
        :disabled="disabled || choosing"
        aria-label="入库仓位"
        aria-haspopup="dialog"
        :aria-expanded="pickerOpen"
        @click="openPicker"
        >{{ modelValue || (required ? '请选择入库仓位' : '选择仓位（选填）') }}
        <span class="location-trigger-hint">{{
          modelValue ? '更换' : '查看仓位列表'
        }}</span></WatermelonButton
      >
      <WatermelonButton
        v-if="modelValue"
        :disabled="disabled || choosing"
        aria-label="清除入库仓位"
        @click="choose('')"
        >清除</WatermelonButton
      >
    </div>
    <WatermelonDialog
      v-if="pickerMounted"
      v-model="pickerOpen"
      title="选择入库仓位"
      width="min(1100px, 94vw)"
      :close-on-click-modal="!choosing"
      :close-on-press-escape="!choosing"
      :show-close="!choosing"
    >
      <p class="location-picker-hint">
        空仓位和已有料的仓位均可选择。查看现有物料后，选择本批料要存放的仓位。
      </p>
      <div class="location-picker-tools">
        <WatermelonSearch
          v-model="query"
          label="搜索入库仓位"
          placeholder="仓位、流水号、批次号或材质"
          :maxlength="80"
          :disabled="choosing"
          @search="findLocations"
        />
        <span ref="columnTools" />
      </div>
      <p v-if="error" class="location-error" role="alert">{{ error }}</p>
      <WatermelonDataTable
        :data="items"
        :loading="loading"
        columns-key="WarehouseLocationSelect-picker"
        :column-settings-target="columnTools"
        :required-columns="['仓位', '现有物料']"
        row-key="id"
        max-height="440"
      >
        <ElTableColumn label="仓位" prop="name" min-width="130" />
        <ElTableColumn label="状态" width="110">
          <template #default="{ row }">{{
            lease?.id === row.id
              ? '本单已选'
              : row.draft_locked
                ? '填写中'
                : row.status === 'locked'
                  ? '待签收'
                  : locationState[row.status as WarehouseLocation['status']]
          }}</template>
        </ElTableColumn>
        <ElTableColumn label="现有物料" min-width="330">
          <template #default="{ row }">
            <div v-if="row.batches.length" class="location-materials">
              <div v-for="batch in row.batches" :key="batch.id">
                <strong>{{ batch.serial_no || '无流水号' }}</strong>
                · {{ batch.material_name || '—' }} · {{ materialTypeLabel(batch.material_type) }}
                <small
                  >{{ batch.batch_no }} · {{ amount(batch.quantity) }} 件 ·
                  {{ amount(batch.weight) }} kg ·
                  {{ batch.status === 'received' ? '在库' : '待签收' }}</small
                >
              </div>
            </div>
            <span v-else>空仓位</span>
          </template>
        </ElTableColumn>
        <ElTableColumn label="操作" width="108" fixed="right">
          <template #default="{ row }">
            <WatermelonButton
              class="location-choice"
              :data-location="row.name"
              :disabled="disabled || choosing || loading || !selectable(row as WarehouseLocation)"
              @click="choose(row.name)"
              >{{ modelValue === row.name ? '已选择' : '选择' }}</WatermelonButton
            >
          </template>
        </ElTableColumn>
        <template #empty>暂无可选仓位，请更换搜索条件或先在仓库管理中设置</template>
      </WatermelonDataTable>
      <WatermelonPagination
        :total="total"
        :current-page="page"
        :page-size="20"
        :show-size="false"
        :disabled="loading || choosing"
        @current-change="changePage"
      />
    </WatermelonDialog>
    <div v-if="showStockPreview && selectedStock?.batches.length" class="location-stock">
      <strong>当前库存 {{ currentQuantity }} 件 · {{ currentWeight }} kg</strong>
      <span>此仓位已有 {{ selectedStock.batches.length }} 批物料</span>
      <div class="location-batches">
        <AppDetailTable columns-key="WarehouseLocationSelect-1" class="business-table">
          <thead>
            <tr>
              <th>批次号</th>
              <th>流水号</th>
              <th>材质</th>
              <th>物料类型</th>
              <th>件数</th>
              <th>重量（kg）</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="batch in selectedStock.batches" :key="batch.id">
              <td>{{ batch.batch_no }}</td>
              <td>{{ batch.serial_no || '—' }}</td>
              <td>{{ batch.material_name || '—' }}</td>
              <td>{{ materialTypeLabel(batch.material_type) }}</td>
              <td>{{ amount(batch.quantity) }}</td>
              <td>{{ amount(batch.weight) }}</td>
              <td>{{ batch.status === 'received' ? '在库' : '待签收' }}</td>
            </tr>
          </tbody>
        </AppDetailTable>
      </div>
    </div>
    <small
      v-if="lease && remainingSeconds > 0"
      class="location-countdown"
      :class="{ 'location-countdown-warning': remainingSeconds <= 60 }"
      aria-live="off"
      >已锁定 · {{ countdown }} 后释放<span v-if="remainingSeconds <= 60">，请及时提交</span></small
    >
    <small v-if="error" class="location-error" role="alert">{{ error }}</small>
    <small v-else-if="loaded && !items.length && !modelValue" role="status">{{
      required ? '暂无可用仓位，请先在仓库管理中设置' : '暂无可用仓位，可不填写'
    }}</small>
  </div>
</template>

<style scoped>
.warehouse-location-select {
  width: 100%;
}
.warehouse-location-select > small {
  display: block;
  margin-top: 6px;
  line-height: 1.5;
  color: var(--subtle);
  font-size: var(--font-size-meta);
}
.warehouse-location-select > .location-countdown {
  color: var(--primary);
  font-variant-numeric: tabular-nums;
}
.warehouse-location-select > .location-countdown-warning {
  color: var(--wm-warning-text, #aa6c19);
}
.location-error {
  color: var(--danger);
}
.location-selection,
.location-picker-tools {
  display: flex;
  align-items: center;
  gap: 12px;
}
.location-trigger {
  flex: 1;
  min-width: 0;
  justify-content: space-between;
}
.location-trigger :deep(.wm-button-label) {
  width: 100%;
  justify-content: space-between;
}
.location-trigger-hint,
.location-picker-hint,
.location-materials small {
  color: var(--subtle);
  font-size: var(--font-size-meta);
}
.location-picker-tools {
  margin: 16px 0;
  flex-wrap: wrap;
  justify-content: space-between;
}
.location-picker-tools .wm-search {
  flex: 1;
  min-width: min(260px, 100%);
}
.location-materials > div + div {
  margin-top: 8px;
}
.location-materials {
  white-space: normal;
}
.location-materials small {
  display: block;
}
.location-stock {
  margin-top: 8px;
  padding: 10px;
  border-radius: 8px;
  background: var(--surface-soft, #f4f8f5);
  font-size: var(--font-size-meta);
  line-height: 1.5;
}
.location-stock > strong,
.location-stock > span {
  display: block;
}
.location-stock > span {
  color: var(--subtle);
  margin: 3px 0 6px;
}
.location-batches {
  max-height: 180px;
  overflow: auto;
}
.location-batches table {
  width: 100%;
  border-collapse: collapse;
  white-space: nowrap;
}
.location-batches th,
.location-batches td {
  padding: 4px 6px;
  text-align: right;
  border-bottom: 1px solid var(--line);
}
.location-batches th[data-column-index='1'],
.location-batches td[data-column-index='1'] {
  text-align: left;
}
</style>
