<script setup lang="ts">
import WeightInput from './WeightInput.vue'
import { useDialogValidation } from '@/composables/useDialogValidation'
import MaterialInput from './MaterialInput.vue'
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { ElAlert, ElButton, ElDialog, ElForm, ElFormItem, ElInput, ElInputNumber, ElOption, ElRadioButton, ElRadioGroup, ElSelect } from 'element-plus'
import MaterialAmount from './MaterialAmount.vue'
import WarehouseLocationSelect from './WarehouseLocationSelect.vue'
import OutboundQuantityClearance from './OutboundQuantityClearance.vue'
import SludgeWeightFields from './SludgeWeightFields.vue'
import SpecificationInput from './SpecificationInput.vue'
import { processingProgressLabels } from '@/types/materialProcessing'
import { sludgePayload, sludgeWeight } from '@/utils/sludgeWeight'
import { useAuthStore } from '@/stores/auth'
import { useTeamDirectoryStore } from '@/stores/teamDirectory'
import { teamWorkspaceProfile } from '@/config/teamWorkspaces'
import { teamMaterialApi, TeamMaterialApiError } from '@/services/teamMaterialApi'
import { externalActionLabel, isExternalEntryKind, isScrapType, isWeightOnlyType, materialTypeLabel, materialTypeOptions, type ExternalEntryKind, type MaterialType } from '@/types/materialTransfer'
import type { CreateDispatch, DispatchKind, CreatedMaterialBatches, MaterialLoss, StockBatch } from '@/types/teamMaterials'
import { amountError, dispatchableAmounts, materialRequestKey, outboundRemainder } from '@/utils/materialStock'
import { useTeamPurposes } from '@/composables/useTeamPurposes'
import type { WarehouseLeaseGroup } from '@/services/warehouseLocationApi'
import { currentLocations } from '@/utils/warehousePlacement'

