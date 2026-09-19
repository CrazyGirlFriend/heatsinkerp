<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { ElAlert, ElButton, ElDialog, ElInput, ElInputNumber, ElOption, ElSelect, ElSwitch, ElTabs, ElTabPane, ElMessageBox } from 'element-plus'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import { useAuthStore } from '@/stores/auth'
import { materialTypeOptions, type MaterialTransfer } from '@/types/materialTransfer'
import type { OpeningLine, OpeningState, TeamPurpose } from '@/types/teamBusiness'
import { materialRequestKey } from '@/utils/materialStock'
import { showToast } from '@/stores/toast'

const props = defineProps<{ modelValue: boolean; teamId: number; initialTab?: string }>()
const emit = defineEmits<{ 'update:modelValue': [boolean]; changed: []; stocked: [MaterialTransfer[]] }>()
const auth = useAuthStore()
const tab = ref('purposes'), loading = ref(false), saving = ref(false), error = ref('')
const purposes = ref<TeamPurpose[]>([]), newName = ref(''), opening = ref<OpeningState | null>(null)
const lines = ref<OpeningLine[]>([])
let epoch = 0, requestKey = '', lastBody = ''
const key = () => `heatsink.opening-draft.v1:${auth.currentUser?.id}:${props.teamId}`
function blank(): OpeningLine { return { serial_no: '', material_name: '', material_type: '', transfer_specification: '', quantity: undefined, weight: undefined, notes: '' } }
function close() { if (!saving.value) emit('update:modelValue', false) }
async function load() {
  const current = ++epoch
  loading.value = true; error.value = ''
  try {
    const [options, state] = await Promise.all([teamMaterialApi.purposes(props.teamId), teamMaterialApi.openingState(props.teamId)])
    if (current !== epoch) return
    purposes.value = options; opening.value = state
  } catch (e) { if (current === epoch) error.value = e instanceof Error ? e.message : '班组设置加载失败' }
  finally { if (current === epoch) loading.value = false }
}
watch(() => [props.modelValue, props.teamId], () => {
  ++epoch
  if (!props.modelValue) return
  tab.value = props.initialTab || 'purposes'; newName.value = ''; requestKey = ''; lastBody = ''; opening.value = null
  lines.value = [blank()]
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
  try { localStorage.setItem(key(), JSON.stringify(lines.value)); showToast('草稿已保存在本机，尚未入账', 'success') }
  catch { error.value = '无法保存本机草稿，请检查浏览器存储权限' }
}
async function savePurpose(item?: TeamPurpose) {
  if (saving.value || loading.value) return
  const name = (item?.name || newName.value).trim()
  if (!name) { error.value = '请输入用途名称'; return }
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
  if (saving.value || loading.value || !opening.value?.can_submit) return
  error.value = ''
  if (lines.value.some(line => !line.serial_no.trim() || !line.material_name.trim() || !line.material_type || !Number.isInteger(line.quantity) || Number(line.quantity) < 0 || line.weight == null || !Number.isFinite(line.weight) || line.weight < 0 || (!line.quantity && !line.weight))) { error.value = '请逐行填写流水号、材质、类型及有效件数和重量；至少一项大于零'; return }
  const body = lines.value.map(line => ({ ...line, purpose_id: line.purpose_id || null, serial_no: line.serial_no.trim(), material_name: line.material_name.trim() }))
  const current = epoch
  try { await ElMessageBox.confirm(`将 ${body.length} 行期初库存正式入账。确认后不可重复初始化，不能直接修改已入账数量。`, '确认期初入账', { confirmButtonText: '确认入账', cancelButtonText: '返回核对', type: 'warning' }) }
  catch { return }
  if (current !== epoch || !props.modelValue || saving.value) return
  const fingerprint = JSON.stringify(body)
  if (!requestKey || fingerprint !== lastBody) { requestKey = materialRequestKey(); lastBody = fingerprint }
  saving.value = true
  try {
    const rows = await teamMaterialApi.createOpening(props.teamId, body, requestKey)
    if (current !== epoch) return
    try { localStorage.removeItem(key()) } catch { /* The committed receipt remains authoritative. */ }
    lines.value = [blank()]; emit('changed'); emit('stocked', rows); await load()
    showToast('期初库存已入账，录入权限已关闭', 'success')
  } catch (e) { if (current === epoch) error.value = e instanceof Error ? e.message : '入账失败，草稿未清除' }
  finally { saving.value = false }
}
</script>

<template>
  <ElDialog :model-value="modelValue" title="班组设置" width="min(1080px, 96vw)" :close-on-click-modal="!saving" :close-on-press-escape="!saving" :show-close="!saving" @close="close">
    <ElTabs v-model="tab"><ElTabPane name="purposes" label="转料用途" /><ElTabPane name="opening" label="期初库存" /></ElTabs>
    <ElAlert v-if="error" :title="error" type="error" :closable="false" />
    <p v-if="loading">正在读取班组设置…</p>
    <section v-else-if="tab === 'purposes'" class="purpose-settings">
      <p class="settings-note">由本班组维护，上序开转料单时选择。改名、停用不会改写历史单据。</p>
      <div v-for="item in purposes" :key="item.id" class="purpose-editor">
        <ElInput v-model="item.name" :aria-label="`用途名称 ${item.id}`" maxlength="80" :disabled="saving" />
        <ElSwitch v-model="item.active" :aria-label="`${item.name}启用状态`" active-text="启用" :disabled="saving" />
        <ElButton :disabled="saving" @click="savePurpose(item)">保存</ElButton>
      </div>
      <div class="purpose-editor"><ElInput v-model="newName" aria-label="新增用途名称" placeholder="例如：检验、去毛刺、发货" maxlength="80" :disabled="saving" @keyup.enter="savePurpose()" /><ElButton type="primary" :loading="saving" @click="savePurpose()">新增用途</ElButton></div>
      <p v-if="!purposes.length" class="settings-note">尚未配置时，新单暂归“未分类”；配置后，上序新开单必须选择启用的用途。</p>
    </section>
    <section v-else class="opening-settings">
      <ElAlert v-if="opening?.completed" title="本班组已完成期初入账，不能重复初始化。" type="success" :closable="false" />
      <ElAlert v-else-if="opening?.has_stock_history" title="本班组已有入账记录，不能将现有库存再次叠加为期初库存。" type="warning" :closable="false" />
      <ElAlert v-else-if="!opening?.enabled" title="请系统管理员在“班组管理”中开启期初录入权限。" type="info" :closable="false" />
      <template v-if="opening?.can_submit">
        <p class="settings-note">登记启用系统前已在本班组的物料。每行独立批次；仅确认后计入库存，不产生下序待接收。</p>
        <div class="opening-lines">
          <article v-for="(line, index) in lines" :key="index" class="opening-line">
            <header><strong>物料 {{ index + 1 }}</strong><ElButton v-if="lines.length > 1" text type="danger" :disabled="saving" @click="lines.splice(index, 1)">移除</ElButton></header>
            <div class="opening-fields">
              <label>流水号<ElInput v-model="line.serial_no" :aria-label="`第${index + 1}行流水号`" maxlength="80" :disabled="saving" /></label>
              <label>材质<ElInput v-model="line.material_name" :aria-label="`第${index + 1}行材质`" maxlength="160" :disabled="saving" /></label>
              <label>规格<ElInput v-model="line.transfer_specification" aria-label="规格" maxlength="240" :disabled="saving" /></label>
              <label>物料类型<ElSelect v-model="line.material_type" :aria-label="`第${index + 1}行物料类型`" :disabled="saving"><ElOption v-for="option in materialTypeOptions" :key="option.value" :value="option.value" :label="option.label" /></ElSelect></label>
              <label>件数<ElInputNumber v-model="line.quantity" :aria-label="`第${index + 1}行件数`" :min="0" :precision="0" :disabled="saving" controls-position="right" /></label>
              <label>重量（kg）<ElInputNumber v-model="line.weight" :aria-label="`第${index + 1}行重量`" :min="0" :precision="3" :disabled="saving" controls-position="right" /></label>
              <label>本班组用途<ElSelect v-model="line.purpose_id" aria-label="期初物料用途" clearable placeholder="未分类" :disabled="saving"><ElOption v-for="item in purposes.filter(item => item.active)" :key="item.id" :value="item.id" :label="item.name" /></ElSelect></label>
              <label>备注<ElInput v-model="line.notes" aria-label="期初备注" maxlength="2000" :disabled="saving" /></label>
            </div>
          </article>
        </div>
        <div class="opening-actions"><ElButton :disabled="saving || lines.length >= 100" @click="lines.push(blank())">增加物料</ElButton><ElButton :disabled="saving" @click="saveDraft">保存本机草稿</ElButton><ElButton type="primary" :loading="saving" @click="submitOpening">确认期初入账</ElButton></div>
      </template>
      <p v-if="opening?.completed" class="settings-note">共 {{ opening.items.length }} 个期初批次，可在库存明细和收发历史中查看。</p>
    </section>
  </ElDialog>
</template>

<style scoped>
.settings-note { color: var(--muted); font-size: 15px; line-height: 1.7; }
.purpose-settings { display: grid; gap: 14px; padding-block: 8px 24px; }
.purpose-editor { display: flex; align-items: center; gap: 20px; max-width: 720px; }
.purpose-editor :deep(.el-input) { flex: 1; }.purpose-editor :deep(.el-switch) { flex-shrink: 0; }
.opening-lines { display: grid; gap: 20px; }.opening-line { border-top: 1px solid var(--line); padding-block: 12px 20px; }
.opening-line header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.opening-fields { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
.opening-fields label { display: grid; gap: 8px; font-size: 15px; color: var(--text); }.opening-fields :deep(.el-input-number) { width: 100%; }
.opening-actions { display: flex; flex-wrap: wrap; gap: 10px; padding-top: 20px; border-top: 1px solid var(--line); }
@media(max-width:700px) { .opening-fields { grid-template-columns: repeat(2, minmax(0, 1fr)); }.purpose-editor { gap: 8px; } }
</style>
