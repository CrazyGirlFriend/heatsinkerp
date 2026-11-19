<script setup lang="ts">
import { useTableQuery } from '@/composables/useTableQuery'
import {
  teamRecordQueryColumns,
  transferQueryColumns,
  queryColumns,
} from '@/utils/tableQueryColumns'
import ElAlert from '@/components/AppAlert.vue'
import ElSelect from '@/components/AppSelect.vue'
import PersonName from '@/components/PersonName.vue'
import WorkspaceDataPanel from '@/components/WorkspaceDataPanel.vue'
import WorkspaceTable from '@/components/WorkspaceTable.vue'
import TeamTransferRecordsTable from '@/components/TeamTransferRecordsTable.vue'
import WorkspacePagination from '@/components/WorkspacePagination.vue'
import { teamCanProcess } from '@/config/teamWorkspaces'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { ElOption, ElTableColumn } from 'element-plus'
import ElButton from '@/components/AppButton.vue'
import FilterDialog from '@/components/FilterDialog.vue'
import LiveRefreshNotice from '@/components/LiveRefreshNotice.vue'
import RecordDateFilter from '@/components/RecordDateFilter.vue'
import { useTeamWorkspaceFilters } from '@/composables/useTeamWorkspaceFilters'
import WorkspaceDataToolbar from '@/components/WorkspaceDataToolbar.vue'
import TeamWorkspaceShell from '@/components/TeamWorkspaceShell.vue'
import TeamWorkspaceActions from '@/components/TeamWorkspaceActions.vue'
import InventoryShipmentDialog from '@/components/InventoryShipmentDialog.vue'
import StockSourcePicker from '@/components/StockSourcePicker.vue'
import TeamInventory from '@/components/TeamInventory.vue'
import TeamDashboard from '@/components/TeamDashboard.vue'
import TeamQualityFeedback from '@/components/TeamQualityFeedback.vue'
import TeamReworkRequestDialog from '@/components/TeamReworkRequestDialog.vue'
import { qualityFeedbackApi } from '@/services/qualityFeedbackApi'
import TeamInspectionRecords from '@/components/TeamInspectionRecords.vue'
import TeamProcessingRecords from '@/components/TeamProcessingRecords.vue'
import type { ProcessingRecord } from '@/types/materialProcessing'
import { stockAvailable, stockSelectable } from '@/utils/materialStock'
import DeliverySchedules from '@/components/DeliverySchedules.vue'
import type { ProductionSchedule } from '@/types/productionSchedule'
import QuantityAdjustmentDialog from '@/components/QuantityAdjustmentDialog.vue'
import TeamSerialHistory from '@/components/TeamSerialHistory.vue'
import TeamBusinessDialog from '@/components/TeamBusinessDialog.vue'
import SerialReallocationDialog from '@/components/SerialReallocationDialog.vue'
import { inventoryAmount } from '@/types/teamInventory'
import type { TeamEmployee } from '@/types/teamBusiness'
import MaterialStockActionDialog from '@/components/MaterialStockActionDialog.vue'
import WarehouseManagement from '@/components/WarehouseManagement.vue'
import WarehouseReceiptDialog from '@/components/WarehouseReceiptDialog.vue'
import MaterialTransferDrawer from '@/components/MaterialTransferDrawer.vue'
import MaterialReceiptScanner from '@/components/MaterialReceiptScanner.vue'
import MaterialBatchPrintDialog from '@/components/MaterialBatchPrintDialog.vue'
import StatePanel from '@/components/StatePanel.vue'
import { useAuthStore } from '@/stores/auth'
import { useTeamDirectoryStore } from '@/stores/teamDirectory'
import { useSidebarStore } from '@/stores/sidebar'
import { appPinia } from '@/stores/pinia'
import { showToast } from '@/stores/toast'
import {
  resolveTeamWorkspaceSection,
  teamWorkspaceProfile,
  teamWorkspaceSectionPath,
  teamCanReallocate,
  type TeamWorkspaceSection,
} from '@/config/teamWorkspaces'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import type { InventoryConnection } from '@/services/inventoryStream'
import {
  shouldRefreshInventory,
  subscribeSharedInventoryChanges as subscribeInventoryChanges,
} from '@/services/inventoryChanges'
import { materialTransferApi } from '@/services/materialTransferApi'
import {
  isExternalEntryKind,
  materialEntryLabel,
  materialTypeOptions,
  materialTypeLabel,
  type MaterialTransfer,
} from '@/types/materialTransfer'
import {
  type TeamMaterialOverview,
  type StockBatch,
  type CreatedMaterialBatches,
  type MaterialLoss,
} from '@/types/teamMaterials'
import { formatDateTime } from '@/utils/format'
import TableExportDialog from '@/components/TableExportDialog.vue'
import { loadExportPages, tableExportSource, type TableExportSource } from '@/utils/tableExport'
import {
  lossExportFields,
  reallocationExportFields,
  transferExportFields,
} from '@/utils/teamTableExport'

