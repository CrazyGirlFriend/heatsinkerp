<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import { ElFormItem, ElOption } from 'element-plus'
import AppSelect from './AppSelect.vue'
import AppButton from './AppButton.vue'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import type { TeamDirectoryItem } from '@/types/teamBusiness'
import AppInput from './AppInput.vue'
import AppNumberInput from './AppNumberInput.vue'
import ProcessingDurationInput from './ProcessingDurationInput.vue'
import {
  processingParameterFields,
  processingParameterErrors,
  type ProcessingParameters,
  type ProcessingParameterKey,
  isEquipmentParameter,
} from '@/config/processingParameters'

const props = defineProps<{
  teamId: number
  fields?: string[]
  totalMinutes?: number | null
  submitted?: boolean
  disabled?: boolean
}>()
const values = defineModel<ProcessingParameters>({ default: () => ({}) })
const fields = computed(() => processingParameterFields(props.fields))
const equipment = ref<TeamDirectoryItem[]>([])
const loading = ref(false)
const loadError = ref('')
let generation = 0
async function loadEquipment() {
  const current = ++generation
  equipment.value = []
  loadError.value = ''
  loading.value = false
  if (!fields.value.some((field) => isEquipmentParameter(field.key))) return
  loading.value = true
  try {
    const result = await teamMaterialApi.equipment(props.teamId)
    if (current === generation) equipment.value = result.filter((item) => item.active)
  } catch {
    if (current === generation) loadError.value = '设备读取失败'
  } finally {
    if (current === generation) loading.value = false
  }
}
watch(
  () => [props.teamId, props.fields?.find(isEquipmentParameter)] as const,
  (current, previous) => {
    if (previous && (current[0] !== previous[0] || current[1] !== previous[1]))
      values.value = { ...values.value, equipment_id: null, furnace_no: null, machine_no: null }
    void loadEquipment()
  },
  { immediate: true },
)
onBeforeUnmount(() => ++generation)
function selectEquipment(key: ProcessingParameterKey, id: number | undefined) {
  const item = equipment.value.find((item) => item.id === id)
  values.value = { ...values.value, equipment_id: item?.id ?? null, [key]: item?.name ?? null }
}
const errors = computed(() =>
  props.submitted
    ? processingParameterErrors(values.value, props.fields || [], props.totalMinutes)
    : {},
)
function update(key: ProcessingParameterKey, value: string | number | undefined) {
  values.value = { ...values.value, [key]: value }
}
</script>

<template>
  <ElFormItem
    v-for="field in fields"
    :key="field.key"
    :label="field.label"
    required
    :error="errors[field.key]"
    :show-message="true"
  >
    <template v-if="isEquipmentParameter(field.key)">
      <AppSelect
        :model-value="values.equipment_id ?? undefined"
        :aria-label="field.label"
        :placeholder="`请选择${field.label}`"
        :loading="loading"
        :disabled="disabled || loading"
        filterable
        @update:model-value="selectEquipment(field.key, $event)"
      >
        <ElOption v-for="item in equipment" :key="item.id" :value="item.id" :label="item.name" />
      </AppSelect>
      <small v-if="loadError" role="alert"
        >{{ loadError }} <AppButton link @click="loadEquipment">重试</AppButton></small
      >
      <small v-else-if="!loading && !equipment.length" role="status"
        >请先在班组管理 → 设备管理中添加设备</small
      >
    </template>
    <ProcessingDurationInput
      v-else-if="field.kind === 'duration'"
      :model-value="values.holding_minutes ?? undefined"
      label="保温"
      :disabled="disabled"
      :invalid="!!errors[field.key]"
      @update:model-value="update(field.key, $event)"
    />
    <AppNumberInput
      v-else-if="field.kind === 'temperature'"
      :model-value="values.actual_temperature_c ?? undefined"
      :min="-273.15"
      :max="99999.99"
      :precision="2"
      :controls="false"
      :disabled="disabled"
      :aria-label="field.label"
      placeholder="实际测得温度"
      @update:model-value="update(field.key, $event)"
      ><template #suffix>°C</template></AppNumberInput
    >
    <AppInput
      v-else
      :model-value="String(values[field.key] ?? '')"
      :maxlength="field.maxLength"
      :disabled="disabled"
      :aria-label="field.label"
      :placeholder="
        field.key === 'temperature_requirement' ? '如 900–950 °C' : `请输入${field.label}`
      "
      @update:model-value="update(field.key, $event)"
    />
  </ElFormItem>
</template>
