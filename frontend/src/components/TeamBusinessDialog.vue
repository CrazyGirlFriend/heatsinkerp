<script setup lang="ts">
import FormPageNav from './FormPageNav.vue'
import FormValidationNotice from './FormValidationNotice.vue'
import OpeningMaterialFields from './OpeningMaterialFields.vue'
import SludgeWeightFields from './SludgeWeightFields.vue'
import { sludgePayload, sludgeWeight } from '@/utils/sludgeWeight'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElAlert, ElButton, ElDialog, ElForm, ElInput, ElInputNumber, ElOption, ElSelect, ElSwitch, ElTabs, ElTabPane, ElMessageBox } from 'element-plus'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import { useAuthStore } from '@/stores/auth'
import { materialTypeOptions, type MaterialTransfer } from '@/types/materialTransfer'
import type { OpeningLine, OpeningState, TeamPurpose } from '@/types/teamBusiness'
import { materialRequestKey } from '@/utils/materialStock'
import { showToast } from '@/stores/toast'

const props = defineProps<{ modelValue: boolean; teamId: number; initialTab?: string; businessOnly?: boolean; teamName?: string }>()
const emit = defineEmits<{ 'update:modelValue': [boolean]; changed: []; stocked: [MaterialTransfer[]] }>()
const auth = useAuthStore()
const tab = ref('purposes'), loading = ref(false), saving = ref(false), error = ref('')
const purposes = ref<TeamPurpose[]>([]), newName = ref(''), opening = ref<OpeningState | null>(null)
const lines = ref<OpeningLine[]>([])
const linePage = ref(0), openingStep = ref('material')
const validationPage = ref<number | null>(null)
const openingSteps = ['material', 'specification', 'amount']
const openingPage = computed({ get: () => linePage.value * 3 + openingSteps.indexOf(openingStep.value), set: page => { linePage.value = Math.floor(page / 3); openingStep.value = openingSteps[page % 3]! } })
watch(() => lines.value.length, count => { linePage.value = Math.max(0, Math.min(linePage.value, count - 1)) })
const invalidSpecifications = new Set<OpeningLine>()
let epoch = 0, requestKey = '', lastBody = ''
const key = () => `heatsink.opening-draft.v1:${auth.currentUser?.id}:${props.teamId}`
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
  linePage.value = 0; openingStep.value = 'material'; validationPage.value = null
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
  if (!name) { error.value = '请输入业务名称'; return }
  const current = epoch
  saving.value = true; error.value = ''
  try {
    await teamMaterialApi.savePurpose(props.teamId, { name, active: item?.active ?? true, ...(item ? { expected_version: item.version } : {}) }, item?.id)
    if (current !== epoch) return
    newName.value = ''; emit('changed'); await load()
  } catch (e) { if (current === epoch) error.value = e instanceof Error ? e.message : '保存失败' }
  finally { saving.value = false }
}
async function submitOpening() {
  validationPage.value = null
  if (lines.value.some(line => invalidSpecifications.has(line))) { linePage.value = lines.value.findIndex(line => invalidSpecifications.has(line)); openingStep.value = 'specification'; error.value = '请填完整规格尺寸'; validationPage.value = openingPage.value; return }
  if (saving.value || loading.value || !opening.value?.can_submit) return
  error.value = ''
  if (lines.value.some(line => line.material_type === 'sludge' && !sludgeWeight(line.sludge_gross_weight, line.sludge_content_percent))) { linePage.value = lines.value.findIndex(line => line.material_type === 'sludge' && !sludgeWeight(line.sludge_gross_weight, line.sludge_content_percent)); openingStep.value = 'amount'; error.value = '请填写废泥实重和有效材料占比，折算重量须达到 0.001 kg'; validationPage.value = openingPage.value; return }
  const invalidLine = lines.value.findIndex(line => !line.serial_no.trim() || !line.material_name.trim() || !line.material_type || !Number.isInteger(line.quantity) || Number(line.quantity) < 0 || line.weight == null || !Number.isFinite(line.weight) || line.weight < 0 || (!line.quantity && !line.weight))
  if (invalidLine !== -1) { linePage.value = invalidLine; openingStep.value = !lines.value[invalidLine]!.serial_no.trim() || !lines.value[invalidLine]!.material_name.trim() ? 'material' : 'amount'; const line = lines.value[invalidLine]!; error.value = !line.serial_no.trim() ? '请输入流水号' : !line.material_name.trim() ? '请输入材质' : !line.material_type ? '请选择物料类型' : !Number.isInteger(line.quantity) || Number(line.quantity) < 0 ? '请填写有效件数，可填 0' : line.weight == null || !Number.isFinite(line.weight) || line.weight < 0 ? '请填写有效重量，可填 0' : '件数和重量至少一项大于 0'; validationPage.value = openingPage.value; return }
  const body = lines.value.map(line => ({ ...line, ...sludgePayload(line.material_type, line.sludge_gross_weight, line.sludge_content_percent), purpose_id: line.purpose_id || null, serial_no: line.serial_no.trim(), material_name: line.material_name.trim() }))
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
  <ElDialog :model-value="modelValue" :title="businessOnly ? teamName ? `${teamName} · 业务设置` : '班组业务设置' : '班组设置'" :width="businessOnly ? 'min(760px, 94vw)' : 'min(1080px, 96vw)'" :close-on-click-modal="!saving" :close-on-press-escape="!saving" :show-close="!saving" @close="close">
    <ElTabs v-if="!businessOnly" v-model="tab"><ElTabPane name="purposes" label="本组业务" /><ElTabPane name="opening" label="初始库存" /></ElTabs>
    <FormValidationNotice v-if="tab === 'opening'" :message="error" :page="validationPage" :label="validationPage == null ? '' : `物料 ${Math.floor(validationPage / 3) + 1} · ${['物料资料', '规格说明', '数量与业务'][validationPage % 3]}`" @locate="validationPage != null && (openingPage = validationPage)" />
    <ElAlert v-else-if="error" :title="error" type="error" :closable="false" />
    <p v-if="loading">正在读取班组设置…</p>
    <section v-else-if="tab === 'purposes'" class="purpose-settings">
      <p class="settings-note">设置本班组可以做的业务，如检验、去毛刺。上序转料时选择；修改后需保存，历史单据保留原名称。</p>
      <div v-for="item in purposes" :key="item.id" class="purpose-editor">
        <ElInput v-model="item.name" :aria-label="`业务名称 ${item.id}`" maxlength="80" :disabled="saving" />
        <ElSwitch v-model="item.active" :aria-label="`${item.name}启用状态`" active-text="启用" :disabled="saving" />
        <ElButton :disabled="saving" @click="savePurpose(item)">保存</ElButton>
      </div>
      <ElAlert v-if="purposes.length && !purposes.some(item => item.active)" title="业务全部停用后，上序无法新建转给本班组的转料单。" type="info" :closable="false" />
      <div class="purpose-editor"><ElInput v-model="newName" aria-label="新增业务名称" placeholder="例如：检验、去毛刺" maxlength="80" :disabled="saving" @keyup.enter="savePurpose()" /><ElButton type="primary" :loading="saving" @click="savePurpose()">新增业务</ElButton></div>
      <p v-if="!purposes.length" class="settings-note">尚未配置时，新单暂归“未分类”；配置后，上序新开单必须选择启用的业务。</p>
    </section>
    <section v-else-if="!businessOnly" class="opening-settings">
      <ElAlert v-if="!opening?.enabled" title="请系统管理员在“班组管理”中开启初始库存录入权限。" type="info" :closable="false" />
      <template v-if="opening?.can_submit">
        <p v-if="openingStep === 'material'" class="settings-note">每次提交累加库存，每行生成独立批次。</p>
        <div class="opening-lines">
          <article v-for="(line, index) in lines" :key="index" v-show="index === linePage" class="opening-line">
            <header><strong>物料 {{ index + 1 }}</strong><ElButton v-if="lines.length > 1" text type="danger" :disabled="saving" @click="lines.splice(index, 1)">移除</ElButton></header>
            <ElTabs v-model="openingStep"><ElTabPane label="物料资料" name="material" /><ElTabPane label="规格说明" name="specification" /><ElTabPane label="数量与业务" name="amount" /></ElTabs>
            <ElForm class="opening-fields" label-position="top" @submit.prevent="submitOpening">
              <div v-show="openingStep !== 'amount'" class="dialog-form-grid">
              <OpeningMaterialFields :section="openingStep === 'specification' ? 'specification' : 'material'" :key="index" :line="line" :index="index" :disabled="saving || !modelValue" @update="Object.assign(line, $event)" @validity-change="$event ? invalidSpecifications.delete(line) : invalidSpecifications.add(line)" />
              <div v-show="openingStep === 'specification'" class="dialog-field dialog-field-wide"><span class="dialog-field-label">备注</span><ElInput v-model="line.notes" aria-label="初始库存备注" maxlength="2000" :disabled="saving" /></div>
              </div>
              <div v-show="openingStep === 'amount'" class="dialog-form-grid">
              <div class="dialog-field"><span class="dialog-field-label is-required">物料类型</span><ElSelect v-model="line.material_type" :aria-label="`第${index + 1}行物料类型`" :disabled="saving"><ElOption v-for="option in materialTypeOptions" :key="option.value" :value="option.value" :label="option.label" /></ElSelect></div>
              <div class="dialog-field"><span class="dialog-field-label">本班组业务</span><ElSelect v-model="line.purpose_id" aria-label="初始库存业务" clearable placeholder="未分类" :disabled="saving"><ElOption v-for="item in purposes.filter(item => item.active)" :key="item.id" :value="item.id" :label="item.name" /></ElSelect></div>
              <div class="dialog-field"><span class="dialog-field-label is-required">件数</span><ElInputNumber v-model="line.quantity" :aria-label="`第${index + 1}行件数`" :min="0" :precision="0" :disabled="saving" controls-position="right"><template #suffix><span class="dialog-input-unit">件</span></template></ElInputNumber></div>
              <div class="dialog-field" v-if="line.material_type !== 'sludge'"><span class="dialog-field-label is-required">重量</span><ElInputNumber v-model="line.weight" :aria-label="`第${index + 1}行重量`" :min="0" :precision="3" :disabled="saving" controls-position="right"><template #suffix><span class="dialog-input-unit">kg</span></template></ElInputNumber></div>
              <SludgeWeightFields v-else v-model:gross="line.sludge_gross_weight" v-model:percent="line.sludge_content_percent" :label="`第${index + 1}行`" :disabled="saving" @update:weight="line.weight = $event" />
              </div>
            </ElForm>
          </article>
        </div>
      </template>
      <p v-if="opening?.completed" class="settings-note">共 {{ opening.items.length }} 个初始库存批次，可在库存明细和收发历史中查看。</p>
    </section>
    <template #footer>
      <FormPageNav v-if="tab === 'opening' && opening?.can_submit" v-model="openingPage" :total="lines.length * 3" :disabled="saving" />
      <ElButton :disabled="saving" @click="close">关闭</ElButton>
      <template v-if="!businessOnly && tab === 'opening' && opening?.can_submit && !loading">
        <ElButton :disabled="saving || lines.length >= 100" @click="lines.push(blank()); linePage = lines.length - 1; openingStep = 'material'">增加物料</ElButton>
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
