<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ElAlert, ElButton, ElForm, ElFormItem, ElInput, ElInputNumber, ElMessageBox, ElResult, ElSkeleton, ElSwitch, ElTable, ElTableColumn, ElTag } from 'element-plus'
import { isAdmin } from '@/stores/auth'
import { mainSystemConfigurationApi as api, type MainSystemConfiguration, type ConfigurationTestResult } from '@/services/mainSystemConfigurationApi'
import { materialDocumentTextFields, materialTypeLabel } from '@/types/materialTransfer'
import { formatDateTime } from '@/utils/format'

const config = ref<MainSystemConfiguration | null>(null)
const form = reactive({ enabled: false, base_url: '', token: '', timeout_seconds: 5 })
const loading = ref(false), saving = ref(false), testing = ref(false)
const error = ref(''), notice = ref(''), serial = ref('')
const result = ref<ConfigurationTestResult | null>(null)
let generation = 0
const busy = computed(() => loading.value || saving.value || testing.value)
const dirty = computed(() => !!config.value && (form.enabled !== config.value.enabled || form.base_url !== config.value.base_url || form.timeout_seconds !== config.value.timeout_seconds || !!form.token))
const rows = computed(() => {
  const data = result.value?.data
  if (!data) return []
  return [
    { label: '流水号', value: data.serial_no }, { label: '资料版本', value: data.revision },
    { label: '更新时间', value: formatDateTime(data.updated_at) }, { label: '状态', value: data.active ? '启用' : '停用' },
    { label: '物料类型', value: materialTypeLabel(data.document.material_type) },
    { label: '成品件数', value: data.document.finished_quantity == null ? '—' : String(data.document.finished_quantity) },
    ...materialDocumentTextFields.map(field => ({ label: field.label, value: data.document[field.key] || '—' })),
  ]
})
function apply(value: MainSystemConfiguration) {
  config.value = value
  Object.assign(form, { enabled: value.enabled, base_url: value.base_url, timeout_seconds: value.timeout_seconds, token: '' })
}
async function load() {
  if (!isAdmin.value || busy.value) return
  if (dirty.value) {
    try { await ElMessageBox.confirm('重新加载将放弃未保存的配置。', '重新加载', { type: 'warning', confirmButtonText: '重新加载', cancelButtonText: '取消' }) }
    catch { return }
  }
  const current = ++generation
  loading.value = true; error.value = ''; notice.value = ''
  try { const value = await api.get(); if (current === generation && isAdmin.value) { apply(value); result.value = null } }
  catch (e) { if (current === generation) error.value = e instanceof Error ? e.message : '加载失败' }
  finally { if (current === generation) loading.value = false }
}
async function save() {
  if (!config.value || !isAdmin.value || busy.value) return
  const current = ++generation
  saving.value = true; error.value = ''; notice.value = ''
  try {
    const value = await api.save({ ...form, expected_version: config.value.version })
    if (current === generation && isAdmin.value) { apply(value); result.value = null; notice.value = '配置已保存，立即生效' }
  } catch (e) { if (current === generation) error.value = e instanceof Error ? e.message : '保存失败' }
  finally { if (current === generation) saving.value = false }
}
async function test() {
  if (!config.value || !isAdmin.value || busy.value || dirty.value || !serial.value.trim()) return
  const current = ++generation
  testing.value = true; error.value = ''; notice.value = ''; result.value = null
  try {
    const value = await api.test(serial.value.trim(), config.value.version)
    if (current === generation && isAdmin.value) {
      result.value = value
      config.value = { ...config.value, last_test_at: value.tested_at, last_test_ok: value.ok, last_test_message: value.message }
    }
  } catch (e) { if (current === generation) error.value = e instanceof Error ? e.message : '测试失败' }
  finally { if (current === generation) testing.value = false }
}
watch(isAdmin, value => { if (!value) { ++generation; loading.value = saving.value = testing.value = false; form.token = ''; config.value = null; result.value = null } else void load() })
onMounted(load)
onBeforeUnmount(() => { ++generation; form.token = '' })
</script>

