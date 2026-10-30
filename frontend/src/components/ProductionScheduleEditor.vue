<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import {
  ElAlert,
  ElButton,
  ElDatePicker,
  ElForm,
  ElFormItem,
  ElInput,
  ElInputNumber,
  ElOption,
  ElRadioButton,
  ElRadioGroup,
  ElSelect,
} from 'element-plus'
import AppDialog from './AppDialog.vue'
import MaterialInput from './MaterialInput.vue'
import ScheduleSourceAllocation from './ScheduleSourceAllocation.vue'
import { useDialogValidation } from '@/composables/useDialogValidation'
import { useTeamDirectoryStore } from '@/stores/teamDirectory'
import { useAuthStore } from '@/stores/auth'
import { productionScheduleApi } from '@/services/productionScheduleApi'
import type { ProductionSchedule, ScheduleSource, ScheduleWrite } from '@/types/productionSchedule'
import { completionBasisLabels, type CompletionBasis } from '@/types/productionSchedule'
import { externalDestinationOptions } from '@/types/materialTransfer'
import { formatDateTime } from '@/utils/format'
import { scheduleAmountErrors } from '@/utils/schedulePlan'
import { materialRequestKey } from '@/utils/materialStock'

const props = defineProps<{
  schedule?: ProductionSchedule | null
  predecessor?: ProductionSchedule | null
}>()
const emit = defineEmits<{ close: []; saved: [schedule: ProductionSchedule] }>()
const visible = ref(true)
const auth = useAuthStore(),
  directory = useTeamDirectoryStore()
const teams = computed(() =>
  directory.items.filter(
    (team) => team.active && !['engineering', 'dispatch', 'business'].includes(team.kind || ''),
  ),
)
const existing = props.schedule
const localDue = existing ? formatDateTime(existing.due_at) : ''
const form = reactive({
  serial: existing?.serial_no || props.predecessor?.serial_no || '',
  team: existing?.team_id || props.predecessor?.next_team_id || undefined,
  destinationKind: existing?.external_destination ? 'external' : 'team',
  nextTeam: existing?.next_team_id || undefined,
  destination: existing?.external_destination || '',
  date: localDue.slice(0, 10),
  hour: localDue.slice(11, 13),
  quantity: existing?.target_quantity ?? undefined,
  weight: existing?.target_weight ?? undefined,
  basis: (existing?.completion_basis ||
    (existing && !existing.target_quantity ? 'weight' : 'quantity')) as CompletionBasis,
  sequence: existing?.sequence_no || (props.predecessor ? props.predecessor.sequence_no + 1 : 1),
  notes: existing?.notes || '',
  sources: (existing?.sources || []).map((source) => ({ ...source })) as ScheduleSource[],
})
const predecessorId = existing?.predecessor_id || props.predecessor?.id || null
const externalAllowed = computed(() =>
  teams.value.some(
    (team) =>
      Number(team.id) === form.team && ['FACTORY-WAREHOUSE', 'FACTORY-QC'].includes(team.code),
  ),
)
const saving = ref(false),
  error = ref('')
let requestKey = '',
  requestFingerprint = ''
