<script setup lang="ts">
import { FullScreen, ArrowRight, Clock, Search } from '@element-plus/icons-vue'
import {
  ElButton,
  ElCard,
  ElEmpty,
  ElIcon,
  ElInput,
  ElScrollbar,
  ElTag,
  type InputInstance,
} from 'element-plus'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import MaterialTransferDrawer from '@/components/MaterialTransferDrawer.vue'
import MaterialDispatchDrawer from '@/components/MaterialDispatchDrawer.vue'
import { materialDispatchApi } from '@/services/materialDispatchApi'
import { isDispatchNumber, dispatchStatusLabel, type MaterialDispatchDocument } from '@/types/teamMaterials'
import { MaterialTransferApiError, materialTransferApi } from '@/services/materialTransferApi'
import { useAuthStore } from '@/stores/auth'
import { showToast } from '@/stores/toast'
import type { MaterialTransfer } from '@/types/materialTransfer'
import { externalActionLabel, isExternalTransfer, materialTransferStatusLabel, materialTypeLabel } from '@/types/materialTransfer'
import { formatDateTime } from '@/utils/format'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const scanInput = ref<InputInstance>()
const scanValue = ref('')
const scanning = ref(false)
const errorMessage = ref('')
const drawerOpen = ref(false)
const selected = ref<MaterialTransfer | null>(null)
const groupOpen = ref(false)
const selectedDispatchNo = ref('')
type ScanRecord = { kind: 'group'; value: MaterialDispatchDocument } | { kind: 'line'; value: MaterialTransfer }
const recentRecords = ref<ScanRecord[]>([])
const anyDetailOpen = computed(() => drawerOpen.value || groupOpen.value)
const recordCode = (record: ScanRecord) => record.kind === 'group' ? record.value.dispatch_no : record.value.batch_no
function remember(record: ScanRecord) { recentRecords.value = [record, ...recentRecords.value.filter(item => recordCode(item) !== recordCode(record))].slice(0, 8) }
let scanVersion = 0
let hidBuffer = ''
let hidLastKeyAt = 0
let disposed = false

function focusScanner(): void {
  void nextTick(() => {
    scanInput.value?.focus()
    scanInput.value?.select()
  })
}

async function scan(raw?: string): Promise<void> {
  const batchNo = (raw ?? scanValue.value).trim().toUpperCase()
  if (!batchNo || scanning.value) return
  const version = ++scanVersion
  scanning.value = true
  errorMessage.value = ''
  try {
    if (isDispatchNumber(batchNo)) {
      const group = await materialDispatchApi.get(batchNo)
      if (disposed || version !== scanVersion) return
      selectedDispatchNo.value = group.dispatch_no; drawerOpen.value = false; groupOpen.value = true
      remember({ kind: 'group', value: group }); scanValue.value = ''
      await router.replace({ path: route.path, query: { ...route.query, batch_no: group.dispatch_no } })
      showToast(`已读取历史合并单 ${group.dispatch_no}，共 ${group.line_count} 条物料明细`, 'success')
      return
    }
    const transfer = await materialTransferApi.get(batchNo)
    if (disposed || version !== scanVersion) return
    selected.value = transfer
    remember({ kind: 'line', value: transfer }); groupOpen.value = false
    scanValue.value = ''
    drawerOpen.value = true
    await router.replace({ path: route.path, query: { ...route.query, batch_no: transfer.batch_no } })
    showToast(`已读取${transfer.entry_kind === 'warehouse_receipt' ? '入库单' : isExternalTransfer(transfer) ? `${externalActionLabel(transfer.entry_kind)}单` : '转料单'} ${transfer.batch_no}`, 'success')
  } catch (error) {
    if (disposed || version !== scanVersion) return
    errorMessage.value = error instanceof MaterialTransferApiError && error.status === 404
      ? `未找到单据 ${batchNo}`
      : error instanceof Error ? error.message : '转料单查询失败'
    showToast(errorMessage.value, 'error')
    focusScanner()
  } finally {
    if (!disposed && version === scanVersion) scanning.value = false
  }
}

function openRecent(record: ScanRecord): void {
  if (record.kind === 'group') { selectedDispatchNo.value = record.value.dispatch_no; drawerOpen.value = false; groupOpen.value = true }
  else { selected.value = record.value; groupOpen.value = false; drawerOpen.value = true }
}
function updateRecent(transfer: MaterialTransfer): void { remember({ kind: 'line', value: transfer }); selected.value = transfer }
function updateGroup(group: MaterialDispatchDocument): void { remember({ kind: 'group', value: group }) }

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

