<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElOption, ElSelect } from 'element-plus'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import { locationState, warehouseLocationApi, type WarehouseLease, type WarehouseLocation } from '@/services/warehouseLocationApi'

const props = withDefaults(defineProps<{ modelValue: string; reservationKey?: string; teamId: number; active?: boolean; disabled?: boolean }>(), { active: true, reservationKey: '' })
const emit = defineEmits<{ 'update:modelValue': [value: string]; 'update:reservationKey': [value: string]; busyChange: [value: boolean] }>()
const items = ref<WarehouseLocation[]>([]), lease = ref<WarehouseLease | null>(null)
const loading = ref(false), choosing = ref(false), loaded = ref(false), error = ref('')
const now = ref(Date.now())
const remainingSeconds = computed(() => lease.value?.hold_until ? Math.max(0, Math.ceil((Date.parse(lease.value.hold_until) - now.value) / 1000)) : 0)
const countdown = computed(() => `${String(Math.floor(remainingSeconds.value / 60)).padStart(2, '0')}:${String(remainingSeconds.value % 60).padStart(2, '0')}`)
let generation = 0, searchVersion = 0
let heartbeat: ReturnType<typeof setInterval> | undefined
let deadlineTimer: ReturnType<typeof setTimeout> | undefined
let countdownTimer: ReturnType<typeof setInterval> | undefined
const key = () => globalThis.crypto?.randomUUID?.() || `warehouse-${Date.now()}-${Math.random().toString(16).slice(2)}`
function busy(value: boolean) { choosing.value = value; emit('busyChange', value) }
async function release(value: WarehouseLease | null) {
  if (value) await warehouseLocationApi.release(value.id, value.key, true).catch(() => { /* The bounded lease also releases after a lost connection. */ })
}
async function search(query = '') {
  const version = ++searchVersion, team = props.teamId
  if (!team || !props.active) return
  loading.value = true
  try {
    const result = await teamMaterialApi.warehouseLocations(team, query.slice(0, 80), props.modelValue)
    if (version !== searchVersion || !props.active) return
    items.value = result.items; loaded.value = true
    // A saved uncertain submission keeps its original key for safe retries.
    const selected = items.value.find(item => item.name === props.modelValue)
    if (!lease.value && selected && props.reservationKey) lease.value = { id: selected.id, name: selected.name, key: props.reservationKey, expires_at: '', hold_until: '' }
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
  const item = items.value.find(item => item.name === name && item.status === 'available')
  if (!item) { error.value = '该仓位已不可选，请刷新后重新选择'; await search(); return }
  busy(true)
  try {
    const claimed = await warehouseLocationApi.reserve(item.id, key())
    if (version !== generation || !props.active) { await release(claimed); return }
    lease.value = claimed
    scheduleDeadline()
    emit('update:modelValue', claimed.name); emit('update:reservationKey', claimed.key)
    await release(previous)
  } catch (failure) {
    if (version === generation) error.value = failure instanceof Error ? failure.message : '仓位锁定失败，请重新选择'
  } finally {
    if (version === generation) { busy(false); await search() }
  }
}
async function renew() {
  const current = lease.value, version = generation
  if (!current || !props.active || props.disabled || choosing.value) return
  try {
    const renewed = await warehouseLocationApi.reserve(current.id, current.key)
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
watch(() => props.disabled, () => scheduleDeadline())
function cleanup() {
  ++generation; ++searchVersion; clearTimeout(deadlineTimer); loading.value = false; busy(false)
  const previous = lease.value; lease.value = null
  void release(previous)
}
function pagehide() { cleanup(); emit('update:modelValue', ''); emit('update:reservationKey', '') }
watch(() => [props.active, props.teamId], () => {
  const selected = lease.value
  cleanup();
  if (selected) { emit('update:modelValue', ''); emit('update:reservationKey', '') }
  items.value = []; loaded.value = false; error.value = ''
  if (props.active) void search()
}, { immediate: true })
watch(() => props.modelValue, value => { if (!value && lease.value) cleanup() })
onMounted(() => { countdownTimer = setInterval(() => { now.value = Date.now() }, 1000); heartbeat = setInterval(() => void renew(), 45_000); window.addEventListener('pagehide', pagehide) })
onBeforeUnmount(() => { cleanup(); clearInterval(heartbeat); clearInterval(countdownTimer); window.removeEventListener('pagehide', pagehide) })
</script>

<template>
  <div class="warehouse-location-select">
    <ElSelect :model-value="modelValue" :disabled="disabled || choosing" aria-label="入库仓位" placeholder="选择空闲仓位（选填）" filterable clearable remote :remote-method="search" :loading="loading || choosing" no-data-text="暂无空闲仓位，可不填写" @visible-change="open => { if (open) search() }" @update:model-value="choose(String($event || ''))">
      <ElOption v-for="item in items" :key="item.id" :value="item.name" :label="item.name" :disabled="item.status !== 'available' && lease?.id !== item.id"><span>{{ item.name }}</span><small>{{ lease?.id === item.id && item.status === 'locked' ? '本单已锁定' : locationState[item.status] }}</small></ElOption>
    </ElSelect>
    <small v-if="lease && remainingSeconds > 0" class="location-countdown" :class="{ 'location-countdown-warning': remainingSeconds <= 60 }" aria-live="off">已锁定 · {{ countdown }} 后释放<span v-if="remainingSeconds <= 60">，请及时提交</span></small>
    <small v-if="error" class="location-error" role="alert">{{ error }}</small>
    <small v-else-if="loaded && !items.length && !modelValue" role="status">暂无空闲仓位，可不填写</small>
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
</style>