const columnSettingsTarget = ref<HTMLElement | null>(null)
const dashboardToolbarTarget = ref<HTMLElement>()
const emptyListTitle = computed(() => {
  if (tab.value === 'pending') return '暂无来料待签收'
  if (tab.value === 'outgoing') return '暂无出库记录'
  if (tab.value === 'receipts') return '暂无入库记录'
  if (tab.value === 'reallocations') return '暂无转投记录'
  return '暂无丢失记录'
})
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const workspaceNavigation = useSidebarStore(appPinia)
const directory = useTeamDirectoryStore()
const teamKey = computed(() => String(route.params.teamId ?? ''))
const teamId = computed(() => Number(teamKey.value))
const validId = computed(
  () => /^\d+$/.test(teamKey.value) && Number.isSafeInteger(teamId.value) && teamId.value > 0,
)
const team = computed(() => directory.items.find((item) => String(item.id) === teamKey.value))
watch(
  team,
  (value) => {
    if (value?.kind === 'engineering') void router.replace('/process-routes')
    if (value?.kind === 'dispatch') void router.replace('/dispatch-schedules')
    if (value?.kind === 'business') void router.replace('/business-people')
  },
  { immediate: true },
)
const profile = computed(() => teamWorkspaceProfile(team.value?.code))
const scopeReady = computed(
  () =>
    validId.value &&
    directory.loaded &&
    !directory.error &&
    Boolean(team.value?.active) &&
    !['engineering', 'dispatch', 'business'].includes(team.value?.kind || ''),
)
const scopeLoading = computed(
  () =>
    validId.value &&
    !directory.error &&
    (!directory.loaded || directory.loading) &&
    !scopeReady.value,
)
const canWrite = computed(
  () =>
    scopeReady.value &&
    (auth.isAdmin || auth.isTeamAccount) &&
    auth.currentUser?.active !== false &&
    (auth.isAdmin || String(auth.currentUser?.team_id) === teamKey.value) &&
    !auth.currentUserError,
)
const canManageBusiness = computed(
  () =>
    scopeReady.value &&
    !auth.currentUserError &&
    auth.currentUser?.active !== false &&
    (auth.isAdmin || canWrite.value),
)
const canReallocate = computed(() => canWrite.value && teamCanReallocate(team.value))
const isWarehouse = computed(
  () =>
    scopeReady.value &&
    team.value?.code === 'FACTORY-WAREHOUSE' &&
    team.value?.kind === 'warehouse',
)
const canManageWarehouse = computed(() => isWarehouse.value && (auth.isAdmin || canWrite.value))
const overview = ref<TeamMaterialOverview | null>(null)
const qualityCount = ref(0)
watch(
  () => [teamId.value, team.value?.code, overview.value] as const,
  async ([id], _, onCleanup) => {
    let current = true
    onCleanup(() => {
      current = false
    })
    qualityCount.value = 0
    if (!id) return
    try {
      const result = await qualityFeedbackApi.records({
        team_id: team.value?.code === 'FACTORY-QC' ? undefined : id,
        page: 1,
        page_size: 1,
      })
      if (current) qualityCount.value = result.pending_count
    } catch {
      /* The feedback page provides retry and error details. */
    }
  },
  { immediate: true },
)
const hasProcessing = computed(() => scopeReady.value && teamCanProcess(team.value))
const canReceive = computed(
  () => isWarehouse.value && canWrite.value && auth.currentUser?.active !== false,
)
const title = computed(() =>
  scopeReady.value ? team.value!.name || profile.value?.name || '班组' : '班组工作台',
)
const tab = computed(() =>
  resolveTeamWorkspaceSection(
    route.query,
    isWarehouse.value,
    canManageWarehouse.value,
    teamCanReallocate(team.value),
    hasProcessing.value,
    team.value?.code === 'FACTORY-QC',
    canManageBusiness.value,
  ),
)
const {
  queryText,
  page,
  pageSize,
  queryDraft,
  dateDraft,
  materialDraft,
  receiptSourceDraft,
  batchStatusLabels,
  statusDraft,
  nextTeamDraft,
  kindDraft,
  dispatchKinds,
  listFiltersOpen,
  listFilterCount,
  openListFilters,
  cancelListFilters,
  applyListDialog,
  resetListFilters,
  applyFilters,
  listParams: baseListParams,
  receiptParams,
  dispatchParams,
  resetFiltersFromRoute,
} = useTeamWorkspaceFilters(tab, team)
const recordDateLabel = computed(() =>
  tab.value === 'receipts' ? '入库日期' : tab.value === 'pending' ? '转出日期' : '登记日期',
)
const recordColumns = computed(() =>
  tab.value === 'losses'
    ? queryColumns([
        ['流水号', 'serial_no'],
        ['来源批次号', 'batch_no'],
        ['材质', 'material_name'],
        ['件数', 'quantity', 'number'],
        ['重量 (kg)', 'weight', 'number'],
        ['原因', 'reason'],
        ['登记人', 'created_by'],
        ['登记时间', 'created_at', 'date'],
      ])
    : ['pending', 'receipts', 'outgoing'].includes(tab.value)
      ? teamRecordQueryColumns
      : transferQueryColumns,
)
const tableQuery = useTableQuery(
  recordColumns,
  () => {
    if (page.value !== 1)
      void router.replace({ path: route.path, query: { ...route.query, page: undefined } })
    else void loadView()
  },
  (table_query) => {
    const params = { ...listParams(), table_query },
      id = teamId.value
    if (tab.value === 'pending') return materialTransferApi.pendingFilterOptions(id, params)
    if (tab.value === 'outgoing')
      return teamMaterialApi.transferRecordFilterOptions(id, 'outbound-batches', {
        ...params,
        ...dispatchParams(),
      })
    if (tab.value === 'reallocations')
      return teamMaterialApi.reallocations(id, {
        ...params,
        material_type: receiptParams().material_type,
      })
    if (tab.value === 'losses') return teamMaterialApi.losses(id, params)
    return teamMaterialApi.transferRecordFilterOptions(id, 'receipts', {
      ...params,
      ...receiptParams(),
    })
  },
)
function listParams() {
  return { ...baseListParams(), ...tableQuery.params.value }
}
watch([tab, teamId], () => tableQuery.reset(), { flush: 'sync' })

watch(
  [scopeReady, () => route.fullPath],
  () => {
    if (scopeReady.value)
      workspaceNavigation.rememberWorkspace(teamKey.value, tab.value, route.query)
  },
  { immediate: true },
)
const fullscreen = ref(false)
const inventoryPanel = ref<InstanceType<typeof TeamInventory>>()
const schedulePanel = ref<InstanceType<typeof DeliverySchedules>>()
const initialSchedule =
  ref<Pick<ProductionSchedule, 'id' | 'next_team_id' | 'external_destination'>>()
const exportSource = ref<TableExportSource | null>(null)
const exportable = computed(
  () =>
    scopeReady.value &&
    !auth.currentUserError &&
    auth.currentUser?.active !== false &&
    !loading.value &&
    !loadError.value &&
    !overviewError.value &&
    [
      'stock',
      'delivery-schedule',
      'pending',
      'receipts',
      'outgoing',
      'reallocations',
      'losses',
    ].includes(tab.value),
)
function openExport() {
  if (!exportable.value) return
  let source: TableExportSource | undefined
  if (tab.value === 'stock') source = inventoryPanel.value?.exportSource()
  else if (tab.value === 'delivery-schedule') source = schedulePanel.value?.exportSource()
  else {
    const id = teamId.value,
      section = tab.value,
      params = listParams(),
      receiptFilters = receiptParams(),
      dispatchFilters = dispatchParams()
    if (section === 'losses')
      source = tableExportSource(
        listTitle.value,
        total.value,
        lossExportFields,
        (signal, progress) =>
          loadExportPages(
            (page, pageSize) =>
              teamMaterialApi.losses(id, { ...params, page, page_size: pageSize }),
            signal,
            progress,
          ),
      )
    else if (section === 'reallocations')
      source = tableExportSource(
        listTitle.value,
        total.value,
        reallocationExportFields,
        (signal, progress) =>
          loadExportPages(
            (page, pageSize) =>
              teamMaterialApi.reallocations(id, {
                ...params,
                material_type: receiptFilters.material_type,
                page,
                page_size: pageSize,
              }),
            signal,
            progress,
          ),
      )
    else if (section === 'pending' || section === 'receipts' || section === 'outgoing')
      source = tableExportSource(
        listTitle.value,
        total.value,
        transferExportFields(section, isWarehouse.value),
        (signal, progress) =>
          loadExportPages(
            (page, pageSize) => {
              const pagination = { ...params, page, page_size: pageSize }
              if (section === 'pending')
                return materialTransferApi.list({
                  ...pagination,
                  team_id: id,
                  direction: 'incoming',
                  status: 'pending',
                })
              if (section === 'receipts')
                return teamMaterialApi.receipts(id, { ...pagination, ...receiptFilters })
              return teamMaterialApi.dispatches(id, { ...pagination, ...dispatchFilters })
            },
            signal,
            progress,
          ),
      )
  }
  if (source) exportSource.value = { ...source, title: `${title.value} · ${source.title}` }
}
watch(
  [
    () => route.fullPath,
    () => auth.currentUser?.id,
    () => auth.currentUserError,
    () => auth.currentUser?.active,
  ],
  () => {
    exportSource.value = null
  },
)
function selectSection(section: TeamWorkspaceSection) {
  if (section !== tab.value)
    void router.push(workspaceNavigation.workspaceLocation(teamKey.value, section))
}
watch(
  [() => queryText('tab'), () => queryText('management_tab')],
  ([value, oldManagementView]) => {
    if (value === 'serials' || value === 'materials' || value === 'material-types')
      void router.replace({
        path: route.path,
        query: { ...route.query, tab: 'stock' },
        hash: route.hash,
      })
    if (value === 'overview')
      void router.replace({
        path: route.path,
        query: { ...route.query, tab: 'history' },
        hash: route.hash,
      })
    if (value === 'settings' && oldManagementView === 'production') {
      const { management_tab: _previousView, ...query } = route.query
      void router.replace({
        path: route.path,
        query: { ...query, tab: 'processing', processing_view: 'production' },
        hash: route.hash,
      })
    }
  },
  { immediate: true },
)
const listTitle = computed(
  () =>
    ({
      pending: '来料待签收',
      receipts: '入库记录',
      outgoing: '出库记录',
      reallocations: '转投记录',
      losses: '丢失记录',
    })[tab.value as 'pending' | 'receipts' | 'outgoing' | 'reallocations' | 'losses'],
)
const pendingCount = computed(() =>
  scopeReady.value && overview.value && Number(overview.value.team_id) === teamId.value
    ? isWarehouse.value
      ? (overview.value.pending_incoming.batch_count ?? overview.value.pending_incoming.count)
      : overview.value.pending_incoming.count
    : null,
)
watch(
  [teamKey, scopeReady, pendingCount, qualityCount],
  ([id, ready, pending, quality]) => {
    if (ready) workspaceNavigation.workspaceCounts[id] = { pending: pending || 0, quality }
  },
  { immediate: true },
)
const overviewError = ref('')
const pending = ref<MaterialTransfer[]>([])
const outgoing = ref<MaterialTransfer[]>([])
const selectedPrintRows = ref<MaterialTransfer[]>([])
const printRows = ref<MaterialTransfer[]>([]),
  printOpen = ref(false)
