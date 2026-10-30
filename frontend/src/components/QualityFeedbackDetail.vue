<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import {
  ElAlert,
  ElButton,
  ElCheckbox,
  ElCheckboxGroup,
  ElCheckboxButton,
  ElDescriptions,
  ElDescriptionsItem,
  ElForm,
  ElFormItem,
  ElInput,
  ElSelect,
  ElOption,
  ElTable,
  ElTableColumn,
  ElTag,
} from 'element-plus'
import AppDialog from './AppDialog.vue'
import InspectionRegistrationDialog from './InspectionRegistrationDialog.vue'
import QualityReworkRequest from './QualityReworkRequest.vue'
import { useAuthStore } from '@/stores/auth'
import { useTeamDirectoryStore } from '@/stores/teamDirectory'
import {
  qualityFeedbackApi,
  feedbackStates,
  dispositions,
  type QualityFeedbackDetail,
} from '@/services/qualityFeedbackApi'
import {
  inspectionItemLabels,
  inspectionMethodLabels,
  inspectionProblemLabel,
  type InspectionRecord,
} from '@/services/inspectionApi'
import { materialRequestKey } from '@/utils/materialStock'
import { formatDateTime } from '@/utils/format'
const props = defineProps<{ issueId: number }>()
const emit = defineEmits<{ close: []; changed: [] }>()
const visible = ref(true)
const auth = useAuthStore(),
  directory = useTeamDirectoryStore()
const detail = ref<QualityFeedbackDetail>(),
  error = ref(''),
  busy = ref(false),
  loading = ref(false),
  rechecking = ref(false)
const reworkOpen = ref(false)
const reply = ref(''),
  decisionNotes = ref(''),
  disposition = ref<keyof typeof dispositions>('pending'),
  status = ref<keyof typeof feedbackStates>('pending'),
  involved = ref<number[]>([]),
  release = ref(false),
  submitted = ref<'reply' | 'decision' | null>(null)
const qc = computed(() => directory.items.find((t) => t.code === 'FACTORY-QC' && t.active))
const writable = computed(
  () => auth.isTeamAccount && auth.currentUser?.active !== false && !auth.currentUserError,
)
const canDecide = computed(
  () => writable.value && !!qc.value && Number(auth.currentUser?.team_id) === Number(qc.value.id),
)
const canReply = computed(
  () =>
    writable.value &&
    detail.value?.feedback_status !== 'closed' &&
    detail.value?.involved_teams.some((t) => t.team_id === Number(auth.currentUser?.team_id)),
)
let generation = 0,
  fingerprint = '',
  requestKey = ''
