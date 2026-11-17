<script setup lang="ts">
import { computed } from 'vue'
import AppInput from './AppInput.vue'
import MaterialInput from './MaterialInput.vue'
import SpecificationInput from './SpecificationInput.vue'
import { materialDocumentTextFields, materialSpecificationKeys } from '@/types/materialTransfer'

const props = defineProps<{
  field: (typeof materialDocumentTextFields)[number]
  disabled?: boolean
}>()
const value = defineModel<string>({ required: true })
const emit = defineEmits<{ validityChange: [valid: boolean] }>()
const suggestionFields = [
  'material_name',
  'customer_code',
  'product_code',
  'part_no',
  'outsourced_unit',
] as const
const suggestionField = computed(() => suggestionFields.find((key) => key === props.field.key))
</script>

<template>
  <SpecificationInput
    v-if="materialSpecificationKeys.includes(field.key)"
    v-model="value"
    :label="field.label"
    :disabled="disabled"
    @validity-change="emit('validityChange', $event)"
  />
  <MaterialInput
    v-else-if="suggestionField"
    v-model="value"
    :field="suggestionField"
    :label="field.label"
    :maxlength="field.maxLength"
    :disabled="disabled"
  />
  <AppInput
    v-else
    v-model="value"
    :aria-label="field.label"
    :type="field.multiline ? 'textarea' : 'text'"
    :rows="2"
    :maxlength="field.maxLength"
    :show-word-limit="field.multiline"
    :disabled="disabled"
    placeholder="选填"
  />
</template>
