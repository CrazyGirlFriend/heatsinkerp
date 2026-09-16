<script setup lang="ts">
import { CircleCheck, Delete, EditPen, Lock, Printer } from '@element-plus/icons-vue'
import {
  ElAlert,
  ElButton,
  ElIcon,
  ElMessageBox,
} from 'element-plus'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import BarcodeCard from '@/components/BarcodeCard.vue'
import MaterialTransferDetailFrame from '@/components/MaterialTransferDetailFrame.vue'
import MaterialTransferStatus from '@/components/MaterialTransferStatus.vue'
import MaterialTransferDocumentFields from '@/components/MaterialTransferDocumentFields.vue'
import MaterialTransferHistory from '@/components/MaterialTransferHistory.vue'
import MaterialTransferFormDialog from '@/components/MaterialTransferFormDialog.vue'
import MaterialTransferPrintSheet from '@/components/MaterialTransferPrintSheet.vue'
import MaterialDispatchDrawer from '@/components/MaterialDispatchDrawer.vue'
import { isDispatchNumber } from '@/types/teamMaterials'
import SerialUrgencyBadge from './SerialUrgencyBadge.vue'
import StatePanel from '@/components/StatePanel.vue'
import LiveRefreshNotice from './LiveRefreshNotice.vue'
import { useLiveRefresh } from '@/composables/useLiveRefresh'
import { MaterialTransferApiError, materialTransferApi } from '@/services/materialTransferApi'
import { useAuthStore } from '@/stores/auth'
import { showToast } from '@/stores/toast'
import type { MaterialTransfer, MaterialTransferFilterParams } from '@/types/materialTransfer'
import {
  canConfirmMaterialTransfer,
  canConfirmOutbound,
  canEditMaterialTransfer,
  canVoidMaterialTransfer,
  materialTransferVersion,
  isWarehouseReceipt,
  isExternalTransfer,
  externalActionLabel,
  materialTypeLabel,
} from '@/types/materialTransfer'
import { formatDateTime } from '@/utils/format'

const props = withDefaults(defineProps<{
  modelValue: boolean
  batchNo?: string
  transfer?: MaterialTransfer | null
  traceScope?: Pick<MaterialTransferFilterParams, 'team_id' | 'direction'>
  docked?: boolean
}>(), { batchNo: '', transfer: null, docked: false })

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  changed: [transfer: MaterialTransfer]
  confirmed: [transfer: MaterialTransfer]
  voided: [transfer: MaterialTransfer]
  busyChange: [busy: boolean]
}>()

const authStore = useAuthStore()
const current = ref<MaterialTransfer | null>(null)
const grouped = computed(() => Boolean(current.value?.dispatch_no && isDispatchNumber(current.value.dispatch_no)))
const groupOpen = ref(false)
const receipt = computed(() => Boolean(current.value && isWarehouseReceipt(current.value)))
const external = computed(() => Boolean(current.value && isExternalTransfer(current.value)))
const actionLabel = computed(() => externalActionLabel(current.value?.entry_kind))
const loading = ref(false)
const loadError = ref('')
const confirming = ref(false)
const voiding = ref(false)
const editOpen = ref(false)
const printReady = ref(false)
const reviewNotice = ref('')
let requestVersion = 0
let actionVersion = 0
let confirmKey = ''
onBeforeUnmount(() => { ++requestVersion; ++actionVersion })
watch([confirming, voiding], ([confirmBusy, voidBusy]) => emit('busyChange', confirmBusy || voidBusy), { flush: 'sync' })

