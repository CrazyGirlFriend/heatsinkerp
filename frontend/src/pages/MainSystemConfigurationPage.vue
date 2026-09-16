<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ElAlert, ElButton, ElDescriptions, ElDescriptionsItem, ElForm, ElFormItem, ElInput, ElInputNumber, ElMessageBox, ElResult, ElSkeleton, ElSwitch, ElTable, ElTableColumn, ElTag } from 'element-plus'
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
      <header class="integration-heading"><h1>主系统对接</h1><ElButton :disabled="busy" @click="load">重新加载</ElButton></header>
      <ElAlert v-if="error" :title="error" type="error" :closable="false" show-icon />
      <ElAlert v-if="notice" :title="notice" type="success" :closable="false" show-icon />
      <ElSkeleton v-if="loading && !config" :rows="6" animated />
      <template v-if="config">
        <ElAlert v-if="!config.key_ready" title="服务端尚未设置配置加密密钥，暂不能保存。请联系部署管理员。" type="warning" :closable="false" show-icon />
        <section class="integration-panel" aria-label="连接配置">
          <h2>连接配置</h2>
          <ElForm label-position="top" :disabled="busy" @submit.prevent="save">
            <div class="integration-form-grid">
              <ElFormItem label="主系统地址" class="integration-wide"><ElInput v-model="form.base_url" aria-label="主系统地址" placeholder="https://主系统域名" maxlength="500" autocomplete="off" /><p class="field-hint">允许地址：{{ config.allowed_origins.length ? config.allowed_origins.join('、') : '尚未设置，请联系部署管理员' }}</p></ElFormItem>
              <ElFormItem label="访问令牌（Bearer Token）"><ElInput v-model="form.token" aria-label="访问令牌" type="password" show-password autocomplete="new-password" maxlength="4096" :placeholder="config.has_token ? '已保存 · 留空不修改' : '填写专用只读令牌'" /><p class="field-hint">后端通过 Authorization 请求头认证。{{ config.has_token ? '原文不回显，留空不修改。更换地址须重新填写。' : '令牌加密保存，不是本系统登录密码。' }}</p></ElFormItem>
              <ElFormItem label="请求超时（秒）"><ElInputNumber v-model="form.timeout_seconds" aria-label="请求超时（秒）" :min="0.1" :max="30" :step="0.1" :precision="1" controls-position="right" /></ElFormItem>
              <ElFormItem label="资料查询"><ElSwitch v-model="form.enabled" aria-label="启用资料查询" active-text="启用" inactive-text="停用" /><p class="field-hint">停用不影响已有库存和班组转料。</p></ElFormItem>
            </div>
            <footer class="integration-actions"><ElButton type="primary" native-type="submit" :loading="saving" :disabled="busy || !config.key_ready">保存配置</ElButton><span class="field-hint">{{ dirty ? '有未保存的修改' : '接口路径与字段映射使用统一规范' }}</span></footer>
          </ElForm>
        </section>
        <section class="integration-panel" aria-label="连接状态">
          <h2>连接状态</h2>
          <ElDescriptions :column="2" border>
            <ElDescriptionsItem label="资料查询"><ElTag :type="config.enabled ? 'success' : 'info'">{{ config.enabled ? '已启用' : '已停用' }}</ElTag></ElDescriptionsItem>
            <ElDescriptionsItem label="访问令牌">{{ config.has_token ? '已配置（不回显）' : '未配置' }}</ElDescriptionsItem>
            <ElDescriptionsItem label="最近保存">{{ config.updated_by || '尚未通过页面保存' }}<span v-if="config.updated_at"> · {{ formatDateTime(config.updated_at) }}</span></ElDescriptionsItem>
            <ElDescriptionsItem label="最近测试">{{ config.last_test_at ? formatDateTime(config.last_test_at) : '尚未测试' }}<span v-if="config.last_test_message"> · {{ config.last_test_message }}</span></ElDescriptionsItem>
          </ElDescriptions>
        </section>
        <section class="integration-panel" aria-label="测试查询">
          <h2>测试查询</h2>
          <p class="field-hint">使用已保存的配置，只读取资料，不生成入库或转料记录。停用时也可手动测试。</p>
          <form class="integration-test" @submit.prevent="test"><ElInput v-model="serial" aria-label="测试流水号" placeholder="输入主系统中存在的流水号" maxlength="80" :disabled="busy" /><ElButton native-type="submit" type="primary" plain :loading="testing" :disabled="busy || dirty || !serial.trim() || !config.version || !config.has_token || !config.key_ready">测试查询</ElButton></form>
          <p v-if="dirty" class="field-hint">请先保存修改，再测试当前配置。</p>
          <ElAlert v-if="result" :title="result.message" :type="result.ok ? 'success' : 'error'" :closable="false" show-icon />
          <ElTable v-if="result?.data" :data="rows" class="business-table integration-result" aria-label="主系统返回资料"><ElTableColumn prop="label" label="字段" width="180" /><ElTableColumn prop="value" label="返回内容" class-name="table-prose" /></ElTable>
        </section>
      </template>
    </template>
  </section>
</template>

<style scoped>
.integration-page { display: flex; flex-direction: column; gap: 20px; }
.integration-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.integration-heading h1 { margin: 0; font-size: 22px; }
.integration-panel { background: var(--surface, white); border: 1px solid var(--line); border-radius: 8px; padding: 24px; }
.integration-panel h2 { margin: 0 0 20px; font-size: 18px; font-weight: 600; }
.integration-form-grid { display: grid; grid-template-columns: minmax(0, 2fr) minmax(180px, 1fr); gap: 0 32px; max-width: 980px; }
.integration-wide { grid-column: 1 / -1; }
.field-hint { color: var(--muted); font-size: 14px; line-height: 1.6; margin: 8px 0 0; overflow-wrap: anywhere; }
.integration-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 16px; }
.integration-actions .field-hint { margin: 0; }
.integration-test { display: flex; gap: 12px; margin: 16px 0; max-width: 660px; }
.integration-result { margin-top: 16px; }
.integration-panel :deep(.el-form-item__label) { font-size: 16px; }
.integration-panel :deep(.el-form-item__content) { display: block; }
.integration-panel :deep(.el-descriptions__content) { overflow-wrap: anywhere; }
@media (max-width: 680px) {
  .integration-panel { padding: 16px; }
  .integration-form-grid { grid-template-columns: minmax(0, 1fr); }
  .integration-panel :deep(.el-descriptions__table) { table-layout: fixed; }
  .integration-test { flex-wrap: wrap; }
}
</style>
