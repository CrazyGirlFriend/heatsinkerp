<script setup lang="ts">
import { computed } from 'vue'
import { ElInput } from 'element-plus'
import type { ProcessRoute, RouteMaterialField } from '@/types/processRoute'
const props = defineProps<{
  data: ProcessRoute['source_data']
  readonly: boolean
  disabled: boolean
}>()
const emit = defineEmits<{
  change: [key: string, value: string]
  source: [kind: 'word' | 'order']
}>()
const fields = computed(() =>
  Object.entries(props.data.receipt_fields || {}).filter(([key]) => key !== 'serial_no'),
)
function source(field: RouteMaterialField) {
  return field.source_kind === 'excel' ? '订单表' : '工艺单'
}
function warningLabel(warning: string) {
  if (warning.includes('未标明重量单位')) return '来料重量缺少单位'
  const label = warning.match(/“([^”]+)”/)?.[1]
  return label ? `${label}待确认` : '资料待确认'
}
</script>

<template>
  <section v-if="fields.length" class="route-materials" aria-label="工艺物料资料">
    <header>
      <strong>物料与订单资料</strong><span v-if="data.material_confirmation">已确认</span>
    </header>
    <table>
      <thead>
        <tr>
          <th>项目</th>
          <th>内容</th>
          <th>来源</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="[key, field] in fields"
          :key="key"
          :class="{ 'has-difference': field.alternative }"
        >
          <th scope="row">{{ field.label }}</th>
          <td>
            <span v-if="readonly">{{ field.value === '' ? '—' : field.value }}</span>
            <ElInput
              v-else
              :model-value="String(field.value)"
              :aria-label="`工艺资料：${field.label}`"
              :disabled="disabled"
              :type="String(field.value).length > 60 ? 'textarea' : 'text'"
              :autosize="{ minRows: 1, maxRows: 4 }"
              @update:model-value="emit('change', key, $event)"
            />
            <small v-if="field.alternative"
              >订单表：{{ field.alternative.value
              }}<template v-if="field.parsed_value === undefined"> · 已采用工艺单</template></small
            >
          </td>
          <td>
            <button
              type="button"
              :title="`${field.source_filename || ''} ${field.source_row}`"
              @click="emit('source', field.source_kind === 'excel' ? 'order' : 'word')"
            >
              {{ source(field) }} · 自动填入</button
            ><span
              v-if="
                field.parsed_value !== undefined &&
                String(field.parsed_value) !== String(field.value)
              "
              class="edited"
              >已修改</span
            >
          </td>
        </tr>
      </tbody>
    </table>
    <div v-if="data.field_warnings?.length" class="field-warnings">
      <button
        v-for="warning in data.field_warnings"
        :key="warning"
        type="button"
        class="field-warning"
        :title="warning"
        @click="emit('source', 'word')"
      >
        <span aria-hidden="true">!</span> {{ warningLabel(warning) }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.route-materials {
  margin-bottom: 18px;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 14px;
  color: #202522;
}
header > span {
  color: #28664f;
  font-size: 12px;
}
table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  background: #fff;
  font-size: 13px;
}
th,
td {
  border: 1px solid #dce2df;
  padding: 4px 9px;
  text-align: left;
  color: #242824;
  vertical-align: middle;
  font-weight: 400;
  overflow-wrap: anywhere;
}
thead th {
  background: #f2f5f3;
  color: #555f58;
}
th:first-child {
  width: 112px;
}
th:last-child {
  width: 140px;
}
tbody th {
  background: #fafbf9;
}
button {
  border: 0;
  background: none;
  padding: 0;
  font: inherit;
  font-size: 11px;
  color: #536859;
  cursor: pointer;
  text-align: left;
}
button:hover {
  text-decoration: underline;
}
small,
.edited {
  display: block;
  color: #93651e;
  font-size: 11px;
  margin-top: 4px;
}
.has-difference td:first-of-type {
  border-left: 2px solid #bb914d;
}
.field-warnings {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  margin-top: 8px;
}
.field-warning {
  font-size: 12px;
  color: #93651e;
}
.field-warning span {
  font-weight: 600;
}
.route-materials :deep(.el-input__wrapper) {
  min-height: 28px;
  padding: 0 8px;
}
.route-materials :deep(.el-input__inner) {
  height: 28px;
}
</style>