function openPrint(items: MaterialTransfer[]) {
  printRows.value = [...items]
  printOpen.value = true
}
const losses = ref<MaterialLoss[]>([])
const receipts = ref<MaterialTransfer[]>([])
const reallocations = ref<MaterialTransfer[]>([])
const receiptOpen = ref(false)
const editingReceipt = ref<MaterialTransfer | null>(null)
const processingGroupId = ref<number>()
const openingProcessing = ref(0)
const processingOpen = ref(false),
  processingSourceId = ref<number | null>(null)
function chooseProcessingBatch() {
  if (!canWrite.value || !hasProcessing.value) return
  void router.push({ path: route.path, query: { tab: 'stock' } })
  showToast('在库存列表勾选一个批次后，点「加工登记」', 'info')
}
async function openProcessing(groupId: number) {
  if (!canWrite.value || !hasProcessing.value || openingProcessing.value) return
  processingGroupId.value = groupId
  const current = ++actionVersion,
    scope = teamKey.value
  openingProcessing.value = current
  try {
    const result = await teamMaterialApi.processingSources(teamId.value, {
      group_id: groupId,
      page: 1,
      page_size: 2,
    })
    if (
      current !== actionVersion ||
      scope !== teamKey.value ||
      !canWrite.value ||
      !hasProcessing.value
    )
      return
    const batch = result.items[0]
    if (!batch || result.total !== 1 || Number(batch.transfer.id) !== groupId) {
      showToast('该批次已无法登记加工，请刷新库存后重试', 'info')
      return
    }
    if (batch.transfer.rework_pending && !batch.transfer.rework_route_ready) {
      showToast('请等待返工工艺制定后再登记加工', 'info')
      return
    }
    processingSourceId.value = groupId
    processingOpen.value = true
  } catch (error) {
    if (current === actionVersion && scope === teamKey.value)
      showToast(error instanceof Error ? error.message : '加工批次读取失败，请重试', 'error')
  } finally {
    if (openingProcessing.value === current) openingProcessing.value = 0
  }
}
function processingSaved() {
  if (processingSourceId.value != null)
    inventoryPanel.value?.clearBatchSelection(processingSourceId.value)
  showToast('加工件数已登记，库存已更新', 'success')
  void loadView()
}
function businessChanged() {
  void directory.refreshTeamDirectory()
  void loadView()
}
async function openingStocked() {
  const alreadyInStock = tab.value === 'stock'
  await router.replace(teamWorkspaceSectionPath(teamKey.value, 'stock'))
  if (alreadyInStock) await loadView()
}
const openingReceipt = ref(false)
const total = ref(0)
const loading = ref(false)
const loadError = ref('')
const selected = ref<MaterialTransfer | null>(null)
const drawerOpen = ref(false)
const actionOpen = ref(false)
const reallocationOpen = ref(false),
  reallocationSource = ref<StockBatch | null>(null)
const pickerOpen = ref(false)
const reworkRequestOpen = ref(false)
type StockAction = 'loss' | 'reallocate' | 'shipment'
const pickerMode = ref<StockAction>('loss')
const shipmentSource = ref<StockBatch | null>(null)
const canShip = computed(
  () => canWrite.value && team.value?.code === 'FACTORY-QC' && team.value.kind === 'production',
)
const openingDispatch = ref(false)
const processingDispatch = ref<{ recordId: number; version: number } | null>(null)
const actionMode = ref<'dispatch' | 'loss'>('dispatch')
const actionSources = ref<StockBatch[]>([])
const receiptReceiver = ref<TeamEmployee | null>(null)
watch(
  [teamKey, () => auth.currentUser?.id, canWrite],
  () => {
    receiptReceiver.value = null
    reworkRequestOpen.value = false
  },
  { flush: 'sync' },
)
const traceScope = computed(() => ({ team_id: teamId.value, direction: 'all' as const }))
const actionBindings = computed(() => ({
  section: tab.value,
  canWrite: canWrite.value,
  canReceive: canReceive.value,
  canReallocate: canReallocate.value,
  openingReceipt: openingReceipt.value,
  openingDispatch: openingDispatch.value,
  loading: loading.value,
  warehouse: isWarehouse.value,
  inspection: canShip.value,
  onDispatch: openNewDispatch,
  onLoss: () => openNewStockAction('loss'),
  onReallocate: () => openNewStockAction('reallocate'),
  onReceipt: openReceipt,
  onShipment: () => openNewStockAction('shipment'),
  onRefresh: loadView,
}))
let version = 0
let actionVersion = 0
const syncState = ref<InventoryConnection>('connecting'),
  syncError = ref('')
const syncMessage = computed(() =>
  syncState.value === 'expired'
    ? '登录或访问凭证已失效，请重新验证。'
    : syncError.value ||
      (syncState.value === 'reconnecting' ? '实时连接中断，当前显示上次结果，正在重连。' : ''),
)
let unsubscribe: (() => void) | undefined,
  streamVersion = 0
let refreshQueued = false,
  refreshing = false,
  disposed = false
let identityQueued = false,
  directoryQueued = false
let refreshTimer: ReturnType<typeof setTimeout> | undefined

