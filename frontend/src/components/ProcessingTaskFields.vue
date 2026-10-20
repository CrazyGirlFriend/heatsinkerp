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
const origin = computed(() =>
  props.context.rework_task_records?.find(
    (item) => item.rework_of_id === (props.reworkRecordId || props.context.rework_of_id),
  ),
)
const required = computed(
  () => !props.rework && (props.context.task_required || tasks.value.length > 0),
)
const choices = computed(() =>
  tasks.value.filter(
    (item) =>
      item.active &&
      (props.context.completed_task_ids
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
  () => [props.context, loading.value, error.value, validTask.value, validPurpose.value],
  () => emit('validity', !loading.value && !error.value && validTask.value && validPurpose.value),
  { immediate: true },
)
let generation = 0
async function load() {
  const current = ++generation
  loading.value = true
  error.value = ''
  if (props.rework) {
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
  } catch (e) {
    if (current === generation) error.value = e instanceof Error ? e.message : '加工任务读取失败'
  } finally {
    if (current === generation) loading.value = false
  }
}
watch(
  () => [props.teamId, props.context.source_transfer_id, props.reworkRecordId],
  () => void load(),
  { immediate: true },
)
onBeforeUnmount(() => ++generation)
</script>

<template>
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
      :disabled="disabled || rework || loading"
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
      :disabled="disabled || rework || loading"
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
    v-if="settingsOpen"
    v-model="settingsOpen"
    :team-id="teamId"
    business-only
    initial-tab="tasks"
    @changed="load"
  />
</template>