const props = defineProps<{ modelValue: boolean; teamId: number; mode: 'dispatch' | 'loss'; sources: StockBatch[] }>()
const emit = defineEmits<{ 'update:modelValue': [boolean]; saved: [CreatedMaterialBatches | MaterialLoss]; balancesChanged: [] }>()
const locationLeases: WarehouseLeaseGroup = new Map()
const auth = useAuthStore()
const directory = useTeamDirectoryStore()
const lines = ref<{ key: string; warehouseLocation: string; warehouseLocationKey: string; locationBusy: boolean; source: StockBatch; latest: StockBatch | null; quantity: number | undefined; weight: number | undefined; gross?: number; percent?: number; materialType: MaterialType | ''; purposeId?: number; specification: string; originalSpecification: string; specificationValid: boolean }[]>([])
function enteredQuantity(line: typeof lines.value[number]) { return isWeightOnlyType(line.materialType) ? 0 : line.quantity }
function converted(line: typeof lines.value[number]) { return !isLoss.value && line.materialType === 'sludge' && !(line.source.transfer.material_type === 'sludge' && line.source.transfer.sludge_content_percent == null) }
const form = reactive({ nextTeamId: '' as string | number, entryKind: 'transfer' as DispatchKind, externalDestination: '', notes: '', reason: '' })
const saving = ref(false)
const refreshing = ref(false)
const errorMessage = ref('')
const balanceNotice = ref('')
const batchPurposeId = ref<number>()
const processing = reactive<Record<number, { quantity?: number; original?: number; revision?: number; reason: string; status?: 'partial' | 'complete'; loading: boolean; error: string }>>({})
const weightToleranceKg = 1
let generation = 0
let requestKey = ''
let fingerprint = ''
const isLoss = computed(() => props.mode === 'loss')
const sourceWarehouse = computed(() => props.sources.length > 0 && props.sources.every(source => source.transfer.next_team.code === 'FACTORY-WAREHOUSE'))
const processingTeam = computed(() => props.sources.every(source => ['FACTORY-ROLL', 'FACTORY-WIRE', 'FACTORY-ENGRAVE'].includes(source.transfer.next_team.code)))
const canWrite = computed(() => auth.isTeamAccount && auth.currentUser?.active !== false && String(auth.currentUser?.team_id) === String(props.teamId) && !auth.currentUserError)
const externalOption = computed<ExternalEntryKind | null>(() => {
  const team = directory.items.find(team => team.active && Number(team.id) === props.teamId)
  if (!team || directory.error) return null
  return team.code === 'FACTORY-WAREHOUSE' && team.kind === 'warehouse' ? 'warehouse_outbound' : team.code === 'FACTORY-QC' && team.kind === 'production' ? 'inspection_shipment' : null
})
const external = computed(() => !isLoss.value && isExternalEntryKind(form.entryKind))
const purposes = useTeamPurposes(() => props.modelValue && !isLoss.value && !external.value && form.nextTeamId ? Number(form.nextTeamId) : null)
watch(() => [form.nextTeamId, form.entryKind], () => { batchPurposeId.value = undefined; lines.value.forEach(line => { line.purposeId = undefined; line.warehouseLocation = ''; line.warehouseLocationKey = '' }) })
function applyBatchPurpose(value: number) {
  if (busy.value || !canWrite.value || !purposes.items.value.some(item => item.active && item.id === value)) return
  lines.value.forEach(line => { line.purposeId = value })
}
const actionLabel = computed(() => externalActionLabel(form.entryKind))
const containsScrap = computed(() => lines.value.some(line => isScrapType(line.materialType) || isScrapType(line.source.transfer.material_type)))
const destinations = computed(() => directory.items.filter(team => team.active && String(team.id) !== String(props.teamId) && (!containsScrap.value || team.kind === 'warehouse')))
const warehouse = computed(() => !external.value && destinations.value.find(team => String(team.id) === String(form.nextTeamId))?.kind === 'warehouse')
const totalQuantity = computed(() => lines.value.reduce((sum, line) => sum + (Number(enteredQuantity(line)) || 0), 0))
const totalWeight = computed(() => Math.round(lines.value.reduce((sum, line) => sum + (Number(line.weight) || 0), 0) * 1000000) / 1000000)
const busy = computed(() => saving.value || refreshing.value || Object.values(processing).some(item => item.loading))
function availableFor(line: typeof lines.value[number]) {
  const free = dispatchableAmounts(line.latest)
  const draft = processing[Number(line.source.transfer.id)]
  return { ...free, quantity: draft && !draft.error && draft.revision != null ? draft.quantity ?? free.quantity : free.quantity }
}
const weightNotice = computed(() => isLoss.value ? '' : lines.value.flatMap((line, index) => {
  if (lines.value.slice(0, index).some(other => other.source.transfer.id === line.source.transfer.id)) return []
  const same = lines.value.filter(other => other.source.transfer.id === line.source.transfer.id)
  if (same.some(other => amountError(enteredQuantity(other), other.weight, other.latest))) return []
  const difference = Math.round((same.reduce((sum, other) => sum + Number(other.weight), 0) - Number(dispatchableAmounts(line.latest).weight)) * 1000000) / 1000000
  return difference > 0 ? [`${line.source.transfer.batch_no}：本次转出比账面剩余多 ${difference} kg，${difference <= weightToleranceKg ? `在允许的 ${weightToleranceKg} kg 误差范围内` : `超过允许的 ${weightToleranceKg} kg 误差，请核对，仍可提交`}；仅记录重量差异，不计为损耗`] : []
}).join('；'))
const clearanceReasons = reactive<Record<string, string>>({})
const clearanceSelected = reactive<Record<string, boolean>>({})
const clearances = computed(() => isLoss.value ? [] : lines.value.flatMap((line, index) => {
  const id = Number(line.source.transfer.id)
  if (lines.value.slice(0, index).some(other => Number(other.source.transfer.id) === id)) return []
  const sameSource = lines.value.filter(other => Number(other.source.transfer.id) === id)
  if (sameSource.some(other => !!amountError(enteredQuantity(other), other.weight, other.latest))) return []
  const free = dispatchableAmounts(line.latest)
  const quantity = outboundRemainder(sameSource.reduce((sum, item) => sum + Number(enteredQuantity(item)), 0), sameSource.reduce((sum, item) => sum + Number(item.weight), 0), free.quantity, free.weight)
  return quantity > 0 ? [{ id, batchNo: line.source.transfer.batch_no, quantity, availableQuantity: free.quantity, availableWeight: free.weight }] : []
}))
watch(() => JSON.stringify(clearances.value), () => { Object.keys(clearanceReasons).forEach(key => delete clearanceReasons[key]); Object.keys(clearanceSelected).forEach(key => delete clearanceSelected[key]) })
async function loadProcessing(source: StockBatch) {
  const id = Number(source.transfer.id), current = generation
  processing[id] ||= { reason: '', loading: false, error: '' }
  const draft = processing[id]!
  draft.loading = true; draft.error = ''
  try {
    const context = await teamMaterialApi.quantityContext(props.teamId, id)
    if (current !== generation || !props.modelValue || processing[id] !== draft) return
    draft.quantity ??= context.quantity
    draft.original = context.quantity; draft.revision = context.revision
    if (processingTeam.value) draft.status ??= context.processing_status || 'partial'
    lines.value.filter(line => line.source.transfer.id === source.transfer.id).forEach(line => { if (line.specification === line.originalSpecification) line.specification = line.originalSpecification = context.transfer_specification || '' })
  } catch (e) { if (current === generation) { draft.revision = undefined; draft.error = e instanceof Error ? e.message : '件数读取失败' } }
  finally { if (current === generation) draft.loading = false }
}
function openQuantity(source: StockBatch) { if (canWrite.value && !busy.value) void loadProcessing(source) }
function removeLine(index: number) {
  const id = Number(lines.value[index]!.source.transfer.id)
  lines.value.splice(index, 1)
  if (!lines.value.some(line => Number(line.source.transfer.id) === id)) delete processing[id]
}
function close() { if (!busy.value) emit('update:modelValue', false) }
function fillAll(index: number) {
  const line = lines.value[index]
  if (!line?.latest) return
  const free = availableFor(line)
  const others = isLoss.value ? [] : lines.value.filter((other, position) => position !== index && other.source.transfer.id === line.source.transfer.id)
  line.quantity = free.quantity == null ? undefined : Math.max(0, free.quantity - others.reduce((sum, other) => sum + (enteredQuantity(other) || 0), 0))
  line.weight = free.weight == null ? undefined : Math.max(0, Math.round((free.weight - others.reduce((sum, other) => sum + (other.weight || 0), 0)) * 1000000) / 1000000)
  if (converted(line) && line.percent) {
    const gross = line.latest.sludge_available_gross_weight
    line.gross = gross == null ? undefined : Math.max(0, Math.round((gross - others.reduce((sum, other) => sum + (other.gross || 0), 0)) * 1000000) / 1000000)
    line.weight = sludgeWeight(line.gross, line.percent)
  }
}
function splitLine(index: number) {
  const line = lines.value[index]
  if (!line || busy.value || lines.value.length >= 100) return
  lines.value.splice(index + 1, 0, { ...line, key: materialRequestKey(), warehouseLocation: '', warehouseLocationKey: '', locationBusy: false, quantity: undefined, weight: undefined, gross: undefined })
}
const validation = useDialogValidation(() => {
  const issues: Record<string, string> = {}
  if (external.value && (!form.externalDestination.trim() || form.externalDestination.trim().length > 240)) issues.externalDestination = '请填写外部去向'
  if (!isLoss.value && !external.value && !destinations.value.some(team => String(team.id) === String(form.nextTeamId))) issues.nextTeamId = '请选择接收班组'
  if (form.notes.trim().length > 2000) issues.notes = '内容过长'
  if (isLoss.value && form.reason.trim().length > 2000) issues.reason = '内容过长'
  for (const line of lines.value) {
    const add = (field: string, message: string) => { issues[`${line.key}.${field}`] = message }
    if (!isLoss.value && !isScrapType(line.materialType) && !line.specificationValid) add('specification', '请补全实际尺寸')
    if (converted(line) && !sludgeWeight(line.gross, line.percent)) {
      if (!sludgeWeight(line.gross, 100)) add('gross', '请填写有效废泥实重')
      if (!sludgeWeight(1, line.percent)) add('percent', '请填写有效材料占比')
      if (!issues[`${line.key}.gross`] && !issues[`${line.key}.percent`]) add('gross', '折算重量须达到 0.000001 kg')
    } else {
      const message = amountError(enteredQuantity(line), line.weight, line.latest, isLoss.value)
      if (message && message !== '请先刷新该批次的可转出库存') {
        if (message.startsWith('件数')) add('quantity', message)
        else if (message.includes('至少一项')) { add('quantity', message); add('weight', message) }
        else add('weight', message)
      }
    }
    if (!isLoss.value && warehouse.value && !line.materialType) add('materialType', '请选择物料类型')
    if (!isLoss.value && !external.value && purposes.items.value.length && !purposes.items.value.some(item => item.active && item.id === line.purposeId)) add('purposeId', '请选择接收业务')
    const draft = processing[Number(line.source.transfer.id)]
    if (draft) {
      if (!Number.isSafeInteger(draft.quantity) || draft.quantity! < 0 || draft.quantity! > 2147483647) add('processingQuantity', '请填写有效非负整数')
      if (processingTeam.value && !draft.status) add('processingStatus', '请选择加工进度')
      if (draft.reason.trim().length > 2000) add('processingReason', '内容过长')
    }
  }
  return issues
})
const { formRef, fieldErrors } = validation
function lineError(line: typeof lines.value[number], field: string) { return fieldErrors.value[`${line.key}.${field}`] }

