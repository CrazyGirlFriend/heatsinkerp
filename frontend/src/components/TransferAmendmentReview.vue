<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { ElInput, ElTag } from 'element-plus'
import ElButton from '@/components/AppButton.vue'
import PersonName from './PersonName.vue'
import StatePanel from './StatePanel.vue'
import { formatAmount, formatDateTime } from '@/utils/format'
import {
  transferAmendmentApi,
  transferAmendmentStatusLabels,
  type TransferAmendment,
} from '@/services/transferAmendmentApi'
import { HttpRequestError } from '@/services/httpClient'

const props = withDefaults(defineProps<{ amendmentId: number; showTransferLink?: boolean }>(), {
  showTransferLink: false,
})
const emit = defineEmits<{
  loaded: [TransferAmendment]
  resolved: [TransferAmendment]
  'view-transfer': [string]
  busy: [boolean]
}>()
const amendment = ref<TransferAmendment | null>(null)
const loading = ref(false),
  saving = ref(false),
  error = ref('')
const rejecting = ref(false),
  rejection = ref(''),
  rejectionError = ref('')
const rejectionInput = ref<InstanceType<typeof ElInput>>()
let generation = 0
const changes = computed(() => {
  if (!amendment.value) return []
  const { before, after } = amendment.value
  return [
    { key: 'quantity', label: '数量（件）', before: before.quantity, after: after.quantity },
    { key: 'weight', label: '重量（kg）', before: before.weight, after: after.weight },
    { key: 'notes', label: '备注', before: before.notes || '', after: after.notes || '' },
  ].filter((row) => row.before !== row.after)
})
function text(value: number | string) {
  return typeof value === 'number' ? formatAmount(value) : value || '—'
}
async function load() {
  const epoch = ++generation
  amendment.value = null
  loading.value = true
  error.value = ''
  rejecting.value = false
  rejection.value = ''
  rejectionError.value = ''
  saving.value = false
  emit('busy', false)
  try {
    const result = await transferAmendmentApi.get(props.amendmentId)
    if (epoch !== generation) return
    amendment.value = result
    emit('loaded', result)
  } catch (failure) {
    if (epoch === generation)
      error.value = failure instanceof Error ? failure.message : '修改申请读取失败'
  } finally {
    if (epoch === generation) loading.value = false
  }
}
async function decide(action: 'approve' | 'reject' | 'cancel') {
  const current = amendment.value
  if (saving.value || !current || !current.allowed_actions.includes(action)) return
  if (action === 'reject') {
    rejectionError.value = rejection.value.trim() ? '' : '请填写拒绝原因'
    if (rejectionError.value) {
      await nextTick()
      rejectionInput.value?.focus()
      return
    }
  }
  const epoch = generation
  saving.value = true
  error.value = ''
  emit('busy', true)
  try {
    const result =
      action === 'reject'
        ? await transferAmendmentApi.reject(current.id, rejection.value.trim())
        : await transferAmendmentApi[action](current.id)
    if (epoch !== generation) return
    amendment.value = result
    rejecting.value = false
    emit('resolved', result)
  } catch (failure) {
    if (epoch !== generation) return
    error.value = failure instanceof Error ? failure.message : '操作失败，请重试'
    if (failure instanceof HttpRequestError && failure.status === 409) {
      try {
        const latest = await transferAmendmentApi.get(current.id)
        if (epoch !== generation) return
        amendment.value = latest
        emit('loaded', latest)
      } catch {
        // Keep the proposal and the original error visible for an explicit retry.
      }
    }
  } finally {
    if (epoch === generation) {
      saving.value = false
      emit('busy', false)
    }
  }
}
watch(() => props.amendmentId, load, { immediate: true })
onBeforeUnmount(() => {
  ++generation
  emit('busy', false)
})
</script>