function assign(row: QualityFeedbackDetail) {
  detail.value = row
  decisionNotes.value = row.decision_notes
  disposition.value = row.disposition as keyof typeof dispositions
  status.value = row.feedback_status
  involved.value = row.involved_teams.map((t) => t.team_id)
  release.value = false
}
async function load() {
  const token = ++generation
  loading.value = true
  error.value = ''
  try {
    const row = await qualityFeedbackApi.detail(props.issueId)
    if (token === generation) assign(row)
  } catch (e) {
    if (token === generation) error.value = e instanceof Error ? e.message : '质量反馈读取失败'
  } finally {
    if (token === generation) loading.value = false
  }
}
async function save(decision: boolean) {
  if (busy.value || !detail.value || (decision ? !canDecide.value : !canReply.value)) return
  submitted.value = decision ? 'decision' : 'reply'
  if (
    decision
      ? !involved.value.length || (status.value === 'closed' && disposition.value === 'pending')
      : !reply.value.trim()
  )
    return
  const body = {
    notes: decision ? decisionNotes.value.trim() : reply.value.trim(),
    expected_version: detail.value.feedback_version,
  }
  const decisionBody = {
    ...body,
    disposition: disposition.value,
    status: status.value,
    involved_team_ids: involved.value,
    release_legacy_hold: release.value,
  }
  const next = JSON.stringify([props.issueId, decision, decision ? decisionBody : body])
  if (next !== fingerprint) {
    fingerprint = next
    requestKey = materialRequestKey()
  }
  busy.value = true
  error.value = ''
  try {
    assign(
      decision
        ? await qualityFeedbackApi.decide(props.issueId, {
            ...decisionBody,
            idempotency_key: requestKey,
          })
        : await qualityFeedbackApi.reply(props.issueId, { ...body, idempotency_key: requestKey }),
    )
    reply.value = ''
    submitted.value = null
    emit('changed')
  } catch (e) {
    error.value = e instanceof Error ? e.message : '保存失败'
  } finally {
    busy.value = false
  }
}
function rechecked() {
  rechecking.value = false
  void load()
  emit('changed')
}
watch(
  () => props.issueId,
  () => {
    detail.value = undefined
    reworkOpen.value = false
    reply.value = ''
    submitted.value = null
    void load()
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  ++generation
})
</script>
<template>
  <AppDialog
    v-model="visible"
    title="质量反馈"
    width="min(1120px, calc(100vw - 40px))"
    align-center
    append-to-body
    class="quality-feedback-dialog"
    :close-on-click-modal="false"
    :close-on-press-escape="!busy"
    :show-close="!busy"
    @closed="emit('close')"
  >
    <ElAlert v-if="error" :title="error" type="error" :closable="false" />
    <template v-if="detail">
      <div class="quality-detail-heading">
        <strong>{{ detail.serial_no }} · {{ detail.material_name }}</strong
        ><ElTag>{{ feedbackStates[detail.feedback_status] }}</ElTag
        ><span>{{ detail.batch_no }}</span
        ><ElButton link :loading="loading" :disabled="busy" @click="load">刷新</ElButton>
      </div>
      <ElDescriptions :column="2" border>
        <ElDescriptionsItem v-if="detail.process_step" label="被检工艺 / 工序" :span="2"
          >{{ detail.process_step.title }} · {{ detail.process_step.sequence_no }} ·
          {{ detail.process_step.step_name }}</ElDescriptionsItem
        >
        <ElDescriptionsItem label="来源 / 发现班组"
          >{{ detail.kind === 'inspection' ? '检验' : '巡检' }} /
          {{ detail.team_name }}</ElDescriptionsItem
        >
        <ElDescriptionsItem label="检验人 / 时间"
          >{{ detail.inspector_name }} / {{ formatDateTime(detail.checked_at) }}</ElDescriptionsItem
        >
        <ElDescriptionsItem label="检验范围"
          >{{ detail.scope === 'full' ? '全检' : '抽检' }} {{ detail.sample_quantity }} 件 /
          当时在库 {{ detail.batch_quantity }} 件</ElDescriptionsItem
        >
        <ElDescriptionsItem label="检查结果"
          >合格 {{ detail.passed_quantity }} 件 · 不合格
          {{ detail.failed_quantity }} 件</ElDescriptionsItem
        >
        <ElDescriptionsItem label="检查手段">{{
          detail.methods.map((m) => inspectionMethodLabels[m]).join('、') || '历史未记录'
        }}</ElDescriptionsItem>
        <ElDescriptionsItem label="检查项目">{{
          detail.items.map((i) => inspectionItemLabels[i]).join('、') || '历史未记录'
        }}</ElDescriptionsItem>
        <ElDescriptionsItem
          v-if="detail.items.includes('dimension')"
          label="尺寸要求 / 实测"
          :span="2"
          >{{ detail.dimension_result || '—' }}</ElDescriptionsItem
        >
        <ElDescriptionsItem
          v-if="detail.items.includes('weight')"
          label="重量要求 / 实测"
          :span="2"
          >{{ detail.weight_result || '—' }}</ElDescriptionsItem
        >
        <ElDescriptionsItem label="检验问题" :span="2">{{
          inspectionProblemLabel(detail)
        }}</ElDescriptionsItem>
        <ElDescriptionsItem label="补充说明" :span="2">{{
          detail.notes || '—'
        }}</ElDescriptionsItem>
      </ElDescriptions>
      <div class="quality-detail-section">
        <RouterLink
          v-if="auth.isAdmin"
          :to="{ path: '/material-trace', query: { serial_no: detail.serial_no } }"
          >查看流水号库存</RouterLink
        >
      </div>
      <section class="quality-detail-section">
        <h3>班组反馈</h3>
        <div class="quality-members">
          <ElTag
            v-for="team in detail.involved_teams"
            :key="team.team_id"
            :type="team.replied ? 'success' : 'warning'"
            >{{ team.name }} · {{ team.replied ? '已反馈' : '未反馈' }}</ElTag
          ><span v-if="!detail.involved_teams.length">历史记录待检验班组长指定涉及班组</span>
        </div>
        <div v-for="event in detail.events" :key="event.id" class="quality-event">
          <div>
            <strong>{{
              event.kind === 'decision' ? '检验班组长处理意见' : `${event.team_name}反馈`
            }}</strong
            ><span>{{ event.actor }} · {{ formatDateTime(event.occurred_at) }}</span>
          </div>
          <p v-if="event.kind === 'decision'">
            {{ event.details.disposition && dispositions[event.details.disposition] }} ·
            {{ event.details.status && feedbackStates[event.details.status]
            }}<span v-if="event.details.released_legacy_hold"> · 已手动解除历史锁定</span>
          </p>
          <p>{{ event.notes || '未填写补充说明' }}</p>
        </div>
        <ElForm v-if="canReply" label-position="top" :disabled="busy"
          ><ElFormItem
            label="本班组反馈"
            :class="{ 'is-error': submitted === 'reply' && !reply.trim() }"
            ><ElInput
              v-model="reply"
              type="textarea"
              :rows="2"
              maxlength="2000"
              show-word-limit /></ElFormItem
        ></ElForm>
      </section>
      <section class="quality-detail-section">
        <h3>处理意见</h3>
        <ElForm v-if="canDecide" label-position="top" :disabled="busy">
          <ElFormItem
            label="问题涉及班组（可多选）"
            :class="{ 'is-error': submitted === 'decision' && !involved.length }"
            ><ElCheckboxGroup v-model="involved"
              ><ElCheckboxButton
                v-for="team in directory.items.filter((t) => t.active)"
                :key="team.id"
                :value="Number(team.id)"
                >{{ team.name }}</ElCheckboxButton
              ></ElCheckboxGroup
            ></ElFormItem
          >
          <div class="quality-decision-fields">
            <ElFormItem
              label="处理方式"
              :class="{
                'is-error':
                  submitted === 'decision' && status === 'closed' && disposition === 'pending',
              }"
              ><ElSelect v-model="disposition"
                ><ElOption
                  v-for="(name, key) in dispositions"
                  :key="key"
                  :value="key"
                  :label="name" /></ElSelect></ElFormItem
            ><ElFormItem label="问题状态"
              ><ElSelect v-model="status"
                ><ElOption
                  v-for="(name, key) in feedbackStates"
                  :key="key"
                  :value="key"
                  :label="name" /></ElSelect
            ></ElFormItem>
          </div>
          <ElFormItem label="处理意见（选填）"
            ><ElInput
              v-model="decisionNotes"
              type="textarea"
              :rows="2"
              maxlength="2000"
              show-word-limit
          /></ElFormItem>
          <ElCheckbox v-if="detail.blocks_outbound" v-model="release"
            >手动解除此条历史巡检锁定</ElCheckbox
          >
          <p class="quality-note">保存处理意见不执行库存操作。</p>
        </ElForm>
        <template v-else
          ><p>
            {{ dispositions[detail.disposition as keyof typeof dispositions] }} ·
            {{ feedbackStates[detail.feedback_status] }}
          </p>
          <p>{{ detail.decision_notes || '暂无补充意见' }}</p></template
        >
      </section>
      <section
        v-if="canDecide && detail.feedback_status !== 'closed'"
        class="quality-detail-section"
      >
        <div class="quality-detail-heading">
          <h3>返工工艺</h3>
          <ElButton :disabled="busy || loading" @click="reworkOpen = !reworkOpen">{{
            reworkOpen ? '收起' : '提交工艺'
          }}</ElButton>
        </div>
        <QualityReworkRequest
          v-if="reworkOpen"
          :issue="detail"
          @busy="busy = $event"
          @changed="emit('changed')"
        />
      </section>
      <section class="quality-detail-section">
        <div class="quality-detail-heading">
          <h3>关联复检记录</h3>
          <ElButton v-if="canDecide" @click="rechecking = true">登记复检</ElButton>
        </div>
        <ElTable :data="detail.rechecks" class="business-table" empty-text="暂无复检记录"
          ><ElTableColumn label="时间" min-width="170" align="center"
            ><template #default="{ row }">{{
              formatDateTime(row.checked_at)
            }}</template></ElTableColumn
          ><ElTableColumn prop="inspector_name" label="检验人" align="center" /><ElTableColumn
            prop="sample_quantity"
            label="检查件数"
            align="center"
          /><ElTableColumn prop="passed_quantity" label="合格" align="center" /><ElTableColumn
            prop="failed_quantity"
            label="不合格"
            align="center"
          /><ElTableColumn label="检验问题" min-width="180" align="center" show-overflow-tooltip>
            <template #default="{ row }">{{
              inspectionProblemLabel(row as InspectionRecord)
            }}</template>
          </ElTableColumn></ElTable
        >
      </section>
    </template>
    <template #footer
      ><ElButton :disabled="busy" @click="visible = false">关闭</ElButton
      ><ElButton
        v-if="canReply"
        :type="canDecide ? undefined : 'primary'"
        :loading="busy"
        :disabled="loading"
        @click="save(false)"
        >提交反馈</ElButton
      ><ElButton
        v-if="canDecide"
        type="primary"
        :loading="busy"
        :disabled="loading"
        @click="save(true)"
        >保存处理意见</ElButton
      ></template
    >
  </AppDialog>
  <InspectionRegistrationDialog
    v-if="rechecking && detail && qc"
    :inspection-team-id="Number(qc.id)"
    :recheck="detail"
    @close="rechecking = false"
    @saved="rechecked"
  />
</template>
<style scoped>
.quality-detail-heading,
.quality-members {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 16px;
}
.quality-detail-heading > span,
.quality-note,
.quality-event span {
  color: var(--muted);
  font-size: 13px;
}
.quality-detail-section {
  margin-top: 24px;
}
h3 {
  font-size: 15px;
  margin: 0 0 14px;
}
.quality-decision-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
}
.quality-event {
  padding: 12px 16px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 12px;
  margin: 10px 0;
}
.quality-event > div {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
.quality-event p {
  margin: 8px 0 0;
  white-space: pre-wrap;
}
.quality-detail-section :deep(.el-form) {
  margin-top: 16px;
}
</style>
<style>
.quality-feedback-dialog.el-dialog {
  display: flex;
  flex-direction: column;
  max-height: calc(100dvh - 40px);
}
.quality-feedback-dialog > .el-dialog__body {
  min-height: 0;
  overflow: auto;
  padding-bottom: 24px;
}
.quality-feedback-dialog > .el-dialog__footer {
  flex-shrink: 0;
}
</style>
