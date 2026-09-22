<script setup lang="ts">
import { FullScreen, Search } from '@element-plus/icons-vue'
import {
  ElButton,
  ElCard,
  ElEmpty,
  ElIcon,
  ElInput,
  ElTable,
  ElTableColumn,
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
import { externalActionLabel, isExternalTransfer, materialTransferStatusLabel } from '@/types/materialTransfer'
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
const asScanRecord = (row: unknown) => row as ScanRecord
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
    <h1 class="sr-only">扫码查询</h1>

    <div class="scan-workspace">
      <ElCard class="scanner-panel" shadow="never">
        <div class="scanner-main">
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
          <span class="scanner-shortcuts"><kbd>F2</kbd> 定位输入框</span>
          <ElTag type="success" effect="plain"><span class="scanner-online"><i />{{ scanning ? '查询中' : '扫码就绪' }}</span></ElTag>
        </div>
        <p v-if="errorMessage" class="scanner-error" role="alert">{{ errorMessage }}</p>
      </ElCard>

      <ElCard class="recent-panel" shadow="never">
        <template #header>
          <div class="recent-heading"><h2>本次查询</h2><span>{{ recentRecords.length }} 条 / 最近 8 条</span></div>
        </template>
        <div v-if="recentRecords.length" class="table-region">
          <ElTable :data="recentRecords" :row-key="recordCode" class="business-table scan-history-table" @row-click="openRecent">
            <ElTableColumn label="批次号" min-width="240"><template #default="{ row }"><ElButton link type="primary" @click.stop="openRecent(asScanRecord(row))">{{ recordCode(asScanRecord(row)) }}</ElButton></template></ElTableColumn>
            <ElTableColumn label="流水号" min-width="170"><template #default="{ row }">{{ row.kind === 'group' ? `历史合并单 · ${row.value.line_count} 条物料明细` : row.value.serial_no }}</template></ElTableColumn>
            <ElTableColumn label="来源" min-width="120"><template #default="{ row }">{{ row.value.source_team?.name || '外部来料' }}</template></ElTableColumn>
            <ElTableColumn label="去向" min-width="120"><template #default="{ row }">{{ row.value.next_team.name }}</template></ElTableColumn>
            <ElTableColumn label="件数" min-width="100"><template #default="{ row }">{{ row.kind === 'group' ? row.value.total_quantity : row.value.quantity }}</template></ElTableColumn>
            <ElTableColumn label="重量（kg）" min-width="120"><template #default="{ row }">{{ row.kind === 'group' ? row.value.total_weight : row.value.weight }}</template></ElTableColumn>
            <ElTableColumn label="状态" min-width="110"><template #default="{ row }"><ElTag effect="plain">{{ row.kind === 'group' ? dispatchStatusLabel(row.value.status, row.value.entry_kind) : materialTransferStatusLabel(row.value.status, row.value.entry_kind) }}</ElTag></template></ElTableColumn>
            <ElTableColumn label="最近更新" min-width="180"><template #default="{ row }">{{ formatDateTime(row.kind === 'group' ? row.value.created_at : row.value.updated_at) }}</template></ElTableColumn>
          </ElTable>
        </div>
        <ElEmpty v-else :image-size="48" description="暂无查询记录" />
      </ElCard>
    </div>

    <MaterialDispatchDrawer v-model="groupOpen" :dispatch-no="selectedDispatchNo" @changed="updateGroup" />
    <MaterialTransferDrawer v-model="drawerOpen" :batch-no="selected?.batch_no" :transfer="selected" @changed="updateRecent" />
  </section>
</template>

<style scoped>
.scanner-online { display: inline-flex; align-items: center; gap: 7px; }
.scanner-online i { width: 6px; height: 6px; border-radius: 50%; background: var(--el-color-success); }
.scan-workspace { display: flex; flex-direction: column; min-width: 0; gap: 12px; }
.scanner-panel, .recent-panel { min-height: 0; overflow: hidden; }
.material-scan-page .scanner-panel :deep(.el-card__body) { padding: 16px; }
.scanner-main { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.material-scan-page .scanner-input { flex: 1 1 360px; max-width: 680px; margin-top: 0; }
.scanner-input :deep(.el-input__wrapper) { min-height: 44px; font-size: 16px; }
.scanner-input :deep(.el-input-group__append) { padding: 0; }
.scanner-input :deep(.el-input-group__append .el-button) { min-width: 80px; min-height: 42px; margin: 0; border-radius: 0 4px 4px 0; }
.scanner-error { width: 100%; margin-top: 8px; color: var(--danger); font-size: 14px; }
.scanner-shortcuts { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 14px; }
.scanner-shortcuts kbd { padding: 2px 6px; border: 1px solid var(--line); border-radius: 3px; background: #fafbfc; font-family: inherit; }
.scanner-main > .el-tag { margin-left: auto; }
.recent-panel :deep(.el-card__header) { padding: 14px 16px; }
.recent-panel :deep(.el-card__body) { padding: 0; }
.recent-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.recent-heading h2 { margin: 0; font-size: 16px; font-weight: 600; }
.recent-heading > span { color: var(--muted); font-size: 14px; }
.scan-history-table :deep(.el-table__row) { cursor: pointer; }
@media (max-width: 640px) { .scanner-main { gap: 12px; }.material-scan-page .scanner-input { flex-basis: 100%; }.scanner-shortcuts { font-size: 13px; } }
</style>
