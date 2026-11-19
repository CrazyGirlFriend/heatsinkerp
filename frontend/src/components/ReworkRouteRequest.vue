<script setup lang="ts">
import ElAlert from '@/components/AppAlert.vue'
import ElInput from '@/components/AppInput.vue'
import ElSelect from '@/components/AppSelect.vue'
import { computed, ref, watch } from 'vue'
import CompactFormSection from './CompactFormSection.vue'
import WeightInput from './WeightInput.vue'
import { ElForm, ElFormItem, ElOption } from 'element-plus'
import ElInputNumber from '@/components/AppNumberInput.vue'
import ElButton from '@/components/AppButton.vue'
import type { QuantityAdjustmentContext } from '@/types/teamMaterials'
import { processRouteApi } from '@/services/processRouteApi'
import { createMaterialSubmissionKey } from '@/utils/materialStock'
const props = defineProps<{
  context?: QuantityAdjustmentContext
  loading?: boolean
  inspectionId?: number
  repairTeams?: { id: number; name: string }[]
  initialReason?: string
}>()
const emit = defineEmits<{ changed: []; busy: [boolean] }>()
const repairTeam = ref<number | undefined>(
  props.repairTeams?.length === 1 ? props.repairTeams[0]?.id : undefined,
)
watch(
  () => props.repairTeams,
  (teams) => {
    if (!teams?.some((t) => t.id === repairTeam.value))
      repairTeam.value = teams?.length === 1 ? teams[0]?.id : undefined
  },
)
const original = ref(props.context?.rework_of_id || null)
type WorkRecord = NonNullable<QuantityAdjustmentContext['rework_task_records']>[number]
const selectedRecord = computed(() =>
  props.context?.rework_task_records?.find((record) => record.rework_of_id === original.value),
)
function recordTitle(record: WorkRecord) {
  return [
    record.team_name,
    record.process_step_name || record.processing_task_name || '历史工艺记录',
  ]
    .filter(Boolean)
    .join(' · ')
}
function recordSummary(record: WorkRecord) {
  return [
    record.processing_task_name ? `加工任务：${record.processing_task_name}` : '',
    record.work_kind === 'rework'
      ? `第 ${record.rework_round || 1} 轮返工`
      : record.work_kind === 'initial'
        ? '正常加工'
        : '',
    record.processing_date,
    record.processor_name,
    record.completed_quantity != null ? `已加工 ${record.completed_quantity} 件` : '',
  ]
    .filter(Boolean)
    .join(' · ')
}
const quantity = ref<number>(),
  weight = ref<number>(),
  reason = ref(props.initialReason || '')
const busy = ref(false),
  error = ref(''),
  submitted = ref(false)
