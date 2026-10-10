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
    <div
      v-else
      class="specification-dimensions"
      :class="{ 'has-three-dimensions': labels.length === 3 }"
    >
      <label v-for="(name, i) in labels" :key="name"
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
          ><template #prefix
            ><span class="dimension-name">{{ name }}</span></template
          ><template #suffix><small>mm</small></template></ElInputNumber
        ></label
      >
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
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  min-width: 0;
}
.specification-input > :deep(.el-select) {
  flex: 0 0 150px;
  max-width: 100%;
}
.specification-input > :deep(.el-input) {
  flex: 1 1 180px;
  min-width: 0;
}
.specification-dimensions {
  display: flex;
  flex: 1 1 240px;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}
.specification-dimensions label {
  display: flex;
  flex: 1 1 112px;
  min-width: 112px;
  max-width: 154px;
}
.specification-dimensions.has-three-dimensions {
  flex-basis: 352px;
}
.dimension-name {
  color: var(--muted);
  font-size: 11px;
  white-space: nowrap;
}
.specification-dimensions small {
  color: var(--subtle);
  font-size: 10px;
}
.specification-dimensions :deep(.el-input-number) {
  width: 100%;
}
.specification-dimensions :deep(.el-input__inner) {
  text-align: left;
}
.specification-error {
  flex-basis: 100%;
  color: var(--el-color-danger);
  font-size: 12px;
}
@media (max-width: 640px) {
  .specification-input > :deep(.el-select) {
    flex-basis: 100%;
  }
}
</style>
