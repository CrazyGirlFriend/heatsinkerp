<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElAlert, ElButton, ElFormItem, ElOption, ElSelect } from 'element-plus'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import type { TeamProcessingTask, TeamPurpose } from '@/types/teamBusiness'
import type { QuantityAdjustmentContext } from '@/types/teamMaterials'
import TeamBusinessDialog from './TeamBusinessDialog.vue'

const props = defineProps<{
  teamId: number
  context: QuantityAdjustmentContext
  taskId?: number | null
  purposeId?: number | null
  rework?: boolean
  reworkRecordId?: number | null
  reworkRecordFixed?: boolean
  submitted?: boolean
  disabled?: boolean
}>()
const emit = defineEmits<{
  'update:taskId': [number | null]
  'update:purposeId': [number | null]
  'update:reworkRecordId': [number | null]
  validity: [boolean]
}>()
const tasks = ref<TeamProcessingTask[]>([])
const purposes = ref<TeamPurpose[]>([])
const loading = ref(true),
  error = ref(''),
  settingsOpen = ref(false)
const routeStep = computed(() => (!props.rework ? props.context.process_route : null))
const reworkRecords = computed(() => props.context.rework_task_records || [])
const recordId = computed(() => props.reworkRecordId ?? props.context.rework_of_id ?? null)
const origin = computed(() =>
  reworkRecords.value.find((item) => item.rework_of_id === recordId.value),
)
const chooseOriginal = computed(
  () =>
    props.rework &&
    !props.reworkRecordFixed &&
    (reworkRecords.value.length > 1 || (reworkRecords.value.length > 0 && !origin.value)),
)
const validReworkRecord = computed(
  () =>
    !props.rework ||
    Boolean(
      recordId.value &&
      (origin.value || (!props.context.process_route && !reworkRecords.value.length)),
    ),
)
const currentTaskName = computed(() =>
  props.rework
    ? origin.value?.processing_task_name || '历史未登记'
    : tasks.value.find((item) => item.id === props.taskId)?.name || '未登记',
)
function originalLabel(record: (typeof reworkRecords.value)[number]) {
  return `${record.process_step_name || '历史工序未登记'} · ${record.processing_task_name || '任务未登记'} · 原记录 #${record.rework_of_id}`
}
const required = computed(
  () => !props.rework && (props.context.task_required || tasks.value.length > 0),
)
const choices = computed(() =>
  tasks.value.filter(
    (item) =>
      item.active &&
      (routeStep.value
        ? item.id === routeStep.value.processing_task_id
        : props.context.completed_task_ids
          ? !props.context.completed_task_ids.includes(item.id)
          : !props.context.allowed_task_ids || props.context.allowed_task_ids.includes(item.id)),
  ),
)
const validTask = computed(
  () => props.rework || !required.value || choices.value.some((item) => item.id === props.taskId),
)
const purposeRequired = computed(() => !!props.taskId && purposes.value.length > 0)
const validPurpose = computed(
  () =>
    props.rework ||
    (!purposeRequired.value && !props.purposeId) ||
    purposes.value.some((item) => item.active && item.id === props.purposeId),
)
watch(
  () => [
    props.context,
    loading.value,
    error.value,
    validTask.value,
    validPurpose.value,
    validReworkRecord.value,
  ],
  () =>
    emit(
      'validity',
      !loading.value &&
        !error.value &&
        validTask.value &&
        validPurpose.value &&
        validReworkRecord.value,
    ),
  { immediate: true },
)
let generation = 0
async function load() {
  const current = ++generation
  loading.value = true
  error.value = ''
  if (props.rework) {
    if (!recordId.value && reworkRecords.value.length === 1)
      emit('update:reworkRecordId', reworkRecords.value[0]!.rework_of_id)
    emit('update:taskId', origin.value?.processing_task_id || null)
    emit('update:purposeId', origin.value?.purpose_id || null)
    loading.value = false
    return
  }
  try {
    const [taskOptions, purposeOptions] = await Promise.all([
      teamMaterialApi.processingTasks(props.teamId),
      teamMaterialApi.purposes(props.teamId),
    ])
    if (current !== generation) return
    tasks.value = taskOptions
    purposes.value = purposeOptions
    if (routeStep.value) {
      emit('update:taskId', routeStep.value.processing_task_id)
      emit('update:purposeId', routeStep.value.purpose_id)
    }
  } catch (e) {
    if (current === generation) error.value = e instanceof Error ? e.message : '加工任务读取失败'
  } finally {
    if (current === generation) loading.value = false
  }
}
watch(
  () => [props.teamId, props.context, props.rework, props.reworkRecordId],
  () => void load(),
  { immediate: true },
)
onBeforeUnmount(() => ++generation)
</script>