const submission = createMaterialSubmissionKey()
watch(
  () => props.context,
  (context) => {
    original.value = context?.rework_of_id || null
    quantity.value = undefined
    weight.value = undefined
    error.value = ''
    submitted.value = false
    submission.reset()
  },
)
async function save() {
  submitted.value = true
  if (
    busy.value ||
    props.loading ||
    !props.context ||
    (props.inspectionId ? !repairTeam.value : !original.value) ||
    quantity.value == null ||
    weight.value == null ||
    !Number.isInteger(quantity.value) ||
    quantity.value <= 0 ||
    !Number.isFinite(weight.value) ||
    weight.value <= 0 ||
    !reason.value.trim()
  )
    return
  busy.value = true
  emit('busy', true)
  error.value = ''
  try {
    const body = {
      inspection_id: props.inspectionId,
      source_transfer_id: props.context.source_transfer_id,
      rework_of_id: original.value || undefined,
      repair_team_id: props.inspectionId ? repairTeam.value : undefined,
      problem_team_id: props.context.rework_problem_team_id || undefined,
      expected_revision: props.context.revision,
      quantity: quantity.value,
      weight: weight.value,
      reason: reason.value.trim(),
    }
    await processRouteApi.requestRework({ ...body, idempotency_key: submission.get(body) })
    emit('changed')
  } catch (e) {
    error.value = e instanceof Error ? e.message : '问题提交失败'
  } finally {
    busy.value = false
    emit('busy', false)
  }
}
</script>
<template>
  <section class="rework-request" aria-label="提交问题">
    <ElAlert v-if="error" :title="error" type="error" :closable="false" />
    <ElForm label-position="top" :disabled="busy" @submit.prevent="save">
      <CompactFormSection title="问题信息">
        <slot name="source" :submitted="submitted" />
        <ElFormItem v-if="inspectionId" class="form-field--medium" label="返修班组" required>
          <ElSelect v-model="repairTeam" aria-label="返修班组"
            ><ElOption
              v-for="team in repairTeams"
              :key="team.id"
              :value="team.id"
              :label="team.name"
          /></ElSelect>
        </ElFormItem>
        <ElFormItem
          class="form-field--long"
          label="工艺记录"
          :required="!inspectionId"
          :error="submitted && context && !inspectionId && !original ? '请选择工艺记录' : ''"
        >
          <ElSelect
            v-model="original"
            aria-label="工艺记录"
            popper-class="problem-work-menu"
            :disabled="!context || loading"
            :loading="loading"
            :placeholder="context ? '选择发现问题的工艺记录' : '请先选择问题批次'"
          >
            <ElOption
              v-for="record in context?.rework_task_records"
              :key="record.rework_of_id"
              :value="record.rework_of_id"
              :label="recordTitle(record)"
              class="problem-work-option"
            >
              <strong>{{ recordTitle(record) }}</strong>
              <span v-if="recordSummary(record)">{{ recordSummary(record) }}</span>
              <span v-if="record.process_step_instructions">{{
                record.process_step_instructions
              }}</span>
            </ElOption>
            <ElOption
              v-if="
                original &&
                !context?.rework_task_records?.some((row) => row.rework_of_id === original)
              "
              :value="original"
              label="工艺记录（历史信息未登记）"
            />
          </ElSelect>
        </ElFormItem>
        <ElFormItem
          class="form-field--medium"
          label="问题件数"
          required
          :error="submitted && context && (!quantity || quantity <= 0) ? '请填写问题件数' : ''"
          ><ElInputNumber
            v-model="quantity"
            :min="1"
            :max="context?.quantity"
            :disabled="!context || loading"
            :precision="0"
            aria-label="问题件数"
        /></ElFormItem>
        <ElFormItem
          class="form-field--medium"
          label="问题重量"
          required
          :error="submitted && context && (!weight || weight <= 0) ? '请填写问题重量' : ''"
          ><WeightInput
            v-model="weight"
            :max="context?.weight"
            :disabled="!context || loading"
            ariaLabel="问题重量"
        /></ElFormItem>
        <div v-if="selectedRecord" class="form-field--full work-record-detail">
          <strong>{{ recordTitle(selectedRecord) }}</strong>
          <span v-if="recordSummary(selectedRecord)">{{ recordSummary(selectedRecord) }}</span>
          <p>{{ selectedRecord.process_step_instructions || '历史记录未保存工艺要求' }}</p>
        </div>
        <ElFormItem
          class="form-field--full"
          label="问题描述"
          required
          :error="submitted && !reason.trim() ? '请填写问题描述' : ''"
          ><ElInput
            v-model="reason"
            type="textarea"
            :rows="2"
            maxlength="2000"
            aria-label="问题描述"
        /></ElFormItem>
      </CompactFormSection>
      <footer>
        <ElButton type="primary" :loading="busy" :disabled="loading" native-type="submit"
          >提交问题</ElButton
        >
      </footer>
    </ElForm>
  </section>
</template>
<style scoped>
.rework-request {
  container: form-fields / inline-size;
  margin-top: 12px;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface, #fff);
}
.el-input-number,
.el-select {
  width: 100%;
}
footer {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 12px;
}
.work-record-detail {
  display: grid;
  gap: 4px;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--surface-alt, var(--surface));
  font-size: var(--font-size-label);
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.work-record-detail span {
  color: var(--muted);
}
.work-record-detail p {
  margin: 0;
  white-space: pre-wrap;
}
</style>

<style>
.problem-work-menu .el-select-dropdown__item.problem-work-option {
  height: auto;
  min-height: 40px;
  padding-block: 10px;
  white-space: normal;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.problem-work-option strong,
.problem-work-option span {
  display: block;
}
.problem-work-option span {
  font-size: var(--font-size-meta);
  white-space: pre-wrap;
}
</style>