const effectiveBatchNo = computed(() => props.batchNo.trim() || props.transfer?.batch_no || '')
const canEdit = computed(() => Boolean(current.value && !loadError.value && !loading.value && canEditMaterialTransfer(current.value)))
const canVoid = computed(() => Boolean(current.value && !loadError.value && !loading.value && canVoidMaterialTransfer(current.value)))
const canConfirm = computed(() => Boolean(!grouped.value && current.value && !loadError.value && !loading.value && canConfirmMaterialTransfer(current.value)))
const canConfirmExternal = computed(() => Boolean(!grouped.value && current.value && !loadError.value && !loading.value && authStore.isTeamAccount && String(authStore.currentUser?.team_id) === String(current.value.source_team.id) && canConfirmOutbound(current.value)))
watch(effectiveBatchNo, () => { reviewNotice.value = '' })
const tracePath = computed(() => {
  if (!current.value?.serial_no) return ''
  const query = new URLSearchParams({ serial_no: current.value.serial_no })
  if (props.traceScope?.team_id !== undefined) {
    query.set('team_id', String(props.traceScope.team_id))
    query.set('direction', props.traceScope.direction || 'all')
  }
  return `/material-trace?${query}`
})
const stateMessage = computed(() => {
  if (!current.value) return ''
  if (grouped.value) return '这是整批中的一条物料明细，请打开所属批次核对或打印。'
  if (receipt.value) return '手工入库已入账，单据已锁定'
  if (authStore.isAdmin) return '管理员仅可查看转料记录'
  if (current.value.status === 'dispatched') return `${actionLabel.value}已确认，单据已锁定`
  if (external.value && current.value.status === 'pending') return `已预留库存，由${current.value.source_team.name}确认实际${actionLabel.value}`
  if (current.value.status === 'received') return '接收已确认，转料内容已锁定'
  if (current.value.status === 'voided') return '该转料单已作废'
  if (canConfirm.value) return '整单确认接收：无需重新录入数量或重量，请核对后确认。'
  if (canEdit.value || canVoid.value) return '接收确认前，转出方可以修改或作废'
  return '当前账号仅可查看此转料单'
})

function numberText(value: number, unit: string): string {
  return `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 3 }).format(value)} ${unit}`
}

function newIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() || `confirm-transfer-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const freezeLive = computed(() => loading.value || confirming.value || voiding.value || editOpen.value || printReady.value || groupOpen.value)
const liveRefresh = useLiveRefresh(() => load(false, true), {
  enabled: () => props.modelValue && Boolean(effectiveBatchNo.value), busy: () => freezeLive.value,
})
async function load(resetKey: unknown = true, background = false): Promise<void> {
  const batchNo = effectiveBatchNo.value
  if (!batchNo) {
    current.value = null
    loadError.value = '未提供转料批次号'
    return
  }
  const version = ++requestVersion
  if (!background) loading.value = true
  loadError.value = ''
  if (!background && props.transfer?.batch_no === batchNo) current.value = props.transfer
  try {
    const result = await materialTransferApi.get(batchNo)
    if (version !== requestVersion || !props.modelValue) return
    if (background && freezeLive.value) { liveRefresh.request(); return }
    if (resetKey !== false || current.value?.version !== result.version) confirmKey = newIdempotencyKey()
    current.value = result
  } catch (error) {
    if (version !== requestVersion || !props.modelValue) return
    if (background) throw error
    loadError.value = error instanceof Error ? error.message : '转料单加载失败'
    if (!current.value) current.value = null
  } finally {
    if (version === requestVersion) loading.value = false
  }
}

function close(): void {
  if (confirming.value || voiding.value) return
  editOpen.value = false
  ++requestVersion
  emit('update:modelValue', false)
}

function updateCurrent(transfer: MaterialTransfer): void {
  current.value = transfer
  emit('changed', transfer)
}

async function confirmReceipt(): Promise<void> {
  const transfer = current.value
  if (!transfer || !canConfirm.value || confirming.value) return
  const epoch = ++actionVersion
  confirming.value = true
  try {
    await ElMessageBox.confirm(
      `确认已收到 ${numberText(transfer.quantity, '件')}、${numberText(transfer.weight, 'kg')}？确认后转出方不能修改。`,
      '确认接收',
      { type: 'warning', confirmButtonText: '确认接收', cancelButtonText: '取消' },
    )
  } catch {
    if (epoch === actionVersion) confirming.value = false
    return
  }
  if (epoch !== actionVersion || !props.modelValue) return
  try {
    const confirmed = await materialTransferApi.confirm(transfer.batch_no, { idempotency_key: confirmKey || newIdempotencyKey(), ...materialTransferVersion(transfer) })
    if (epoch !== actionVersion || !props.modelValue) return
    current.value = confirmed
    emit('changed', confirmed)
    emit('confirmed', confirmed)
    reviewNotice.value = ''
    showToast(`转料单 ${confirmed.batch_no} 已确认接收`, 'success')
  } catch (error) {
    if (epoch !== actionVersion || !props.modelValue) return
    const message = error instanceof MaterialTransferApiError ? error.message : error instanceof Error ? error.message : '接收确认失败'
    showToast(message, 'error')
    if (error instanceof MaterialTransferApiError && error.status === 409) {
      reviewNotice.value = '单据已更新，请重新核对最新内容后接收。'
    }
    await load()
  } finally {
    if (epoch === actionVersion) confirming.value = false
  }
}

async function confirmExternal() {
  const transfer = current.value
  if (!transfer || !canConfirmExternal.value || confirming.value) return
  const epoch = ++actionVersion
  const active = () => epoch === actionVersion && props.modelValue && effectiveBatchNo.value === transfer.batch_no
  const verb = externalActionLabel(transfer.entry_kind)
  confirming.value = true
  try {
    await ElMessageBox.confirm(
      `批次：${transfer.batch_no}\n材质：${transfer.material_name || '未填写'} · ${materialTypeLabel(transfer.material_type)}\n${verb}去向：${transfer.external_destination || '未填写'}\n数量：${numberText(transfer.quantity, '件')}、${numberText(transfer.weight, 'kg')}\n确认物料已实际${verb}？由${transfer.source_team.name}确认后扣减库存，单据将锁定。`,
      `确认${verb}`,
      { type: 'warning', confirmButtonText: `确认${verb}`, cancelButtonText: '取消', customClass: 'outbound-confirmation' },
    )
    if (!active()) return
    await authStore.refreshCurrentUser()
    if (!active() || !canConfirmExternal.value) return
    confirmKey ||= newIdempotencyKey()
    const confirmed = await materialTransferApi.confirmOutbound(transfer.batch_no, { idempotency_key: confirmKey, ...materialTransferVersion(transfer) })
    if (!active()) return
    current.value = confirmed; reviewNotice.value = ''
    emit('changed', confirmed); emit('confirmed', confirmed)
    showToast(`${verb}单 ${confirmed.batch_no} 已确认${verb}`, 'success')
  } catch (failure) {
    if (!active() || failure === 'cancel' || failure === 'close') return
    showToast(failure instanceof Error ? failure.message : `${verb}确认失败`, 'error')
    const conflict = failure instanceof MaterialTransferApiError && failure.status === 409
    if (conflict) { reviewNotice.value = `单据已更新，请重新核对最新内容后确认${verb}。` }
    await load(conflict)
  } finally { if (active()) confirming.value = false }
}

async function voidTransfer(): Promise<void> {
  const transfer = current.value
  if (!transfer || !canVoid.value || voiding.value) return
  const epoch = ++actionVersion
  voiding.value = true
  try {
    await ElMessageBox.confirm(
      '作废后不能恢复或接收。',
      `作废转料单 ${transfer.batch_no}`,
      { type: 'warning', confirmButtonText: '确认作废', cancelButtonText: '取消' },
    )
  } catch {
    if (epoch === actionVersion) voiding.value = false
    return
  }
  if (epoch !== actionVersion || !props.modelValue) return
  try {
    const voided = await materialTransferApi.void(transfer.batch_no)
    if (epoch !== actionVersion || !props.modelValue) return
    current.value = voided
    emit('changed', voided)
    emit('voided', voided)
    showToast(`转料单 ${voided.batch_no} 已作废`, 'success')
  } catch (error) {
    if (epoch !== actionVersion || !props.modelValue) return
    showToast(error instanceof Error ? error.message : '转料单作废失败', 'error')
  } finally {
    if (epoch === actionVersion) voiding.value = false
  }
}

async function printTransfer(): Promise<void> {
  if (!current.value) return
  if (grouped.value) { groupOpen.value = true; return }
  printReady.value = true
  await nextTick()
  await nextTick()
  document.body.classList.add('material-transfer-printing')
  try {
    window.print()
  } finally {
    document.body.classList.remove('material-transfer-printing')
    printReady.value = false
  }
}

async function groupChanged() {
  await load()
  if (current.value && props.modelValue) emit('changed', current.value)
}

watch(
  () => [props.modelValue, effectiveBatchNo.value] as const,
  ([open]) => {
    groupOpen.value = false
    ++actionVersion; confirming.value = false; voiding.value = false
    if (!open) {
      ++requestVersion
      editOpen.value = false
      return
    }
    current.value = props.transfer || null
    editOpen.value = false
    confirmKey = newIdempotencyKey()
    void load()
  },
  { immediate: true },
)
watch(() => props.transfer, (transfer) => {
  if (transfer?.batch_no !== effectiveBatchNo.value || !transfer) return
  if (freezeLive.value) { liveRefresh.request(); return }
  const previous = current.value
  if (previous?.version && transfer.version && transfer.version < previous.version) return
  if (previous && previous.version !== transfer.version && !transfer.history?.length) {
    void load()
    return
  }
  // List responses intentionally omit audit events; keep the detail history for this same version.
  current.value = { ...transfer, history: transfer.history?.length ? transfer.history : previous?.history ?? [], loss_records: transfer.loss_records?.length ? transfer.loss_records : previous?.loss_records ?? [] }
})

watch(() => `${authStore.currentUser?.id ?? ''}:${authStore.currentUser?.team_id ?? ''}:${authStore.isTeamAccount}`, () => {
  groupOpen.value = false
  ++requestVersion
  ++actionVersion; confirming.value = false; voiding.value = false
  editOpen.value = false
  current.value = null
  emit('update:modelValue', false)
})

</script>

<template>
  <MaterialTransferDetailFrame :model-value="modelValue && !groupOpen" :docked="docked" :busy="confirming || voiding" @close="close">
    <template #header>
      <header class="drawer-heading">
        <span>{{ receipt ? '库房手工入库' : external ? `${actionLabel}详情` : '转料详情' }}</span>
        <h2>{{ current?.batch_no || effectiveBatchNo || '正在读取…' }}</h2>
        <MaterialTransferStatus v-if="current" :status="current.status" :entry-kind="current.entry_kind" />
      </header>
    </template>

    <StatePanel v-if="loading && !current" state="loading" title="正在读取转料单" />
    <StatePanel v-else-if="loadError && !current" state="error" :description="loadError" @retry="load" />
    <div v-else-if="current" class="drawer-content">
      <LiveRefreshNotice :message="liveRefresh.message.value" @retry="liveRefresh.request" />
      <ElAlert v-if="loadError" type="warning" :closable="false" title="最新数据刷新失败，当前显示上次加载结果" show-icon />
      <ElButton v-if="loadError" :loading="loading" @click="load">重新读取</ElButton>
      <ElAlert v-if="reviewNotice" class="review-notice" type="warning" :closable="false" :title="reviewNotice" show-icon />
      <div class="document-barcode"><BarcodeCard :value="grouped ? current.dispatch_no! : current.barcode_payload || current.batch_no" :entity-label="grouped ? '整批出库' : receipt ? '入库批次号' : '转料批次号'" compact /><ElButton v-if="grouped" link type="primary" @click="groupOpen = true">打开所属整批 · {{ current.dispatch_no }}</ElButton></div>
      <MaterialTransferDocumentFields :transfer="current" group="all"><template #serial><RouterLink :to="tracePath">{{ current.serial_no }}</RouterLink><SerialUrgencyBadge :urgency="current.urgency" /></template></MaterialTransferDocumentFields>
      <section class="document-records"><h3>{{ receipt ? '入库记录' : '流转记录' }}</h3><MaterialTransferHistory :transfer="current" /></section>
      <section v-if="current.loss_records?.length" class="document-records"><h3>来源批次丢失记录</h3><div class="document-table-scroll"><table class="loss-record-table business-document-table" aria-label="来源批次丢失记录"><thead><tr><th scope="col">记录号</th><th scope="col">件数</th><th scope="col">重量（kg）</th><th scope="col">原因</th><th scope="col">登记人 / 时间</th></tr></thead><tbody><tr v-for="loss in current.loss_records" :key="loss.id"><td>{{ loss.loss_no }}</td><td>{{ loss.quantity }}</td><td>{{ loss.weight }}</td><td class="table-prose">{{ loss.reason }}</td><td>{{ loss.created_by }}<br />{{ formatDateTime(loss.created_at) }}</td></tr></tbody></table></div></section>
    </div>

    <template v-if="current" #footer>
      <div class="drawer-footer">
        <ElButton v-if="canConfirm" type="primary" :icon="CircleCheck" :loading="confirming" @click="confirmReceipt">确认接收</ElButton>
        <ElButton v-if="canConfirmExternal" type="primary" :icon="CircleCheck" :loading="confirming" @click="confirmExternal">确认{{ actionLabel }}</ElButton>
        <ElButton v-if="canEdit" type="primary" :icon="EditPen" :disabled="voiding" @click="editOpen = true">编辑</ElButton>
        <ElButton :icon="Printer" @click="printTransfer">{{ grouped ? '核对 / 打印整批' : receipt ? '打印入库单' : external ? `打印${actionLabel}单` : '打印转料单' }}</ElButton>
        <ElButton v-if="canVoid" type="danger" plain :icon="Delete" :loading="voiding" @click="voidTransfer">作废</ElButton>
      </div>
      <p class="permission-note" :title="stateMessage" aria-live="polite"><ElIcon><Lock /></ElIcon>{{ canConfirm ? '接收后本单将锁定。' : stateMessage }}</p>
    </template>
  </MaterialTransferDetailFrame>
  <MaterialDispatchDrawer v-model="groupOpen" :dispatch-no="current?.dispatch_no || ''" :docked="docked" @changed="groupChanged" @busy-change="emit('busyChange', $event)" />
  <MaterialTransferFormDialog v-model="editOpen" :transfer="current" @saved="updateCurrent" @refreshed="updateCurrent" />
  <Teleport to="body"><MaterialTransferPrintSheet v-if="current && printReady" :transfer="current" /></Teleport>
</template>

<style scoped>
:global(.outbound-confirmation .el-message-box__message p) { white-space: pre-line; overflow-wrap: anywhere; line-height: 1.8; }
.drawer-heading { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px 16px; padding-right: 24px; }
.drawer-heading > span:first-child { font-size: 22px; font-weight: 600; }
.drawer-heading h2 { margin: 0; font-size: 16px; font-weight: 400; overflow-wrap: anywhere; }
.drawer-content { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; min-width: 0; }
.document-barcode { display: grid; grid-template-columns: minmax(0, 1fr); min-width: 0; justify-items: center; padding: 0 0 4px; }
.document-records { min-width: 0; }
.document-records h3 { margin: 6px 0 12px; font-size: 16px; font-weight: 600; }
.document-table-scroll { overflow-x: auto; }
.loss-record-table { width: 100%; min-width: 620px; table-layout: fixed; border-collapse: collapse; font-size: 14px; line-height: 1.7; }
.loss-record-table th, .loss-record-table td { border: 1px solid #cdd3dc; padding: 10px; text-align: left; overflow-wrap: anywhere; white-space: pre-wrap; }
.loss-record-table th { background: var(--table-header-bg); font-weight: 500; }
.drawer-footer { display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
.drawer-footer :deep(.el-button) { margin: 0; height: 40px; font-size: 15px; }
.permission-note { display: flex; align-items: baseline; gap: 7px; margin: 10px 0 0; color: var(--subtle); font-size: 13px; line-height: 1.6; }
.permission-note .el-icon { flex-shrink: 0; }
@media (max-width: 560px) { .drawer-heading { gap: 8px; } .drawer-heading h2 { flex-basis: 100%; } }
</style>
