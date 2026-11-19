<script lang="ts">
import { computed, defineComponent, h, type PropType, type VNode } from 'vue'
import { ElTableColumn } from 'element-plus'
import WorkspaceTable from './WorkspaceTable.vue'
import sheets from '@/config/productionTemplateColumns.json'
import {
  productionRecordData,
  productionReportRows,
  productionReportTitle,
} from '@/utils/productionWorkbook'
import type { ProcessingRecord } from '@/types/materialProcessing'

type Header = { key: string; label: string } & ({ widthPx: number } | { children: Header[] })

function headerColumn(header: Header): VNode {
  const props = { key: header.key, label: header.label, align: 'center' as const }
  if ('children' in header) {
    return h(ElTableColumn, props, { default: () => header.children.map(headerColumn) })
  }
  return h(ElTableColumn, {
    ...props,
    prop: header.key,
    width: header.widthPx,
    showOverflowTooltip: true,
  })
}

export default defineComponent({
  props: {
    templateKey: { type: String, required: true },
    records: { type: Array as PropType<ProcessingRecord[]>, required: true },
    loading: Boolean,
  },
  setup(props) {
    const rows = computed(() =>
      productionReportRows(props.templateKey, props.records.map(productionRecordData)),
    )
    return () => {
      const sheet = sheets[props.templateKey as keyof typeof sheets]
      if (!sheet) return null
      const columns = () => sheet.columns.map(headerColumn)
      const title = productionReportTitle(
        sheet.title,
        props.records.map((row) => row.processing_date),
      )
      return h(
        WorkspaceTable,
        {
          key: props.templateKey,
          data: rows.value,
          loading: props.loading,
          columnSettings: false,
          fixedColumns: [],
          fit: false,
          class: 'production-report-table',
          emptyText: '暂无日产登记',
          'aria-label': '日产登记',
        },
        {
          default: () =>
            title
              ? [h(ElTableColumn, { label: title, align: 'center' }, { default: columns })]
              : columns(),
        },
      )
    }
  },
})
</script>

<style scoped>
.production-report-table.el-table :deep(.el-table__header-wrapper th.el-table__cell .cell) {
  padding-inline: 4px;
  white-space: normal;
  overflow-wrap: anywhere;
}
</style>
