<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { ElAlert, ElButton, ElMessageBox, ElTag } from 'element-plus'
import { CircleCheck, Printer, Refresh } from '@element-plus/icons-vue'
import BarcodeCard from './BarcodeCard.vue'
import MaterialDocumentTable from './MaterialDocumentTable.vue'
import MaterialTransferDocumentFields from './MaterialTransferDocumentFields.vue'
import MaterialTransferDetailFrame from './MaterialTransferDetailFrame.vue'
import MaterialTransferFormDialog from './MaterialTransferFormDialog.vue'
import MaterialTransferHistory from './MaterialTransferHistory.vue'
import MaterialDispatchPrintSheet from './MaterialDispatchPrintSheet.vue'
import SerialUrgencyBadge from './SerialUrgencyBadge.vue'
import StatePanel from './StatePanel.vue'
import LiveRefreshNotice from './LiveRefreshNotice.vue'
import { useLiveRefresh } from '@/composables/useLiveRefresh'
import { materialDispatchApi, MaterialDispatchApiError } from '@/services/materialDispatchApi'
import { materialTransferApi } from '@/services/materialTransferApi'
import { useAuthStore } from '@/stores/auth'
import { showToast } from '@/stores/toast'
import { dispatchConfirmLabel, dispatchDocumentTitle, dispatchStatusLabel, type MaterialDispatchDocument } from '@/types/teamMaterials'
import { canEditMaterialTransfer, canVoidMaterialTransfer, isExternalEntryKind, materialTransferStatusLabel, materialTypeLabel, type MaterialTransfer } from '@/types/materialTransfer'
import { materialRequestKey } from '@/utils/materialStock'
import { formatDateTime } from '@/utils/format'

const props = withDefaults(defineProps<{ modelValue: boolean; dispatchNo?: string; docked?: boolean }>(), { dispatchNo: '', docked: false })
const emit = defineEmits<{ 'update:modelValue': [boolean]; changed: [MaterialDispatchDocument]; busyChange: [boolean] }>()
const auth = useAuthStore()
const current = ref<MaterialDispatchDocument | null>(null)
const loading = ref(false)
const busy = ref(false)
const errorMessage = ref('')
const notice = ref('')
const editOpen = ref(false)
const editing = ref<MaterialTransfer | null>(null)
const printReady = ref(false)
const expandedBatchNo = ref('')
const documentFields = computed(() => current.value ? [
  { label: '转出班组', value: current.value.source_team.name },
  { label: external.value ? '外部去向' : '接收班组', value: current.value.next_team.name },
  { label: '登记人', value: current.value.created_by || '—' },
  { label: '创建时间', value: formatDateTime(current.value.created_at) },
  { label: '整批确认人', value: current.value.confirmed_by || '—' },
  { label: '确认时间', value: formatDateTime(current.value.confirmed_at) },
  { label: '说明', value: current.value.notes || '无', fullWidth: true },
] : [])
let generation = 0
let requestVersion = 0
let key = ''
const external = computed(() => isExternalEntryKind(current.value?.entry_kind))
const confirmLabel = computed(() => dispatchConfirmLabel(current.value?.entry_kind))
const pending = computed(() => current.value?.items.filter(line => line.status === 'pending') || [])
const pendingQuantity = computed(() => pending.value.reduce((sum, line) => sum + line.quantity, 0))
const pendingWeight = computed(() => Math.round(pending.value.reduce((sum, line) => sum + line.weight, 0) * 1000) / 1000)
const identity = () => `${auth.currentUser?.id ?? ''}:${auth.currentUser?.team_id ?? ''}:${auth.isTeamAccount}`
const ownsSource = computed(() => auth.isTeamAccount && auth.currentUser?.active !== false && !auth.currentUserError && String(auth.currentUser?.team_id) === String(current.value?.source_team.id))
const canConfirm = computed(() => Boolean(current.value && !loading.value && !errorMessage.value && !current.value.locked && pending.value.length && auth.isTeamAccount && auth.currentUser?.active !== false && !auth.currentUserError && String(auth.currentUser?.team_id) === String(external.value ? current.value.source_team.id : current.value.next_team.id) && current.value.allowed_actions.includes(external.value ? 'confirm_outbound' : 'confirm')))
const active = (epoch: number, code = props.dispatchNo) => epoch === generation && props.modelValue && code === props.dispatchNo
watch(busy, value => emit('busyChange', value), { flush: 'sync' })

