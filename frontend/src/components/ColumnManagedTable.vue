<script lang="ts">
import {
  cloneVNode,
  defineComponent,
  h,
  inject,
  ref,
  watch,
  type PropType,
  type Slots,
  type VNode,
} from 'vue'
import { ElTable } from 'element-plus'
import InventoryColumnSettings from './InventoryColumnSettings.vue'
import TableColumnFilter from './TableColumnFilter.vue'
import type { TableQueryController } from '@/types/tableQuery'
import type { InventoryColumnChoice } from '@/types/inventoryColumns'
import {
  nodeChildren,
  orderedTableColumns,
  projectNativeTable,
  tableColumnEntries,
  tableNodes,
  tableColumnScopeKey,
} from '@/utils/tableColumnLayout'

export default defineComponent({
  name: 'ColumnManagedTable',
  inheritAttrs: false,
  props: {
    native: Boolean,
    columnsKey: { type: String, default: '' },
    columnSettings: { type: Boolean, default: true },
    requiredColumns: { type: Array as PropType<string[]>, default: () => [] },
    columnQuery: { type: Object as PropType<TableQueryController>, default: undefined },
  },
  setup(props, { attrs, slots }) {
    const scope = inject(tableColumnScopeKey, ref(null))
    const choices = ref<InventoryColumnChoice<string>[]>([])
    watch(
      [scope, () => props.columnsKey],
      () => {
        choices.value = []
      },
      { flush: 'sync' },
    )
    return () => {
      const nodes = tableNodes(slots.default?.() || [])
      const engine = props.native ? 'table' : ElTable
      const renderTable = (content: VNode[]) =>
        props.native
          ? h(engine, attrs, content)
          : h(engine, attrs, { ...slots, default: () => content })
      if (!props.columnSettings && !props.columnQuery) return renderTable(nodes)
      const header = props.native
        ? nodeChildren(nodes.find((node) => node.type === 'thead') || h('thead'))
        : []
      const entries = tableColumnEntries(
        props.native ? nodeChildren(header[0] || h('tr')) : nodes,
        props.native,
        props.requiredColumns,
      )
      const options = entries
        .filter((entry) => !entry.pinned)
        .map(({ key, label, required }) => ({ key, label, required, defaultVisible: true }))
      if (!options.length && !props.columnQuery) return renderTable(nodes)
      const selected = props.columnSettings ? orderedTableColumns(entries, choices.value) : entries
      const renderControl = () =>
        h(
          'span',
          {
            class: 'table-column-settings',
            onClick: (event: Event) => event.stopPropagation(),
            onKeydown: (event: Event) => event.stopPropagation(),
          },
          [
            h(InventoryColumnSettings, {
              storageKey:
                props.columnsKey && scope.value !== null
                  ? `heatsink.table-columns.v1:${scope.value}:${props.columnsKey}`
                  : null,
              columns: options,
              initialChoices: choices.value,
              newVisibleKeys: options.map((option) => option.key),
              showTrigger: true,
              compact: true,
              minimumVisible: 1,
              choicesLabel: '表格显示列',
              description: '勾选显示列，上下移动调整顺序。必填项保留，固定列位置不变。',
              onChange: (value: InventoryColumnChoice<string>[]) => {
                choices.value = value
              },
            }),
          ],
        )
      if (props.native)
        return renderTable(projectNativeTable(nodes, entries, selected, renderControl()))
      const first = selected.findIndex((entry) => !entry.pinned)
      return renderTable(
        selected.map((entry, index) => {
          const node = cloneVNode(entry.node, { key: entry.key })
          node.patchFlag = 0
          const query = props.columnQuery
          const field =
            query?.columns[String(node.props?.prop || '')] || query?.columns[entry.label]
          if (field || (props.columnSettings && index === first)) {
            if (node.props?.width && Number(node.props.width) < 104) node.props.width = 104
            const cellSlots = node.children as Slots | null
            node.children = {
              ...cellSlots,
              _: undefined,
              header: (scope: unknown) =>
                h('span', { class: 'table-column-heading' }, [
                  field && query
                    ? h(TableColumnFilter, {
                        label: entry.label,
                        kind: field.kind || 'text',
                        options: field.options,
                        value:
                          query.state.filters.find((item) => item.field === field.field)?.value ||
                          '',
                        end:
                          query.state.filters.find((item) => item.field === field.field)?.end || '',
                        sortable: true,
                        sort:
                          query.state.sort?.field === field.field
                            ? query.state.sort.direction
                            : undefined,
                        onApply: (value: string, end: string) => query.filter(field, value, end),
                        onSort: (direction?: 'asc' | 'desc') => query.sort(field.field, direction),
                      })
                    : h(
                        'span',
                        { class: 'table-column-heading__label' },
                        cellSlots?.header?.(scope) || entry.label,
                      ),
                  props.columnSettings && index === first ? renderControl() : null,
                ]),
            }
            // A prop-only column originally has no slots; mark the new header as slot content.
            node.shapeFlag = (node.shapeFlag & ~(8 | 16)) | 32
          }
          return node
        }),
      )
    }
  },
})
</script>

<style>
.table-column-heading {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  vertical-align: middle;
}
.table-column-heading__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.table-column-settings {
  display: inline-flex;
  flex: 0 0 28px;
  margin-left: 4px;
  vertical-align: middle;
}
@media print {
  .table-column-settings {
    display: none;
  }
}
</style>
