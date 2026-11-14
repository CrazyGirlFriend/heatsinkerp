<script setup lang="ts">
import { computed } from 'vue'
import { ElTableColumn } from 'element-plus'
import WorkspaceTable from './WorkspaceTable.vue'
import columns from '@/config/productionTemplateColumns.json'
import { productionRecordData, productionReportRows } from '@/utils/productionWorkbook'
import type { ProcessingRecord } from '@/types/materialProcessing'

const props = defineProps<{
  templateKey: string
  records: ProcessingRecord[]
  loading: boolean
  columnSettingsTarget?: HTMLElement | null
}>()
const fields = computed(() => columns[props.templateKey as keyof typeof columns] || [])
const rows = computed(() =>
  productionReportRows(props.templateKey, props.records.map(productionRecordData)),
)
</script>

<template>
  <WorkspaceTable
    :key="templateKey"
    :columns-key="`production-report-${templateKey}`"
    :column-settings-target="columnSettingsTarget"
    :data="rows"
    :loading="loading"
    empty-text="暂无日产登记"
    aria-label="日产登记"
  >
    <ElTableColumn
      v-for="field in fields"
      :key="field.key"
      :prop="field.key"
      :label="field.label"
      :min-width="field.label === '备注' ? 240 : field.label === '流水号' ? 160 : 125"
      :fixed="field.label === '日期' || field.label === '流水号'"
      show-overflow-tooltip
    >
      <template #default="{ row }">{{ row[field.key] ?? '' }}</template>
    </ElTableColumn>
  </WorkspaceTable>
</template>
