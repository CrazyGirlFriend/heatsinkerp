<script setup lang="ts">
import AppDialog from '@/components/AppDialog.vue'
import { materialWeightToleranceKg } from '@/config/materialRules'

import TableExportButton from './TableExportButton.vue'
import TeamInspectionRecords from './TeamInspectionRecords.vue'
import SharedMaterialInfo from './SharedMaterialInfo.vue'
import SerialMaterialDrawer from './SerialMaterialDrawer.vue'
import { loadExportPages, tableExportSource } from '@/utils/tableExport'
import { globalTransferExportFields } from '@/utils/teamTableExport'
import { currentLocations } from '@/utils/warehousePlacement'
import { computed, defineAsyncComponent, onBeforeUnmount, ref, watch } from 'vue'
import { useProcessRouteView } from '@/composables/useProcessRouteView'
import {
  ElButton,
  ElDescriptions,
  ElDescriptionsItem,
  ElPagination,
  ElTable,
  ElTableColumn,
  ElTag,
} from 'element-plus'
import MaterialTransferDrawer from './MaterialTransferDrawer.vue'
import QuantityAdjustmentDialog from './QuantityAdjustmentDialog.vue'
import ProcessingStockStatus from './ProcessingStockStatus.vue'
import InventoryScheduleDetails from './InventoryScheduleDetails.vue'
import ProcessRouteLotDialog from './ProcessRouteLotDialog.vue'
import LiveRefreshNotice from './LiveRefreshNotice.vue'
import StatePanel from './StatePanel.vue'
import { useLiveRefresh } from '@/composables/useLiveRefresh'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import {
  isScrapType,
  isWeightOnlyType,
  materialTypeLabel,
  materialTransferStatusLabel,
  materialTransferStatusTone,
  type MaterialTransfer,
} from '@/types/materialTransfer'
import { inventorySourceLabel, inventoryAmount, type TeamInventoryRow } from '@/types/teamInventory'
import type { StockBatch } from '@/types/teamMaterials'
import { dispatchableAmounts, stockAvailable, stockSelectable } from '@/utils/materialStock'
import { formatDateTime } from '@/utils/format'
import { processingRoleLabels } from '@/types/materialProcessing'
import {
  inventoryScheduleBaseline,
  inventoryScheduleDue,
  inventoryScheduleLabel,
  inventoryScheduleTone,
  loadInventorySchedules,
} from '@/utils/inventorySchedule'

const props = defineProps<{
  teamId: number
  group: TeamInventoryRow | null
  canWrite?: boolean
  canReallocate?: boolean
  warehouse?: boolean
  processing?: boolean
}>()
const emit = defineEmits<{
  close: []
  changed: []
  pending: []
  action: [mode: 'dispatch' | 'loss', sources: StockBatch[]]
  reallocate: [source: StockBatch]
  schedule: [id?: number, serialNo?: string]
}>()
const routeLot = ref<number | null>(null)
const ProcessRouteEditor = defineAsyncComponent(() => import('./ProcessRouteEditor.vue'))
const {
  route: viewedRoute,
  loading: routeLoading,
  open: viewRoute,
  close: closeRoute,
} = useProcessRouteView()
const rows = ref<StockBatch[]>([]),
  total = ref(0),
  page = ref(1),
  pageSize = ref(10)
const movements = ref<MaterialTransfer[]>([]),
  movementTotal = ref(0),
  movementPage = ref(1),
  movementPageSize = ref(10)
const loading = ref(false),
  error = ref('')
const scheduleLoading = ref(false),
  scheduleError = ref(''),
  expandedScheduleSources = ref<number[]>([])