<template>
  <StatePanel v-if="loading" state="loading" title="正在读取修改申请" />
  <StatePanel v-else-if="!amendment" state="error" :description="error" @retry="load" />
  <article v-else class="amendment-review" :aria-busy="saving">
    <header class="review-heading">
      <div>
        <h3>转料修改申请</h3>
        <p>{{ amendment.serial_no }} · {{ amendment.batch_no }}</p>
      </div>
      <ElTag
        :type="
          amendment.status === 'approved'
            ? 'success'
            : amendment.status === 'pending'
              ? 'warning'
              : 'info'
        "
      >
        {{ transferAmendmentStatusLabels[amendment.status] }}
      </ElTag>
    </header>
    <dl class="review-meta">
      <div>
        <dt>申请班组</dt>
        <dd>{{ amendment.requester_team_name }}</dd>
      </div>
      <div>
        <dt>确认班组</dt>
        <dd>{{ amendment.counterparty_team_name }}</dd>
      </div>
      <div>
        <dt>申请人</dt>
        <dd><PersonName :name="amendment.requested_by" /></dd>
      </div>
      <div>
        <dt>申请时间</dt>
        <dd>{{ formatDateTime(amendment.created_at) }}</dd>
      </div>
    </dl>
    <section class="review-reason">
      <h4>修改原因</h4>
      <p>{{ amendment.reason }}</p>
    </section>
    <table class="amendment-diff business-document-table" aria-label="转料修改前后对比">
      <thead>
        <tr>
          <th scope="col">项目</th>
          <th scope="col">修改前</th>
          <th scope="col">申请修改为</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in changes" :key="row.key">
          <th scope="row">{{ row.label }}</th>
          <td class="before-value">{{ text(row.before) }}</td>
          <td>{{ text(row.after) }}</td>
        </tr>
      </tbody>
    </table>
    <p v-if="amendment.status === 'pending'" class="review-hint">
      对方确认后生效；已加工和已转出的记录保持原样。
    </p>
    <div v-if="amendment.resolved_at" class="review-resolution" role="status">
      <PersonName :name="amendment.resolved_by || '—'" /> ·
      {{ formatDateTime(amendment.resolved_at) }}
      <p v-if="amendment.response_reason">{{ amendment.response_reason }}</p>
    </div>
    <div v-if="rejecting" class="rejection-field">
      <label for="amendment-rejection">拒绝原因</label>
      <ElInput
        id="amendment-rejection"
        ref="rejectionInput"
        v-model="rejection"
        type="textarea"
        :rows="2"
        maxlength="2000"
        :disabled="saving"
        :aria-invalid="Boolean(rejectionError)"
        @input="rejectionError = ''"
      />
      <p v-if="rejectionError" role="alert" class="review-error">{{ rejectionError }}</p>
    </div>
    <p v-if="error" role="alert" class="review-error">{{ error }}</p>
    <footer class="review-actions">
      <ElButton
        v-if="showTransferLink"
        link
        type="primary"
        :disabled="saving"
        @click="emit('view-transfer', amendment.batch_no)"
        >查看转料单</ElButton
      >
      <span class="action-spacer" />
      <template v-if="rejecting">
        <ElButton :disabled="saving" @click="rejecting = false">取消</ElButton>
        <ElButton type="danger" :loading="saving" @click="decide('reject')">确认拒绝</ElButton>
      </template>
      <template v-else>
        <ElButton
          v-if="amendment.allowed_actions.includes('cancel')"
          :loading="saving"
          @click="decide('cancel')"
          >撤回申请</ElButton
        >
        <ElButton
          v-if="amendment.allowed_actions.includes('reject')"
          :disabled="saving"
          @click="rejecting = true"
          >拒绝</ElButton
        >
        <ElButton
          v-if="amendment.allowed_actions.includes('approve')"
          type="primary"
          :loading="saving"
          @click="decide('approve')"
          >确认修改</ElButton
        >
      </template>
    </footer>
  </article>
</template>

<style scoped>
.amendment-review {
  display: grid;
  gap: 18px;
  min-width: 0;
}
.review-heading {
  display: flex;
  gap: 12px;
  align-items: start;
  justify-content: space-between;
}
.review-heading h3 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}
.review-heading p {
  margin: 6px 0 0;
  color: var(--subtle);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.review-meta {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 20px;
  margin: 0;
}
.review-meta div {
  display: grid;
  gap: 4px;
}
.review-meta dt,
.review-hint {
  color: var(--subtle);
  font-size: 12px;
}
.review-meta dd {
  margin: 0;
  font-size: 14px;
}
.review-reason h4 {
  margin: 0 0 6px;
  font-size: 12px;
  color: var(--subtle);
  font-weight: 400;
}
.review-reason p,
.review-resolution p {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.amendment-diff {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
  font-size: 14px;
}
.amendment-diff th,
.amendment-diff td {
  border: 1px solid var(--el-border-color-lighter);
  padding: 12px;
  text-align: left;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.amendment-diff th {
  font-weight: 500;
}
.amendment-diff thead {
  background: var(--table-header-bg);
}
.amendment-diff th:first-child {
  width: 24%;
}
.before-value,
.review-resolution {
  color: var(--subtle);
}
.review-hint,
.review-error {
  margin: 0;
}
.review-error {
  color: var(--danger);
  font-size: 13px;
}
.review-resolution {
  font-size: 12px;
  line-height: 1.8;
}
.rejection-field {
  display: grid;
  gap: 8px;
}
.review-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.review-actions :deep(.el-button) {
  margin-left: 0;
}
.action-spacer {
  flex: 1;
}
@media (max-width: 480px) {
  .review-meta {
    grid-template-columns: 1fr;
  }
  .amendment-diff th,
  .amendment-diff td {
    padding: 8px;
  }
}
</style>
