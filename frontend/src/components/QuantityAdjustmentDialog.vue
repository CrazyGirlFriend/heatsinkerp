<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElAlert, ElButton, ElDescriptions, ElDescriptionsItem, ElDialog, ElForm, ElFormItem, ElInput, ElInputNumber, ElPagination, ElTable, ElTableColumn } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import { teamMaterialApi, TeamMaterialApiError } from '@/services/teamMaterialApi'
import type { QuantityAdjustment, QuantityAdjustmentContext } from '@/types/teamMaterials'
import { materialRequestKey } from '@/utils/materialStock'
import { formatDateTime } from '@/utils/format'

const props = defineProps<{ modelValue: boolean; teamId: number; sourceId: number | null; canWrite?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [boolean]; saved: [QuantityAdjustment] }>()
const auth = useAuthStore()
const snapshot = ref<QuantityAdjustmentContext | null>(null)
const records = ref<QuantityAdjustment[]>([]), total = ref(0), page = ref(1)
const quantity = ref<number | undefined>(), reason = ref(''), error = ref('')
const loading = ref(false), saving = ref(false), conflict = ref(false)
const editable = computed(() => props.canWrite && auth.isTeamAccount && auth.currentUser?.active !== false && !auth.currentUserError && Number(auth.currentUser?.team_id) === props.teamId)
const hasStock = computed(() => !!snapshot.value && (snapshot.value.quantity > 0 || snapshot.value.weight > 0))
let generation = 0, requestKey = '', fingerprint = ''

async function load(refreshSnapshot = false) {
  if (!props.modelValue || props.sourceId == null || saving.value) return
  const current = ++generation
  loading.value = true; error.value = ''
  try {
    const result = await teamMaterialApi.quantityContext(props.teamId, props.sourceId, page.value)
    if (current !== generation) return
    if (!snapshot.value) quantity.value = result.quantity
    if (!snapshot.value || refreshSnapshot) { snapshot.value = result; conflict.value = false }
    records.value = result.items; total.value = result.total
  } catch (e) { if (current === generation) error.value = e instanceof Error ? e.message : '件数记录读取失败' }
  finally { if (current === generation) loading.value = false }
}
function close() { if (!saving.value) emit('update:modelValue', false) }
async function save() {
  if (!editable.value || loading.value || saving.value || conflict.value || !snapshot.value || props.sourceId == null) return
  error.value = ''
  if (!Number.isSafeInteger(quantity.value) || quantity.value! < 0 || quantity.value! > 2147483647) { error.value = '请填写有效的加工后件数'; return }
  if (quantity.value === snapshot.value.quantity) { error.value = '件数未发生变化'; return }
  if (reason.value.trim().length > 2000) { error.value = '加工说明不能超过 2000 个字符'; return }
  const body = { source_transfer_id: props.sourceId, quantity: quantity.value!, expected_revision: snapshot.value.revision, reason: reason.value.trim() }
  const nextFingerprint = JSON.stringify(body)
  if (fingerprint !== nextFingerprint || !requestKey) { requestKey = materialRequestKey(); fingerprint = nextFingerprint }
  const current = generation
  saving.value = true
  try {
    const result = await teamMaterialApi.changeQuantity(props.teamId, { ...body, idempotency_key: requestKey })
    if (current !== generation) return
    emit('saved', result); emit('update:modelValue', false)
  } catch (e) {
    if (current !== generation) return
    error.value = e instanceof Error ? e.message : '件数变更失败，请重试'
    conflict.value = e instanceof TeamMaterialApiError && e.status === 409
  } finally { if (current === generation) saving.value = false }
}
watch(() => [props.modelValue, props.teamId, props.sourceId], () => {
  ++generation; snapshot.value = null; records.value = []; total.value = 0; page.value = 1
  quantity.value = undefined; reason.value = error.value = requestKey = fingerprint = ''
  loading.value = saving.value = conflict.value = false
  if (props.modelValue) void load()
}, { immediate: true })
watch(() => `${auth.currentUser?.id}:${auth.currentUser?.team_id}:${auth.currentUser?.active}`, () => { ++generation; emit('update:modelValue', false) })
onBeforeUnmount(() => { ++generation })
</script>