let scheduleVersion = 0
async function withSchedules(items: StockBatch[], teamId = props.teamId) {
  const summaries = await loadInventorySchedules(
    teamId,
    items.map((row) => ({ id: Number(row.transfer.id), materialType: row.transfer.material_type })),
    'sources',
  )
  return items.map((row) => ({ ...row, delivery_schedule: summaries[Number(row.transfer.id)] }))
}
async function loadSchedules(current = version) {
  const request = ++scheduleVersion
  scheduleLoading.value = true
  scheduleError.value = ''
  try {
    const items = await withSchedules(rows.value)
    if (current === version && request === scheduleVersion) rows.value = items
  } catch {
    if (current === version && request === scheduleVersion)
      scheduleError.value = '交货排期加载失败，库存仍可查看。'
  } finally {
    if (current === version && request === scheduleVersion) scheduleLoading.value = false
  }
}
function toggleSchedule(row: StockBatch) {
  const id = Number(row.transfer.id)
  expandedScheduleSources.value = expandedScheduleSources.value.includes(id) ? [] : [id]
}
function scheduleDestination(row: StockBatch) {
  const peers = [
    ...new Set(
      row.delivery_schedule?.items
        .map((item) => item.next_team_name || item.external_destination)
        .filter(Boolean),
    ),
  ]
  return peers.length > 1 ? `${peers.length}个去向` : peers[0] || '—'
}
async function refreshSchedules() {
  if (
    !props.group ||
    loading.value ||
    scheduleLoading.value ||
    document.hidden ||
    batchOpen.value ||
    quantityOpen.value ||
    serialOpen.value ||
    inspectionSource.value
  )
    return
  await loadSchedules()
}
defineExpose({ refreshSchedules })
const batchOpen = ref(false),
  selected = ref<MaterialTransfer | null>(null)
const inspectionSource = ref<number | null>(null)
const inspectionOpen = ref(false)
const serialMounted = ref(false)
function openSerial() {
  serialMounted.value = true
  serialOpen.value = true
}
function openInspection(sourceId: number) {
  inspectionSource.value = sourceId
  inspectionOpen.value = true
}
const serialOpen = ref(false)
const quantityOpen = ref(false),
  quantitySource = ref<number | null>(null)
