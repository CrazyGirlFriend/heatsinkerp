<script setup lang="ts">
import ElDatePicker from '@/components/AppDatePicker.vue'
import ElInput from '@/components/AppInput.vue'
import AppPopover from '@/components/AppPopover.vue'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { Filter } from '@element-plus/icons-vue'
import type {
  TableColumnCondition,
  TableQueryColumn,
  TableFilterDetails,
  TableOptionPage,
} from '@/types/tableQuery'
import { invalidNumberRange } from '@/utils/numberFilterRange'
import { ElCheckbox, ElCheckboxGroup } from 'element-plus'
import ElButton from '@/components/AppButton.vue'

const props = withDefaults(
  defineProps<{
    label: string
    editor?: TableQueryColumn['editor']
    kind?: 'text' | 'select' | 'number' | 'date'
    value?: string
    end?: string
    options?: readonly { value: string; label: string }[]
    valueLabel?: (value: string | null) => string
    integer?: boolean
    context?: string
    sortable?: boolean
    sort?: 'asc' | 'desc'
    condition?: TableColumnCondition
    loadOptions?: (search: string, offset: number) => Promise<TableOptionPage>
  }>(),
  { kind: 'text', value: '', end: '', options: () => [] },
)
const emit = defineEmits<{
  apply: [value: string, end: string, details?: TableFilterDetails]
  sort: [direction?: 'asc' | 'desc']
}>()
const visible = ref(false),
  draft = ref(''),
  endDraft = ref(''),
  search = ref('')
const form = ref<HTMLFormElement>()
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
const mode = ref<'values' | 'condition'>('condition')
const operator = ref<TableColumnCondition['operator']>()
const values = ref<(string | null)[]>([]),
  exceptions = ref<(string | null)[]>([])
const allSelected = ref(true),
  loading = ref(false),
  optionError = ref(''),
  hasMore = ref(false)
const initialChoices = ref<(string | null)[]>([])
const pagedChoices = ref(false)
const choiceSearchVisible = computed(() => pagedChoices.value || initialChoices.value.length > 8)
const displayedValues = computed(() => {
  const term = search.value.trim().toLowerCase()
  if (props.editor !== 'choices' || !term) return values.value
  // Match formatted labels too, e.g. a null schedule batch displays as 未关联排期.
  const labeled = initialChoices.value.filter((value) =>
    optionLabel(value).toLowerCase().includes(term),
  )
  return pagedChoices.value ? [...new Set([...labeled, ...values.value])] : labeled
})
const nextOffset = ref(0),
  period = ref<'date' | 'month' | 'year'>('date')
let request = 0,
  timer: ReturnType<typeof setTimeout> | undefined