<template>
  <ElFormItem
    v-if="chooseOriginal"
    label="返工原加工记录"
    required
    :class="{ 'is-error': submitted && !validReworkRecord }"
    class="processing-rework-selection dialog-field-wide"
  >
    <ElSelect
      :model-value="origin ? recordId : null"
      aria-label="返工原加工记录"
      filterable
      :disabled="disabled || loading"
      placeholder="按工序和任务选择原加工记录"
      @update:model-value="emit('update:reworkRecordId', $event || null)"
    >
      <ElOption
        v-for="record in reworkRecords"
        :key="record.rework_of_id"
        :value="record.rework_of_id"
        :label="originalLabel(record)"
      />
    </ElSelect>
  </ElFormItem>
  <section
    v-if="routeStep || rework"
    class="processing-route-instructions"
    :class="{ 'processing-route-instructions--invalid': rework && submitted && !validReworkRecord }"
    aria-label="本道加工工艺"
  >
    <header>
      <strong>{{
        rework
          ? origin?.process_step_name || '原工序未登记'
          : `${routeStep!.sequence_no} · ${routeStep!.step_name}`
      }}</strong>
      <span>{{ rework ? `原加工记录 #${recordId || '未选择'}` : '按派工工艺执行' }}</span>
    </header>
    <div class="processing-route-task">具体任务 · {{ currentTaskName }}</div>
    <p v-if="rework && !recordId">请选择原加工记录，核对对应工序和工艺要求。</p>
    <p v-else-if="rework && !validReworkRecord">未找到关联的原加工记录，请刷新后重新核对。</p>
    <p v-else>
      {{
        rework
          ? origin?.process_step_instructions || '历史未登记本道工艺要求'
          : routeStep!.instructions
      }}
    </p>
    <small v-if="!rework && routeStep?.available === false"
      >本工序已完成，请按路线转出；重复执行请登记返工。</small
    >
  </section>
  <ElFormItem
    label="对应业务"
    :required="purposeRequired"
    :class="{ 'is-error': submitted && !validPurpose }"
  >
    <ElSelect
      :model-value="purposeId"
      aria-label="加工对应业务"
      clearable
      filterable
      :placeholder="rework ? '未登记' : '未分类'"
      :loading="loading"
      :disabled="disabled || rework || !!routeStep || loading"
      @update:model-value="emit('update:purposeId', $event || null)"
    >
      <ElOption
        v-for="item in purposes.filter((item) => item.active || item.id === purposeId)"
        :key="item.id"
        :value="item.id"
        :label="item.name"
        :disabled="!item.active"
      />
      <ElOption
        v-if="purposeId && !purposes.some((item) => item.id === purposeId)"
        :value="purposeId"
        :label="origin?.purpose_name || context.purpose_name || '原业务'"
        disabled
      />
    </ElSelect>
  </ElFormItem>
  <ElFormItem
    label="具体任务"
    :required="required"
    :class="{ 'is-error': submitted && (!validTask || !!error) }"
  >
    <ElSelect
      :model-value="taskId"
      aria-label="加工任务"
      filterable
      clearable
      :placeholder="rework ? '未登记' : tasks.length ? '选择本次完成的任务' : '尚未配置任务'"
      :loading="loading"
      :disabled="disabled || rework || !!routeStep || loading"
      @update:model-value="emit('update:taskId', $event || null)"
    >
      <ElOption v-for="item in choices" :key="item.id" :value="item.id" :label="item.name" />
      <ElOption
        v-if="rework && taskId && !choices.some((item) => item.id === taskId)"
        :value="taskId"
        :label="origin?.processing_task_name || '原加工任务'"
        disabled
      />
    </ElSelect>
    <small v-if="!loading && !tasks.length && !rework" class="dialog-field-hint">
      可先在<ElButton link type="primary" @click="settingsOpen = true">班组设置</ElButton
      >维护具体任务。
    </small>
    <small v-if="rework" class="dialog-field-hint"
      >沿用原加工记录的业务和任务，历史未登记的不补填。</small
    >
    <ElAlert v-if="error" :title="error" type="error" :closable="false">
      <ElButton link @click="load">重试</ElButton>
    </ElAlert>
  </ElFormItem>
  <TeamBusinessDialog
    v-model="settingsOpen"
    :team-id="teamId"
    business-only
    initial-tab="tasks"
    @changed="load"
  />
</template>

<style scoped>
.processing-route-instructions {
  grid-column: 1 / -1;
  border: 1px solid var(--line);
  padding: 12px 14px;
  margin-bottom: 4px;
  background: var(--surface);
  border-radius: 10px;
}
.processing-route-instructions--invalid {
  border-color: var(--el-color-danger);
}
.processing-route-instructions header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px 16px;
  flex-wrap: wrap;
}
.processing-route-instructions header > span,
.processing-route-task,
.processing-route-instructions small {
  font-size: 12px;
  color: var(--muted);
}
.processing-route-task {
  margin-top: 6px;
}
.processing-route-instructions p {
  margin: 8px 0 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text);
}
.processing-route-instructions small {
  display: block;
  margin-top: 8px;
}
.processing-rework-selection {
  grid-column: 1 / -1;
}
</style>