const hasLoss = computed(() =>
  rows.value.some((row) => Number(row.lost_quantity) > 0 || Number(row.lost_weight) > 0),
)
const hasPending = computed(() =>
  rows.value.some(
    (row) => Number(row.in_transit_quantity) > 0 || Number(row.in_transit_weight) > 0,
  ),
)
const hasExternalPending = computed(() =>
  rows.value.some(
    (row) => Number(row.external_pending_quantity) > 0 || Number(row.external_pending_weight) > 0,
  ),
)
const canRegisterProcessing = computed(
  () => !!(props.canWrite && props.processing && !props.warehouse),
)
const availableLabel = computed(() =>
  isScrapType(props.group?.material_type) ? '可处理' : '可转出',
)
let version = 0
const live = useLiveRefresh(() => load(true), {
  teamId: () => props.teamId,
  enabled: () => !!props.group,
  busy: () => loading.value || quantityOpen.value || batchOpen.value,
})
async function load(background = false) {
  const current = ++version
  ++scheduleVersion
  scheduleLoading.value = false
  scheduleError.value = ''
  if (!props.group) {
    loading.value = false
    return
  }
  if (!background) {
    loading.value = true
    rows.value = []
    movements.value = []
  }
  error.value = ''
  try {
    const [result, records] = await Promise.all([
      teamMaterialApi.inventorySources(props.teamId, props.group.group_id, {
        page: page.value,
        page_size: pageSize.value,
      }),
      teamMaterialApi.inventoryMovements(props.teamId, props.group.group_id, {
        page: movementPage.value,
        page_size: movementPageSize.value,
      }),
    ])
    if (current !== version) return
    const lastPage = Math.max(1, Math.ceil(result.total / pageSize.value)),
      lastMovementPage = Math.max(1, Math.ceil(records.total / movementPageSize.value))
    if (page.value > lastPage || movementPage.value > lastMovementPage) {
      page.value = Math.min(page.value, lastPage)
      movementPage.value = Math.min(movementPage.value, lastMovementPage)
      await load(background)
      return
    }
    rows.value = result.items.map((row) => ({
      ...row,
      delivery_schedule: inventoryScheduleBaseline(row.transfer.material_type),
    }))
    expandedScheduleSources.value = expandedScheduleSources.value.filter((id) =>
      result.items.some((row) => Number(row.transfer.id) === id),
    )
    void loadSchedules(current)
    total.value = result.total
    movements.value = records.items
    movementTotal.value = records.total
  } catch (e) {
    if (current === version) {
      if (background) throw e
      error.value = e instanceof Error ? e.message : '库存明细加载失败'
    }
  } finally {
    if (current === version) loading.value = false
  }
}
function exportStock() {
  const id = props.teamId,
    group = props.group
  if (!group) return null
  return tableExportSource(
    `${group.serial_no} · 当前库存`,
    total.value,
    [
      { key: 'batch_no', label: '来源批次号', value: (row: StockBatch) => row.transfer.batch_no },
      ...(props.processing
        ? [
            {
              key: 'processing_role',
              label: '加工类别',
              value: (row: StockBatch) =>
                row.processing_role
                  ? processingRoleLabels[row.processing_role]
                  : row.transfer.processing_role
                    ? processingRoleLabels[row.transfer.processing_role]
                    : '',
            },
          ]
        : []),
      {
        key: 'specification',
        label: '实际尺寸',
        value: (row) => row.current_specification ?? row.transfer.transfer_specification ?? '',
      },
      { key: 'location', label: '仓位', value: currentLocations },
      { key: 'quantity', label: '库存件数', value: (row) => row.owned_quantity },
      { key: 'weight', label: '库存重量 (kg)', value: (row) => row.owned_weight },
      {
        key: 'delivery_due_at',
        label: '要求交货时间',
        value: (row) => inventoryScheduleDue(row.delivery_schedule),
      },
      {
        key: 'delivery_schedule_status',
        label: '排期状态',
        value: (row) => inventoryScheduleLabel(row.delivery_schedule),
      },
      { key: 'delivery_destination', label: '排期接收班组 / 去向', value: scheduleDestination },
      {
        key: 'available_quantity',
        label: '可处理件数',
        value: (row) => dispatchableAmounts(row).quantity,
      },
      {
        key: 'available_weight',
        label: '可处理重量 (kg)',
        value: (row) => dispatchableAmounts(row).weight,
      },
      {
        key: 'received_at',
        label: '接收时间',
        value: (row) => formatDateTime(row.transfer.received_at),
      },
    ],
    (signal, progress) =>
      loadExportPages(
        async (page, pageSize) => {
          const result = await teamMaterialApi.inventorySources(id, group.group_id, {
            page,
            page_size: pageSize,
          })
          return { ...result, items: await withSchedules(result.items, id) }
        },
        signal,
        progress,
      ),
  )
}
function exportMovements() {
  const id = props.teamId,
    group = props.group
  if (!group) return null
  return tableExportSource(
    `${group.serial_no} · 收发记录`,
    movementTotal.value,
    globalTransferExportFields,
    (signal, progress) =>
      loadExportPages(
        (page, pageSize) =>
          teamMaterialApi.inventoryMovements(id, group.group_id, { page, page_size: pageSize }),
        signal,
        progress,
      ),
  )
}
function open(transfer: MaterialTransfer) {
  selected.value = transfer
  batchOpen.value = true
}
function action(mode: 'dispatch' | 'loss', row: StockBatch) {
  if (
    props.canWrite &&
    !loading.value &&
    !error.value &&
    (mode === 'loss' ? stockAvailable(row) : stockSelectable(row))
  )
    emit('action', mode, [actionSource(row)])
}
function actionSource(row: StockBatch) {
  const source = { ...row }
  delete source.delivery_schedule
  return source
}
function asStock(row: unknown) {
  return row as StockBatch
}
function asTransfer(row: unknown) {
  return row as MaterialTransfer
}
function incoming(row: MaterialTransfer) {
  return row.entry_kind === 'serial_reallocation'
    ? row.serial_no === props.group?.serial_no
    : Number(row.next_team.id) === props.teamId
}
function movementLabel(row: MaterialTransfer) {
  if (row.entry_kind === 'processing_output') return '本班组加工'
  if (row.entry_kind === 'serial_reallocation') return incoming(row) ? '转投入' : '转投出'
  if (incoming(row))
    return row.entry_kind === 'opening_stock'
      ? '初始库存登记'
      : row.entry_kind === 'warehouse_receipt'
        ? '入库'
        : '收料'
  return row.entry_kind === 'inspection_shipment'
    ? '发货'
    : row.entry_kind === 'warehouse_outbound'
      ? '对外出库'
      : '转出'
}
function counterpart(row: MaterialTransfer) {
  if (row.entry_kind === 'processing_output') return `${row.next_team.name} · 加工实物`
  if (row.entry_kind === 'serial_reallocation')
    return incoming(row) ? row.source_serial_no || '—' : row.serial_no
  if (!incoming(row)) return row.external_destination || row.next_team.name || '—'
  return row.entry_kind === 'opening_stock'
    ? '初始库存'
    : row.external_source || row.source_team.name || '—'
}
function openQuantity(row: StockBatch) {
  quantitySource.value = Number(row.transfer.id)
  quantityOpen.value = true
}
function changed() {
  void load()
  emit('changed')
}
watch(
  [() => props.teamId, () => props.group?.group_id],
  () => {
    closeRoute()
    page.value = movementPage.value = 1
    rows.value = []
    movements.value = []
    total.value = movementTotal.value = 0
    batchOpen.value = quantityOpen.value = serialOpen.value = inspectionOpen.value = false
    serialMounted.value = false
    selected.value = null
    inspectionSource.value = null
    expandedScheduleSources.value = []
    void load()
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  ++version
})
</script>