const operators = computed(() => [
  ...(props.kind === 'number' || props.kind === 'date'
    ? [
        ['between', '介于'],
        ['eq', '等于'],
        ['ne', '不等于'],
        ['gt', '大于'],
        ['gte', '大于或等于'],
        ['lt', '小于'],
        ['lte', '小于或等于'],
      ]
    : [
        ['contains', '包含'],
        ['not_contains', '不包含'],
        ['eq', '等于'],
        ['ne', '不等于'],
        ['starts_with', '开头是'],
        ['ends_with', '结尾是'],
      ]),
  ['blank', '空白'],
  ['not_blank', '非空白'],
])
const noInput = computed(() => ['blank', 'not_blank'].includes(operator.value || ''))
const isRange = computed(() => !operator.value || operator.value === 'between')
const active = computed(() =>
  Boolean(props.value || props.end || props.sort || props.condition?.operator),
)
function optionLabel(value: string | null) {
  if (props.valueLabel) return props.valueLabel(value)
  return value === null
    ? '(空白)'
    : props.options.find((option) => option.value === value)?.label || value
}
function checked(value: string | null) {
  return allSelected.value ? !exceptions.value.includes(value) : exceptions.value.includes(value)
}
function toggle(value: string | null) {
  exceptions.value = exceptions.value.includes(value)
    ? exceptions.value.filter((item) => item !== value)
    : [...exceptions.value, value]
}
function changePeriod() {
  draft.value = ''
  endDraft.value = ''
  operator.value = 'between'
}
function selectAll(selected: boolean) {
  allSelected.value = selected
  exceptions.value = []
}
async function loadMore(reset = false) {
  if (!props.loadOptions) return
  const current = ++request
  loading.value = true
  optionError.value = ''
  if (reset) {
    values.value = []
    nextOffset.value = 0
    hasMore.value = false
  }
  try {
    const result = await props.loadOptions(search.value.trim(), nextOffset.value)
    if (current !== request || !visible.value) return
    values.value = [...new Set([...values.value, ...result.values])]
    nextOffset.value = result.next_offset
    hasMore.value = result.has_more
    if (props.editor === 'choices' && reset && !search.value.trim()) {
      initialChoices.value = values.value
      pagedChoices.value = result.has_more
    }
  } catch (error) {
    if (current === request)
      optionError.value = error instanceof Error ? error.message : '选项加载失败'
  } finally {
    if (current === request) loading.value = false
  }
}
watch(search, () => {
  if (
    !props.loadOptions ||
    !visible.value ||
    props.editor === 'input' ||
    (props.editor === 'choices' && !pagedChoices.value)
  )
    return
  clearTimeout(timer)
  ++request
  if (props.editor === 'choices') {
    values.value = []
    loading.value = true
  }
  timer = setTimeout(() => void loadMore(true), 250)
})
onBeforeUnmount(() => {
  ++request
  clearTimeout(timer)
})
const invalid = computed(() => {
  if (mode.value === 'values' || noInput.value) return false
  if (props.kind === 'date')
    return Boolean(isRange.value && draft.value && endDraft.value && draft.value > endDraft.value)
  if (props.kind !== 'number') return false
  return invalidNumberRange(draft.value, isRange.value ? endDraft.value : '', props.integer)
})
// An older bookmark may contain an operator the compact editor cannot express.
const legacyCondition = computed(() => {
  const op = props.condition?.operator
  if (!props.editor || !props.condition) return false
  if (props.editor === 'choices')
    return op !== 'in' && op !== 'not_in' && !(props.kind === 'select' && !op)
  return !!op && op !== (props.kind === 'text' ? 'contains' : 'between')
})
async function open() {
  draft.value = props.condition?.value ?? props.value
  endDraft.value = props.condition?.end ?? props.end
  search.value = ''
  period.value = 'date'
  const op = props.condition?.operator
  const valueList = op === 'in' || op === 'not_in'
  operator.value = props.editor || valueList ? undefined : op
  if (props.editor) {
    mode.value = props.editor === 'choices' ? 'values' : 'condition'
    if (legacyCondition.value) {
      draft.value = ''
      endDraft.value = ''
    }
  } else {
    mode.value =
      valueList || (props.loadOptions && !op && !props.value && !props.end) ? 'values' : 'condition'
  }
  allSelected.value = valueList ? op === 'not_in' : props.editor !== 'choices'
  exceptions.value = valueList
    ? [...(props.condition?.values || [])]
    : props.editor === 'choices' && draft.value
      ? draft.value.split(',')
      : []
  initialChoices.value = []
  pagedChoices.value = false
  clearTimeout(timer)
  if (props.loadOptions && props.editor !== 'input') void loadMore(true)
  await nextTick()
  if (input.value) input.value.focus()
  else if (props.editor) form.value?.focus({ preventScroll: true })
}
function close() {
  visible.value = false
  ++request
  clearTimeout(timer)
  void nextTick(() => trigger.value?.ref?.focus())
}
function chooseSort(direction?: 'asc' | 'desc') {
  emit('sort', direction)
  close()
}
function apply(clear = false) {
  if (!clear && invalid.value) return
  if (
    !clear &&
    legacyCondition.value &&
    !draft.value &&
    !endDraft.value &&
    (props.editor !== 'choices' || !exceptions.value.length)
  ) {
    close()
    return
  }
  if (clear) emit('apply', '', '')
  else if (props.loadOptions && mode.value === 'values') {
    if (optionError.value || loading.value) return
    if ((allSelected.value || props.editor === 'choices') && !exceptions.value.length)
      emit('apply', '', '')
    else
      emit('apply', '', '', {
        operator: allSelected.value ? 'not_in' : 'in',
        values: exceptions.value,
      })
  } else if (noInput.value) emit('apply', '', '', { operator: operator.value })
  else if (props.kind === 'date' && period.value !== 'date' && draft.value) {
    const year = Number(draft.value.slice(0, 4)),
      month = period.value === 'year' ? 1 : Number(draft.value.slice(5, 7))
    const end = new Date(year, period.value === 'year' ? 12 : month, 0)
    const startText = `${year}-${String(month).padStart(2, '0')}-01`
    const endText = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`
    emit('apply', startText, endText, { operator: 'between' })
  } else if (operator.value)
    emit('apply', draft.value.trim(), isRange.value ? endDraft.value.trim() : '', {
      operator: operator.value,
    })
  else emit('apply', draft.value.trim(), endDraft.value.trim())
  close()
}
watch(visible, (value) => {
  if (value) void open()
})
watch(
  () => props.context,
  () => {
    close()
  },
)
</script>

<template>
  <AppPopover
    v-model:visible="visible"
    trigger="click"
    placement="bottom-start"
    :width="editor === 'input' && kind === 'text' ? 252 : 300"
    popper-class="table-column-filter-popover"
    role="dialog"
    :aria-label="`${label}筛选`"
    :popper-options="{
      modifiers: [{ name: 'preventOverflow', options: { altAxis: true, padding: 8 } }],
    }"
  >
    <template #reference>
      <ElButton
        ref="trigger"
        text
        class="table-column-filter"
        :class="{ 'is-filtered': active }"
        :aria-label="`筛选${label}`"
        :aria-expanded="visible"
        :title="sortable ? `${label}：筛选或排序` : `筛选${label}`"
        @click.stop
      >
        {{ label }}<span v-if="sort" aria-hidden="true">{{ sort === 'asc' ? '↑' : '↓' }}</span
        ><Filter aria-hidden="true" />
      </ElButton>
    </template>
    <form
      ref="form"
      :tabindex="editor ? -1 : undefined"
      class="table-column-filter-form"
      :class="{ 'is-invalid': invalid, 'column-filter-compact': !!editor }"
      @submit.prevent="apply()"
      @keydown.esc.stop.prevent="close"
    >
      <strong>{{ label }}</strong>
      <span v-if="legacyCondition" class="column-filter-empty">已有筛选，可重新填写或清除本列</span>
      <div v-if="sortable" class="column-filter-sort" aria-label="排序方式">
        <ElButton :type="sort === 'asc' ? 'primary' : 'default'" @click="chooseSort('asc')"
          >升序 ↑</ElButton
        >
        <ElButton :type="sort === 'desc' ? 'primary' : 'default'" @click="chooseSort('desc')"
          >降序 ↓</ElButton
        >
        <ElButton v-if="sort" @click="chooseSort()">默认</ElButton>
      </div>
      <div v-if="loadOptions && !editor" class="column-filter-modes" aria-label="筛选方式">
        <ElButton :type="mode === 'values' ? 'primary' : 'default'" @click="mode = 'values'"
          >按值选择</ElButton
        >
        <ElButton :type="mode === 'condition' ? 'primary' : 'default'" @click="mode = 'condition'"
          >条件筛选</ElButton
        >
      </div>
      <template v-if="loadOptions && mode === 'values'">
        <ElInput
          v-if="!editor || choiceSearchVisible"
          ref="input"
          v-model="search"
          :aria-label="`查找${label}选项`"
          clearable
          placeholder="查找选项"
        />
        <div v-if="!editor" class="column-filter-selection">
          <ElButton text @click="selectAll(true)">全选</ElButton>
          <ElButton text @click="selectAll(false)">取消全选</ElButton>
        </div>
        <div class="table-column-filter-choices" :aria-label="`${label}选项`">
          <ElCheckbox
            v-for="value in displayedValues"
            :key="value === null ? 'blank' : `value:${value}`"
            :model-value="checked(value)"
            @change="toggle(value)"
            >{{ optionLabel(value) }}</ElCheckbox
          >
          <span v-if="loading" role="status">正在读取选项…</span>
          <span v-else-if="!displayedValues.length && !optionError" class="column-filter-empty"
            >没有匹配选项</span
          >
          <div v-if="optionError" role="alert">
            {{ optionError }} <ElButton text @click="loadMore(true)">重试</ElButton>
          </div>
          <ElButton v-else-if="hasMore" :loading="loading" @click="loadMore()">加载更多</ElButton>
        </div>
      </template>
      <template v-else>
        <select
          v-if="!editor"
          v-model="operator"
          :aria-label="`${label}筛选条件`"
          class="column-filter-operator"
        >
          <option :value="undefined">
            {{
              kind === 'number' || kind === 'date' ? '介于' : kind === 'select' ? '选择值' : '包含'
            }}
          </option>
          <option v-for="item in operators" :key="item[0]" :value="item[0]">{{ item[1] }}</option>
        </select>
        <template v-if="!noInput">
          <template v-if="kind === 'select' && !operator">
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
              <ElCheckbox
                v-for="option in filteredOptions"
                :key="option.value"
                :value="option.value"
                >{{ option.label }}</ElCheckbox
              >
              <span v-if="!filteredOptions.length" class="column-filter-empty">没有匹配选项</span>
            </ElCheckboxGroup>
          </template>
          <template v-else-if="kind === 'date'">
            <select
              v-if="!editor"
              v-model="period"
              aria-label="日期选择方式"
              class="column-filter-operator"
              @change="changePeriod"
            >
              <option value="date">按日</option>
              <option value="month">按月</option>
              <option value="year">按年</option>
            </select>
            <div class="column-filter-range">
              <ElDatePicker
                :model-value="draft"
                @update:model-value="draft = $event || ''"
                :type="period"
                value-format="YYYY-MM-DD"
                :teleported="false"
                clearable
                placeholder="开始日期"
                :aria-label="`${label}开始日期`"
              />
              <span v-if="isRange && period === 'date'">至</span>
              <ElDatePicker
                v-if="isRange && period === 'date'"
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
          </template>
          <div
            v-else-if="kind === 'number'"
            class="column-filter-range"
            :class="{ 'column-filter-bounds': editor }"
          >
            <ElInput
              ref="input"
              v-model="draft"
              :inputmode="integer ? 'numeric' : 'decimal'"
              clearable
              :placeholder="editor ? '最少' : '最小值'"
              :aria-label="`${label}最小值`"
              :aria-invalid="invalid"
            />
            <span v-if="isRange">至</span>
            <ElInput
              v-if="isRange"
              v-model="endDraft"
              :inputmode="integer ? 'numeric' : 'decimal'"
              clearable
              :placeholder="editor ? '最多' : '最大值'"
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
        </template>
      </template>
      <footer>
        <ElButton v-if="!editor || active" :text="!!editor" @click="apply(true)">{{
          editor ? '清除本列' : '清除'
        }}</ElButton>
        <ElButton v-if="!editor" @click="close">取消</ElButton>
        <ElButton
          type="primary"
          native-type="submit"
          :disabled="invalid || (loadOptions && mode === 'values' && (loading || !!optionError))"
          >{{ editor ? '确定' : '筛选' }}</ElButton
        >
      </footer>
    </form>
  </AppPopover>
</template>

<style>
.table-column-filter.el-button {
  height: 28px;
  max-width: 100%;
  margin: 0;
  font: inherit;
  color: inherit;
  vertical-align: middle;
}
.table-column-filter.el-button.is-text:not(.is-link) {
  min-height: 28px;
  padding: 2px 0;
  border: 0;
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
  font-size: var(--font-size-label);
}
.table-column-filter-form > strong {
  color: var(--text);
  font-weight: var(--font-weight-semibold);
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
.column-filter-sort {
  display: flex;
  gap: 6px;
}
.column-filter-sort .el-button {
  margin: 0;
}
.column-filter-bounds {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
}
.column-filter-compact:focus {
  outline: none;
}
.column-filter-compact footer {
  justify-content: flex-end;
}
.table-column-filter-form.column-filter-compact footer .el-button:only-child {
  margin: 0;
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

<style scoped>
.column-filter-modes,
.column-filter-selection {
  display: flex;
  gap: 8px;
}
.column-filter-operator {
  width: 100%;
  min-height: 34px;
  padding: 4px 8px;
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-compact);
  background: var(--el-bg-color);
  color: var(--el-text-color-primary);
}
.table-column-filter-choices .el-checkbox {
  flex-shrink: 0;
}
</style>