<template>
  <ElDialog :model-value="modelValue" :title="editable ? '加工件数变更' : '件数变更记录'" width="min(780px, 94vw)" append-to-body :close-on-click-modal="!saving" :close-on-press-escape="!saving" :show-close="!saving" @close="close">
    <ElAlert v-if="error" :title="error" type="error" :closable="false" />
    <div v-if="loading" role="status" class="quantity-loading">正在读取件数记录…</div>
    <template v-if="snapshot">
      <ElDescriptions :column="2" border class="quantity-summary">
        <ElDescriptionsItem label="来源批次" :span="2">{{ snapshot.batch_no }}</ElDescriptionsItem>
        <ElDescriptionsItem label="未转出件数">{{ snapshot.quantity }} 件</ElDescriptionsItem>
        <ElDescriptionsItem label="未转出重量">{{ snapshot.weight }} kg</ElDescriptionsItem>
      </ElDescriptions>
      <ElForm v-if="editable && hasStock" label-position="top" :disabled="saving || loading" @submit.prevent="save">
        <p class="quantity-note">只修改本批未转出的件数，重量、原签收单和已转出件数不变。保存后立即生效，取消出库不会撤销本次修改。</p>
        <ElFormItem label="加工后未转出件数" required><ElInputNumber v-model="quantity" aria-label="加工后未转出件数" :min="0" :max="2147483647" :precision="0" controls-position="right"><template #suffix><span class="dialog-input-unit">件</span></template></ElInputNumber></ElFormItem>
        <ElFormItem label="加工说明（选填）"><ElInput v-model="reason" type="textarea" aria-label="加工说明" :rows="2" maxlength="2000" show-word-limit placeholder="选填，例如：10 块板材切割为 100 件" /></ElFormItem>
      </ElForm>
      <p v-else-if="editable" class="quantity-note">本批没有未转出的库存，不能修改件数。</p>
      <h3 class="quantity-history-title">变更记录</h3>
      <ElTable :data="records" class="business-table" empty-text="暂无件数变更" aria-label="件数变更记录">
        <ElTableColumn label="时间 / 操作人" min-width="160" align="center"><template #default="{ row }">{{ formatDateTime(row.created_at) }}<br>{{ row.created_by }}</template></ElTableColumn>
        <ElTableColumn label="变更前 → 变更后" min-width="140" align="center"><template #default="{ row }">{{ row.before_quantity }} → {{ row.after_quantity }} 件</template></ElTableColumn>
        <ElTableColumn prop="reason" label="加工说明" min-width="220" align="center" />
      </ElTable>
      <ElPagination v-if="total > 10" :current-page="page" :page-size="10" :total="total" :disabled="loading || saving" layout="prev, pager, next" @current-change="page = $event; load()" />
    </template>
    <template #footer>
      <ElButton :disabled="saving" @click="close">关闭</ElButton>
      <ElButton v-if="conflict || (!snapshot && error)" :disabled="loading || saving" @click="load(true)">刷新并核对</ElButton>
      <ElButton v-if="editable" type="primary" :loading="saving" :disabled="loading || conflict || !hasStock" @click="save">保存件数</ElButton>
    </template>
  </ElDialog>
</template>

<style scoped>
.quantity-summary { margin-block: 16px; }
.quantity-note { color: var(--muted); line-height: 1.7; font-size: 14px; }
.quantity-history-title { margin: 24px 0 12px; font-size: 16px; font-weight: 600; }
.quantity-loading { padding: 12px 0; color: var(--muted); }
.el-pagination { justify-content: flex-end; margin-top: 12px; }
</style>