watch([() => props.modelValue, () => props.teamId, () => props.mode], ([open]) => {
  ++generation
  saving.value = false
  refreshing.value = false
  Object.keys(processing).forEach(key => delete processing[Number(key)])
  if (!open) return
  lines.value = (isLoss.value ? props.sources.slice(0, 1) : props.sources).map(source => ({ key: materialRequestKey(), warehouseLocation: '', warehouseLocationKey: '', locationBusy: false, source, latest: source, quantity: isLoss.value ? undefined : dispatchableAmounts(source).quantity ?? undefined, weight: isLoss.value ? undefined : dispatchableAmounts(source).weight ?? undefined, materialType: source.transfer.material_type || '', specification: source.current_specification ?? source.transfer.transfer_specification ?? '', originalSpecification: source.current_specification ?? source.transfer.transfer_specification ?? '', specificationValid: true }))
  lines.value.forEach((line, index) => { line.percent = line.source.transfer.sludge_content_percent ?? undefined; if (!isLoss.value) fillAll(index) })
  validation.reset()
  form.nextTeamId = ''; form.entryKind = 'transfer'; form.externalDestination = ''; form.notes = ''; form.reason = ''
  Object.keys(clearanceReasons).forEach(key => delete clearanceReasons[key]); Object.keys(clearanceSelected).forEach(key => delete clearanceSelected[key])
  errorMessage.value = ''; balanceNotice.value = ''; requestKey = ''; fingerprint = ''
}, { immediate: true })
watch(() => `${auth.currentUser?.id ?? ''}:${auth.currentUser?.team_id ?? ''}:${auth.isTeamAccount}`, () => { ++generation; emit('update:modelValue', false) })
onBeforeUnmount(() => { ++generation })