<template>
  <AppDialog
    :model-value="!!group"
    title="库存明细"
    width="min(1480px, calc(100vw - 32px))"
    align-center
    append-to-body
    class="material-detail-dialog warehouse-stock-detail"
    @update:model-value="!$event && emit('close')"
  >
    <LiveRefreshNotice :message="live.message.value" @retry="live.request" />
    <ElDescriptions v-if="group" class="stock-detail-overview" :column="3" border>
      <ElDescriptionsItem label="流水号"
        ><span v-if="group.shared_unallocated"
          >共投料 · {{ group.shared_serials?.length || 0 }} 个流水号</span
        ><ElButton v-else link type="primary" @click="openSerial">{{
          group.serial_no
        }}</ElButton></ElDescriptionsItem
      >
      <ElDescriptionsItem label="材质">{{ group.material_name || '—' }}</ElDescriptionsItem>
      <ElDescriptionsItem label="规格">{{
        group.transfer_specification || '—'
      }}</ElDescriptionsItem>
      <ElDescriptionsItem label="物料类型">{{
        materialTypeLabel(group.material_type || null)
      }}</ElDescriptionsItem>
      <ElDescriptionsItem label="本班组业务">{{
        group.purpose_name || '未指定业务'
      }}</ElDescriptionsItem>
      <ElDescriptionsItem :label="warehouse ? '来源' : '上序班组'">{{
        inventorySourceLabel(group, warehouse)
      }}</ElDescriptionsItem>
      <ElDescriptionsItem
        v-if="(group.max_weight_difference || 0) > materialWeightToleranceKg"
        label="同批累计重量差异"
        >最大 {{ inventoryAmount(group.max_weight_difference) }} kg，超过
        {{ materialWeightToleranceKg }} kg，请核对</ElDescriptionsItem
      >
    </ElDescriptions>
    <SharedMaterialInfo v-if="group" :item="group" />
    <StatePanel v-if="error" state="error" :description="error" @retry="load()" />
    <StatePanel v-else-if="loading" state="loading" title="正在读取库存明细" />
    <template v-else>
      <section class="stock-detail-section material-detail-section" aria-label="当前库存">
        <header>
          <h3>当前库存</h3>
          <div class="detail-section-actions">
            <ElButton
              v-if="
                group && (Number(group.reserved_quantity) > 0 || Number(group.reserved_weight) > 0)
              "
              link
              type="primary"
              @click="emit('pending')"
              >查看转出待确认批次</ElButton
            ><TableExportButton
              :source="exportStock"
              :disabled="loading || !!error"
              :context="group?.group_id"
            />
          </div>
        </header>
        <ElTable
          class="business-table warehouse-source-table"
          :data="rows"
          row-key="transfer.id"
          :expand-row-keys="expandedScheduleSources.map(String)"
          empty-text="暂无来源记录"
        >
          <ElTableColumn label="来源批次号" min-width="205"
            ><template #default="{ row }"
              ><ElButton link type="primary" @click="open(row.transfer)">{{
                row.transfer.batch_no
              }}</ElButton></template
            ></ElTableColumn
          >
          <ElTableColumn
            v-if="
              processing && rows.some((row) => row.processing_role || row.transfer.processing_role)
            "
            label="加工类别"
            min-width="110"
            ><template #default="{ row }">{{
              processingRoleLabels[
                (row.processing_role ||
                  row.transfer.processing_role) as keyof typeof processingRoleLabels
              ] || '—'
            }}</template></ElTableColumn
          >
          <ElTableColumn label="派工工序" min-width="170" align="center"
            ><template #default="{ row }"
              ><ElButton
                v-if="row.transfer.rework_route_id"
                link
                type="primary"
                :disabled="!row.transfer.rework_route_ready || routeLoading"
                @click="viewRoute(row.transfer.rework_route_id)"
                >{{ row.transfer.rework_route_ready ? '返工工艺' : '待制定返工工艺' }}</ElButton
              ><ElButton v-else link type="primary" @click="routeLot = Number(row.transfer.id)">{{
                row.transfer.process_route
                  ? `${row.transfer.process_route.sequence_no} · ${row.transfer.process_route.step_name}`
                  : warehouse && canWrite
                    ? '关联工艺'
                    : '查看工艺'
              }}</ElButton></template
            ></ElTableColumn
          >
          <ElTableColumn label="当前实际尺寸" min-width="180" show-overflow-tooltip
            ><template #default="{ row }">{{
              row.current_specification ?? row.transfer.transfer_specification ?? '—'
            }}</template></ElTableColumn
          >
          <ElTableColumn v-if="warehouse" label="当前仓位" min-width="160" show-overflow-tooltip
            ><template #default="{ row }">{{
              currentLocations(asStock(row))
            }}</template></ElTableColumn
          >
          <ElTableColumn label="库存件数" min-width="110" align="right"
            ><template #default="{ row }">{{
              inventoryAmount(row.owned_quantity)
            }}</template></ElTableColumn
          >
          <ElTableColumn label="库存重量 (kg)" min-width="140" align="right"
            ><template #default="{ row }">{{
              inventoryAmount(row.owned_weight)
            }}</template></ElTableColumn
          >
          <ElTableColumn label="要求交货时间" min-width="180" align="center">
            <template #default="{ row }">
              <ElButton
                v-if="row.delivery_schedule?.count"
                link
                type="primary"
                :class="`source-schedule-link--${inventoryScheduleTone(row.delivery_schedule)}`"
                :aria-expanded="expandedScheduleSources.includes(Number(row.transfer.id))"
                :aria-label="`查看批次${row.transfer.batch_no}交货排期`"
                @click="toggleSchedule(asStock(row))"
                >{{ inventoryScheduleDue(row.delivery_schedule) }}</ElButton
              >
              <span v-else>{{ inventoryScheduleDue(row.delivery_schedule) }}</span>
            </template>
          </ElTableColumn>
          <ElTableColumn label="排期状态" min-width="120" align="center">
            <template #default="{ row }">
              <span v-if="!row.delivery_schedule && scheduleLoading">读取中</span>
              <ElTag v-else :type="inventoryScheduleTone(row.delivery_schedule)">{{
                inventoryScheduleLabel(row.delivery_schedule)
              }}</ElTag>
            </template>
          </ElTableColumn>
          <ElTableColumn
            label="排期接收班组 / 去向"
            min-width="160"
            align="center"
            show-overflow-tooltip
          >
            <template #default="{ row }">{{ scheduleDestination(asStock(row)) }}</template>
          </ElTableColumn>
          <ElTableColumn
            v-if="rows.some((row) => row.weight_difference)"
            label="同批累计差异 (kg)"
            min-width="175"
            align="right"
            ><template #default="{ row }"
              ><span
                :class="{
                  'source-weight-warning':
                    Math.abs(row.weight_difference || 0) > materialWeightToleranceKg,
                }"
                >{{ row.weight_difference > 0 ? '+' : ''
                }}{{ inventoryAmount(row.weight_difference) }}</span
              ></template
            ></ElTableColumn
          >
          <ElTableColumn :label="`${availableLabel}件数`" min-width="120" align="right"
            ><template #default="{ row }">{{
              inventoryAmount(dispatchableAmounts(asStock(row)).quantity)
            }}</template></ElTableColumn
          >
          <ElTableColumn :label="`${availableLabel}重量 (kg)`" min-width="150" align="right"
            ><template #default="{ row }">{{
              inventoryAmount(dispatchableAmounts(asStock(row)).weight)
            }}</template></ElTableColumn
          >
          <ElTableColumn v-if="hasPending" label="待签收件数" min-width="120" align="right"
            ><template #default="{ row }">{{
              inventoryAmount(row.in_transit_quantity)
            }}</template></ElTableColumn
          >
          <ElTableColumn v-if="hasPending" label="待签收重量 (kg)" min-width="150" align="right"
            ><template #default="{ row }">{{
              inventoryAmount(row.in_transit_weight)
            }}</template></ElTableColumn
          >
          <ElTableColumn
            v-if="hasExternalPending"
            label="对外待确认件数"
            min-width="150"
            align="right"
            ><template #default="{ row }">{{
              inventoryAmount(row.external_pending_quantity)
            }}</template></ElTableColumn
          >
          <ElTableColumn
            v-if="hasExternalPending"
            label="对外待确认重量 (kg)"
            min-width="180"
            align="right"
            ><template #default="{ row }">{{
              inventoryAmount(row.external_pending_weight)
            }}</template></ElTableColumn
          >
          <ElTableColumn v-if="hasLoss" label="丢失件数" min-width="110" align="right"
            ><template #default="{ row }">{{
              inventoryAmount(row.lost_quantity)
            }}</template></ElTableColumn
          >
          <ElTableColumn v-if="hasLoss" label="丢失重量 (kg)" min-width="140" align="right"
            ><template #default="{ row }">{{
              inventoryAmount(row.lost_weight)
            }}</template></ElTableColumn
          >
          <ElTableColumn :label="processing ? '接收 / 加工时间' : '接收时间'" min-width="170"
            ><template #default="{ row }">{{
              formatDateTime(row.transfer.received_at)
            }}</template></ElTableColumn
          >
          <ElTableColumn
            v-if="rows.some((row) => row.delivery_schedule?.count)"
            type="expand"
            width="1"
            class-name="source-schedule-toggle"
            label-class-name="source-schedule-toggle"
            :resizable="false"
            ><template #default="{ row }">
              <InventoryScheduleDetails
                v-if="row.delivery_schedule?.count"
                :summary="row.delivery_schedule"
                :serial-no="row.transfer.serial_no"
                @close="expandedScheduleSources = []"
                @view="emit('schedule', $event)"
                @view-all="emit('schedule', undefined, row.transfer.serial_no)"
              /> </template
          ></ElTableColumn>
          <ElTableColumn v-if="processing" label="质量检查" min-width="155" align="center"
            ><template #default="{ row }"
              ><ElButton
                link
                :type="row.inspection_hold_id ? 'danger' : 'primary'"
                @click="openInspection(Number(row.transfer.id))"
                >{{ row.inspection_hold_id ? '待处理 · 禁止转出' : '检查记录' }}</ElButton
              ></template
            ></ElTableColumn
          >
          <ElTableColumn label="返工属性" min-width="130" align="center"
            ><template #default="{ row }">{{
              row.transfer.process_route?.route_kind === 'rework'
                ? '返工中'
                : row.transfer.rework_pending
                  ? '待返工'
                  : row.transfer.rework_count
                    ? `已返工 ${row.transfer.rework_count} 次`
                    : '—'
            }}</template></ElTableColumn
          >
          <ElTableColumn v-if="processing" label="加工状态" min-width="185" align="center"
            ><template #default="{ row }"
              ><ProcessingStockStatus
                :state="row.processing_state"
                :material-type="row.transfer.material_type" /></template
          ></ElTableColumn>
          <ElTableColumn
            label="操作"
            :width="canWrite ? (canReallocate ? 310 : 250) : 110"
            fixed="right"
            ><template #default="{ row }"
              ><div class="source-actions">
                <ElButton
                  v-if="!isWeightOnlyType(row.transfer.material_type)"
                  link
                  type="primary"
                  @click="openQuantity(asStock(row))"
                  >{{
                    canRegisterProcessing && stockAvailable(asStock(row))
                      ? row.transfer.rework_pending
                        ? '返工登记'
                        : '加工登记'
                      : processing
                        ? '加工记录'
                        : '件数记录'
                  }}</ElButton
                ><template v-if="canWrite"
                  ><ElButton
                    link
                    type="primary"
                    :disabled="!stockSelectable(asStock(row))"
                    @click="action('dispatch', asStock(row))"
                    >出库</ElButton
                  ><ElButton
                    v-if="canReallocate"
                    link
                    type="primary"
                    :disabled="!stockSelectable(asStock(row))"
                    @click="emit('reallocate', actionSource(asStock(row)))"
                    >转投</ElButton
                  ><ElButton
                    link
                    type="primary"
                    :disabled="!stockAvailable(asStock(row))"
                    @click="action('loss', asStock(row))"
                    >登记丢失</ElButton
                  ></template
                >
              </div></template
            ></ElTableColumn
          >
        </ElTable>
        <div v-if="scheduleError" class="source-schedule-error" role="status">
          <span>{{ scheduleError }}</span
          ><ElButton link type="primary" :loading="scheduleLoading" @click="loadSchedules()"
            >重试排期</ElButton
          >
        </div>
        <footer>
          <span>共 {{ total }} 个来源批次（含零库存）</span
          ><ElPagination
            aria-label="当前库存分页"
            :current-page="page"
            :page-size="pageSize"
            :page-sizes="[10, 20, 50, 100]"
            :total="total"
            layout="sizes, prev, pager, next"
            @current-change="
              ($event) => {
                page = $event
                load()
              }
            "
            @size-change="
              ($event) => {
                pageSize = $event
                page = 1
                load()
              }
            "
          />
        </footer>
      </section>
      <section class="stock-detail-section material-detail-section" aria-label="逐笔收发记录">
        <header>
          <div class="detail-section-heading">
            <h3>收发记录</h3>
            <span>{{ movementTotal }} 笔</span>
          </div>
          <div class="detail-section-actions">
            <TableExportButton
              :source="exportMovements"
              :disabled="loading || !!error"
              :context="group?.group_id"
            />
          </div>
        </header>
        <ElTable
          class="business-table warehouse-movement-table"
          :data="movements"
          row-key="id"
          empty-text="暂无收发记录"
        >
          <ElTableColumn label="批次号" min-width="205"
            ><template #default="{ row }"
              ><ElButton link type="primary" @click="open(asTransfer(row))">{{
                row.batch_no
              }}</ElButton></template
            ></ElTableColumn
          >
          <ElTableColumn label="业务" min-width="95"
            ><template #default="{ row }">{{
              movementLabel(asTransfer(row))
            }}</template></ElTableColumn
          >
          <ElTableColumn label="来源批次号" min-width="205"
            ><template #default="{ row }">{{
              incoming(asTransfer(row)) &&
              !['serial_reallocation', 'processing_output'].includes(row.entry_kind)
                ? '—'
                : row.source_transfer_batch_no || '—'
            }}</template></ElTableColumn
          >
          <ElTableColumn label="来源 / 去向" min-width="120"
            ><template #default="{ row }">{{
              counterpart(asTransfer(row))
            }}</template></ElTableColumn
          >
          <ElTableColumn label="件数" min-width="85" align="right"
            ><template #default="{ row }">{{
              inventoryAmount(row.quantity)
            }}</template></ElTableColumn
          >
          <ElTableColumn label="重量 (kg)" min-width="115" align="right"
            ><template #default="{ row }">{{
              inventoryAmount(row.weight)
            }}</template></ElTableColumn
          >
          <ElTableColumn label="状态" min-width="125"
            ><template #default="{ row }"
              ><ElTag effect="light" :type="materialTransferStatusTone(row.status)">{{
                materialTransferStatusLabel(row.status, row.entry_kind)
              }}</ElTag></template
            ></ElTableColumn
          >
          <ElTableColumn label="收发时间" min-width="170"
            ><template #default="{ row }">{{
              formatDateTime(incoming(asTransfer(row)) ? row.received_at : row.transferred_at)
            }}</template></ElTableColumn
          >
        </ElTable>
        <footer>
          <span>共 {{ movementTotal }} 笔收发记录</span
          ><ElPagination
            aria-label="收发记录分页"
            :current-page="movementPage"
            :page-size="movementPageSize"
            :page-sizes="[10, 20, 50, 100]"
            :total="movementTotal"
            layout="sizes, prev, pager, next"
            @current-change="
              ($event) => {
                movementPage = $event
                load()
              }
            "
            @size-change="
              ($event) => {
                movementPageSize = $event
                movementPage = 1
                load()
              }
            "
          />
        </footer>
      </section>
    </template>
  </AppDialog>
  <MaterialTransferDrawer
    v-model="batchOpen"
    :transfer="selected"
    :trace-scope="{ team_id: teamId, direction: 'all' }"
    @changed="changed"
  />
  <AppDialog
    v-model="inspectionOpen"
    title="本批检查记录"
    width="min(1380px, calc(100vw - 40px))"
    align-center
    append-to-body
    @closed="inspectionSource = null"
  >
    <TeamInspectionRecords
      v-if="inspectionSource != null"
      :team-id="teamId"
      :source-id="inspectionSource"
      compact
    />
    <template #footer><ElButton @click="inspectionOpen = false">关闭</ElButton></template>
  </AppDialog>
  <QuantityAdjustmentDialog
    v-model="quantityOpen"
    :team-id="teamId"
    :source-id="quantitySource"
    :can-write="canRegisterProcessing"
    :processing="processing"
    @saved="changed"
    @changed="changed"
  />
  <SerialMaterialDrawer
    v-if="group && serialMounted"
    v-model="serialOpen"
    :team-id="teamId"
    :serial-no="group.serial_no"
    @closed="serialMounted = false"
  />
  <ProcessRouteLotDialog
    v-if="routeLot"
    :lot-id="routeLot"
    :can-bind="warehouse && canWrite"
    @close="routeLot = null"
    @changed="emit('changed')"
  />
  <ProcessRouteEditor v-if="viewedRoute" :route="viewedRoute" view-only @close="closeRoute" />