const freezeLive = computed(() => busy.value || loading.value || editOpen.value || printReady.value)
const liveRefresh = useLiveRefresh(async () => { await load(true, true) }, {
  enabled: () => props.modelValue && Boolean(props.dispatchNo), busy: () => freezeLive.value,
})
async function load(preserveKey = false, background = false): Promise<MaterialDispatchDocument | null> {
  const epoch = generation, request = ++requestVersion, code = props.dispatchNo
  if (!code || !props.modelValue) return null
  if (!background) loading.value = true
  errorMessage.value = ''
  try {
    const result = await materialDispatchApi.get(code)
    if (!active(epoch, code) || request !== requestVersion) return null
    if (background && freezeLive.value) { liveRefresh.request(); return null }
    if (!preserveKey || result.revision !== current.value?.revision) key = materialRequestKey()
    current.value = result
    return result
  } catch (error) {
    if (active(epoch, code) && request === requestVersion && background) throw error
    if (active(epoch, code) && request === requestVersion) errorMessage.value = error instanceof Error ? error.message : '整批单据读取失败'
    return null
  } finally { if (active(epoch, code) && request === requestVersion) loading.value = false }
}
function close() { if (!busy.value) emit('update:modelValue', false) }
async function confirmGroup() {
  const reviewed = current.value
  if (!reviewed || !canConfirm.value || busy.value) return
  const epoch = generation, code = props.dispatchNo, actor = identity(), label = confirmLabel.value
  busy.value = true
  try {
    await ElMessageBox.confirm(
      `出库批次：${reviewed.dispatch_no}\n${reviewed.source_team.name} → ${reviewed.next_team.name}\n共 ${reviewed.line_count} 条物料明细，本次确认 ${pending.value.length} 条待确认明细\n本次：${pendingQuantity.value} 件、${pendingWeight.value} kg\n确认班组：${external.value ? reviewed.source_team.name : reviewed.next_team.name}\n确认后这些明细将同时锁定，已有确认和作废记录保留。`,
      label, { confirmButtonText: label, cancelButtonText: '返回核对', type: 'warning', customClass: 'dispatch-confirmation' },
    )
    if (!active(epoch, code) || actor !== identity()) return
    await auth.refreshCurrentUser()
    if (!active(epoch, code) || actor !== identity() || !canConfirm.value) return
    key ||= materialRequestKey()
    const result = await materialDispatchApi.confirm(code, { idempotency_key: key, expected_revision: reviewed.revision }, isExternalEntryKind(reviewed.entry_kind))
    if (!active(epoch, code) || actor !== identity()) return
    current.value = result; notice.value = ''; key = materialRequestKey()
    emit('changed', result)
    showToast(`${reviewed.dispatch_no} ${dispatchStatusLabel(result.status, result.entry_kind)}`, 'success')
  } catch (error) {
    if (!active(epoch, code) || error === 'cancel' || error === 'close') return
    const conflict = error instanceof MaterialDispatchApiError && error.status === 409
    notice.value = conflict ? '整批内容已变化，请重新核对全部明细，再次确认。' : '确认结果暂未核实，正在重新读取整批状态。'
    showToast(error instanceof Error ? error.message : '整批确认失败', 'error')
    const refreshed = await load(!conflict)
    if (refreshed && active(epoch, code)) {
      emit('changed', refreshed)
      if (!refreshed.items.some(line => line.status === 'pending')) notice.value = '已重新核实，整批没有待确认明细。'
      else if (!conflict) notice.value = '已重新读取整批状态，请核对后重试确认。'
    }
  } finally { if (active(epoch, code)) busy.value = false }
}
function editLine(line: MaterialTransfer) { if (!busy.value && !loading.value && !errorMessage.value && ownsSource.value && canEditMaterialTransfer(line)) { editing.value = line; editOpen.value = true } }
async function lineChanged() {
  editOpen.value = false; editing.value = null
  const result = await load()
  if (result) { notice.value = '明细已更新，请重新核对整批内容。'; emit('changed', result) }
}
async function lineRefreshed(line: MaterialTransfer) {
  editing.value = line
  const result = await load()
  if (result) { notice.value = '明细已更新，请重新核对整批内容。'; emit('changed', result) }
}
async function voidLine(line: MaterialTransfer) {
  if (busy.value || loading.value || errorMessage.value || !ownsSource.value || !canVoidMaterialTransfer(line)) return
  const epoch = generation, actor = identity()
  busy.value = true
  try {
    await ElMessageBox.confirm(`仅作废流水号 ${line.serial_no} 的这条物料明细，整批其他明细保留。`, '作废物料明细', { confirmButtonText: '确认作废', cancelButtonText: '取消', type: 'warning' })
    if (!active(epoch) || actor !== identity()) return
    await auth.refreshCurrentUser()
    if (!active(epoch) || actor !== identity() || !ownsSource.value) return
    await materialTransferApi.void(line.batch_no)
    if (active(epoch)) await lineChanged()
  } catch (error) { if (active(epoch) && error !== 'cancel' && error !== 'close') { showToast(error instanceof Error ? error.message : '明细作废失败', 'error'); await load() } }
  finally { if (active(epoch)) busy.value = false }
}
async function printGroup() {
  if (busy.value || loading.value || editOpen.value) return
  const epoch = generation
  busy.value = true
  try {
    const result = await load(true)
    if (!result || !active(epoch)) return
    printReady.value = true
    await nextTick(); await nextTick()
    if (!active(epoch)) return
    document.body.classList.add('material-dispatch-printing')
    window.print()
  } finally {
    document.body.classList.remove('material-dispatch-printing')
    printReady.value = false
    if (active(epoch)) busy.value = false
  }
}
function reset() {
  expandedBatchNo.value = ''
  if (busy.value) ElMessageBox.close()
  ++generation; ++requestVersion; current.value = null; busy.value = false; loading.value = false; printReady.value = false; editOpen.value = false; editing.value = null; errorMessage.value = ''; notice.value = ''; key = ''
}
watch(() => [props.modelValue, props.dispatchNo] as const, ([open]) => { reset(); if (open) void load() }, { immediate: true })
watch(identity, () => { reset(); emit('update:modelValue', false) })
onBeforeUnmount(reset)
</script>