function handleHidKeydown(event: KeyboardEvent): void {
  if (anyDetailOpen.value || isEditableTarget(event.target) || event.ctrlKey || event.metaKey || event.altKey) return
  if (event.key === 'F2') {
    event.preventDefault()
    focusScanner()
    return
  }
  const now = Date.now()
  if (event.key === 'Enter' || event.key === 'Tab') {
    const code = hidBuffer.toUpperCase()
    const isScannerInput = Boolean(code) && now - hidLastKeyAt <= 180 && /^(?:TL|CK)[A-Z0-9-]{4,}$/.test(code)
    hidBuffer = ''
    hidLastKeyAt = 0
    if (isScannerInput) {
      event.preventDefault()
      scanValue.value = code
      void scan(code)
    }
    return
  }
  if (event.key.length !== 1 || !/^[\x21-\x7e]$/.test(event.key)) {
    hidBuffer = ''
    hidLastKeyAt = 0
    return
  }
  if (hidLastKeyAt && now - hidLastKeyAt > 180) hidBuffer = ''
  hidBuffer = `${hidBuffer}${event.key}`.slice(-64)
  hidLastKeyAt = now
}

watch(anyDetailOpen, (open) => {
  if (open) return
  const { batch_no: _batchNo, ...query } = route.query
  void router.replace({ path: route.path, query })
  focusScanner()
})

watch(() => `${authStore.currentUser?.id ?? ''}:${authStore.currentUser?.team_id ?? ''}:${authStore.isTeamAccount}`, () => { ++scanVersion; scanning.value = false; drawerOpen.value = false; groupOpen.value = false; selected.value = null; selectedDispatchNo.value = ''; recentRecords.value = []; scanValue.value = ''; errorMessage.value = '' })

onMounted(() => {
  window.addEventListener('keydown', handleHidKeydown)
  const batchNo = typeof route.query.batch_no === 'string' ? route.query.batch_no : ''
  if (batchNo) {
    scanValue.value = batchNo
    void scan()
  } else focusScanner()
})

onBeforeUnmount(() => {
  disposed = true
  ++scanVersion
  window.removeEventListener('keydown', handleHidKeydown)
})
</script>

<template>
  <section class="page workspace-page material-scan-page reading-workspace">
    <header class="page-heading scan-heading">
      <div><h1>扫码查询</h1></div>
      <ElTag type="success" effect="plain"><span class="scanner-online"><i />扫码监听已启用</span></ElTag>
    </header>

    <div class="scan-workspace">
      <ElCard class="scanner-panel" shadow="never">
        <div class="scanner-main">
          <span class="scanner-icon"><ElIcon><FullScreen /></ElIcon></span>
          <h2>扫描单据条码</h2>
          <p v-if="authStore.currentUser?.team">当前班组：<strong>{{ authStore.currentUser.team.name }}</strong></p>
          <p v-else>管理员扫描后可查看单据详情。</p>
          <ElInput
            ref="scanInput"
            v-model="scanValue"
            class="scanner-input"
            size="large"
            clearable
            autocomplete="off"
            autocapitalize="characters"
            spellcheck="false"
            aria-label="转料批次条形码"
            :disabled="scanning"
            placeholder="扫描条形码或输入批次号"
            @keyup.enter="scan()"
          >
            <template #prefix><ElIcon><FullScreen /></ElIcon></template>
            <template #append><ElButton type="primary" :icon="Search" :loading="scanning" :disabled="!scanValue.trim()" @click="scan()">查询</ElButton></template>
          </ElInput>
          <span v-if="errorMessage" class="scanner-error" role="alert">{{ errorMessage }}</span>
          <div class="scanner-shortcuts"><kbd>F2</kbd><span>聚焦扫码框</span><i /><kbd>Enter</kbd><span>读取单据</span></div>
        </div>
      </ElCard>

      <ElCard class="recent-panel" shadow="never">
        <template #header>
          <div class="recent-heading"><span><ElIcon><Clock /></ElIcon><strong>本次扫码记录</strong></span><small>{{ recentRecords.length }} / 8</small></div>
        </template>
        <ElScrollbar v-if="recentRecords.length" class="recent-scroll">
          <div class="recent-list">
            <ElButton v-for="record in recentRecords" :key="recordCode(record)" text class="recent-item" @click="openRecent(record)">
              <span class="recent-item__head"><strong>{{ recordCode(record) }}</strong><ElTag size="small" effect="plain">{{ record.kind === 'group' ? dispatchStatusLabel(record.value.status, record.value.entry_kind) : materialTransferStatusLabel(record.value.status, record.value.entry_kind) }}</ElTag></span>
              <span class="recent-item__route"><b>{{ record.value.source_team?.name }}</b><ElIcon><ArrowRight /></ElIcon><b>{{ record.value.next_team.name }}</b></span>
              <span v-if="record.kind === 'group'" class="recent-material">{{ record.value.line_count }} 条物料明细<span>{{ record.value.total_quantity }} 件 · {{ record.value.total_weight }} kg</span></span>
              <span v-else class="recent-material">{{ materialTypeLabel(record.value.material_type) }}<template v-if="record.value.material_name"> · {{ record.value.material_name }}</template><span>{{ record.value.quantity }} 件 · {{ record.value.weight }} kg</span></span>
              <span class="recent-item__meta"><i>{{ record.kind === 'group' ? '历史合并单' : record.value.serial_no }}</i><time>{{ formatDateTime(record.kind === 'group' ? record.value.created_at : record.value.updated_at) }}</time></span>
            </ElButton>
          </div>
        </ElScrollbar>
        <ElEmpty v-else :image-size="76" description="暂无扫码记录" />
      </ElCard>
    </div>

    <MaterialDispatchDrawer v-model="groupOpen" :dispatch-no="selectedDispatchNo" @changed="updateGroup" />
    <MaterialTransferDrawer v-model="drawerOpen" :batch-no="selected?.batch_no" :transfer="selected" @changed="updateRecent" />
  </section>
