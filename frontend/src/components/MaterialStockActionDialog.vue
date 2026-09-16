<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { ElAlert, ElButton, ElDialog, ElForm, ElFormItem, ElInput, ElInputNumber, ElOption, ElRadioButton, ElRadioGroup, ElSelect } from 'element-plus'
import MaterialAmount from './MaterialAmount.vue'
import { useAuthStore } from '@/stores/auth'
import { useTeamDirectoryStore } from '@/stores/teamDirectory'
import { teamWorkspaceProfile } from '@/config/teamWorkspaces'
import { teamMaterialApi, TeamMaterialApiError } from '@/services/teamMaterialApi'
import { externalActionLabel, isExternalEntryKind, materialTypeLabel, materialTypeOptions, type ExternalEntryKind, type MaterialType } from '@/types/materialTransfer'
import type { CreateDispatch, DispatchKind, MaterialDispatch, MaterialLoss, StockBatch } from '@/types/teamMaterials'
import { amountError, materialRequestKey } from '@/utils/materialStock'

const props = defineProps<{ modelValue: boolean; teamId: number; mode: 'dispatch' | 'loss'; sources: StockBatch[] }>()
const emit = defineEmits<{ 'update:modelValue': [boolean]; saved: [MaterialDispatch | MaterialLoss]; balancesChanged: [] }>()
const auth = useAuthStore()
const directory = useTeamDirectoryStore()
const lines = ref<{ source: StockBatch; latest: StockBatch | null; quantity: number | undefined; weight: number | undefined; materialType: MaterialType | '' }[]>([])
const form = reactive({ nextTeamId: '' as string | number, entryKind: 'transfer' as DispatchKind, externalDestination: '', notes: '', reason: '' })
const saving = ref(false)
const refreshing = ref(false)
const errorMessage = ref('')
const balanceNotice = ref('')
let generation = 0
let requestKey = ''
let fingerprint = ''
const isLoss = computed(() => props.mode === 'loss')
const canWrite = computed(() => auth.isTeamAccount && auth.currentUser?.active !== false && String(auth.currentUser?.team_id) === String(props.teamId) && !auth.currentUserError)
const externalOption = computed<ExternalEntryKind | null>(() => {
  const team = directory.items.find(team => team.active && Number(team.id) === props.teamId)
  if (!team || directory.error) return null
  return team.code === 'FACTORY-WAREHOUSE' && team.kind === 'warehouse' ? 'warehouse_outbound' : team.code === 'FACTORY-QC' && team.kind === 'production' ? 'inspection_shipment' : null
})
const external = computed(() => !isLoss.value && isExternalEntryKind(form.entryKind))
const actionLabel = computed(() => externalActionLabel(form.entryKind))
const destinations = computed(() => directory.items.filter(team => team.active && String(team.id) !== String(props.teamId)))
const warehouse = computed(() => !external.value && destinations.value.find(team => String(team.id) === String(form.nextTeamId))?.kind === 'warehouse')
const totalQuantity = computed(() => lines.value.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0))
const totalWeight = computed(() => Math.round(lines.value.reduce((sum, line) => sum + (Number(line.weight) || 0), 0) * 1000) / 1000)
const busy = computed(() => saving.value || refreshing.value)
function close() { if (!busy.value) emit('update:modelValue', false) }
function fillAll(index: number) {
  const line = lines.value[index]
  if (!line?.latest) return
  line.quantity = line.latest.available_quantity ?? undefined
  line.weight = line.latest.available_weight ?? undefined
}
watch([() => props.modelValue, () => props.teamId, () => props.mode], ([open]) => {
  ++generation
  saving.value = false
  refreshing.value = false
  if (!open) return
  lines.value = (isLoss.value ? props.sources.slice(0, 1) : props.sources).map(source => ({ source, latest: source, quantity: isLoss.value ? undefined : source.available_quantity ?? undefined, weight: isLoss.value ? undefined : source.available_weight ?? undefined, materialType: source.transfer.material_type || '' }))
  form.nextTeamId = ''; form.entryKind = 'transfer'; form.externalDestination = ''; form.notes = ''; form.reason = ''
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
  results.forEach((result, index) => { lines.value[index]!.latest = result.status === 'fulfilled' ? result.value : null })
  refreshing.value = false
  balanceNotice.value = results.some(result => result.status === 'rejected') ? '部分来源余量读取失败，请重试。填写内容已保留。' : '已刷新来源余量，填写内容已保留。请逐批核对后重新提交。'
  emit('balancesChanged')
}

async function submit() {
  if (busy.value) return
  errorMessage.value = ''
  if (!canWrite.value) { errorMessage.value = '仅本班组账号可以操作物料'; return }
  if (!lines.value.length || lines.value.length > 100) { errorMessage.value = '请选择 1 至 100 个来源批次'; return }
  if (external.value && externalOption.value !== form.entryKind) { errorMessage.value = '当前班组不能使用此对外出库方式'; return }
  if (external.value && (!form.externalDestination.trim() || form.externalDestination.trim().length > 240)) { errorMessage.value = '请填写外部去向，最多 240 个字符'; return }
  if (!isLoss.value && !external.value && !destinations.value.some(team => String(team.id) === String(form.nextTeamId))) { errorMessage.value = '请选择一个启用的接收班组'; return }
  if (isLoss.value && (!form.reason.trim() || form.reason.trim().length > 2000)) { errorMessage.value = '请填写丢失原因，最多 2000 个字符'; return }
  if (form.notes.trim().length > 2000) { errorMessage.value = '说明不能超过 2000 个字符'; return }
  for (const line of lines.value) {
    const error = amountError(line.quantity, line.weight, line.latest)
    if (error) { errorMessage.value = `${line.source.transfer.batch_no}：${error}`; return }
    if (!isLoss.value && warehouse.value && !line.materialType) { errorMessage.value = `${line.source.transfer.batch_no}：转入库房前请选择物料类型`; return }
  }
  const current = generation
  const teamId = props.teamId
  const first = lines.value[0]!
  const lossBody = { source_transfer_id: Number(first.source.transfer.id), quantity: Number(first.quantity), weight: Number(first.weight), reason: form.reason.trim() }
  const dispatchBody: Omit<CreateDispatch, 'idempotency_key'> = { ...(isExternalEntryKind(form.entryKind) ? { entry_kind: form.entryKind, external_destination: form.externalDestination.trim() } : { next_team_id: Number(form.nextTeamId) }), notes: form.notes.trim() || null, lines: lines.value.map(line => ({ source_transfer_id: Number(line.source.transfer.id), quantity: Number(line.quantity), weight: Number(line.weight), ...(line.materialType ? { material_type: line.materialType } : {}) })) }
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
  <ElDialog :model-value="modelValue" :title="isLoss ? '登记物料丢失' : external ? `${sources.length > 1 ? '批量' : ''}${actionLabel}` : sources.length > 1 ? '批量出库' : '物料出库'" width="min(920px, 94vw)" class="stock-action-dialog" :close-on-click-modal="!busy" :close-on-press-escape="!busy" :show-close="!busy" @close="close">
    <p class="action-intro">{{ isLoss ? '仅登记本班已接收物料的实际丢失。提交后扣减可用余量，记录保留。' : external ? `每个来源批次保留一条物料明细，整批使用一个条码。创建后先预留库存，实物${actionLabel}后由本班组整批确认。` : '整批使用一个条码，发往同一班组。提交即扣减本班库存，待接收期间计入在途，下序确认后入库。' }}</p>
    <ElForm label-position="top" :disabled="busy || !canWrite" @submit.prevent="submit">
      <ElFormItem v-if="!isLoss && externalOption" label="出库方式">
        <ElRadioGroup v-model="form.entryKind" aria-label="出库方式"><ElRadioButton value="transfer">内部转料</ElRadioButton><ElRadioButton :value="externalOption">{{ externalOption === 'warehouse_outbound' ? '对外出库' : '发货' }}</ElRadioButton></ElRadioGroup>
      </ElFormItem>
      <ElFormItem v-if="external" :label="`${actionLabel}去向`" required><ElInput v-model="form.externalDestination" :aria-label="`${actionLabel}去向`" maxlength="240" show-word-limit placeholder="填写客户、收货单位或实际去向" /></ElFormItem>
      <div v-if="external" class="external-confirmation"><span>确认班组</span><strong>{{ directory.items.find(team => Number(team.id) === teamId)?.name }}</strong><small>创建后需本班组确认{{ actionLabel }}</small></div>
      <ElFormItem v-if="!isLoss && !external" label="接收班组" required class="destination-field">
        <ElSelect v-model="form.nextTeamId" aria-label="出库接收班组" placeholder="选择接收班组" filterable><ElOption v-for="team in destinations" :key="team.id" :value="team.id" :label="teamWorkspaceProfile(team.code)?.name || team.name" /></ElSelect>
      </ElFormItem>
      <div class="source-lines">
        <article v-for="(line, index) in lines" :key="line.source.transfer.id" class="source-line">
          <header><div><strong>{{ line.source.transfer.material_name || '未填写材质' }}</strong><span>{{ line.source.transfer.batch_no }}</span></div><small>来源 · {{ line.source.transfer.source_team.name }}</small></header>
          <p class="source-identity">流水号 {{ line.source.transfer.serial_no }}<span>原单批号 {{ line.source.transfer.source_batch_no || '未填写' }}</span></p>
          <div class="source-balance"><span>当前可用</span><MaterialAmount :quantity="line.latest?.available_quantity" :weight="line.latest?.available_weight" /><ElButton link type="primary" :disabled="!line.latest" @click="fillAll(index)">{{ isLoss ? '填入全部余量' : '全部出库' }}</ElButton></div>
          <div class="source-inputs">
            <ElFormItem :label="isLoss ? '丢失件数' : `${actionLabel}件数`" required><ElInputNumber v-model="line.quantity" :aria-label="`${line.source.transfer.batch_no}件数`" :min="0" :precision="0" controls-position="right" /><span class="amount-unit">件</span></ElFormItem>
            <ElFormItem :label="isLoss ? '丢失重量' : `${actionLabel}重量`" required><ElInputNumber v-model="line.weight" :aria-label="`${line.source.transfer.batch_no}重量`" :min="0" :precision="3" :step="0.1" controls-position="right" /><span class="amount-unit">kg</span></ElFormItem>
            <ElFormItem v-if="!isLoss" :label="`${actionLabel}物料类型`" :required="warehouse"><ElSelect v-model="line.materialType" :aria-label="`${line.source.transfer.batch_no}物料类型`" :placeholder="materialTypeLabel(line.source.transfer.material_type)"><ElOption v-for="type in materialTypeOptions" :key="type.value" :label="type.label" :value="type.value" /></ElSelect></ElFormItem>
          </div>
        </article>
      </div>
      <ElFormItem v-if="isLoss" label="丢失原因" required><ElInput v-model="form.reason" aria-label="丢失原因" type="textarea" :rows="3" maxlength="2000" show-word-limit placeholder="填写实际情况和原因" /></ElFormItem>
      <ElFormItem v-else :label="external ? `${actionLabel}说明` : warehouse ? '入库说明' : '出库说明'"><ElInput v-model="form.notes" :aria-label="external ? `${actionLabel}说明` : '出库说明'" type="textarea" :rows="2" maxlength="2000" show-word-limit placeholder="选填" /></ElFormItem>
    </ElForm>
    <ElAlert v-if="balanceNotice" :title="balanceNotice" type="warning" :closable="false" show-icon />
    <p v-if="errorMessage" role="alert" class="stock-action-error">{{ errorMessage }}</p>
    <ElButton v-if="balanceNotice" link type="primary" :loading="refreshing" :disabled="saving" @click="refreshBalances">重新刷新余量</ElButton>
    <template #footer><div class="action-footer"><div><span>{{ isLoss ? '本次丢失' : `共 ${lines.length} 个来源批次` }}</span><MaterialAmount :quantity="totalQuantity" :weight="totalWeight" /></div><div><ElButton :disabled="busy" @click="close">取消</ElButton><ElButton type="primary" :loading="saving" :disabled="busy || !canWrite || lines.some(line => !line.latest)" @click="submit">{{ isLoss ? '确认登记丢失' : external ? `生成${actionLabel}单` : '确认出库' }}</ElButton></div></div></template>
  </ElDialog>
</template>

<style scoped>
.external-confirmation { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-bottom: 22px; padding: 14px 16px; background: #f8f6fc; border-radius: 10px; font-size: 13px; }
.external-confirmation span, .external-confirmation small { color: var(--subtle); }
.external-confirmation small { margin-left: auto; }
.action-intro { margin: 0 0 24px; color: var(--subtle); line-height: 1.8; }
.destination-field { max-width: 370px; }
.source-lines { display: grid; gap: 14px; margin-bottom: 24px; max-height: 47vh; overflow-y: auto; padding: 1px; }
.source-line { padding: 18px 20px 6px; border: 1px solid var(--line); border-radius: 12px; background: #fcfbfe; }
.source-line header { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; }
.source-line header > div { display: flex; flex-wrap: wrap; gap: 12px; align-items: baseline; }
.source-line header strong { color: var(--text); font-size: 16px; font-weight: 600; }
.source-line header span { font-size: 12px; color: var(--subtle); }
.source-line small { color: var(--subtle); }
.source-identity { display: flex; gap: 20px; flex-wrap: wrap; margin: 10px 0 16px; color: var(--subtle); font-size: 12px; }
.source-balance { display: flex; flex-wrap: wrap; align-items: center; gap: 14px; padding-bottom: 18px; color: var(--subtle); font-size: 12px; }
.source-inputs { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }
.source-inputs :deep(.el-form-item__content) { flex-wrap: nowrap; }
.source-inputs :deep(.el-input-number) { min-width: 0; width: 100%; }
.amount-unit { padding-left: 8px; color: var(--subtle); font-size: 12px; }
.action-footer { display: flex; justify-content: space-between; gap: 20px; align-items: center; text-align: left; }
.action-footer > div:first-child { display: grid; gap: 5px; }
.action-footer > div:first-child > span { color: var(--subtle); font-size: 12px; }
.stock-action-error { color: var(--danger); line-height: 1.6; }
@media (max-width: 650px) { .source-inputs { grid-template-columns: 1fr 1fr; }.source-inputs > :last-child { grid-column: 1 / -1; }.source-line { padding: 14px 12px 0; }.source-line header { flex-wrap: wrap; }.action-footer { flex-wrap: wrap; }.action-footer > div:last-child { margin-left: auto; } }
</style>