</template>

<style scoped>
.stock-detail-overview :deep(.el-descriptions__table) {
  table-layout: fixed;
}
.stock-detail-overview :deep(.el-descriptions__table .el-descriptions__cell) {
  padding: 10px;
  font-size: 14px;
  line-height: 22px;
  text-align: center;
}
.stock-detail-overview :deep(.el-descriptions__table .el-descriptions__label) {
  width: 110px;
  font-weight: 500;
  background: var(--table-header-bg);
}
.source-weight-warning {
  color: var(--el-color-danger);
}
.source-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px 12px;
}
.source-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}
.source-schedule-link--danger {
  color: var(--el-color-danger);
}
.source-schedule-link--warning {
  color: var(--el-color-warning);
}
.source-schedule-error {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding-block: 8px;
  color: var(--muted);
  font-size: 13px;
}
.warehouse-source-table {
  container-type: inline-size;
}
.warehouse-source-table :deep(.source-schedule-toggle) {
  padding: 0;
  border-right: 0;
}
.warehouse-source-table :deep(.source-schedule-toggle .cell) {
  display: none;
}
.warehouse-source-table :deep(.el-table__expanded-cell) {
  padding: 0;
}
@media (max-width: 760px) {
  :deep(.el-descriptions__body) {
    overflow-x: auto;
  }
  :deep(.el-descriptions__table) {
    min-width: 640px;
  }
  .stock-detail-section > footer {
    overflow-x: auto;
  }
  .stock-detail-section :deep(.el-scrollbar__bar.is-horizontal) {
    opacity: 1;
  }
  .stock-detail-section :deep(.el-table-fixed-column--right) {
    position: relative !important;
    right: auto !important;
  }
  .stock-detail-section :deep(.el-table-fixed-column--right::before) {
    box-shadow: none;
  }
}
</style>