</template>

<style scoped>
.recent-material { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 6px 12px; color: var(--muted); font-size: 12px; text-align: left; white-space: normal; overflow-wrap: anywhere; }
.scan-heading > div > span { display: block; margin-top: 8px; color: var(--subtle); font-size: 14px; }
.scanner-online { display: inline-flex; align-items: center; gap: 7px; }
.scanner-online i { width: 6px; height: 6px; border-radius: 50%; background: var(--el-color-success); }
.scan-workspace { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(340px, .8fr); flex: 1; min-height: 0; gap: 16px; }
.scanner-panel, .recent-panel { min-height: 0; overflow: hidden; }
.scanner-panel :deep(.el-card__body) { display: grid; height: 100%; min-height: 0; align-items: start; padding: 32px; }
.scanner-main { display: flex; align-items: flex-start; width: 100%; padding-block: 20px; flex-direction: column; }
.scanner-icon { color: var(--navy); font-size: 40px; line-height: 1; }
.scanner-main h2 { margin: 24px 0 0; color: var(--text); font-size: 24px; font-weight: 600; }
.scanner-main p { margin: 12px 0 0; color: var(--subtle); font-size: 14px; }
.scanner-main p strong { color: var(--text); font-weight: 500; }
.scanner-input { width: 100%; margin-top: 32px; }
.scanner-input :deep(.el-input__wrapper) { min-height: 52px; font-size: 16px; }
.scanner-input :deep(.el-input-group__append) { padding: 0; }
.scanner-input :deep(.el-input-group__append .el-button) { min-width: 80px; min-height: 50px; margin: 0; border-radius: 0 4px 4px 0; }
.scanner-error { width: 100%; margin-top: 8px; color: var(--danger); font-size: 14px; }
.scanner-shortcuts { display: flex; align-items: center; margin-top: 20px; gap: 8px; color: var(--subtle); font-size: 13px; }
.scanner-shortcuts kbd { padding: 2px 6px; border: 1px solid var(--line); border-radius: 3px; background: #fafbfc; font-family: inherit; }
.scanner-shortcuts i { width: 1px; height: 14px; margin-inline: 4px; background: var(--line); }
.recent-panel :deep(.el-card__header) { padding: 20px 24px; }
.recent-panel :deep(.el-card__body) { height: calc(100% - 65px); min-height: 0; padding: 0; }
.recent-heading, .recent-heading > span { display: flex; align-items: center; justify-content: space-between; }
.recent-heading > span { gap: 10px; }
.recent-heading small { color: var(--subtle); font-size: 13px; }
.recent-scroll { height: 100%; }
.recent-list { padding-inline: 24px; }
.recent-item { white-space: normal; line-height: 1.5; width: 100%; height: auto; min-height: 88px; margin: 0; padding: 12px 0; border-bottom: 1px solid var(--line); border-radius: 0; text-align: left; }
.recent-item :deep(> span) { display: grid; width: 100%; gap: 12px; }
.recent-item__head, .recent-item__route, .recent-item__meta { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.recent-item__head strong { color: var(--primary); font-size: 14px; font-weight: 500; }
.recent-item__route { justify-content: flex-start; color: var(--text); }
.recent-item__route b { font-size: 14px; font-weight: 500; }
.recent-item__route .el-icon { color: var(--subtle); }
.recent-item__meta { flex-wrap: wrap; color: var(--subtle); font-size: 13px; }
.recent-item__meta i { font-style: normal; overflow-wrap: anywhere; }
@media (max-width: 1100px) { .scan-workspace { gap: 20px; } .scanner-panel :deep(.el-card__body) { padding: 24px; } }
@media (max-width: 960px) {
  .material-scan-page { height: auto; min-height: calc(100dvh - var(--topbar-height)); overflow: auto; }
  .scan-workspace { grid-template-columns: 1fr; }
  .scanner-panel :deep(.el-card__body) { min-height: 360px; }
  .scanner-main { padding-bottom: 0; }
  .recent-panel { min-height: 300px; }
}
@media (max-width: 600px) {
  .scan-heading { align-items: flex-start; flex-direction: column; gap: 16px; }
  .scan-heading > div > span { font-size: 13px; }
  .scanner-panel :deep(.el-card__body) { min-height: 330px; padding: 24px 16px; }
  .scanner-main h2 { font-size: 22px; }
  .scanner-shortcuts { gap: 6px; font-size: 12px; }
  .recent-list { padding-inline: 16px; }
}
</style>