<template>
  <MaterialTransferDetailFrame :model-value="modelValue" :docked="docked" :busy="busy" title="整批物料详情" @close="close">
    <template #header><header class="dispatch-detail-heading"><h2>{{ dispatchDocumentTitle(current?.entry_kind) }}</h2><strong>{{ current?.dispatch_no || dispatchNo }}</strong><ElTag v-if="current" :type="current.status === 'received' || current.status === 'dispatched' ? 'success' : 'warning'">{{ dispatchStatusLabel(current.status, current.entry_kind) }}</ElTag></header></template>
    <StatePanel v-if="loading && !current" state="loading" title="正在读取全部物料明细" />
    <StatePanel v-else-if="!current" state="error" :description="errorMessage" @retry="load()" />
    <div v-else class="dispatch-detail-content">
      <LiveRefreshNotice :message="liveRefresh.message.value" @retry="liveRefresh.request" />
      <ElAlert v-if="errorMessage" :title="errorMessage" type="error" :closable="false" /><ElButton v-if="errorMessage" :icon="Refresh" :loading="loading" @click="load()">重新读取整批</ElButton>
      <ElAlert v-if="notice" :title="notice" type="warning" :closable="false" />
      <div class="dispatch-barcode"><BarcodeCard :value="current.barcode_payload" entity-label="整批出库" compact /></div>
      <MaterialDocumentTable :fields="documentFields" label="批次单据资料" />
      <div class="dispatch-lines-heading"><h3>物料明细</h3><span>{{ current.line_count }} 条<template v-if="pending.length"> · 待确认 {{ pending.length }} 条（{{ pendingQuantity }} 件 / {{ pendingWeight }} kg）</template></span></div>
      <div class="dispatch-table-scroll"><table class="dispatch-detail-lines business-document-table" aria-label="全部物料明细">
        <colgroup><col style="width: 6%" /><col style="width: 23%" /><col style="width: 23%" /><col style="width: 9%" /><col style="width: 12%" /><col style="width: 12%" /><col style="width: 15%" /></colgroup>
        <thead><tr><th scope="col">序号</th><th scope="col">流水号</th><th scope="col">材质 / 规格</th><th scope="col" class="number">件数</th><th scope="col" class="number">重量（kg）</th><th scope="col">状态</th><th scope="col">操作</th></tr></thead>
        <tbody><template v-for="(line, index) in current.items" :key="line.batch_no">
          <tr class="dispatch-detail-line"><td>{{ index + 1 }}</td><td><RouterLink :to="{ path: '/material-trace', query: { serial_no: line.serial_no } }">{{ line.serial_no }}</RouterLink><SerialUrgencyBadge :urgency="line.urgency" /></td><td>{{ line.material_name || '—' }}<small>{{ materialTypeLabel(line.material_type) }} · {{ line.transfer_specification || line.finished_specification || '—' }}</small></td><td class="number">{{ line.quantity }}</td><td class="number">{{ line.weight }}</td><td>{{ materialTransferStatusLabel(line.status, line.entry_kind) }}</td><td><div class="dispatch-line-actions"><ElButton link type="primary" :aria-label="'查看明细 ' + (index + 1)" :aria-expanded="expandedBatchNo === line.batch_no" @click="expandedBatchNo = expandedBatchNo === line.batch_no ? '' : line.batch_no">{{ expandedBatchNo === line.batch_no ? '收起' : '详情' }}</ElButton><template v-if="ownsSource && !errorMessage"><ElButton v-if="canEditMaterialTransfer(line)" link type="primary" :disabled="busy || loading" :aria-label="'编辑明细 ' + (index + 1)" @click="editLine(line)">编辑</ElButton><ElButton v-if="canVoidMaterialTransfer(line)" link type="danger" :disabled="busy || loading" :aria-label="'作废明细 ' + (index + 1)" @click="voidLine(line)">作废</ElButton></template></div></td></tr>
          <tr v-if="expandedBatchNo === line.batch_no" class="dispatch-expanded-line"><td colspan="7" class="table-prose"><p>明细 {{ index + 1 }} · 历史明细号 {{ line.batch_no }}</p><MaterialTransferDocumentFields :transfer="line" group="all" /><h4>流转记录</h4><MaterialTransferHistory :transfer="line" /></td></tr>
        </template></tbody>
        <tfoot><tr><th colspan="3" scope="row">合计<small>不含作废明细</small></th><td class="number">{{ current.total_quantity }}</td><td class="number">{{ current.total_weight }}</td><td colspan="2"></td></tr></tfoot>
      </table></div>
    </div>
    <template #footer><div class="dispatch-detail-actions"><ElButton v-if="canConfirm" type="primary" :icon="CircleCheck" :loading="busy" @click="confirmGroup">{{ confirmLabel }}</ElButton><ElButton :icon="Printer" :disabled="!current || loading || busy || Boolean(errorMessage)" @click="printGroup">打印整批单</ElButton></div><p v-if="current" class="dispatch-detail-note">{{ current.locked ? '本批已完成，保留完整明细与追溯记录。' : canConfirm ? '请核对全部明细，整批一次确认。' : '当前账号可查看整批物料与打印汇总单。' }}</p></template>
  </MaterialTransferDetailFrame>
  <MaterialTransferFormDialog v-model="editOpen" :transfer="editing" @saved="lineChanged" @refreshed="lineRefreshed" />
  <Teleport to="body"><MaterialDispatchPrintSheet v-if="current && printReady" :dispatch="current" /></Teleport>
