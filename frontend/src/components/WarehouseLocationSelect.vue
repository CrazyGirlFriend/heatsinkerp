<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElOption, ElSelect } from 'element-plus'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import { locationState, warehouseLocationApi, type WarehouseLease, type WarehouseLocation, type WarehouseLeaseGroup, type WarehouseMaterial } from '@/services/warehouseLocationApi'
import { materialTypeLabel } from '@/types/materialTransfer'

const props = withDefaults(defineProps<{ modelValue: string; reservationKey?: string; teamId: number; active?: boolean; disabled?: boolean; serialNo?: string; materialName?: string; materialType?: string; leaseGroup?: WarehouseLeaseGroup }>(), { active: true, reservationKey: '' })
const emit = defineEmits<{ 'update:modelValue': [value: string]; 'update:reservationKey': [value: string]; busyChange: [value: boolean] }>()
const items = ref<WarehouseLocation[]>([]), lease = ref<WarehouseLease | null>(null)
const loading = ref(false), choosing = ref(false), loaded = ref(false), error = ref('')
const now = ref(Date.now())
const material = computed<WarehouseMaterial | undefined>(() => props.serialNo?.trim() && props.materialName?.trim() && props.materialType ? { serial_no: props.serialNo.trim(), material_name: props.materialName.trim(), material_type: props.materialType } : undefined)
const materialKey = computed(() => JSON.stringify(material.value))
const owner = Symbol('warehouse-line')
const selectedStock = computed(() => items.value.find(item => item.name === props.modelValue))
const currentStock = computed(() => selectedStock.value?.batches.filter(batch => batch.status === 'received') || [])
const amount = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 3 })
const currentQuantity = computed(() => amount(currentStock.value.reduce((sum, batch) => sum + batch.quantity, 0)))
const currentWeight = computed(() => amount(currentStock.value.reduce((sum, batch) => sum + batch.weight, 0)))
let defaultAttempted = false
function compatible(item: WarehouseLocation) {
  return !!material.value && item.batches.length > 0 && item.batches.every(batch => batch.serial_no === material.value!.serial_no && batch.material_name === material.value!.material_name && batch.material_type === material.value!.material_type)
}
function selectable(item: WarehouseLocation) {
  const shared = props.leaseGroup?.get(item.id)
  if (shared) return item.active && shared.material === materialKey.value
  return item.active && !item.draft_locked && (item.status === 'available' || compatible(item))
}
const remainingSeconds = computed(() => lease.value?.hold_until ? Math.max(0, Math.ceil((Date.parse(lease.value.hold_until) - now.value) / 1000)) : 0)
const countdown = computed(() => `${String(Math.floor(remainingSeconds.value / 60)).padStart(2, '0')}:${String(remainingSeconds.value % 60).padStart(2, '0')}`)
let generation = 0, searchVersion = 0
let heartbeat: ReturnType<typeof setInterval> | undefined
let deadlineTimer: ReturnType<typeof setTimeout> | undefined
let countdownTimer: ReturnType<typeof setInterval> | undefined
const key = () => globalThis.crypto?.randomUUID?.() || `warehouse-${Date.now()}-${Math.random().toString(16).slice(2)}`
function busy(value: boolean) { choosing.value = value; emit('busyChange', value) }
async function release(value: WarehouseLease | null) {
  const shared = value && props.leaseGroup?.get(value.id)
  if (shared && value && shared.key === value.key) {
    shared.owners.delete(owner)
    if (shared.owners.size) return
    props.leaseGroup!.delete(value.id)
  }
  if (value) await warehouseLocationApi.release(value.id, value.key, true).catch(() => { /* The bounded lease also releases after a lost connection. */ })
}
async function search(query = '') {
  const version = ++searchVersion, team = props.teamId
  if (!team || !props.active) return
  loading.value = true
  try {
    const result = await teamMaterialApi.warehouseLocations(team, query.slice(0, 80), props.modelValue, material.value)
    if (version !== searchVersion || !props.active) return
    items.value = result.items; loaded.value = true
    for (const shared of props.leaseGroup?.values() || []) {
      if (shared.material === materialKey.value && !items.value.some(item => item.id === shared.slot.id)) items.value.push(shared.slot)
    }
    // A saved uncertain submission keeps its original key for safe retries.
    const selected = items.value.find(item => item.name === props.modelValue)
    if (!lease.value && selected && props.reservationKey) lease.value = { id: selected.id, name: selected.name, key: props.reservationKey, expires_at: '', hold_until: '' }
    if (!query && material.value && !props.modelValue && !props.disabled && !defaultAttempted) {
      defaultAttempted = true
      const available = items.value.filter(selectable)
      const preferred = available.find(compatible) || available.find(item => props.leaseGroup?.get(item.id)?.material === materialKey.value) || available[0]
      if (preferred) void choose(preferred.name)
    }
  } catch (failure) {
    if (version === searchVersion) error.value = failure instanceof Error ? failure.message : '仓位读取失败，请重新展开重试'
  } finally { if (version === searchVersion) loading.value = false }
}
async function choose(name: string) {
  if (props.disabled || choosing.value) return
  const version = ++generation, previous = lease.value
  error.value = ''
  if (!name) {
    lease.value = null; emit('update:modelValue', ''); emit('update:reservationKey', '')
    await release(previous); await search(); return
  }
  if (previous?.name === name) return
  const item = items.value.find(item => item.name === name && selectable(item))
  if (!item) { error.value = '该仓位已不可选，请刷新后重新选择'; await search(); return }
  busy(true)
  const shared = props.leaseGroup?.get(item.id)
  const claimKey = shared?.key || key()
  if (props.leaseGroup) {
    const entry = shared || { key: claimKey, material: materialKey.value, owners: new Set<symbol>(), slot: item }
    entry.owners.add(owner); props.leaseGroup.set(item.id, entry)
  }
  try {
    const claimed = await warehouseLocationApi.reserve(item.id, claimKey, material.value)
    if (version !== generation || !props.active) { await release(claimed); return }
    lease.value = claimed
    scheduleDeadline()
    emit('update:modelValue', claimed.name); emit('update:reservationKey', claimed.key)
    await release(previous)
  } catch (failure) {
    await release({ id: item.id, name, key: claimKey, expires_at: '', hold_until: '' })
    if (version === generation) error.value = failure instanceof Error ? failure.message : '仓位锁定失败，请重新选择'
  } finally {
    if (version === generation) { busy(false); await search() }
  }
}
async function renew() {
  const current = lease.value, version = generation
  if (!current || !props.active || props.disabled || choosing.value) return
  try {
    const renewed = await warehouseLocationApi.reserve(current.id, current.key, material.value)
    if (version === generation && lease.value === current) { lease.value = renewed; scheduleDeadline() }
    else await release(renewed)
  }
  catch (failure) {
    if (version !== generation || lease.value !== current) return
    lease.value = null; emit('update:modelValue', ''); emit('update:reservationKey', '')
    error.value = failure instanceof Error ? failure.message : '仓位锁定已失效，请重新选择'
    await release(current); await search()
  }
}
function scheduleDeadline() {
  now.value = Date.now()
  clearTimeout(deadlineTimer)
  const current = lease.value
  if (!current?.hold_until || !props.active || props.disabled) return
  const remaining = Date.parse(current.hold_until) - Date.now()
  if (remaining > 0) { deadlineTimer = setTimeout(scheduleDeadline, remaining); return }
  lease.value = null; emit('update:modelValue', ''); emit('update:reservationKey', '')
  error.value = '10 分钟未提交，仓位已释放，请重新选择'
  void release(current).then(() => search())
}
watch(() => props.disabled, value => { scheduleDeadline(); if (!value && !props.modelValue) void search() })
function cleanup() {
  ++generation; ++searchVersion; clearTimeout(deadlineTimer); loading.value = false; busy(false)
  const previous = lease.value; lease.value = null
  void release(previous)
}
function pagehide() { cleanup(); emit('update:modelValue', ''); emit('update:reservationKey', '') }
watch(() => [props.active, props.teamId, materialKey.value], () => {
  const selected = lease.value
  cleanup();
  if (selected) { emit('update:modelValue', ''); emit('update:reservationKey', '') }
  items.value = []; loaded.value = false; error.value = ''; defaultAttempted = false
  if (props.active) void search()
}, { immediate: true })
watch(() => props.modelValue, value => { if (!value && lease.value) cleanup() })
onMounted(() => { countdownTimer = setInterval(() => { now.value = Date.now() }, 1000); heartbeat = setInterval(() => void renew(), 45_000); window.addEventListener('pagehide', pagehide) })
onBeforeUnmount(() => { cleanup(); clearInterval(heartbeat); clearInterval(countdownTimer); window.removeEventListener('pagehide', pagehide) })
</script>