async function refreshBalances() {
  if (refreshing.value) return
  const current = generation
  const teamId = props.teamId
  refreshing.value = true
  const results = await Promise.allSettled(lines.value.map(line => teamMaterialApi.refreshSource(teamId, line.source)))
  if (current !== generation || !props.modelValue) return
  results.forEach((result, index) => {
    const line = lines.value[index]!
    line.latest = result.status === 'fulfilled' ? result.value : null
    if (line.latest && line.specification === line.originalSpecification) line.specification = line.originalSpecification = line.latest.current_specification ?? line.latest.transfer.transfer_specification ?? ''
  })
  await Promise.all(lines.value.filter((line, index) => processing[Number(line.source.transfer.id)] && lines.value.findIndex(other => other.source.transfer.id === line.source.transfer.id) === index).map(line => loadProcessing(line.source)))
  if (current !== generation || !props.modelValue) return
  refreshing.value = false
  balanceNotice.value = results.some(result => result.status === 'rejected') ? '部分批次的可转出库存读取失败，请重试。填写内容已保留。' : '已刷新各批次的可转出库存，填写内容已保留。请核对后重新提交。'
  emit('balancesChanged')
}

async function submit() {
  if (busy.value || lines.value.some(line => line.locationBusy)) return
  errorMessage.value = ''
  if (!canWrite.value) { errorMessage.value = '仅本班组账号可以操作物料'; return }
  if (!lines.value.length || lines.value.length > 100) { errorMessage.value = '请选择 1 至 100 个来源批次'; return }
  if (external.value && externalOption.value !== form.entryKind) { errorMessage.value = '当前班组不能使用此对外出库方式'; return }
  if (!isLoss.value && !external.value && (purposes.loading.value || purposes.error.value)) { errorMessage.value = purposes.error.value || '请等待下序业务加载完成'; return }
  if (!validation.validate()) return
  if (!isLoss.value && containsScrap.value && external.value && form.entryKind !== 'warehouse_outbound') { errorMessage.value = '废料只能转库房处理，不能按成品发货'; return }
  for (const line of lines.value) {
    if (!isLoss.value && isScrapType(line.source.transfer.material_type) && !isScrapType(line.materialType)) { errorMessage.value = '废料不能直接改为正常物料出库'; return }
    const sameSource = lines.value.filter(other => other.source.transfer.id === line.source.transfer.id)
    const error = amountError(sameSource.reduce((sum, other) => sum + Number(enteredQuantity(other)), 0), Math.round(sameSource.reduce((sum, other) => sum + Number(other.weight), 0) * 1000000) / 1000000, line.latest, isLoss.value)
    if (error) { errorMessage.value = `上一批次 ${line.source.transfer.batch_no}：${error}`; return }
  }
  for (const item of clearances.value) {
    if (clearanceSelected[item.id] && (clearanceReasons[item.id]?.trim().length ?? 0) > 2000) { errorMessage.value = `批次 ${item.batchNo}：清零原因不能超过 2000 个字符`; return }
  }
  const quantityUpdates = Object.entries(processing).filter(([id, draft]) => lines.value.some(line => Number(line.source.transfer.id) === Number(id)) && (draft.status || draft.quantity !== draft.original))
  for (const [, draft] of quantityUpdates) {
    if (draft.error || draft.revision == null) { errorMessage.value = draft.error || '请重新读取加工件数'; return }
  }
  const current = generation
  const teamId = props.teamId
  const first = lines.value[0]!
  const lossBody = { source_transfer_id: Number(first.source.transfer.id), quantity: Number(enteredQuantity(first)), weight: Number(first.weight), reason: form.reason.trim() }
  const dispatchBody: Omit<CreateDispatch, 'idempotency_key'> = { ...(isExternalEntryKind(form.entryKind) ? { entry_kind: form.entryKind, external_destination: form.externalDestination.trim() } : { next_team_id: Number(form.nextTeamId) }), notes: form.notes.trim() || null, lines: lines.value.map(line => ({ ...(warehouse.value && line.warehouseLocation ? { warehouse_location: line.warehouseLocation, warehouse_location_reservation_key: line.warehouseLocationKey } : {}), source_transfer_id: Number(line.source.transfer.id), quantity: Number(enteredQuantity(line)), weight: Number(line.weight), ...(line.specification !== line.originalSpecification ? { transfer_specification: line.specification.trim() } : {}), ...(!external.value && line.purposeId ? { purpose_id: line.purposeId } : {}), ...(line.materialType ? { material_type: line.materialType } : {}) })) }
  dispatchBody.lines.forEach((body, index) => { const line = lines.value[index]!; if (converted(line)) Object.assign(body, sludgePayload(line.materialType, line.gross, line.percent)) })
  if (clearances.value.length) dispatchBody.quantity_clearances = clearances.value.filter(item => clearanceSelected[item.id]).map(item => ({ source_transfer_id: item.id, quantity: item.quantity, reason: clearanceReasons[item.id]?.trim() || '' }))
  if (quantityUpdates.length) dispatchBody.quantity_adjustments = quantityUpdates.map(([id, draft]) => ({ source_transfer_id: Number(id), quantity: draft.quantity!, expected_revision: draft.revision!, reason: draft.reason.trim(), ...(draft.status ? { processing_status: draft.status } : {}) }))
  const nextFingerprint = JSON.stringify({ teamId, mode: props.mode, body: isLoss.value ? lossBody : dispatchBody })
  if (!requestKey || fingerprint !== nextFingerprint) { requestKey = materialRequestKey(); fingerprint = nextFingerprint }
  saving.value = true
  try {
    await auth.refreshCurrentUser()
    if (external.value) await directory.refreshTeamDirectory()
    if (current !== generation || !props.modelValue) return
    if (!canWrite.value) { errorMessage.value = '账号所属班组已变更，请关闭后重新操作'; return }
    if (external.value && externalOption.value !== form.entryKind) { errorMessage.value = '班组信息已变更，请关闭后重新操作'; return }
    const result = isLoss.value ? await teamMaterialApi.createLoss(teamId, { ...lossBody, idempotency_key: requestKey }) : await teamMaterialApi.createDispatch(teamId, { ...dispatchBody, idempotency_key: requestKey } as CreateDispatch)
    if (current !== generation || !props.modelValue) return
    emit('saved', result)
    emit('update:modelValue', false)
  } catch (error) {
    if (current !== generation || !props.modelValue) return
    errorMessage.value = error instanceof Error ? error.message : '提交失败，请重试'
    if (error instanceof TeamMaterialApiError && error.status === 409) await refreshBalances()
  } finally { if (current === generation) saving.value = false }
}
</script>