const writable = computed(
  () =>
    (auth.isAdmin ||
      (auth.isTeamAccount && existing?.team_id === Number(auth.currentUser?.team_id))) &&
    !auth.currentUserError &&
    auth.currentUser?.active !== false,
)
const hasExecutions = computed(() =>
  Boolean(
    existing?.deliveries?.length || existing?.dispatched_quantity || existing?.dispatched_weight,
  ),
)
const { formRef, fieldErrors, validate } = useDialogValidation(() => {
  const issues: Record<string, string> = {}
  if (!form.serial.trim()) issues.serial = '请输入流水号'
  if (!form.team) issues.team = '请选择交货班组'
  if (form.destinationKind === 'team' ? !form.nextTeam : !form.destination)
    issues.destination = '请选择接收去向'
  else if (form.destinationKind === 'team' && form.nextTeam === form.team)
    issues.destination = '接收班组不能与交货班组相同'
  if (!form.date || !form.hour) issues.due = '请选择日期和小时'
  Object.assign(issues, scheduleAmountErrors(form))
  return issues
})
function identityChanged() {
  form.sources = []
  if (!externalAllowed.value) form.destinationKind = 'team'
}
async function save() {
  if (!writable.value || saving.value || !validate()) return
  saving.value = true
  error.value = ''
  const body: ScheduleWrite = {
    completion_basis: form.basis,
    process_route_id: existing?.process_route_id || null,
    process_step_index: existing?.process_step_index ?? null,
    serial_no: form.serial.trim(),
    team_id: form.team!,
    next_team_id: form.destinationKind === 'team' ? form.nextTeam! : null,
    external_destination: form.destinationKind === 'external' ? form.destination : null,
    due_at: `${form.date}T${form.hour}:00:00+08:00`,
    target_quantity: form.quantity || null,
    target_weight: form.weight || null,
    sequence_no: form.sequence,
    predecessor_id: predecessorId,
    notes: form.notes.trim() || null,
    sources: form.sources.map(({ source_transfer_id, quantity, weight }) => ({
      source_transfer_id,
      quantity: quantity || null,
      weight: weight || null,
    })),
  }
  const fingerprint = JSON.stringify(body)
  if (!requestKey || fingerprint !== requestFingerprint) {
    requestKey = materialRequestKey()
    requestFingerprint = fingerprint
  }
  try {
    const result = existing
      ? await (auth.isAdmin
          ? productionScheduleApi.update(existing.id, {
              ...body,
              expected_version: existing.version,
            })
          : productionScheduleApi.updateCommitment(existing.id, {
              expected_version: existing.version,
              due_at: body.due_at,
              target_quantity: body.target_quantity,
              target_weight: body.target_weight,
              completion_basis: body.completion_basis,
              notes: body.notes,
            }))
      : await productionScheduleApi.create({ ...body, idempotency_key: requestKey })
    emit('saved', result)
  } catch (e) {
    error.value = e instanceof Error ? e.message : '排期保存失败，请重试'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <AppDialog
    v-model="visible"
    :title="existing ? '调整交货排期' : predecessor ? '添加下序交货节点' : '新建交货排期'"
    width="min(1000px, 94vw)"
    class="schedule-editor"
    append-to-body
    :close-on-click-modal="!saving"
    :close-on-press-escape="!saving"
    :show-close="!saving"
    @closed="emit('close')"
  >
    <ElAlert v-if="error" :title="error" type="error" :closable="false" />
    <ElForm
      ref="formRef"
      label-position="top"
      :disabled="saving || !writable"
      class="schedule-form"
      @submit.prevent="save"
    >
      <p v-if="existing?.task_id" class="schedule-form__note">
        所属任务：{{ existing.task_no }} ·
        {{ existing.task_title }}
      </p>
      <div class="schedule-form__grid">
        <ElFormItem label="流水号" required :error="fieldErrors.serial"
          ><MaterialInput
            v-model="form.serial"
            field="serial_no"
            label="排期流水号"
            :maxlength="80"
            :disabled="!!existing?.task_id || !!predecessorId || hasExecutions"
            @update:model-value="identityChanged"
        /></ElFormItem>
        <ElFormItem label="交货班组" required :error="fieldErrors.team"
          ><ElSelect
            v-model="form.team"
            placeholder="选择交货班组"
            :disabled="!!existing?.task_id || !!predecessorId || hasExecutions"
            @change="identityChanged"
            ><ElOption
              v-for="team in teams"
              :key="team.id"
              :value="Number(team.id)"
              :label="team.name" /></ElSelect
        ></ElFormItem>
        <ElFormItem
          label="接收去向"
          required
          :error="fieldErrors.destination"
          class="schedule-form__destination"
          ><ElRadioGroup
            v-if="externalAllowed"
            v-model="form.destinationKind"
            size="small"
            :disabled="!!existing?.task_id || hasExecutions"
            ><ElRadioButton value="team">接收班组</ElRadioButton
            ><ElRadioButton value="external">外部去向</ElRadioButton></ElRadioGroup
          ><ElSelect
            v-if="form.destinationKind === 'team'"
            v-model="form.nextTeam"
            placeholder="选择接收班组"
            :disabled="!!existing?.task_id || hasExecutions"
            ><ElOption
              v-for="team in teams.filter((team) => Number(team.id) !== form.team)"
              :key="team.id"
              :value="Number(team.id)"
              :label="team.name" /></ElSelect
          ><ElSelect
            v-else
            v-model="form.destination"
            placeholder="选择外部去向"
            :disabled="!!existing?.task_id || hasExecutions"
            ><ElOption
              v-for="destination in externalDestinationOptions"
              :key="destination"
              :value="destination"
              :label="destination" /></ElSelect
        ></ElFormItem>
        <ElFormItem label="要求交货时间（北京时间）" required :error="fieldErrors.due"
          ><div class="schedule-form__deadline">
            <ElDatePicker
              v-model="form.date"
              type="date"
              value-format="YYYY-MM-DD"
              placeholder="交货日期"
              aria-label="交货日期"
            /><ElSelect v-model="form.hour" placeholder="小时" aria-label="交货小时"
              ><ElOption
                v-for="hour in 24"
                :key="hour"
                :value="String(hour - 1).padStart(2, '0')"
                :label="`${String(hour - 1).padStart(2, '0')}:00`"
            /></ElSelect></div
        ></ElFormItem>
        <ElFormItem label="计量方式" required>
          <ElSelect v-model="form.basis" aria-label="计量方式"
            ><ElOption
              v-for="(label, value) in completionBasisLabels"
              :key="value"
              :label="label"
              :value="value"
          /></ElSelect>
        </ElFormItem>
        <ElFormItem
          :label="form.basis === 'weight' ? '参考件数' : '计划交货件数'"
          :required="form.basis !== 'weight'"
          :error="fieldErrors.quantity"
        >
          <ElInputNumber
            v-model="form.quantity"
            :min="1"
            :precision="0"
            controls-position="right"
            placeholder="件数"
            aria-label="计划交货件数"
        /></ElFormItem>
        <ElFormItem
          :label="form.basis === 'quantity' ? '参考重量（kg）' : '计划交货重量（kg）'"
          :required="form.basis !== 'quantity'"
          :error="fieldErrors.weight"
          ><ElInputNumber
            v-model="form.weight"
            :min="0.000001"
            :precision="6"
            controls-position="right"
            placeholder="重量"
            aria-label="计划交货重量"
        /></ElFormItem>
      </div>
      <p v-if="predecessorId" class="schedule-form__note">
        上序 #{{ predecessorId
        }}<span v-if="predecessor">
          · {{ predecessor.team_name }} · {{ formatDateTime(predecessor.due_at) }}</span
        >
      </p>
      <ScheduleSourceAllocation
        v-if="auth.isAdmin"
        v-model="form.sources"
        :serial-no="form.serial"
        :team-id="form.team"
        :target-quantity="form.quantity"
        :target-weight="form.weight"
        :disabled="saving || !writable"
        :error="fieldErrors.sources"
      />
      <ElFormItem label="备注"
        ><ElInput
          v-model="form.notes"
          type="textarea"
          :rows="2"
          maxlength="2000"
          show-word-limit
          placeholder="选填"
      /></ElFormItem>
    </ElForm>
    <template #footer
      ><ElButton :disabled="saving" @click="visible = false">取消</ElButton
      ><ElButton type="primary" :loading="saving" :disabled="!writable" @click="save"
        >保存排期</ElButton
      ></template
    >
  </AppDialog>
</template>

<style scoped>
.schedule-form {
  margin-top: 8px;
}
.schedule-form__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 2px 24px;
}
.schedule-form :deep(.el-form-item) {
  min-width: 0;
  margin-bottom: 18px;
}
.schedule-form :deep(.el-select),
.schedule-form :deep(.el-input-number) {
  width: 100%;
}
.schedule-form__destination :deep(.el-form-item__content) {
  gap: 8px;
}

.schedule-form__deadline {
  display: flex;
  gap: 10px;
  width: 100%;
}
.schedule-form__deadline :deep(.el-date-editor) {
  flex: 1;
  width: 0;
}
.schedule-form__deadline :deep(.el-select) {
  width: 104px;
}
.schedule-form__note {
  color: var(--muted);
  font-size: 13px;
  margin: 10px 0 16px;
  line-height: 1.6;
}
.schedule-form__note span {
  margin-left: 12px;
}
@media (max-width: 680px) {
  .schedule-form__grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
