<script setup lang="ts">
import { computed } from 'vue'

export interface DocumentField { label: string; value: string; key?: string; fullWidth?: boolean }
const props = defineProps<{ fields: DocumentField[]; label: string }>()
const rows = computed(() => {
  const result: DocumentField[][] = []
  for (const field of props.fields) {
    const last = result[result.length - 1]
    if (!field.fullWidth && last?.length === 1 && !last[0]!.fullWidth) last.push(field)
    else result.push([field])
  }
  return result
})
</script>

<template>
  <div class="document-table-container">
    <table class="document-table business-document-table" :aria-label="label">
      <colgroup><col class="field-label" /><col /><col class="field-label" /><col /></colgroup>
      <tbody><tr v-for="(row, index) in rows" :key="index">
        <template v-for="field in row" :key="field.key || field.label">
          <th scope="row">{{ field.label }}</th>
          <td :class="{ 'table-prose': field.fullWidth }" :colspan="row.length === 1 ? 3 : 1"><slot :name="field.key || field.label" :field="field">{{ field.value }}</slot></td>
        </template>
      </tr></tbody>
    </table>
  </div>
</template>

<style scoped>
.document-table-container { min-width: 0; container-type: inline-size; }
.document-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 15px; line-height: 1.65; color: var(--text); }
.field-label { width: 16%; }
.document-table th, .document-table td { border: 1px solid #cdd3dc; padding: 10px 12px; vertical-align: top; text-align: left; overflow-wrap: anywhere; white-space: pre-wrap; }
.document-table th { background: var(--table-header-bg); color: var(--text); font-weight: 500; }
@container (max-width: 540px) {
  .document-table colgroup { display: none; }
  .document-table tr { display: grid; grid-template-columns: 96px minmax(0, 1fr); }
  .document-table { border-top: 1px solid #cdd3dc; border-left: 1px solid #cdd3dc; }
  .document-table th, .document-table td { border-top: 0; border-left: 0; padding: 9px 10px; }
}
@media print {
  .document-table-container { container-type: normal; }
  .document-table { font-size: 9pt; color: #000; }
  .document-table th, .document-table td { padding: 1.5mm; border: .6pt solid #333; }
  .document-table th { background: #f1f1f1; color: #000; }
  .document-table tr { break-inside: avoid; }
}
</style>
