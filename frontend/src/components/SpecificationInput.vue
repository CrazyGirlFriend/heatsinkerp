<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElInput, ElInputNumber, ElOption, ElSelect } from 'element-plus'
const props = defineProps<{ modelValue: string; label: string; disabled?: boolean }>()
const emit = defineEmits<{
  'update:modelValue': [value: string]
  'validity-change': [valid: boolean]
}>()
const shapes = {
  custom: '自由填写 / 异形',
  rectangle: '长方体 / 板材',
  cylinder: '圆柱 / 圆片',
  ring: '圆环 / 圆管',
}
const shape = ref<keyof typeof shapes>('custom')
const dimensions = reactive<(number | undefined)[]>([undefined, undefined, undefined])
const labels = computed(() =>
  shape.value === 'rectangle'
    ? ['长', '宽', '高 / 厚']
    : shape.value === 'ring'
      ? ['外径', '内径', '高 / 长']
      : ['直径', '高 / 厚'],
)
const valid = computed(
  () =>
    shape.value === 'custom' ||
    (labels.value.every((_, i) => Number(dimensions[i]) > 0) &&
      (shape.value !== 'ring' || Number(dimensions[0]) > Number(dimensions[1]))),
)
let ownValue: string | undefined
function update(value: string) {
  ownValue = value
  emit('update:modelValue', value)
}
function generate() {
  if (!valid.value) {
    update('')
    return
  }
  const values = dimensions.slice(0, labels.value.length)
  update(
    shape.value === 'rectangle'
      ? `${values.join(' × ')} mm`
      : shape.value === 'cylinder'
        ? `Φ${values.join(' × ')} mm`
        : `Φ${values[0]} × Φ${values[1]} × ${values[2]} mm`,
  )
}
function changeShape() {
  dimensions.splice(0, 3, undefined, undefined, undefined)
  update('')
}
watch(
  () => props.modelValue,
  (value) => {
    if (value === ownValue) {
      ownValue = undefined
      return
    }
    const number = '(\\d+(?:\\.\\d+)?)'
    const patterns = [
      ['ring', new RegExp(`^Φ${number} × Φ${number} × ${number} mm$`)],
      ['cylinder', new RegExp(`^Φ${number} × ${number} mm$`)],
      ['rectangle', new RegExp(`^${number} × ${number} × ${number} mm$`)],
    ] as const
    const found = patterns.find(([, pattern]) => pattern.test(value))
    shape.value = found?.[0] || 'custom'
    const values = found ? value.match(found[1])!.slice(1).map(Number) : []
    dimensions.splice(0, 3, values[0], values[1], values[2])
  },
  { immediate: true },
)
watch(valid, (value) => emit('validity-change', value), { immediate: true })
</script>
<template>
  <div class="specification-input">
    <ElSelect
      v-model="shape"
      :aria-label="`${label}形状`"
      :disabled="disabled"
      @change="changeShape"
      ><ElOption v-for="(name, key) in shapes" :key="key" :value="key" :label="name"
    /></ElSelect>
    <ElInput
      v-if="shape === 'custom'"
      :model-value="modelValue"
      :aria-label="label"
      :disabled="disabled"
      maxlength="240"
      placeholder="如：异形件，按图纸 HS-01 加工"
      @update:model-value="update($event)"
    />
    <div v-else class="specification-dimensions">
      <label v-for="(name, i) in labels" :key="name"
        ><span>{{ name }}<small>mm</small></span
        ><ElInputNumber
          v-model="dimensions[i]"
          :aria-label="`${label}${name}`"
          :disabled="disabled"
          :min="0.001"
          :max="999999"
          :precision="3"
          :controls="false"
          placeholder="尺寸"
          @update:model-value="generate"
      /></label>
    </div>
    <small v-if="!valid" class="specification-error">{{
      shape === 'ring' && dimensions[0] && dimensions[1] && dimensions[0] <= dimensions[1]
        ? '外径须大于内径'
        : '请填完整尺寸'
    }}</small>
  </div>
</template>
<style scoped>
.specification-input {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  min-width: 0;
}
.specification-dimensions {
  display: flex;
  gap: 8px;
  min-width: 0;
}
.specification-dimensions label {
  flex: 1;
  min-width: 0;
}
.specification-dimensions i {
  margin-right: auto;
  color: var(--el-color-danger);
  font-style: normal;
}
.specification-dimensions label > span {
  display: flex;
  justify-content: space-between;
  gap: 4px;
  margin-bottom: 4px;
  color: var(--muted);
  font-size: 12px;
}
.specification-dimensions small {
  color: var(--subtle);
}
.specification-dimensions :deep(.el-input-number) {
  width: 100%;
}
.specification-dimensions :deep(.el-input__inner) {
  text-align: left;
}
.specification-error {
  color: var(--el-color-danger);
  font-size: 12px;
}
</style>
