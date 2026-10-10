<script setup lang="ts">
import WeightInput from './WeightInput.vue'
import { useDialogValidation } from '@/composables/useDialogValidation'
import OpeningMaterialFields from './OpeningMaterialFields.vue'
import SludgeWeightFields from './SludgeWeightFields.vue'
import { sludgePayload, sludgeWeight } from '@/utils/sludgeWeight'
import { onBeforeUnmount, reactive, ref, watch } from 'vue'
import { ElAlert, ElButton, ElDialog, ElForm, ElInput, ElInputNumber, ElOption, ElSelect, ElSwitch, ElTabs, ElTabPane, ElMessageBox } from 'element-plus'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import { useAuthStore } from '@/stores/auth'
import { isWeightOnlyType, materialTypeOptions, type MaterialTransfer } from '@/types/materialTransfer'
import type { OpeningLine, OpeningState, TeamPurpose } from '@/types/teamBusiness'
import { materialRequestKey } from '@/utils/materialStock'
import { showToast } from '@/stores/toast'

const props = defineProps<{ modelValue: boolean; teamId: number; initialTab?: string; businessOnly?: boolean; teamName?: string }>()
const emit = defineEmits<{ 'update:modelValue': [boolean]; changed: []; stocked: [MaterialTransfer[]] }>()
const auth = useAuthStore()
const tab = ref('purposes'), loading = ref(false), saving = ref(false), error = ref('')
const purposes = ref<TeamPurpose[]>([]), newName = ref(''), opening = ref<OpeningState | null>(null)
const lines = ref<OpeningLine[]>([])
const invalidSpecifications = reactive(new Set<OpeningLine>())
const invalidPurpose = ref<number | 'new' | null>(null)
const validation = useDialogValidation(() => {
  const issues: Record<string, string> = {}
  lines.value.forEach((line, index) => {
    const add = (field: string, message: string) => { issues[`${index}.${field}`] = message }
    if (!line.serial_no.trim() || line.serial_no.trim().length > 80) add('serial_no', '请输入有效流水号')
    if (!line.material_name.trim()) add('material_name', '请输入材质')
    if (!line.material_type) add('material_type', '请选择物料类型')
    if (invalidSpecifications.has(line)) add('transfer_specification', '请填完整规格尺寸')
    if (!Number.isInteger(enteredQuantity(line)) || Number(enteredQuantity(line)) < 0) add('quantity', '请填写有效非负整数')
    if (line.material_type === 'sludge' && !sludgeWeight(line.sludge_gross_weight, line.sludge_content_percent)) {
      if (!sludgeWeight(line.sludge_gross_weight, 100)) add('gross', '请填写有效废泥实重')
      if (!sludgeWeight(1, line.sludge_content_percent)) add('percent', '请填写有效材料占比')
      if (!issues[`${index}.gross`] && !issues[`${index}.percent`]) add('gross', '折算重量须达到 0.000001 kg')
    } else if (line.weight == null || !Number.isFinite(line.weight) || line.weight < 0) add('weight', '请填写有效非负重量')
    else if (!enteredQuantity(line) && !line.weight) { add('quantity', '件数和重量至少一项大于 0'); add('weight', '件数和重量至少一项大于 0') }
  })
  return issues
})
const { formRef, fieldErrors } = validation
function lineError(index: number, field: string) { return fieldErrors.value[`${index}.${field}`] }
let epoch = 0, requestKey = '', lastBody = ''
const key = () => `heatsink.opening-draft.v1:${auth.currentUser?.id}:${props.teamId}`
function enteredQuantity(line: OpeningLine) { return isWeightOnlyType(line.material_type) ? 0 : line.quantity }
function blank(): OpeningLine { return { serial_no: '', material_name: '', material_type: '', transfer_specification: '', quantity: undefined, weight: undefined, notes: '' } }
function close() { if (!saving.value) emit('update:modelValue', false) }
async function load() {
  const current = ++epoch
  loading.value = true; error.value = ''
  try {
    const [options, state] = await Promise.all([teamMaterialApi.purposes(props.teamId), props.businessOnly ? Promise.resolve(null) : teamMaterialApi.openingState(props.teamId)])
    if (current !== epoch) return
    purposes.value = options; opening.value = state
  } catch (e) { if (current === epoch) error.value = e instanceof Error ? e.message : '班组设置加载失败' }
  finally { if (current === epoch) loading.value = false }
}
watch(() => [props.modelValue, props.teamId], () => {
  ++epoch
  if (!props.modelValue) return
  validation.reset(); invalidPurpose.value = null
  tab.value = props.businessOnly ? 'purposes' : props.initialTab || 'purposes'; newName.value = ''; requestKey = ''; lastBody = ''; opening.value = null
  invalidSpecifications.clear(); lines.value = [blank()]
  try {
    const draft = JSON.parse(localStorage.getItem(key()) || 'null')
    if (Array.isArray(draft) && draft.length && draft.length <= 100 && draft.every(line => line && typeof line.serial_no === 'string' && typeof line.material_name === 'string')) lines.value = draft.map(line => ({ ...blank(), ...line }))
  }
  catch { /* A missing/unreadable optional draft never changes server stock. */ }
  void load()
}, { immediate: true })
watch(() => `${auth.currentUser?.id}:${auth.currentUser?.team_id}`, () => { ++epoch; emit('update:modelValue', false) })
onBeforeUnmount(() => { ++epoch })
function saveDraft() {
  try { localStorage.setItem(key(), JSON.stringify(lines.value)); showToast('草稿已保存在本机，尚未计入库存', 'success') }
  catch { error.value = '无法保存本机草稿，请检查浏览器存储权限' }
}
async function savePurpose(item?: TeamPurpose) {
  if (saving.value || loading.value) return
  const name = (item ? item.name : newName.value).trim()
  if (!name) { invalidPurpose.value = item?.id ?? 'new'; return }
  const current = epoch
  saving.value = true; error.value = ''
  try {
    await teamMaterialApi.savePurpose(props.teamId, { name, active: item?.active ?? true, ...(item ? { expected_version: item.version } : {}) }, item?.id)
    if (current !== epoch) return
    newName.value = ''; invalidPurpose.value = null; emit('changed'); await load()
  } catch (e) { if (current === epoch) error.value = e instanceof Error ? e.message : '保存失败' }
  finally { saving.value = false }
}
async function submitOpening() {
  if (saving.value || loading.value || !opening.value?.can_submit) return
  error.value = ''
  if (!validation.validate()) return
  const body = lines.value.map(line => ({ ...line, quantity: enteredQuantity(line), ...sludgePayload(line.material_type, line.sludge_gross_weight, line.sludge_content_percent), purpose_id: line.purpose_id || null, serial_no: line.serial_no.trim(), material_name: line.material_name.trim() }))
  const current = epoch
  try { await ElMessageBox.confirm(`将这 ${body.length} 行物料累加到本班组库存，每行生成独立批次。`, '确认初始库存登记', { confirmButtonText: '确认登记', cancelButtonText: '返回核对', type: 'warning' }) }
  catch { return }
  if (current !== epoch || !props.modelValue || saving.value) return
  const fingerprint = JSON.stringify(body)
  if (!requestKey || fingerprint !== lastBody) { requestKey = materialRequestKey(); lastBody = fingerprint }
  saving.value = true
  try {
    const rows = await teamMaterialApi.createOpening(props.teamId, body, requestKey)
    if (current !== epoch) return
    try { localStorage.removeItem(key()) } catch { /* The committed receipt remains authoritative. */ }
    requestKey = ''; lastBody = ''; lines.value = [blank()]; emit('update:modelValue', false); emit('stocked', rows)
    showToast('库存已登记', 'success')
  } catch (e) { if (current === epoch) error.value = e instanceof Error ? e.message : '登记失败，草稿已保留' }
  finally { saving.value = false }
}
</script>