<template>
  <div class="warehouse-location-select">
    <ElSelect :model-value="modelValue" :disabled="disabled || choosing" aria-label="入库仓位" placeholder="选择仓位（选填）" filterable clearable remote :remote-method="search" :loading="loading || choosing" no-data-text="暂无可用仓位，可不填写" @visible-change="open => { if (open) search() }" @update:model-value="choose(String($event || ''))">
      <ElOption v-for="item in items" :key="item.id" :value="item.name" :label="item.name" :disabled="!selectable(item) && lease?.id !== item.id"><span>{{ item.name }}</span><small>{{ lease?.id === item.id ? '本单已锁定' : compatible(item) ? '同类库存' : locationState[item.status] }}</small></ElOption>
    </ElSelect>
    <div v-if="selectedStock?.batches.length" class="location-stock">
      <strong>当前库存 {{ currentQuantity }} 件 · {{ currentWeight }} kg</strong>
      <span>{{ selectedStock.batches[0]?.serial_no }} · {{ selectedStock.batches[0]?.material_name }} · {{ materialTypeLabel(selectedStock.batches[0]?.material_type) }}</span>
      <div class="location-batches"><table><thead><tr><th>批次号</th><th>件数</th><th>重量（kg）</th><th>状态</th></tr></thead><tbody><tr v-for="batch in selectedStock.batches" :key="batch.id"><td>{{ batch.batch_no }}</td><td>{{ amount(batch.quantity) }}</td><td>{{ amount(batch.weight) }}</td><td>{{ batch.status === 'received' ? '在库' : '待签收' }}</td></tr></tbody></table></div>
    </div>
    <small v-if="lease && remainingSeconds > 0" class="location-countdown" :class="{ 'location-countdown-warning': remainingSeconds <= 60 }" aria-live="off">已锁定 · {{ countdown }} 后释放<span v-if="remainingSeconds <= 60">，请及时提交</span></small>
    <small v-if="error" class="location-error" role="alert">{{ error }}</small>
    <small v-else-if="loaded && !items.length && !modelValue" role="status">暂无可用仓位，可不填写</small>
  </div>
