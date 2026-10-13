<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Filter } from '@element-plus/icons-vue'
import { invalidNumberRange } from '@/utils/numberFilterRange'
import {
  ElButton,
  ElCheckbox,
  ElCheckboxGroup,
  ElDatePicker,
  ElInput,
  ElPopover,
} from 'element-plus'

const props = withDefaults(
  defineProps<{
    label: string
    kind?: 'text' | 'select' | 'number' | 'date'
    value?: string
    end?: string
    options?: readonly { value: string; label: string }[]
    integer?: boolean
    context?: string
  }>(),
  { kind: 'text', value: '', end: '', options: () => [] },
)
const emit = defineEmits<{ apply: [value: string, end: string] }>()
const visible = ref(false),
  draft = ref(''),
  endDraft = ref(''),
  search = ref('')
const trigger = ref<InstanceType<typeof ElButton>>()
const input = ref<InstanceType<typeof ElInput>>()
const choices = computed({
  get: () => (draft.value ? draft.value.split(',') : []),
  set: (values: string[]) => {
    draft.value = values.join(',')
  },
})
const filteredOptions = computed(() =>
  props.options.filter((option) =>
    option.label.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase()),
  ),
)
const active = computed(() => Boolean(props.value || props.end))
const invalid = computed(() => {
  if (props.kind === 'date')
    return Boolean(draft.value && endDraft.value && draft.value > endDraft.value)
  if (props.kind !== 'number') return false
  return invalidNumberRange(draft.value, endDraft.value, props.integer)
})
async function open() {
  draft.value = props.value
  endDraft.value = props.end
  search.value = ''
  await nextTick()
  input.value?.focus()
}
function close() {
  visible.value = false
  void nextTick(() => trigger.value?.ref?.focus())
}
function apply(clear = false) {
  if (!clear && invalid.value) return
  emit('apply', clear ? '' : draft.value.trim(), clear ? '' : endDraft.value.trim())
  close()
}
watch(
  () => props.context,
  () => {
    visible.value = false
  },
)
</script>

<template>
  <ElPopover
    v-model:visible="visible"
    trigger="click"
    placement="bottom-start"
    :width="300"
    popper-class="table-column-filter-popover"
    role="dialog"
    :aria-label="`${label}筛选`"
    :popper-options="{
      modifiers: [{ name: 'preventOverflow', options: { altAxis: true, padding: 8 } }],
    }"
    @show="open"
  >
    <template #reference>
      <ElButton
        ref="trigger"
        text
        class="table-column-filter"
        :class="{ 'is-filtered': active }"
        :aria-label="`筛选${label}`"
        :aria-expanded="visible"
        :title="active ? `${label}已筛选` : `筛选${label}`"
        @click.stop
      >
        {{ label }}<Filter aria-hidden="true" />
      </ElButton>
    </template>
    <form
      class="table-column-filter-form"
      :class="{ 'is-invalid': invalid }"
      @submit.prevent="apply()"
      @keydown.esc.stop.prevent="close"
    >
      <strong>{{ label }}</strong>
      <template v-if="kind === 'select'">
        <ElInput
          ref="input"
          v-model="search"
          :aria-label="`查找${label}选项`"
          clearable
          placeholder="查找选项"
        />
        <ElCheckboxGroup
          v-model="choices"
          class="table-column-filter-choices"
          :aria-label="`${label}选项`"
        >
          <ElCheckbox v-for="option in filteredOptions" :key="option.value" :value="option.value">{{
            option.label
          }}</ElCheckbox>
          <span v-if="!filteredOptions.length" class="column-filter-empty">没有匹配选项</span>
        </ElCheckboxGroup>
      </template>
      <div v-else-if="kind === 'date'" class="column-filter-range">
        <ElDatePicker
          :model-value="draft"
          @update:model-value="draft = $event || ''"
          type="date"
          value-format="YYYY-MM-DD"
          :teleported="false"
          clearable
          placeholder="开始日期"
          :aria-label="`${label}开始日期`"
        />
        <span>至</span>
        <ElDatePicker
          :model-value="endDraft"
          @update:model-value="endDraft = $event || ''"
          type="date"
          value-format="YYYY-MM-DD"
          :teleported="false"
          clearable
          placeholder="结束日期"
          :aria-label="`${label}结束日期`"
        />
      </div>
      <div v-else-if="kind === 'number'" class="column-filter-range">
        <ElInput
          ref="input"
          v-model="draft"
          inputmode="decimal"
          clearable
          placeholder="最小值"
          :aria-label="`${label}最小值`"
          :aria-invalid="invalid"
        />
        <span>至</span>
        <ElInput
          v-model="endDraft"
          inputmode="decimal"
          clearable
          placeholder="最大值"
          :aria-label="`${label}最大值`"
          :aria-invalid="invalid"
        />
      </div>
      <ElInput
        v-else
        ref="input"
        v-model="draft"
        :maxlength="160"
        clearable
        :placeholder="`输入${label}关键词`"
        :aria-label="`${label}筛选内容`"
      />
      <footer>
        <ElButton @click="apply(true)">清除</ElButton>
        <ElButton @click="close">取消</ElButton>
        <ElButton type="primary" native-type="submit" :disabled="invalid">筛选</ElButton>
      </footer>
    </form>
  </ElPopover>
</template>

<style>
.table-column-filter.el-button {
  height: 28px;
  max-width: 100%;
  padding: 2px 5px;
  margin: 0;
  font: inherit;
  color: inherit;
  vertical-align: middle;
}
.table-column-filter.el-button > span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.table-column-filter svg {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
  opacity: 0.5;
}
.table-column-filter.el-button.is-filtered {
  color: var(--primary);
  background: var(--glass-selected-fill);
  box-shadow:
    inset 0 0 0 1px var(--glass-interaction-edge),
    var(--glass-selected-shadow);
}
.table-column-filter.is-filtered svg,
.table-column-filter:hover svg {
  opacity: 1;
}
.table-column-filter-popover.el-popover {
  max-width: calc(100vw - 24px);
  padding: 16px;
}
.table-column-filter-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-size: 13px;
}
.table-column-filter-form > strong {
  color: var(--text);
  font-weight: 600;
}
.table-column-filter-choices {
  display: flex;
  flex-direction: column;
  max-height: 220px;
  overflow-y: auto;
}
.table-column-filter-choices .el-checkbox {
  margin: 0;
  height: 32px;
}
.column-filter-empty {
  color: var(--muted);
  padding: 8px 0;
}
.column-filter-range {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.column-filter-range > span {
  color: var(--muted);
  text-align: center;
}
.column-filter-range .el-date-editor {
  width: 100%;
}
.table-column-filter-form.is-invalid .el-input__wrapper {
  box-shadow: 0 0 0 1px var(--el-color-danger) inset;
}
.table-column-filter-form footer {
  display: flex;
  gap: 6px;
  padding-top: 8px;
  border-top: 1px solid var(--el-border-color-light);
}
.table-column-filter-form footer .el-button {
  margin: 0;
}
.table-column-filter-form footer .el-button:first-child {
  margin-right: auto;
}
</style>
