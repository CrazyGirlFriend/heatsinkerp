<script setup lang="ts">
import { ElInputNumber } from 'element-plus'
import { IconMinus, IconPlus } from '@tabler/icons-vue'
import { useWatermelonAppearance } from '@/composables/useWorkspaceAppearance'
defineOptions({ inheritAttrs: false })
const watermelon = useWatermelonAppearance()
defineProps<{ modelValue?: number | null; controlsPosition?: '' | 'right' }>()
const emit = defineEmits<{ 'update:modelValue': [value: number | undefined] }>()
</script>
<template>
  <ElInputNumber
    v-bind="$attrs"
    :model-value="modelValue"
    :controls-position="watermelon ? '' : controlsPosition"
    :class="{ 'wm-number-input': watermelon }"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <template v-if="watermelon" #decrease-icon><IconMinus :size="15" /></template>
    <template v-if="watermelon" #increase-icon><IconPlus :size="15" /></template>
    <template v-for="(_, name) in $slots" #[name]="scope"
      ><slot :name="name" v-bind="scope || {}"
    /></template>
  </ElInputNumber>
</template>
<style>
.wm-scope .wm-number-input.el-input-number {
  width: 100%;
  height: 40px;
}
.wm-scope .wm-number-input .el-input__wrapper {
  min-height: 40px;
  padding-inline: 36px;
  transition:
    box-shadow 200ms,
    background-color 200ms;
}
.wm-scope .wm-number-input .el-input-number__decrease,
.wm-scope .wm-number-input .el-input-number__increase {
  top: 7px;
  bottom: 7px;
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--wm-muted);
  transition:
    transform 160ms,
    background-color 160ms;
}
.wm-scope .wm-number-input .el-input-number__decrease {
  left: 7px;
}
.wm-scope .wm-number-input .el-input-number__increase {
  right: 7px;
}
.wm-scope .wm-number-input [role='button']:hover:not(.is-disabled) {
  background: var(--wm-hover);
  color: var(--wm-text);
}
.wm-scope .wm-number-input [role='button']:active:not(.is-disabled) {
  transform: scale(0.9);
}
.wm-scope .wm-number-input [role='button'].is-disabled {
  opacity: 0.35;
}
.wm-scope .wm-number-input .el-input__inner {
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.wm-scope .wm-number-input .el-input__suffix {
  color: var(--wm-muted);
}
@media (prefers-reduced-motion: reduce) {
  .wm-scope .wm-number-input .el-input__wrapper,
  .wm-scope .wm-number-input [role='button'] {
    transition: none;
    transform: none;
  }
}
</style>