</template>

<style scoped>
.warehouse-location-select { width: 100%; }
.warehouse-location-select > small { display: block; margin-top: 6px; line-height: 1.5; color: var(--subtle); font-size: 12px; }
.warehouse-location-select > .location-countdown { color: var(--primary); font-variant-numeric: tabular-nums; }
.warehouse-location-select > .location-countdown-warning { color: #aa6c19; }
.warehouse-location-select > .location-error { color: var(--danger); }
.el-select { width: 100%; }
.el-select-dropdown__item { display: flex; align-items: center; justify-content: space-between; gap: 20px; }
.el-select-dropdown__item small { color: var(--subtle); font-size: 12px; }
.location-stock { margin-top: 8px; padding: 10px; border-radius: 8px; background: var(--surface-soft, #f4f8f5); font-size: 12px; line-height: 1.5; }
.location-stock > strong, .location-stock > span { display: block; }
.location-stock > span { color: var(--subtle); margin: 3px 0 6px; }
.location-batches { max-height: 180px; overflow: auto; }
.location-batches table { width: 100%; border-collapse: collapse; white-space: nowrap; }
.location-batches th, .location-batches td { padding: 4px 6px; text-align: right; border-bottom: 1px solid var(--line); }
.location-batches th:first-child, .location-batches td:first-child { text-align: left; }
</style>