function queueRefresh() {
  if (disposed || document.hidden) return
  refreshQueued = true
  if (refreshTimer || refreshing || loading.value) return
  refreshTimer = setTimeout(async () => {
    refreshTimer = undefined
    if (disposed || document.hidden) return
    if (loading.value) return // Its completion watcher drains the queued update.
    refreshQueued = false
    refreshing = true
    const scope = teamKey.value
    const refreshIdentity = identityQueued,
      refreshDirectory = directoryQueued
    identityQueued = false
    directoryQueued = false
    try {
      await Promise.all([
        ...(refreshIdentity ? [auth.refreshCurrentUser()] : []),
        ...(refreshDirectory ? [directory.refreshTeamDirectory()] : []),
      ])
      if (!disposed && !document.hidden && scope === teamKey.value && scopeReady.value)
        await loadView(false, true)
    } catch {
      if (!disposed) {
        identityQueued ||= refreshIdentity
        directoryQueued ||= refreshDirectory
        syncError.value = '数据更新失败，保留上次结果，请刷新重试。'
      }
    } finally {
      refreshing = false
      if (refreshQueued) queueRefresh()
    }
  }, 100)
}
function connectChanges() {
  const current = ++streamVersion
  unsubscribe?.()
  unsubscribe = subscribeInventoryChanges({
    onData(change) {
      if (current !== streamVersion || !shouldRefreshInventory(change, teamId.value)) return
      identityQueued ||= change.team_ids === undefined || Boolean(change.current_user_changed)
      directoryQueued ||= change.team_ids === undefined || Boolean(change.directory_changed)
      queueRefresh()
    },
    onState(state) {
      if (current === streamVersion) syncState.value = state
    },
  })
}
function syncVisibility() {
  if (document.hidden) {
    ++streamVersion
    unsubscribe?.()
    unsubscribe = undefined
    clearTimeout(refreshTimer)
    refreshTimer = undefined
    refreshQueued = false
    identityQueued = directoryQueued = false
  } else connectChanges()
}
watch(loading, (value) => {
  if (!value && refreshQueued) queueRefresh()
})

function asTransfer(row: unknown) {
  return row as MaterialTransfer
}
function asLoss(row: unknown) {
  return row as MaterialLoss
}

function closeDetails() {
  ++actionVersion
  pickerOpen.value = false
  openingDispatch.value = false
  processingDispatch.value = null
  drawerOpen.value = false
  selected.value = null
  actionOpen.value = false
  reallocationOpen.value = false
  reallocationSource.value = null
  receiptOpen.value = false
  openingReceipt.value = false
  editingReceipt.value = null
  shipmentSource.value = null
  actionSources.value = []
  initialSchedule.value = undefined
  processingOpen.value = false
  openingProcessing.value = 0
  processingSourceId.value = null
}
function openDetail(transfer: MaterialTransfer) {
  selected.value = transfer
  drawerOpen.value = true
}
function openIncoming(transfer: MaterialTransfer) {
  openDetail(transfer)
}
function openWarehouseMaterial(batchNo: string) {
  selected.value = null
  selectedBatchNo.value = batchNo
  drawerOpen.value = true
}
async function dispatchWarehouseMaterial(batchNo: string) {
  if (!canWrite.value || !isWarehouse.value) return
  const scope = teamKey.value,
    current = ++actionVersion
  try {
    const result = await teamMaterialApi.stock(teamId.value, {
      query: batchNo,
      availability: 'dispatchable',
      page_size: 100,
    })
    if (current !== actionVersion || scope !== teamKey.value) return
    const source = result.items.find((item) => item.transfer.batch_no === batchNo)
    if (!source) {
      showToast('该批物料暂无可转出库存，请刷新查看', 'error')
      return
    }
    await openAction('dispatch', [source])
  } catch (e) {
    showToast(e instanceof Error ? e.message : '读取库存失败', 'error')
  }
}
async function dispatchWarehouseBatches(sourceIds: number[]) {
  if (!canWrite.value || !isWarehouse.value || openingDispatch.value || !sourceIds.length) return
  const scope = teamKey.value,
    current = ++actionVersion
  openingDispatch.value = true
  try {
    const ids = [...new Set(sourceIds)]
    const result = await teamMaterialApi.stock(teamId.value, {
      source_ids: ids.join(','),
      availability: 'dispatchable',
      page_size: 100,
    })
    if (current !== actionVersion || scope !== teamKey.value) return
    const sources = ids.map((id) => result.items.find((item) => Number(item.transfer.id) === id))
    if (sources.some((item) => !item)) {
      showToast('部分物料已转出或库存已变化，请刷新后重新勾选', 'error')
      void loadView()
      return
    }
    await openAction('dispatch', sources as StockBatch[])
  } catch (e) {
    if (current === actionVersion && scope === teamKey.value)
      showToast(e instanceof Error ? e.message : '读取库存失败', 'error')
  } finally {
    if (scope === teamKey.value) openingDispatch.value = false
  }
}
function openLossSource(loss: MaterialLoss) {
  selected.value = null
  selectedBatchNo.value = loss.batch_no
  drawerOpen.value = true
}
const selectedBatchNo = ref('')
watch(selected, (transfer) => {
  if (transfer) selectedBatchNo.value = transfer.batch_no
})