<template>
  <ElDialog :model-value="modelValue" :title="isLoss ? '登记物料丢失' : external ? `${sources.length > 1 ? '批量' : ''}${actionLabel}` : sources.length > 1 ? '批量出库' : '物料出库'" width="min(1180px, 96vw)" top="16px" class="stock-action-dialog" :close-on-click-modal="!busy" :close-on-press-escape="!busy" :show-close="!busy" @close="close">
    <ElAlert v-if="errorMessage" :title="errorMessage" type="error" :closable="false" />
    <ElForm ref="formRef" label-position="left" label-width="112px" :show-message="false" :disabled="busy || !canWrite" @submit.prevent="submit">
      <section v-if="!isLoss" class="dialog-form-section"><h3>收发信息</h3><div class="dialog-form-grid">
      <ElFormItem v-if="!isLoss && externalOption" label="出库方式" class="dialog-field-wide">
        <ElRadioGroup v-model="form.entryKind" aria-label="出库方式"><ElRadioButton value="transfer">内部转料</ElRadioButton><ElRadioButton :value="externalOption">{{ externalOption === 'warehouse_outbound' ? '对外出库' : '发货' }}</ElRadioButton></ElRadioGroup>
      </ElFormItem>
      <ElFormItem class="dialog-field-wide" v-if="external" :label="`${actionLabel}去向`" :error="fieldErrors.externalDestination" required><MaterialInput field="external_source" :label="`${actionLabel}去向`" v-model="form.externalDestination" :disabled="saving || !modelValue" :maxlength="240" placeholder="填写客户、收货单位或实际去向" /></ElFormItem>
      <ElFormItem v-if="!isLoss && !external" label="接收班组" :error="fieldErrors.nextTeamId" required class="destination-field">
        <ElSelect v-model="form.nextTeamId" aria-label="出库接收班组" placeholder="选择接收班组" filterable><ElOption v-for="team in destinations" :key="team.id" :value="team.id" :label="teamWorkspaceProfile(team.code)?.name || team.name" /></ElSelect>
      </ElFormItem>
      <ElFormItem v-if="!isLoss && !external && lines.length > 1 && purposes.items.value.some(item => item.active)" label="统一接收业务" class="batch-purpose-field">
        <ElSelect v-model="batchPurposeId" aria-label="统一接收业务" placeholder="选择一次，应用到全部物料" @change="applyBatchPurpose"><ElOption v-for="purpose in purposes.items.value.filter(item => item.active)" :key="purpose.id" :value="purpose.id" :label="purpose.name" /></ElSelect>
      </ElFormItem>
      </div>
      </section>
      <div class="source-lines">
        <article v-for="(line, index) in lines" :key="line.key" class="source-line">
          <header><div><strong>{{ line.source.transfer.serial_no }}</strong><span>{{ line.source.transfer.material_name || '未填写材质' }}</span><span>上一批次 {{ line.source.transfer.batch_no }}</span></div><div class="source-actions"><ElButton link type="primary" :disabled="!line.latest" @click="fillAll(index)">全部填入</ElButton><ElButton v-if="!isLoss && !sourceWarehouse" link type="primary" :disabled="lines.length >= 100" @click="splitLine(index)">拆分物料</ElButton><ElButton v-if="!isLoss && lines.length > 1" link type="danger" @click="removeLine(index)">移除</ElButton><ElButton v-if="!isLoss && !sourceWarehouse && !isWeightOnlyType(line.source.transfer.material_type) && !isWeightOnlyType(line.materialType) && !processing[Number(line.source.transfer.id)] && lines.findIndex(other => other.source.transfer.id === line.source.transfer.id) === index" link type="primary" @click="openQuantity(line.source)">登记加工后件数</ElButton></div></header>
          <div class="source-meta"><span>来自 {{ line.source.transfer.source_team.name }}</span><span v-if="line.source.transfer.purpose_name">业务 {{ line.source.transfer.purpose_name }}</span><span v-if="line.source.transfer.source_batch_no">原单批号 {{ line.source.transfer.source_batch_no }}</span><span v-if="sourceWarehouse">当前仓位 {{ currentLocations(line.latest || line.source) }}</span><div class="source-balance"><span>账面库存</span><MaterialAmount :weight-only="isWeightOnlyType(line.source.transfer.material_type)" :quantity="dispatchableAmounts(line.latest).quantity" :weight="dispatchableAmounts(line.latest).weight" /></div></div>
          <template v-if="!isLoss && !sourceWarehouse && !isWeightOnlyType(line.source.transfer.material_type) && (!isWeightOnlyType(line.materialType) || processing[Number(line.source.transfer.id)]) && lines.findIndex(other => other.source.transfer.id === line.source.transfer.id) === index">
            <div v-if="processing[Number(line.source.transfer.id)]" class="processing-count source-inputs dialog-form-grid">
              <p v-if="processing[Number(line.source.transfer.id)]!.loading" class="dialog-field-hint dialog-field-wide" role="status">正在读取加工件数…</p>
              <ElFormItem v-else label="加工后未转出件数" :error="lineError(line, 'processingQuantity')" required><ElInputNumber v-model="processing[Number(line.source.transfer.id)]!.quantity" :aria-label="`${line.source.transfer.batch_no}加工后未转出件数`" :min="0" :max="2147483647" :precision="0" controls-position="right" /></ElFormItem>
              <ElFormItem v-if="processingTeam && !processing[Number(line.source.transfer.id)]!.loading" label="本批加工进度" :error="lineError(line, 'processingStatus')" required><ElSelect v-model="processing[Number(line.source.transfer.id)]!.status" :aria-label="`${line.source.transfer.batch_no}本批加工进度`"><ElOption v-for="(label, value) in processingProgressLabels" :key="value" :value="value" :label="label" /></ElSelect></ElFormItem>
              <ElFormItem label="加工说明（选填）" :error="lineError(line, 'processingReason')"><ElInput v-model="processing[Number(line.source.transfer.id)]!.reason" maxlength="2000" placeholder="例如：1 块切成 20 件" /></ElFormItem>
              <p class="dialog-field-hint dialog-field-wide">仅登记尚未转出的实际件数，与本次出库一起保存。<ElButton link @click="delete processing[Number(line.source.transfer.id)]">取消登记</ElButton></p>
              <ElAlert v-if="processing[Number(line.source.transfer.id)]!.error" :title="processing[Number(line.source.transfer.id)]!.error" type="error" class="dialog-field-wide" :closable="false"><ElButton link @click="loadProcessing(line.source)">重新读取</ElButton></ElAlert>
            </div>
          </template>
          <div class="source-inputs dialog-form-grid">
            <ElFormItem v-if="!isWeightOnlyType(line.materialType)" :label="isLoss ? '丢失件数' : `${actionLabel}件数`" :error="lineError(line, 'quantity')" required><ElInputNumber v-model="line.quantity" :aria-label="`${line.source.transfer.batch_no}件数`" :min="0" :precision="0" controls-position="right"><template #suffix><span class="dialog-input-unit">件</span></template></ElInputNumber></ElFormItem>
            <ElFormItem v-if="!converted(line)" :label="isLoss ? (line.source.transfer.sludge_content_percent ? '丢失折算重量' : '丢失重量') : `${actionLabel}重量`" :error="lineError(line, 'weight')" required><WeightInput v-model="line.weight" :ariaLabel="`${line.source.transfer.batch_no}重量`" /></ElFormItem>
            <SludgeWeightFields v-if="converted(line)" v-model:gross="line.gross" v-model:percent="line.percent" :label="line.source.transfer.batch_no" :gross-error="lineError(line, 'gross')" :percent-error="lineError(line, 'percent')" :locked="line.source.transfer.sludge_content_percent != null" :disabled="busy || !canWrite" @update:weight="line.weight = $event" />
            <p v-else-if="line.materialType === 'sludge' && line.source.transfer.sludge_content_percent == null" class="dialog-field-hint dialog-field-wide">历史废泥未记录比例，沿用原账重，不自动折算。</p>
            <p v-else-if="isLoss && line.materialType === 'sludge'" class="dialog-field-hint dialog-field-wide">丢失重量按有效材料计算，不填废泥实重。</p>
            <ElFormItem v-if="!isLoss" :label="`${actionLabel}物料类型`" :error="lineError(line, 'materialType')" :required="warehouse"><span class="dialog-readonly" v-if="sourceWarehouse || line.source.transfer.material_type === 'sludge'">{{ materialTypeLabel(line.source.transfer.material_type) }}</span><ElSelect v-else v-model="line.materialType" :aria-label="`${line.source.transfer.batch_no}物料类型`" :placeholder="materialTypeLabel(line.source.transfer.material_type)"><ElOption v-for="type in materialTypeOptions.filter(type => !isScrapType(line.source.transfer.material_type) || isScrapType(type.value))" :key="type.value" :label="type.label" :value="type.value" /></ElSelect></ElFormItem>
            <ElFormItem v-if="!isLoss && !isScrapType(line.materialType)" label="实际尺寸（选填）" class="source-specification-field" :error="lineError(line, 'specification')"><SpecificationInput class="source-specification" v-model="line.specification" :label="`${line.source.transfer.batch_no}实际尺寸`" @validity-change="line.specificationValid = $event" /></ElFormItem>
            <ElFormItem v-if="!isLoss && !external" label="下序接收业务" :error="lineError(line, 'purposeId')" :required="purposes.items.value.length > 0"><ElSelect v-model="line.purposeId" :aria-label="`${line.source.transfer.batch_no}接收业务`" :loading="purposes.loading.value" :disabled="!form.nextTeamId || !purposes.items.value.length" :placeholder="!form.nextTeamId ? '先选择接收班组' : !purposes.items.value.length ? '接收班组尚未配置业务' : purposes.items.value.some(item => item.active) ? '选择接收业务' : '接收班组暂无启用业务'"><ElOption v-for="purpose in purposes.items.value.filter(item => item.active)" :key="purpose.id" :value="purpose.id" :label="purpose.name" /></ElSelect></ElFormItem>
            <ElFormItem v-if="!isLoss && warehouse" label="入库仓位" class="dialog-field-wide"><WarehouseLocationSelect v-model="line.warehouseLocation" v-model:reservation-key="line.warehouseLocationKey" :team-id="Number(form.nextTeamId)" :serial-no="line.source.transfer.serial_no" :material-name="line.source.transfer.material_name || ''" :material-type="line.materialType" :lease-group="locationLeases" :active="modelValue" :disabled="busy || !canWrite" @busy-change="line.locationBusy = $event" /></ElFormItem>
          </div>
      <OutboundQuantityClearance v-for="item in clearances.filter(item => item.id === line.source.transfer.id && lines.findIndex(candidate => candidate.source.transfer.id === item.id) === index)" :key="item.id" :batch-no="item.batchNo" :quantity="item.quantity" :enabled="!!clearanceSelected[item.id]" :reason="clearanceReasons[item.id] || ''" :disabled="busy || !canWrite" @update:enabled="clearanceSelected[item.id] = $event" @update:reason="clearanceReasons[item.id] = $event" />
        </article>
      </div>
      <section class="dialog-form-section">
      <h3>{{ isLoss ? '丢失说明' : '出库说明' }}</h3><div class="dialog-form-grid">
      <ElFormItem v-if="isLoss" class="dialog-field-wide" label="丢失原因（选填）" :error="fieldErrors.reason"><ElInput v-model="form.reason" aria-label="丢失原因" type="textarea" :rows="3" maxlength="2000" show-word-limit placeholder="选填：填写实际情况和原因" /></ElFormItem>
      <ElFormItem v-else class="dialog-field-wide" :error="fieldErrors.notes" :label="containsScrap ? '废料处理原因（选填）' : external ? `${actionLabel}说明` : warehouse ? '入库说明' : '出库说明'"><ElInput v-model="form.notes" :aria-label="external ? `${actionLabel}说明` : '出库说明'" type="textarea" :rows="2" maxlength="2000" show-word-limit placeholder="选填" /></ElFormItem>
      </div></section>
    </ElForm>
    <ElAlert v-if="weightNotice" :title="weightNotice" type="warning" :closable="false" show-icon />
    <ElAlert v-if="balanceNotice" :title="balanceNotice" type="warning" :closable="false" show-icon />
    <ElAlert v-if="!isLoss && !external && purposes.items.value.length && !purposes.items.value.some(item => item.active)" title="接收班组暂无启用业务，请联系该班组在工作台中启用。" type="warning" :closable="false" />
    <ElAlert v-if="purposes.error.value" :title="purposes.error.value" type="error" :closable="false"><ElButton link @click="purposes.refresh">重新加载业务</ElButton></ElAlert>
    <ElButton v-if="balanceNotice" link type="primary" :loading="refreshing" :disabled="saving" @click="refreshBalances">刷新库存</ElButton>
    <template #footer><div class="action-footer"><div><span>{{ isLoss ? '本次丢失' : `共 ${lines.length} 条物料明细` }}</span><MaterialAmount :weight-only="lines.length > 0 && lines.every(line => isWeightOnlyType(line.materialType))" :quantity="totalQuantity" :weight="totalWeight" /></div><div><ElButton :disabled="busy" @click="close">取消</ElButton><ElButton type="primary" :loading="saving" :disabled="busy || !canWrite || lines.some(line => !line.latest || line.locationBusy)" @click="submit">{{ isLoss ? '确认登记丢失' : external ? `提交${actionLabel}` : '确认出库' }}</ElButton></div></div></template>
  </ElDialog>
