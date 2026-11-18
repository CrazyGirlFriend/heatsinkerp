<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElOption } from 'element-plus'
import ElSelect from './AppSelect.vue'
import MaterialInput from './MaterialInput.vue'
import SpecificationInput from './SpecificationInput.vue'
import AutofillBadge from './AutofillBadge.vue'
import { useMaterialAutofill } from '@/composables/useMaterialAutofill'
import type { OpeningLine, OpeningOrderOption } from '@/types/teamBusiness'
import type { MaterialSuggestion } from '@/services/materialInputApi'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import { formatDateTime } from '@/utils/format'
const props = defineProps<{
  line: OpeningLine
  teamId: number
  warehouse: boolean
  index: number
  disabled?: boolean
  errors?: Record<string, string>
}>()
const emit = defineEmits<{
  'validity-change': [valid: boolean]
  update: [value: Partial<OpeningLine>]
}>()
const form = reactive({
  serial_no: props.line.serial_no,
  material_name: props.line.material_name,
  transfer_specification: props.line.transfer_specification,
})
const generation = ref(0)
const orderOptions = ref<OpeningOrderOption[]>([])
const orderLoading = ref(false)
const orderError = ref('')
const selectedOrder = computed(() =>
  orderOptions.value.find((option) => option.schedule_id === props.line.production_schedule_id),
)
const emptyOrder = {
  production_schedule_id: null,
  process_route_id: null,
  process_route_version: null,
  process_step_index: null,
  process_step_complete: false,
}
watch(
  () => props.line,
  (line) => {
    autofill.reset()
    Object.assign(form, {
      serial_no: line.serial_no,
      material_name: line.material_name,
      transfer_specification: line.transfer_specification,
    })
    ++generation.value
  },
)
watch(form, (value) => emit('update', { ...value }), { flush: 'sync' })
const autofill = useMaterialAutofill(() => form.serial_no, form)
function select(item: MaterialSuggestion) {
  autofill.select({ ...item, details: { material_name: item.details.material_name } })
}
function setStockType(stock_type: OpeningLine['stock_type']) {
  if (stock_type === 'non_order') {
    form.serial_no = ''
    autofill.reset()
  }
  emit('update', { stock_type, material_type: '', ...emptyOrder })
}
function updateSerial(serial: string) {
  if (serial.trim() !== form.serial_no.trim()) emit('update', emptyOrder)
  form.serial_no = serial
}
function setOrder(option?: OpeningOrderOption, stepIndex?: number | null) {
  if (option) orderError.value = ''
  const step =
    option?.steps.find(({ index }) => index === stepIndex) ??
    (option?.steps.length === 1 ? option.steps[0] : undefined)
  emit('update', {
    ...emptyOrder,
    production_schedule_id: option?.schedule_id ?? null,
    process_route_id: option?.route_id ?? null,
    process_route_version: option?.route_version ?? null,
    process_step_index: step?.index ?? null,
    process_step_complete:
      !!step && step.index === stepIndex && (props.line.process_step_complete ?? false),
  })
}
watch(
  () => [props.teamId, props.line, props.line.stock_type, form.serial_no.trim()] as const,
  ([teamId, line, stockType, serial], _, onCleanup) => {
    orderOptions.value = []
    orderError.value = ''
    orderLoading.value = stockType === 'order' && !!serial && serial.length <= 80
    if (!orderLoading.value) return
    let stale = false
    const timer = setTimeout(async () => {
      try {
        const options = await teamMaterialApi.openingOptions(teamId, serial)
        if (stale) return
        orderOptions.value = options
        const selected = options.find(
          (option) => option.schedule_id === line.production_schedule_id,
        )
        if (
          line.production_schedule_id &&
          (!selected ||
            selected.route_id !== line.process_route_id ||
            selected.route_version !== line.process_route_version)
        ) {
          setOrder()
          orderError.value = '草稿中的排期或工艺已变化，请重新选择'
          return
        }
        setOrder(
          selected ?? (options.length === 1 ? options[0] : undefined),
          selected ? line.process_step_index : undefined,
        )
        if (!options.length) orderError.value = '未找到该流水号在本班组的排期，请联系调度'
      } catch (error) {
        if (!stale) orderError.value = error instanceof Error ? error.message : '排期读取失败'
      } finally {
        if (!stale) orderLoading.value = false
      }
    }, 250)
    onCleanup(() => {
      stale = true
      clearTimeout(timer)
    })
  },
  { immediate: true },
)
</script>
<template>
  <div class="dialog-field">
    <span class="dialog-field-label">登记类型</span>
    <ElSelect
      :model-value="line.stock_type"
      :aria-label="`第${index + 1}行登记类型`"
      :disabled="disabled"
      @update:model-value="setStockType"
    >
      <ElOption value="order" label="订单物料" />
      <ElOption value="non_order" label="非订单物料" />
    </ElSelect>
  </div>
  <div
    v-if="line.stock_type === 'order'"
    class="dialog-field"
    :class="{ 'is-error': errors?.[`${index}.serial_no`] }"
  >
    <span class="dialog-field-label is-required">流水号</span
    ><MaterialInput
      :model-value="form.serial_no"
      field="serial_no"
      :label="`第${index + 1}行流水号`"
      :maxlength="80"
      :disabled="disabled"
      @update:model-value="updateSerial"
      @selected="select"
    />
  </div>
  <div class="dialog-field" :class="{ 'is-error': errors?.[`${index}.material_name`] }">
    <span class="dialog-field-label is-required"
      >材质<AutofillBadge :source="autofill.source('material_name')" /></span
    ><MaterialInput
      v-model="form.material_name"
      field="material_name"
      :label="`第${index + 1}行材质`"
      :disabled="disabled"
    />
  </div>
  <template v-if="line.stock_type === 'order'">
    <div class="dialog-field" :class="{ 'is-error': errors?.[`${index}.production_schedule_id`] }">
      <span class="dialog-field-label is-required">排期批次</span>
      <ElSelect
        :model-value="line.production_schedule_id"
        :aria-label="`第${index + 1}行排期批次`"
        :placeholder="orderLoading ? '正在查找排期' : '按流水号选择排期批次'"
        :disabled="disabled || orderLoading"
        @update:model-value="setOrder(orderOptions.find((option) => option.schedule_id === $event))"
      >
        <ElOption
          v-for="option in orderOptions"
          :key="option.schedule_id"
          :value="option.schedule_id"
          :label="`第${option.task_batch_number}批 · ${option.steps.at(-1)?.name ?? ''}`"
        />
      </ElSelect>
      <small v-if="orderError" class="opening-order-feedback" role="status">{{ orderError }}</small>
    </div>
    <div class="dialog-field" :class="{ 'is-error': errors?.[`${index}.process_step_index`] }">
      <span class="dialog-field-label is-required">当前工序</span>
      <ElSelect
        :model-value="line.process_step_index"
        :aria-label="`第${index + 1}行当前工序`"
        placeholder="选择物料当前所在工序"
        :disabled="disabled || !selectedOrder"
        @update:model-value="
          emit('update', { process_step_index: $event, process_step_complete: false })
        "
      >
        <ElOption
          v-for="step in selectedOrder?.steps"
          :key="step.index"
          :value="step.index"
          :label="`${step.sequence_no} · ${step.name}`"
        />
      </ElSelect>
    </div>
    <div v-if="!warehouse" class="dialog-field">
      <span class="dialog-field-label">工序状态</span>
      <ElSelect
        :model-value="line.process_step_complete ?? false"
        :aria-label="`第${index + 1}行工序状态`"
        :disabled="disabled || line.process_step_index == null"
        @update:model-value="emit('update', { process_step_complete: $event === true })"
      >
        <ElOption :value="false" label="待加工" />
        <ElOption :value="true" label="已完成待转出" />
      </ElSelect>
    </div>
    <p v-if="selectedOrder" class="opening-order-feedback">
      工艺 {{ selectedOrder.route_title }} · 交期 {{ formatDateTime(selectedOrder.due_at) }}
    </p>
  </template>
  <slot />
  <div
    class="dialog-field opening-specification-field"
    :class="{ 'is-error': errors?.[`${index}.transfer_specification`] }"
  >
    <span class="dialog-field-label">尺寸</span
    ><SpecificationInput
      :key="generation"
      v-model="form.transfer_specification"
      label="尺寸"
      :disabled="disabled"
      @validity-change="emit('validity-change', $event)"
    />
  </div>
</template>
<style scoped>
.opening-order-feedback {
  grid-column: 1 / -1;
  margin: 0;
  color: var(--muted);
  font-size: var(--font-size-meta);
}
</style>
