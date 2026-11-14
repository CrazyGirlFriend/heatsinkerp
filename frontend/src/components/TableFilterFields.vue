<script setup lang="ts">
import { computed } from 'vue'
import { ElOption } from 'element-plus'
import AppInput from './AppInput.vue'
import AppSelect from './AppSelect.vue'
import RecordDateFilter from './RecordDateFilter.vue'
import type { TableColumnCondition, TableQueryColumn } from '@/types/tableQuery'

const props = defineProps<{
  columns: Record<string, TableQueryColumn>
  exclude?: string[]
}>()
const model = defineModel<TableColumnCondition[]>({ required: true })
const fields = computed(() => {
  const seen = new Set(props.exclude)
  return Object.entries(props.columns).flatMap(([label, column]) => {
    if (seen.has(column.field)) return []
    seen.add(column.field)
    return [{ label, ...column }]
  })
})
const value = (field: string) => model.value.find((item) => item.field === field)
function update(column: TableQueryColumn, start: string, end = '') {
  model.value = [
    ...model.value.filter((item) => item.field !== column.field),
    ...(start || end
      ? [{ field: column.field, kind: column.kind || 'text', value: start, end }]
      : []),
  ]
}
</script>

<template>
  <div class="table-filter-fields">
    <label v-for="column in fields" :key="column.field">
      <span>{{ column.label }}</span>
      <RecordDateFilter
        v-if="column.kind === 'date'"
        :model-value="{
          from: value(column.field)?.value || '',
          to: value(column.field)?.end || '',
        }"
        :label="column.label"
        @update:model-value="update(column, $event.from, $event.to)"
      />
      <AppSelect
        v-else-if="column.kind === 'select'"
        :model-value="value(column.field)?.value.split(',').filter(Boolean) || []"
        multiple
        collapse-tags
        clearable
        placeholder="全部"
        :aria-label="`${column.label}筛选`"
        @update:model-value="update(column, String($event || ''))"
      >
        <ElOption v-for="option in column.options" :key="option.value" v-bind="option" />
      </AppSelect>
      <div v-else-if="column.kind === 'number'" class="table-filter-range">
        <AppInput
          :model-value="value(column.field)?.value || ''"
          inputmode="decimal"
          placeholder="最小值"
          :aria-label="`${column.label}最小值`"
          @update:model-value="update(column, String($event), value(column.field)?.end)"
        />
        <span>—</span>
        <AppInput
          :model-value="value(column.field)?.end || ''"
          inputmode="decimal"
          placeholder="最大值"
          :aria-label="`${column.label}最大值`"
          @update:model-value="update(column, value(column.field)?.value || '', String($event))"
        />
      </div>
      <AppInput
        v-else
        :model-value="value(column.field)?.value || ''"
        clearable
        placeholder="包含关键词"
        :aria-label="`${column.label}筛选`"
        @update:model-value="update(column, String($event))"
      />
    </label>
  </div>
</template>

<style scoped>
.table-filter-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  grid-column: 1 / -1;
}
.table-filter-fields > label {
  display: grid;
  gap: 8px;
  min-width: 0;
}
.table-filter-range {
  display: flex;
  align-items: center;
  gap: 8px;
}
@media (max-width: 520px) {
  .table-filter-fields {
    grid-template-columns: 1fr;
  }
}
</style>