</template>

<style scoped>
:global(.dispatch-confirmation .el-message-box__message p) { white-space: pre-line; overflow-wrap: anywhere; line-height: 1.8; }
.dispatch-detail-heading { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: baseline; padding-right: 24px; }
.dispatch-detail-heading h2 { margin: 0; font-size: 22px; font-weight: 600; }
.dispatch-detail-heading > strong { font-size: 16px; font-weight: 400; overflow-wrap: anywhere; }
.dispatch-detail-content { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; min-width: 0; }
.dispatch-barcode { min-width: 0; padding-bottom: 4px; }
.dispatch-lines-heading { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px 16px; margin-top: 4px; }
.dispatch-lines-heading h3 { margin: 0; font-size: 16px; font-weight: 600; }
.dispatch-lines-heading > span { font-size: 14px; color: #60656f; }
.dispatch-table-scroll { min-width: 0; overflow-x: auto; }
.dispatch-detail-lines { width: 100%; min-width: 740px; table-layout: fixed; border-collapse: collapse; color: #303133; font-size: 15px; line-height: 1.65; }
.dispatch-detail-lines th, .dispatch-detail-lines td { border: 1px solid #cdd3dc; padding: 12px 10px; text-align: left; vertical-align: top; overflow-wrap: anywhere; white-space: pre-wrap; }
.dispatch-detail-lines th { background: var(--table-header-bg); font-weight: 500; }
.dispatch-detail-lines .number { text-align: right; font-variant-numeric: tabular-nums; }
.dispatch-detail-lines small { display: block; margin-top: 4px; color: #60656f; font-size: 13px; }
.dispatch-detail-lines a { color: var(--primary); }
.dispatch-detail-lines tfoot td { background: #f7f8fa; font-weight: 600; }
.dispatch-line-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 10px; }
.dispatch-line-actions :deep(.el-button) { margin: 0; font-size: 14px; }
.dispatch-expanded-line > td { padding: 16px; }
.dispatch-expanded-line p { margin: 0 0 12px; font-size: 14px; }
.dispatch-expanded-line h4 { margin: 16px 0 12px; font-size: 15px; font-weight: 500; }
.dispatch-detail-actions { display: flex; flex-wrap: wrap; gap: 10px; justify-content: flex-end; }
.dispatch-detail-actions :deep(.el-button) { height: 40px; margin: 0; font-size: 15px; }
.dispatch-detail-note { margin: 10px 0 0; color: var(--subtle); font-size: 13px; line-height: 1.6; }
@media (max-width: 560px) { .dispatch-detail-heading > strong { flex-basis: 100%; } }
</style>