<template>
  <section class="page reading-workspace integration-page">
    <ElResult v-if="!isAdmin" icon="warning" title="仅管理员可访问" />
    <template v-else>
      <h1 class="sr-only">主系统对接</h1>
      <ElAlert v-if="error" :title="error" type="error" :closable="false" show-icon />
      <ElAlert v-if="notice" :title="notice" type="success" :closable="false" show-icon />
      <ElSkeleton v-if="loading && !config" :rows="6" animated />
      <ElButton v-if="error && !config" :disabled="busy" @click="load">重新加载</ElButton>
      <template v-if="config">
        <ElAlert v-if="!config.key_ready" title="未配置服务端加密密钥，请联系部署管理员后再保存。" type="warning" :closable="false" show-icon />
        <div class="integration-layout">
        <section class="integration-panel" aria-label="连接配置">
          <header class="integration-panel-heading"><h2>连接配置</h2><ElTag :type="config.enabled ? 'success' : 'info'" effect="plain">{{ config.enabled ? '已启用' : '已停用' }}</ElTag></header>
          <ElForm label-position="top" :disabled="busy" @submit.prevent="save">
            <div class="integration-form-grid">
              <ElFormItem label="主系统地址" class="integration-wide"><ElInput v-model="form.base_url" aria-label="主系统地址" placeholder="https://主系统域名" maxlength="500" autocomplete="off" /><p class="field-hint">允许地址：{{ config.allowed_origins.length ? config.allowed_origins.join('、') : '未设置，请联系部署管理员' }}</p></ElFormItem>
              <ElFormItem label="访问令牌（Bearer Token）" class="integration-wide"><ElInput v-model="form.token" aria-label="访问令牌" type="password" show-password autocomplete="new-password" maxlength="4096" :placeholder="config.has_token ? '已保存 · 留空不修改' : '填写主系统只读令牌'" /><p class="field-hint">{{ config.has_token ? '令牌已加密保存；更换地址时须重新填写。' : '使用主系统只读令牌，不是本系统登录密码。' }}</p></ElFormItem>
              <ElFormItem label="请求超时（秒）"><ElInputNumber v-model="form.timeout_seconds" aria-label="请求超时（秒）" :min="0.1" :max="30" :step="0.1" :precision="1" controls-position="right" /></ElFormItem>
              <ElFormItem label="资料查询"><ElSwitch v-model="form.enabled" aria-label="启用资料查询" active-text="启用" inactive-text="停用" /><p class="field-hint">停用不影响库存及转料。</p></ElFormItem>
            </div>
            <footer class="integration-actions"><ElButton type="primary" native-type="submit" :loading="saving" :disabled="busy || !config.key_ready">保存配置</ElButton><ElButton :disabled="busy" @click="load">重新加载</ElButton><span v-if="dirty" class="field-hint">未保存</span></footer>
          </ElForm>
          <dl class="connection-meta" aria-label="连接状态"><dt>令牌</dt><dd>{{ config.has_token ? '已配置' : '未配置' }}</dd><dt>最近保存</dt><dd>{{ config.updated_at ? formatDateTime(config.updated_at) : '尚未保存' }}<span v-if="config.updated_by"> · {{ config.updated_by }}</span></dd></dl>
        </section>
        <section class="integration-panel" aria-label="测试查询">
          <header class="integration-panel-heading"><h2>测试查询</h2><span class="field-hint">只读，不写入库存</span></header>
          <form class="integration-test" @submit.prevent="test"><ElInput v-model="serial" aria-label="测试流水号" placeholder="输入主系统中存在的流水号" maxlength="80" :disabled="busy" /><ElButton native-type="submit" type="primary" plain :loading="testing" :disabled="busy || dirty || !serial.trim() || !config.version || !config.has_token || !config.key_ready">测试查询</ElButton></form>
          <p v-if="dirty" class="field-hint">请先保存修改，再测试当前配置。</p>
          <dl class="connection-meta"><dt>最近测试</dt><dd>{{ config.last_test_at ? formatDateTime(config.last_test_at) : '尚未测试' }}<span v-if="config.last_test_message"> · {{ config.last_test_message }}</span></dd></dl>
          <ElAlert v-if="result" :title="result.message" :type="result.ok ? 'success' : 'error'" :closable="false" show-icon />
          <ElTable v-if="result?.data" :data="rows" class="business-table integration-result" aria-label="主系统返回资料"><ElTableColumn prop="label" label="字段" width="180" /><ElTableColumn prop="value" label="返回内容" class-name="table-prose" /></ElTable>
        </section>
        </div>
      </template>
    </template>
  </section>
</template>

<style scoped>
.integration-page { display: flex; flex-direction: column; gap: 12px; }
.integration-layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items: start; gap: 16px; }
.integration-panel { min-width: 0; background: var(--surface, white); border: 1px solid var(--line); border-radius: 8px; padding: 20px; }
.integration-panel-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 20px; }
.integration-panel h2 { margin: 0; font-size: 17px; font-weight: 600; }
.integration-panel-heading .field-hint { margin: 0; }
.integration-form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 20px; }
.integration-wide { grid-column: 1 / -1; }
.field-hint { color: var(--muted); font-size: 14px; line-height: 1.6; margin: 8px 0 0; overflow-wrap: anywhere; }
.integration-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 16px; }
.integration-actions .field-hint { margin: 0; }
.integration-actions .el-button + .el-button { margin-left: 0; }
.connection-meta { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 8px 16px; margin: 16px 0 0; padding-top: 16px; border-top: 1px solid var(--line); font-size: 14px; line-height: 1.6; }
.connection-meta dt { color: var(--muted); }.connection-meta dd { margin: 0; overflow-wrap: anywhere; }
.connection-meta + .el-alert { margin-top: 16px; }
.integration-test { display: flex; gap: 12px; margin: 16px 0; max-width: 660px; }
.integration-result { margin-top: 16px; }
.integration-panel :deep(.el-form-item__label) { font-size: 16px; }
.integration-panel :deep(.el-form-item__content) { display: block; }
@media (max-width: 1100px) { .integration-layout { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 680px) {
  .integration-panel { padding: 16px; }
  .integration-form-grid { grid-template-columns: minmax(0, 1fr); }
  .integration-test { flex-wrap: wrap; }
}
</style>
