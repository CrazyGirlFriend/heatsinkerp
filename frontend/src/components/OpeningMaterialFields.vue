<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import MaterialInput from './MaterialInput.vue'
import SpecificationInput from './SpecificationInput.vue'
import AutofillBadge from './AutofillBadge.vue'
import { useMaterialAutofill } from '@/composables/useMaterialAutofill'
import type { OpeningLine } from '@/types/teamBusiness'
import type { MaterialSuggestion } from '@/services/materialInputApi'
const props = defineProps<{ line: OpeningLine; index: number; disabled?: boolean }>()
const emit = defineEmits<{
  'validity-change': [valid: boolean]
  update: [value: Pick<OpeningLine, 'serial_no' | 'material_name' | 'transfer_specification'>]
}>()
const form = reactive({
  serial_no: props.line.serial_no,
  material_name: props.line.material_name,
  transfer_specification: props.line.transfer_specification,
})
const generation = ref(0)
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
</script>
<template>
  <label
    >流水号<MaterialInput
      v-model="form.serial_no"
      field="serial_no"
      :label="`第${index + 1}行流水号`"
      :maxlength="80"
      :disabled="disabled"
      @selected="select"
  /></label>
  <label
    ><span>材质<AutofillBadge :source="autofill.source('material_name')" /></span
    ><MaterialInput
      v-model="form.material_name"
      field="material_name"
      :label="`第${index + 1}行材质`"
      :disabled="disabled"
  /></label>
  <label
    >规格<SpecificationInput
      :key="generation"
      v-model="form.transfer_specification"
      label="规格"
      :disabled="disabled"
      @validity-change="emit('validity-change', $event)"
  /></label>
</template>

<style scoped>
label {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  font-size: 15px;
  color: var(--text);
}
label > span {
  display: flex;
  align-items: center;
  gap: 6px;
}
</style>
