<script setup lang="ts">
import { ElAutocomplete } from 'element-plus'
import { onBeforeUnmount, ref, watch } from 'vue'
import {
  materialSuggestions,
  type MaterialInputField,
  type MaterialSuggestion,
} from '@/services/materialInputApi'
const props = withDefaults(
  defineProps<{
    modelValue: string
    field: MaterialInputField
    label: string
    placeholder?: string
    disabled?: boolean
    maxlength?: number
  }>(),
  { placeholder: '输入或选择已有记录', maxlength: 160 },
)
const emit = defineEmits<{
  'update:modelValue': [value: string]
  selected: [value: MaterialSuggestion]
}>()
const failed = ref(false)
let generation = 0
async function suggestions(query: string, callback: (items: MaterialSuggestion[]) => void) {
  const current = ++generation
  failed.value = false
  try {
    const items = await materialSuggestions(props.field, query)
    if (current === generation && !props.disabled) callback(items)
  } catch {
    if (current === generation) {
      failed.value = true
      callback([])
    }
  }
}
watch(
  () => [props.field, props.disabled, props.modelValue],
  () => {
    ++generation
    failed.value = false
  },
)
onBeforeUnmount(() => {
  ++generation
})
</script>
<template>
  <div class="material-input">
    <ElAutocomplete
      :model-value="modelValue"
      :fetch-suggestions="suggestions"
      :debounce="250"
      :disabled="disabled"
      :maxlength="maxlength"
      :aria-label="label"
      :placeholder="placeholder"
      clearable
      fit-input-width
      popper-class="material-suggestions"
      @update:model-value="emit('update:modelValue', String($event))"
      @select="emit('selected', $event as MaterialSuggestion)"
    >
      <template #default="{ item }"
        ><div class="material-suggestion">
          <strong>{{ item.value }}</strong
          ><span v-if="field === 'serial_no'">{{
            [
              item.details.material_name,
              item.details.finished_specification,
              item.details.customer_code && `客户 ${item.details.customer_code}`,
              item.details.product_code && `产品 ${item.details.product_code}`,
              item.details.part_no && `零件 ${item.details.part_no}`,
            ]
              .filter(Boolean)
              .join(' · ') || '资料未填写'
          }}</span>
        </div></template
      >
    </ElAutocomplete>
    <small v-if="failed" class="input-assist-error">建议暂不可用，可直接输入</small>
  </div>
</template>
<style scoped>
.material-input,
.material-input :deep(.el-autocomplete) {
  width: 100%;
  min-width: 0;
}
.material-suggestion {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding-block: 8px;
  line-height: 1.5;
}
.material-suggestion strong {
  color: var(--text);
  font-size: 14px;
  font-weight: 550;
}
.material-suggestion span {
  color: var(--muted);
  font-size: 12px;
  white-space: normal;
  overflow-wrap: anywhere;
}
.input-assist-error {
  color: var(--muted);
  font-size: 12px;
}
</style>