async function openAction(
  mode: 'dispatch' | 'loss',
  sources: StockBatch[],
  schedule?: Pick<ProductionSchedule, 'id' | 'next_team_id' | 'external_destination'>,
) {
  const current = ++actionVersion
  const scope = teamKey.value
  try {
    await auth.refreshCurrentUser()
  } catch {
    showToast('账号信息刷新失败，请重试', 'error')
    return
  }
  if (current !== actionVersion || scope !== teamKey.value || !canWrite.value || !sources.length)
    return
  pickerOpen.value = false
  actionMode.value = mode
  actionSources.value = sources
  initialSchedule.value = schedule
  actionOpen.value = true
}
async function dispatchSchedule(schedule: ProductionSchedule, sourceId: number) {
  if (!canWrite.value || schedule.team_id !== teamId.value || openingDispatch.value) return
  closeDetails()
  const current = actionVersion,
    scope = teamKey.value
  openingDispatch.value = true
  try {
    const result = await teamMaterialApi.stock(teamId.value, {
      source_ids: String(sourceId),
      availability: 'dispatchable',
      page: 1,
      page_size: 1,
    })
    if (current !== actionVersion || scope !== teamKey.value) return
    if (!result.items.length) {
      showToast('该来源批次暂无可转出库存；加工后的物料请从本流水号库存中出库', 'info')
      await router.push({
        path: route.path,
        query: { tab: 'stock', serial_no: schedule.serial_no },
      })
      return
    }
    await openAction('dispatch', result.items, schedule)
  } catch (e) {
    if (scope === teamKey.value)
      showToast(e instanceof Error ? e.message : '读取排期物料失败', 'error')
  } finally {
    if (scope === teamKey.value) openingDispatch.value = false
  }
}
async function dispatchProcessing(record: ProcessingRecord) {
  if (
    !canWrite.value ||
    !hasProcessing.value ||
    !['processing', 'settings'].includes(tab.value) ||
    openingDispatch.value
  )
    return
  const ids = record.outputs?.length
    ? record.outputs.filter((output) => output.role === 'produced').map((output) => output.id)
    : [record.source_transfer_id]
  if (!ids.length) {
    showToast('这次加工暂无可转出的产出批次', 'info')
    return
  }
  closeDetails()
  const current = actionVersion,
    scope = teamKey.value
  openingDispatch.value = true
  processingDispatch.value = { recordId: record.id, version: current }
  try {
    const result = await teamMaterialApi.stock(teamId.value, {
      source_ids: ids.join(','),
      availability: 'available',
      page_size: 100,
    })
    if (current !== actionVersion || scope !== teamKey.value || !canWrite.value) return
    const sources = result.items.filter(
      (item) => ids.includes(Number(item.transfer.id)) && stockAvailable(item),
    )
    if (!sources.length) {
      showToast('这次加工的产出已转出或已继续加工，暂无可转出库存', 'info')
      void loadView()
      return
    }
    if (sources.some((item) => item.inspection_hold_id)) {
      showToast('该批产出正在质量处理中，暂不能转出', 'info')
      return
    }
    if (
      sources.some(
        (item) =>
          !stockSelectable(item) ||
          item.transfer.rework_pending ||
          item.processing_state === 'unregistered',
      )
    ) {
      showToast('该批产出的加工状态已变化，请刷新记录后重试', 'info')
      void loadView()
      return
    }
    await openAction('dispatch', sources)
  } catch (error) {
    if (current === actionVersion && scope === teamKey.value)
      showToast(error instanceof Error ? error.message : '读取加工产出失败，请重试', 'error')
  } finally {
    if (processingDispatch.value?.version === current) {
      processingDispatch.value = null
      openingDispatch.value = false
    }
  }
}
async function openReallocation(source: StockBatch) {
  const current = ++actionVersion,
    scope = teamKey.value
  try {
    await auth.refreshCurrentUser()
  } catch {
    showToast('账号信息刷新失败，请重试', 'error')
    return
  }
  if (current !== actionVersion || scope !== teamKey.value || !canReallocate.value) return
  pickerOpen.value = false
  reallocationSource.value = source
  reallocationOpen.value = true
}
async function savedReallocation(item: MaterialTransfer) {
  showToast(`已从 ${item.source_serial_no} 转投至 ${item.serial_no}`, 'success')
  reallocationOpen.value = false
  reallocationSource.value = null
  if (tab.value === 'reallocations') await loadView()
  else await openingStocked()
}
function openNewDispatch() {
  if (!canWrite.value || openingDispatch.value) return
  void router.push({ path: route.path, query: { tab: 'stock' } })
  showToast('在库存列表勾选批次后，点「出库」', 'info')
}
function canStartStockAction(mode: StockAction) {
  if (mode === 'reallocate') return canReallocate.value
  if (mode === 'shipment') return canShip.value
  return canWrite.value
}
async function openNewStockAction(mode: StockAction) {
  if (openingDispatch.value || !canStartStockAction(mode)) return
  closeDetails()
  const current = actionVersion
  pickerMode.value = mode
  openingDispatch.value = true
  try {
    await auth.refreshCurrentUser()
    if (current === actionVersion && canStartStockAction(mode)) pickerOpen.value = true
  } catch {
    showToast('账号信息刷新失败，请重试', 'error')
  } finally {
    if (current === actionVersion) openingDispatch.value = false
  }
}
function selectStockSource(source: StockBatch) {
  if (!canStartStockAction(pickerMode.value)) return
  if (pickerMode.value === 'shipment') {
    pickerOpen.value = false
    shipmentSource.value = source
  } else if (pickerMode.value === 'reallocate') {
    void openReallocation(source)
  } else void openAction('loss', [source])
}
function savedAction(result: CreatedMaterialBatches | MaterialLoss) {
  const first = 'items' in result ? result.items[0] : undefined
  showToast(
    first && isExternalEntryKind(first.entry_kind) && first.status === 'dispatched'
      ? `已完成${first.entry_kind === 'inspection_shipment' ? '发货' : '出库'}`
      : 'items' in result
        ? `已生成 ${result.items.length} 个独立批次，每批一个条码`
        : `丢失记录 ${result.loss_no} 已登记`,
    'success',
  )
  void loadView()
  if ('items' in result) {
    inventoryPanel.value?.clearBatchSelection()
    openPrint(result.items)
  }
}

async function openReceipt(row?: MaterialTransfer) {
  if (openingReceipt.value || !canReceive.value) return
  const current = ++actionVersion
  openingReceipt.value = true
  try {
    await auth.refreshCurrentUser()
    if (current !== actionVersion || !canReceive.value) return
    const receipt = row ? await materialTransferApi.get(row.batch_no) : null
    if (current !== actionVersion || !canReceive.value) return
    if (receipt && !receipt.allowed_actions.includes('edit_receipt')) {
      showToast('该入库单已不能修改', 'info')
      void loadView()
      return
    }
    editingReceipt.value = receipt
    receiptOpen.value = true
  } catch (error) {
    if (current === actionVersion)
      showToast(error instanceof Error ? error.message : '入库单打开失败，请重试', 'error')
  } finally {
    if (current === actionVersion) openingReceipt.value = false
  }
}
function savedReceipt(transfer: MaterialTransfer) {
  if (
    String(
      isExternalEntryKind(transfer.entry_kind) ? transfer.source_team.id : transfer.next_team.id,
    ) !== teamKey.value
  )
    return
  showToast(`入库单 ${transfer.batch_no} ${editingReceipt.value ? '已修改' : '已入库'}`, 'success')
  void loadView(true)
}

async function loadView(refreshWarehouse: unknown = false, background = false) {
  const current = ++version
  if (!scopeReady.value) {
    overview.value = null
    pending.value = []
    outgoing.value = []
    losses.value = []
    receipts.value = []
    reallocations.value = []
    total.value = 0
    loading.value = false
    return
  }
  if (!background) {
    loading.value = true
    loadError.value = ''
    overviewError.value = ''
  }
  syncError.value = ''
  const id = teamId.value
  const currentTab = tab.value
  const params = listParams()
  const balanceRequest = (
    currentTab === 'dashboard' ? teamMaterialApi.overview(id, true) : teamMaterialApi.overview(id)
  )
    .then((result) => {
      if (current === version) {
        overview.value = result
        overviewError.value = ''
      }
    })
    .catch((error) => {
      if (current === version) {
        if (background) syncError.value = '数据更新失败，保留上次结果，请刷新重试。'
        else {
          overview.value = null
          overviewError.value = error instanceof Error ? error.message : '物料纵览加载失败'
        }
      }
    })
  const refreshRequests =
    refreshWarehouse === true && isWarehouse.value
      ? [
          ...(currentTab !== 'receipts'
            ? [
                teamMaterialApi.receipts(id, { page: 1, page_size: 20 }).then((result) => {
                  if (current === version) receipts.value = result.items
                }),
              ]
            : []),
        ].map((request) =>
          request.catch(() => {
            if (current === version)
              showToast('入库已成功，部分物料记录刷新失败，请点击刷新', 'error')
          }),
        )
      : []
  try {
    if (currentTab === 'pending') {
      const result = await materialTransferApi.list({
        ...params,
        team_id: id,
        direction: 'incoming',
        status: 'pending',
      })
      if (current === version) {
        pending.value = result.items
        total.value = result.total
      }
    } else if (currentTab === 'outgoing') {
      const result = await teamMaterialApi.dispatches(id, { ...params, ...dispatchParams() })
      if (current === version) {
        outgoing.value = result.items
        selectedPrintRows.value = []
        total.value = result.total
      }
    } else if (currentTab === 'reallocations') {
      const result = await teamMaterialApi.reallocations(id, {
        ...params,
        material_type: receiptParams().material_type,
      })
      if (current === version) {
        reallocations.value = result.items
        total.value = result.total
      }
    } else if (currentTab === 'losses') {
      const result = await teamMaterialApi.losses(id, params)
      if (current === version) {
        losses.value = result.items
        total.value = result.total
      }
    } else if (currentTab === 'receipts') {
      const result = await teamMaterialApi.receipts(id, { ...params, ...receiptParams() })
      if (current === version) {
        receipts.value = result.items
        total.value = result.total
      }
    }
    if (current === version) loadError.value = ''
  } catch (error) {
    if (current === version) {
      if (background) syncError.value = '数据更新失败，保留上次结果，请刷新重试。'
      else {
        pending.value = []
        outgoing.value = []
        losses.value = []
        receipts.value = []
        reallocations.value = []
        total.value = 0
        loadError.value = error instanceof Error ? error.message : '物料记录加载失败'
      }
    }
  }
  await Promise.all([balanceRequest, ...refreshRequests])
  if (current === version) loading.value = false
}