</template>

<style scoped>
.processing-count { padding: 10px 0; margin-bottom: 10px; border-block: 1px solid var(--line); }
.source-lines { display: grid; gap: 10px; margin-bottom: 14px; padding: 1px; }
.source-line { --el-component-size: 32px; padding: 12px 16px; border: 1px solid var(--line); border-radius: 10px; background: var(--workspace-bg); }
.source-line header { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 6px 16px; align-items: center; }
.source-line header > div { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: center; min-width: 0; }
.source-line header strong, .source-line header span, .source-meta > span { overflow-wrap: anywhere; }
.source-actions { margin-left: auto; }
.source-actions :deep(.el-button) { margin-left: 0; font-size: 12px; }
.source-line header strong { color: var(--text); font-size: 16px; font-weight: 600; }
.source-line header span { font-size: 12px; color: var(--subtle); }
.source-meta { display: flex; gap: 6px 16px; flex-wrap: wrap; align-items: center; margin: 6px 0 12px; color: var(--subtle); font-size: 12px; }
.source-balance { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-left: auto; }
.source-inputs { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px 16px; }
.source-inputs :deep(.el-form-item) { margin-bottom: 0; flex-direction: column; }
.source-inputs :deep(.el-form-item__label) { width: 100% !important; justify-content: flex-start; height: auto; line-height: 20px; padding: 0 0 4px; font-size: 12px; }
.source-inputs :deep(.el-form-item__content) { width: 100%; margin-left: 0 !important; }
.source-inputs :deep(.el-input__wrapper), .source-inputs :deep(.el-select__wrapper) { min-height: 32px; }
.source-inputs :deep(.sludge-measurement) { display: contents; }
.source-inputs :deep(.sludge-result) { grid-column: auto; margin: 0; padding: 6px 10px; align-self: end; }
.source-inputs :deep(.sludge-result small) { display: none; }
.source-specification-field { grid-column: span 2; }
.source-specification { flex-direction: row; flex-wrap: wrap; align-items: flex-start; }
.source-specification :deep(.el-select) { flex: 0 0 150px; }
.source-specification :deep(.el-input), .source-specification :deep(.specification-dimensions) { flex: 1; min-width: 0; }
.action-footer { width: 100%; display: flex; flex-wrap: wrap; justify-content: space-between; gap: 20px; align-items: center; text-align: left; }
.action-footer > div:last-child { display: flex; gap: 10px; }
.action-footer > div:last-child .el-button { margin-left: 0; }
.action-footer > div:first-of-type { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; }
.action-footer > div:first-of-type > span { color: var(--subtle); font-size: 12px; }
@media (max-width: 1000px) { .source-inputs { grid-template-columns: repeat(2, minmax(0, 1fr)); }.source-specification-field { grid-column: 1 / -1; } }
@media (max-width: 640px) { .source-line { padding: 12px; }.source-actions { margin-left: 0; }.source-balance { margin-left: 0; }.source-inputs { grid-template-columns: minmax(0, 1fr); }.source-specification { flex-direction: column; }.source-specification :deep(.el-select), .source-specification :deep(.el-input), .source-specification :deep(.specification-dimensions) { flex: initial; width: 100%; }.action-footer { flex-wrap: wrap; }.action-footer > div:last-child { margin-left: auto; } }
</style>