<template>
  <ElDialog :model-value="modelValue" :title="businessOnly ? teamName ? `${teamName} · 业务设置` : '班组业务设置' : '班组设置'" top="16px" :width="businessOnly ? 'min(760px, 94vw)' : 'min(1180px, 96vw)'" :close-on-click-modal="!saving" :close-on-press-escape="!saving" :show-close="!saving" @close="close">
    <ElTabs v-if="!businessOnly" v-model="tab"><ElTabPane name="purposes" label="本组业务" /><ElTabPane name="opening" label="初始库存" /></ElTabs>
    <ElAlert v-if="error" :title="error" type="error" :closable="false" />
    <p v-if="loading">正在读取班组设置…</p>
    <section v-else-if="tab === 'purposes'" class="purpose-settings">
      <p class="settings-note">设置本班组可以做的业务，如检验、去毛刺。上序转料时选择；修改后需保存，历史单据保留原名称。</p>
      <div v-for="item in purposes" :key="item.id" class="purpose-editor">
        <ElInput :class="{ 'is-error': invalidPurpose === item.id && !item.name.trim() }" v-model="item.name" :aria-label="`业务名称 ${item.id}`" maxlength="80" :disabled="saving" />
        <ElSwitch v-model="item.active" :aria-label="`${item.name}启用状态`" active-text="启用" :disabled="saving" />
        <ElButton :disabled="saving" @click="savePurpose(item)">保存</ElButton>
      </div>
      <ElAlert v-if="purposes.length && !purposes.some(item => item.active)" title="业务全部停用后，上序无法新建转给本班组的转料单。" type="info" :closable="false" />
      <div class="purpose-editor"><ElInput :class="{ 'is-error': invalidPurpose === 'new' && !newName.trim() }" v-model="newName" aria-label="新增业务名称" placeholder="例如：检验、去毛刺" maxlength="80" :disabled="saving" @keyup.enter="savePurpose()" /><ElButton type="primary" :loading="saving" @click="savePurpose()">新增业务</ElButton></div>
      <p v-if="!purposes.length" class="settings-note">尚未配置时，新单暂归“未分类”；配置后，上序新开单必须选择启用的业务。</p>
    </section>
    <section v-else-if="!businessOnly" class="opening-settings">
      <ElAlert v-if="!opening?.enabled" title="请系统管理员在“班组管理”中开启初始库存录入权限。" type="info" :closable="false" />
      <template v-if="opening?.can_submit">
        <ElForm ref="formRef" label-position="top" :show-message="false" class="opening-lines" @submit.prevent="submitOpening">
          <article v-for="(line, index) in lines" :key="index" class="opening-line">
            <header><strong>物料 {{ index + 1 }}</strong><ElButton v-if="lines.length > 1" text type="danger" :disabled="saving" @click="lines.splice(index, 1)">移除</ElButton></header>
            <section class="dialog-form-section"><h3>物料资料</h3><div class="dialog-form-grid">
              <OpeningMaterialFields :line="line" :index="index" :errors="fieldErrors" :disabled="saving || !modelValue" @update="Object.assign(line, $event)" @validity-change="$event ? invalidSpecifications.delete(line) : invalidSpecifications.add(line)" />
            </div></section>
            <section class="dialog-form-section"><h3>数量与业务</h3><div class="dialog-form-grid">
              <div class="dialog-field" :class="{ 'is-error': lineError(index, 'material_type') }"><span class="dialog-field-label is-required">物料类型</span><ElSelect v-model="line.material_type" :aria-label="`第${index + 1}行物料类型`" :disabled="saving"><ElOption v-for="option in materialTypeOptions" :key="option.value" :value="option.value" :label="option.label" /></ElSelect></div>
              <div class="dialog-field"><span class="dialog-field-label">本班组业务</span><ElSelect v-model="line.purpose_id" aria-label="初始库存业务" clearable placeholder="未分类" :disabled="saving"><ElOption v-for="item in purposes.filter(item => item.active)" :key="item.id" :value="item.id" :label="item.name" /></ElSelect></div>
              <div v-if="!isWeightOnlyType(line.material_type)" class="dialog-field" :class="{ 'is-error': lineError(index, 'quantity') }"><span class="dialog-field-label is-required">件数</span><ElInputNumber v-model="line.quantity" :aria-label="`第${index + 1}行件数`" :min="0" :precision="0" :disabled="saving" controls-position="right"><template #suffix><span class="dialog-input-unit">件</span></template></ElInputNumber></div>
              <div class="dialog-field" v-if="line.material_type !== 'sludge'" :class="{ 'is-error': lineError(index, 'weight') }"><span class="dialog-field-label is-required">重量</span><WeightInput v-model="line.weight" :ariaLabel="`第${index + 1}行重量`" :disabled="saving" /></div>
              <SludgeWeightFields v-else v-model:gross="line.sludge_gross_weight" v-model:percent="line.sludge_content_percent" :label="`第${index + 1}行`" :gross-error="lineError(index, 'gross')" :percent-error="lineError(index, 'percent')" :disabled="saving" @update:weight="line.weight = $event" />
              </div>
            </section>
            <section class="dialog-form-section"><h3>补充说明</h3><div class="dialog-form-grid"><div class="dialog-field dialog-field-wide"><span class="dialog-field-label">备注</span><ElInput v-model="line.notes" aria-label="初始库存备注" maxlength="2000" type="textarea" :rows="2" :disabled="saving" placeholder="选填" /></div></div></section>
          </article>
        </ElForm>
      </template>
      <p v-if="opening?.completed" class="settings-note">共 {{ opening.items.length }} 个初始库存批次，可在库存明细和收发历史中查看。</p>
    </section>
    <template #footer>
      <ElButton :disabled="saving" @click="close">关闭</ElButton>
      <template v-if="!businessOnly && tab === 'opening' && opening?.can_submit && !loading">
        <ElButton :disabled="saving || lines.length >= 100" @click="lines.push(blank())">增加物料</ElButton>
        <ElButton :disabled="saving" @click="saveDraft">保存本机草稿</ElButton>
        <ElButton type="primary" :loading="saving" @click="submitOpening">确认初始库存登记</ElButton>
      </template>
    </template>
  </ElDialog>
</template>

<style scoped>
.settings-note { color: var(--muted); font-size: 15px; line-height: 1.7; }
.purpose-settings { display: grid; gap: 14px; padding-block: 8px 24px; }
.purpose-editor { display: flex; align-items: center; gap: 20px; max-width: 720px; }
.purpose-editor :deep(.el-input) { flex: 1; }.purpose-editor :deep(.el-switch) { flex-shrink: 0; }
.opening-lines { display: grid; gap: 20px; }.opening-line { min-width: 0; border-top: 1px solid var(--line); padding-block: 12px 20px; }
.opening-line header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
@media(max-width:560px) { .purpose-editor { flex-wrap: wrap; gap: 8px; }.purpose-editor :deep(.el-input) { flex-basis: 100%; } }
</style>