watch(
  [
    () =>
      ['overview', 'stock'].includes(tab.value) ? `${route.path}:${tab.value}` : route.fullPath,
    scopeReady,
  ],
  () => {
    closeDetails()
    pending.value = []
    outgoing.value = []
    selectedPrintRows.value = []
    printOpen.value = false
    losses.value = []
    receipts.value = []
    reallocations.value = []
    overview.value = null
    resetFiltersFromRoute()
    void loadView()
  },
  { immediate: true },
)
watch(
  () =>
    `${auth.currentUser?.id ?? ''}:${auth.currentUser?.team_id ?? ''}:${auth.currentUser?.active}:${auth.isTeamAccount}`,
  () => {
    closeDetails()
    void loadView()
  },
)

onMounted(() => {
  if (!directory.loaded && !directory.loading) void directory.refreshTeamDirectory()
  document.addEventListener('visibilitychange', syncVisibility)
  if (!document.hidden) connectChanges()
})
onBeforeUnmount(() => {
  disposed = true
  ++streamVersion
  unsubscribe?.()
  clearTimeout(refreshTimer)
  ++version
  ++actionVersion
  document.removeEventListener('visibilitychange', syncVisibility)
})
</script>

<template>
  <TeamWorkspaceShell
    :title="title"
    :model-value="tab"
    :warehouse="isWarehouse"
    :manage-warehouse="canManageWarehouse"
    :reallocations="teamCanReallocate(team)"
    :processing="hasProcessing"
    :inspection="team?.code === 'FACTORY-QC'"
    :quality-count="qualityCount"
    :pending-count="pendingCount"
    :exportable="exportable"
    :manage-settings="canManageBusiness"
    @export="openExport"
    @update:model-value="selectSection"
    @fullscreen-change="fullscreen = $event"
  >
    <template v-if="tab === 'dashboard'" #heading-tools>
      <div ref="dashboardToolbarTarget" />
    </template>
    <template v-if="tab !== 'settings' && canWrite && hasProcessing" #messages>
      <ElButton @click="reworkRequestOpen = true">提交问题</ElButton>
    </template>
    <template v-if="syncMessage" #fullscreen-status
      ><span role="status" :title="syncMessage">{{
        syncState === 'expired' ? '登录失效' : '连接中断'
      }}</span></template
    >
    <div class="team-material-content">
      <LiveRefreshNotice
        v-if="tab !== 'delivery-schedule'"
        v-show="!fullscreen"
        :message="syncMessage"
        @retry="queueRefresh"
      />
      <StatePanel v-if="scopeLoading" state="loading" title="正在读取班组信息" />
      <StatePanel
        v-else-if="!scopeReady"
        state="error"
        :title="
          !validId ? '无效的班组编号' : directory.error ? '班组目录加载失败' : '未找到启用的班组'
        "
        description="请刷新班组目录，或从侧边栏选择已配置的班组。"
        @retry="directory.refreshTeamDirectory"
      />
      <template v-else>
        <ElAlert
          v-if="overview?.legacy_received_count"
          v-show="!fullscreen"
          class="legacy-notice"
          type="info"
          :closable="false"
          :title="`另有 ${overview.legacy_received_count} 张历史已接收单未计入库存。`"
          ><template #default
            >历史单据仍可在
            <RouterLink
              :to="{
                path: '/transfer-batches',
                query: { next_team_id: teamKey, status: 'received' },
              }"
              >全局转料记录</RouterLink
            >
            查看。</template
          ></ElAlert
        >
        <TeamBusinessDialog
          v-if="tab === 'settings' && canManageBusiness"
          :key="teamId"
          :model-value="true"
          inline
          @update:model-value="!$event && selectSection('stock')"
          :team-id="teamId"
          :team-name="title"
          :team-code="team?.code"
          initial-tab="employees"
          :processing-tasks="hasProcessing"
          :inspection-problems="team?.code === 'FACTORY-QC'"
          @changed="businessChanged"
          @stocked="openingStocked"
        />
        <TeamDashboard
          v-else-if="tab === 'dashboard'"
          :key="teamId"
          :team-id="teamId"
          :processing="hasProcessing"
          :overview="overview"
          :loading="loading"
          :error="overviewError"
          :toolbar-target="dashboardToolbarTarget"
          @refresh="loadView()"
          @navigate="router.push({ path: route.path, query: $event })"
        />
        <WarehouseManagement
          v-else-if="tab === 'warehouse'"
          :key="teamId"
          :team-id="teamId"
          :can-manage="canManageWarehouse"
          :can-dispatch="canWrite"
          :refresh-key="overview"
          @view="openWarehouseMaterial"
          @dispatch="dispatchWarehouseMaterial"
          @batch-dispatch="dispatchWarehouseBatches"
        />
        <TeamQualityFeedback
          v-else-if="tab === 'quality-feedback'"
          :key="teamId"
          :team-id="teamId"
          :show-all="team?.code === 'FACTORY-QC'"
          @count="qualityCount = $event"
        />
        <DeliverySchedules
          v-else-if="tab === 'delivery-schedule'"
          :key="teamId"
          ref="schedulePanel"
          :team-id="teamId"
          :fullscreen="fullscreen"
          :refresh-key="overview"
          :sync-message="syncMessage"
          @retry-sync="queueRefresh"
          @dispatch="dispatchSchedule"
        />
        <TeamInspectionRecords
          v-else-if="tab === 'inspection-results'"
          :key="`inspection-${teamId}`"
          :team-id="teamId"
          kind="inspection"
          :fullscreen="fullscreen"
        />
        <TeamProcessingRecords
          v-else-if="tab === 'processing'"
          :key="teamId"
          :team-id="teamId"
          :team-code="team?.code"
          :can-write="canWrite"
          :fullscreen="fullscreen"
          :refresh-key="overview"
          :dispatching-record-id="processingDispatch?.recordId"
          @register="chooseProcessingBatch"
          @dispatch="dispatchProcessing"
        />
        <TeamSerialHistory
          v-else-if="['overview', 'history'].includes(tab)"
          :key="teamId"
          :team-id="teamId"
        />
        <template v-else-if="tab === 'stock'">
          <StatePanel v-if="loading && !overview" state="loading" title="正在读取物料库存" />
          <StatePanel
            v-else-if="overviewError"
            state="error"
            :description="overviewError"
            @retry="loadView"
          />
          <TeamInventory
            v-else-if="overview"
            :key="teamId"
            ref="inventoryPanel"
            :team-id="teamId"
            :warehouse="isWarehouse"
            :overview="overview"
            :can-write="canWrite"
            :fullscreen="fullscreen"
            :processing="hasProcessing"
            :processing-loading-group-id="openingProcessing ? processingGroupId : undefined"
            @process="openProcessing"
            @refresh="loadView"
            @changed="loadView"
            @action="openAction"
          />
        </template>
        <template v-else>
          <div class="team-list-layout">
            <WorkspaceDataPanel class="team-list-panel workspace-data-panel">
              <WorkspaceDataToolbar
                v-model="queryDraft"
                :loading="loading"
                :search-label="`${tab === 'reallocations' ? '转投记录' : tab === 'losses' ? '丢失记录' : '物料'}搜索`"
                :placeholder="
                  tab === 'reallocations'
                    ? '搜索原流水号、目标流水号或批次号'
                    : tab === 'outgoing'
                      ? '搜索批次号、流水号、业务或去向'
                      : tab === 'losses'
                        ? '搜索批次号、流水号或材质'
                        : '搜索批次号、流水号、材质或业务'
                "
                @search="applyFilters()"
                @refresh="loadView()"
              >
                <template #query-actions><div ref="columnSettingsTarget" /></template>
                <template #filters
                  ><FilterDialog
                    v-slot="{ appendTo }"
                    v-model="listFiltersOpen"
                    title="记录筛选"
                    :count="listFilterCount"
                    @open="openListFilters"
                    @cancel="cancelListFilters"
                    @apply="applyListDialog"
                    @reset="resetListFilters"
                  >
                    <div class="filter-fields">
                      <label v-if="['receipts', 'outgoing', 'reallocations'].includes(tab)"
                        >物料类型<ElSelect
                          :append-to="appendTo"
                          v-model="materialDraft"
                          aria-label="物料类型筛选"
                          placeholder="全部类型"
                          clearable
                          ><ElOption
                            v-for="type in materialTypeOptions"
                            :key="type.value"
                            :value="type.value"
                            :label="type.label" /></ElSelect
                      ></label>
                      <label v-if="tab === 'receipts' && isWarehouse"
                        >入库来源<ElSelect
                          :append-to="appendTo"
                          v-model="receiptSourceDraft"
                          aria-label="入库来源筛选"
                          placeholder="全部来源"
                          clearable
                          ><ElOption value="external" label="外部来料（含退回）" /><ElOption
                            value="internal"
                            label="车间转入" /><ElOption
                            value="return"
                            label="外部退回" /></ElSelect
                      ></label>
                      <template v-if="tab === 'outgoing'">
                        <label
                          >出库方式<ElSelect
                            :append-to="appendTo"
                            v-model="kindDraft"
                            aria-label="出库方式筛选"
                            placeholder="全部方式"
                            clearable
                            ><ElOption
                              v-for="kind in dispatchKinds"
                              :key="kind"
                              :value="kind"
                              :label="materialEntryLabel(kind)" /></ElSelect
                        ></label>
                        <label
                          >出库状态<ElSelect
                            :append-to="appendTo"
                            v-model="statusDraft"
                            aria-label="出库状态筛选"
                            placeholder="全部状态"
                            clearable
                            ><ElOption
                              v-for="(label, value) in batchStatusLabels"
                              :key="value"
                              :value="value"
                              :label="label" /></ElSelect
                        ></label>
                        <label v-if="!isExternalEntryKind(kindDraft)"
                          >接收班组<ElSelect
                            :append-to="appendTo"
                            v-model="nextTeamDraft"
                            aria-label="接收班组筛选"
                            placeholder="全部接收班组"
                            clearable
                            filterable
                            ><ElOption
                              v-for="item in directory.items.filter(
                                (item) => item.active && String(item.id) !== teamKey,
                              )"
                              :key="item.id"
                              :value="String(item.id)"
                              :label="
                                teamWorkspaceProfile(item.code)?.name || item.name
                              " /></ElSelect
                        ></label>
                      </template>
                      <label
                        >{{ recordDateLabel
                        }}<RecordDateFilter
                          :append-to="appendTo"
                          v-model="dateDraft"
                          :label="recordDateLabel"
                      /></label>
                    </div> </FilterDialog
                ></template>
                <template v-if="!fullscreen && tab === 'outgoing'" #actions>
                  <ElButton
                    :disabled="!selectedPrintRows.length"
                    @click="openPrint(selectedPrintRows)"
                  >
                    合并打印<span v-if="selectedPrintRows.length"
                      >（{{ selectedPrintRows.length }}）</span
                    >
                  </ElButton>
                </template>
                <template #primary-actions>
                  <MaterialReceiptScanner
                    v-if="tab === 'pending' && canWrite"
                    :key="teamId"
                    v-model:receiver="receiptReceiver"
                    :team-id="teamId"
                    :paused="
                      fullscreen ||
                      Boolean(exportSource) ||
                      drawerOpen ||
                      actionOpen ||
                      reallocationOpen ||
                      pickerOpen ||
                      receiptOpen ||
                      printOpen ||
                      listFiltersOpen
                    "
                    @received="loadView(true, true)"
                  />
                  <TeamWorkspaceActions v-else v-bind="actionBindings" :show-refresh="false" />
                </template>
              </WorkspaceDataToolbar>

              <StatePanel v-if="loading" state="loading" title="正在读取物料记录" />
              <StatePanel
                v-else-if="loadError"
                state="error"
                :description="loadError"
                @retry="loadView"
              />
              <div v-show="!loading && !loadError" class="team-table-scroll">
                <TeamTransferRecordsTable
                  v-if="tab === 'pending' || tab === 'receipts' || tab === 'outgoing'"
                  :key="tab"
                  :kind="tab"
                  :rows="tab === 'pending' ? pending : tab === 'receipts' ? receipts : outgoing"
                  :warehouse="isWarehouse"
                  :can-write="canWrite"
                  :receiver-selected="!!receiptReceiver"
                  :empty-title="emptyListTitle"
                  :column-settings-target="columnSettingsTarget"
                  :column-query="tableQuery.controller.value"
                  @detail="tab === 'pending' ? openIncoming($event) : openDetail($event)"
                  @edit-receipt="openReceipt"
                  @selection-change="selectedPrintRows = $event"
                />
                <WorkspaceTable
                  columns-key="TeamWorkspacePage-4"
                  :column-settings-target="columnSettingsTarget"
                  :column-query="tableQuery.controller.value"
                  v-else-if="tab === 'reallocations'"
                  :data="reallocations"
                  class="team-table single-line-table"
                  row-key="id"
                >
                  <template #empty>{{ emptyListTitle }}</template>
                  <ElTableColumn
                    prop="source_serial_no"
                    label="原流水号"
                    min-width="145"
                    show-overflow-tooltip
                  />
                  <ElTableColumn
                    prop="serial_no"
                    label="目标流水号"
                    min-width="145"
                    show-overflow-tooltip
                  />
                  <ElTableColumn label="转投时间" min-width="170" show-overflow-tooltip
                    ><template #default="{ row }">{{
                      formatDateTime(row.transferred_at)
                    }}</template></ElTableColumn
                  >
                  <ElTableColumn label="材质" min-width="110" show-overflow-tooltip
                    ><template #default="{ row }">{{
                      row.material_name || '—'
                    }}</template></ElTableColumn
                  >
                  <ElTableColumn label="物料类型" min-width="110" show-overflow-tooltip
                    ><template #default="{ row }">{{
                      materialTypeLabel(row.material_type)
                    }}</template></ElTableColumn
                  >
                  <ElTableColumn label="件数" min-width="90" align="center"
                    ><template #default="{ row }">{{
                      inventoryAmount(row.quantity)
                    }}</template></ElTableColumn
                  >
                  <ElTableColumn label="重量 (kg)" min-width="110" align="center"
                    ><template #default="{ row }">{{
                      inventoryAmount(row.weight)
                    }}</template></ElTableColumn
                  >
                  <ElTableColumn label="操作人" min-width="100" show-overflow-tooltip
                    ><template #default="{ row }"
                      ><PersonName :name="row.transferred_by || '—'" /></template
                  ></ElTableColumn>
                  <ElTableColumn label="原因" min-width="140" show-overflow-tooltip
                    ><template #default="{ row }">{{ row.notes || '—' }}</template></ElTableColumn
                  >
                  <ElTableColumn label="来源批次号" min-width="190" show-overflow-tooltip
                    ><template #default="{ row }"
                      ><ElButton
                        link
                        class="batch-link"
                        @click="openWarehouseMaterial(row.source_transfer_batch_no)"
                      >
                        {{ row.source_transfer_batch_no || '—' }}
                      </ElButton></template
                    ></ElTableColumn
                  >
                  <ElTableColumn label="转投批次号" min-width="190" show-overflow-tooltip
                    ><template #default="{ row }"
                      ><ElButton link class="batch-link" @click="openDetail(asTransfer(row))">
                        {{ row.batch_no }}
                      </ElButton></template
                    ></ElTableColumn
                  >
                  <ElTableColumn label="操作" width="110" fixed="right"
                    ><template #default="{ row }"
                      ><ElButton link type="primary" @click="openDetail(asTransfer(row))"
                        >查看详情</ElButton
                      ></template
                    ></ElTableColumn
                  >
                </WorkspaceTable>
                <WorkspaceTable
                  columns-key="TeamWorkspacePage-5"
                  :column-settings-target="columnSettingsTarget"
                  :column-query="tableQuery.controller.value"
                  v-else
                  :data="losses"
                  class="team-table single-line-table"
                  row-key="id"
                >
                  <template #empty>{{ emptyListTitle }}</template>
                  <ElTableColumn
                    prop="loss_no"
                    label="丢失记录号"
                    min-width="190"
                    show-overflow-tooltip
                  />
                  <ElTableColumn label="来源批次号" min-width="190" show-overflow-tooltip
                    ><template #default="{ row }"
                      ><ElButton
                        link
                        class="batch-link"
                        :title="row.batch_no"
                        @click="openLossSource(asLoss(row))"
                      >
                        {{ row.batch_no }}
                      </ElButton></template
                    ></ElTableColumn
                  >
                  <ElTableColumn
                    class-name="table-identity"
                    label="流水号"
                    min-width="220"
                    show-overflow-tooltip
                    ><template #default="{ row }"
                      ><span class="record-serial"
                        ><span :title="row.serial_no">{{ row.serial_no }}</span></span
                      ></template
                    ></ElTableColumn
                  >
                  <ElTableColumn label="材质" min-width="130" show-overflow-tooltip
                    ><template #default="{ row }">{{
                      row.material_name || '—'
                    }}</template></ElTableColumn
                  >
                  <ElTableColumn label="件数" min-width="100" align="center" show-overflow-tooltip
                    ><template #default="{ row }">{{
                      inventoryAmount(row.quantity)
                    }}</template></ElTableColumn
                  >
                  <ElTableColumn
                    label="重量 (kg)"
                    min-width="125"
                    align="center"
                    show-overflow-tooltip
                    ><template #default="{ row }">{{
                      inventoryAmount(row.weight)
                    }}</template></ElTableColumn
                  >
                  <ElTableColumn prop="reason" label="原因" min-width="200" show-overflow-tooltip />
                  <ElTableColumn label="登记人" min-width="100" show-overflow-tooltip
                    ><template #default="{ row }"
                      ><PersonName :name="row.created_by || '—'" /></template
                  ></ElTableColumn>
                  <ElTableColumn label="登记时间" min-width="170" show-overflow-tooltip
                    ><template #default="{ row }">{{
                      formatDateTime(row.created_at)
                    }}</template></ElTableColumn
                  >
                </WorkspaceTable>
              </div>
              <WorkspacePagination
                v-if="!loading && !loadError"
                :current-page="page"
                :page-size="pageSize"
                :total="total"
                @current-change="applyFilters($event)"
                @size-change="applyFilters(1, $event)"
                >共 {{ total }} 条记录</WorkspacePagination
              >
            </WorkspaceDataPanel>
            <MaterialTransferDrawer
              v-model="drawerOpen"
              :transfer="selected"
              :batch-no="selectedBatchNo"
              :trace-scope="traceScope"
              :allow-print="tab !== 'pending'"
              :receipt-only="tab === 'pending'"
              :receipt-receiver="tab === 'pending' ? receiptReceiver : undefined"
              @changed="loadView"
            />
          </div>
        </template>
      </template>
    </div>
    <template #dialogs>
      <TeamReworkRequestDialog
        :team-id="teamId"
        v-if="reworkRequestOpen && canWrite && hasProcessing"
        :key="teamId"
        @close="reworkRequestOpen = false"
        @saved="
          () => {
            showToast('问题已提交工艺班组')
            void loadView()
          }
        "
      />
      <QuantityAdjustmentDialog
        v-if="hasProcessing"
        v-model="processingOpen"
        :team-id="teamId"
        :source-id="processingSourceId"
        :can-write="canWrite"
        processing
        @saved="processingSaved"
      />
      <TableExportDialog :source="exportSource" @close="exportSource = null" />
      <StockSourcePicker
        v-if="pickerOpen && canWrite"
        :team-id="teamId"
        :mode="pickerMode"
        :processing="hasProcessing"
        @close="closeDetails"
        @selected="selectStockSource"
      />
      <InventoryShipmentDialog
        v-if="shipmentSource && canShip"
        :team-id="teamId"
        :group-id="Number(shipmentSource.transfer.id)"
        :serial-no="shipmentSource.transfer.serial_no"
        @close="shipmentSource = null"
        @saved="loadView()"
      />
      <WarehouseReceiptDialog
        v-model="receiptOpen"
        :team-id="teamId"
        :receipt="editingReceipt"
        @saved="savedReceipt"
      />
      <SerialReallocationDialog
        v-if="reallocationSource"
        v-model="reallocationOpen"
        :team-id="teamId"
        :source="reallocationSource"
        @saved="savedReallocation"
      />
      <MaterialStockActionDialog
        v-model="actionOpen"
        :team-id="teamId"
        :mode="actionMode"
        :sources="actionSources"
        :initial-schedule="initialSchedule"
        @saved="savedAction"
        @balances-changed="loadView"
      />
      <MaterialBatchPrintDialog v-model="printOpen" :items="printRows" />
    </template>
  </TeamWorkspaceShell>
</template>

<style scoped>
.team-material-content {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  gap: 10px;
}
.legacy-notice {
  flex-shrink: 0;
}
.legacy-notice a {
  color: var(--primary);
}
.team-list-layout {
  display: grid;
  flex: 1;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  gap: 12px;
}
.team-list-panel {
  container-type: inline-size;
}

.list-extra-filters {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-height: min(560px, 65dvh);
  overflow-y: auto;
  padding: 4px;
}
.list-extra-filters > label:not(.el-checkbox) {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--muted);
  font-size: var(--font-size-label);
}
:global(.workspace-record-filters) {
  max-width: calc(100vw - 32px);
}
.list-filter-count {
  margin-left: 6px;
  color: var(--primary);
  font-variant-numeric: tabular-nums;
}
.team-table-scroll {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.team-table :deep(.el-checkbox) {
  height: 24px;
}
@media (max-width: 760px) {
  .team-table :deep(.el-table-fixed-column--right) {
    position: relative !important;
    right: auto !important;
  }
  .team-table :deep(.el-table-fixed-column--right::before) {
    box-shadow: none;
  }
  .team-table :deep(.el-scrollbar__bar.is-horizontal) {
    opacity: 1;
  }
}
</style>
