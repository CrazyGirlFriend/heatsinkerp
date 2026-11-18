<script lang="ts">
import {
  cloneVNode,
  defineComponent,
  h,
  inject,
  onMounted,
  onUpdated,
  ref,
  Teleport,
  watch,
  type PropType,
  type Slots,
  type VNode,
} from 'vue'
import { ElTable } from 'element-plus'
import InventoryColumnSettings from './InventoryColumnSettings.vue'
import TableColumnFilter from './TableColumnFilter.vue'
import { useNativeTableFreeze } from '@/composables/useNativeTableFreeze'
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
    columnSettingsTarget: { type: Object as PropType<HTMLElement | null>, default: null },
    requiredColumns: { type: Array as PropType<string[]>, default: () => [] },
    columnQuery: { type: Object as PropType<TableQueryController>, default: undefined },
    fixedColumns: { type: Array as PropType<string[] | null>, default: undefined },
  },
  emits: ['fixedOptionsChange'],
  setup(props, { attrs, slots, emit }) {
    const scope = inject(tableColumnScopeKey, ref(null))
    const nativeTable = useNativeTableFreeze()
    const choices = ref<InventoryColumnChoice<string>[]>([])
    const fixedColumns = ref<string[] | null>(null)
    let fixedOptions: { key: string; label: string }[] = []
    let publishedOptions = ''
    const publishFixedOptions = () => {
      const signature = JSON.stringify(fixedOptions)
      if (signature !== publishedOptions) {
        publishedOptions = signature
        emit('fixedOptionsChange', fixedOptions)
      }
    }
    onMounted(publishFixedOptions)
    onUpdated(publishFixedOptions)
    watch(
      [scope, () => props.columnsKey],
      () => {
        choices.value = []
        fixedColumns.value = null
      },
      { flush: 'sync' },
    )
    return () => {
      const nodes = tableNodes(slots.default?.() || []).map((node) => {
        if (props.native || node.props?.label !== '操作') return node
        return cloneVNode(node, {
          'class-name': [node.props['class-name'] || node.props.className, 'table-action-column']
            .filter(Boolean)
            .join(' '),
          'show-overflow-tooltip': false,
        })
      })
      const engine = props.native ? 'table' : ElTable
      const renderTable = (content: VNode[]) =>
        props.native
          ? h(
              engine,
              { ...attrs, ref: nativeTable, class: [attrs.class, 'column-managed-native'] },
              content,
            )
          : h(engine, attrs, { ...slots, default: () => content })
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
      fixedOptions = entries
        .filter(
          (entry) =>
            entry.label && !['selection', 'expand', 'index'].includes(entry.node.props?.type),
        )
        .map(({ key, label }) => ({ key, label }))
      let selected = props.columnSettings ? orderedTableColumns(entries, choices.value) : entries
      // Saved table preferences replace legacy fixed props declared by individual pages.
      const fixed = props.fixedColumns === undefined ? fixedColumns.value : props.fixedColumns
      const firstData = selected.find(
        (entry) =>
          fixedOptions.some((option) => option.key === entry.key) && entry.label !== '操作',
      )
      const fixedKeys = new Set(
        (fixed ?? (firstData ? [firstData.key] : [])).filter((key) =>
          selected.some((entry) => entry.key === key),
        ),
      )
      if (props.native) {
        selected = [
          ...selected.filter((entry) => fixedKeys.has(entry.key)),
          ...selected.filter((entry) => !fixedKeys.has(entry.key)),
        ]
      }
      if (props.native && !entries.length) return renderTable(nodes)
      const renderControl = () => {
        const control = h(
          'span',
          {
            class: props.columnSettingsTarget
              ? 'table-column-settings--toolbar'
              : 'table-column-settings',
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
              fixedColumnOptions: fixedOptions,
              initialFixedColumns: fixedColumns.value,
              newVisibleKeys: options.map((option) => option.key),
              showTrigger: true,
              compact: !props.columnSettingsTarget,
              minimumVisible: 1,
              choicesLabel: '表格显示列',
              description: '勾选显示列，上下移动调整顺序。表头固定，固定列可自行选择。',
              onChange: (value: InventoryColumnChoice<string>[]) => {
                choices.value = value
              },
              onFixedChange: (value: string[] | null) => {
                fixedColumns.value = value
              },
            }),
          ],
        )
        return props.columnSettingsTarget
          ? h(Teleport, { to: props.columnSettingsTarget }, control)
          : control
      }
      if (props.native)
        return renderTable(
          projectNativeTable(
            nodes,
            entries,
            selected,
            props.columnSettings && options.length ? renderControl() : null,
            fixedKeys,
          ),
        )
      const first = selected.findIndex((entry) => !entry.pinned)
      return renderTable(
        selected.map((entry, index) => {
          const node = cloneVNode(entry.node, {
            key: entry.key,
            align: 'center',
            headerAlign: 'center',
            fixed:
              fixedKeys.has(entry.key) ||
              (fixedKeys.size > 0 &&
                ['selection', 'expand', 'index'].includes(entry.node.props?.type))
                ? 'left'
                : false,
          })
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
              header: (scope: unknown) => {
                // Element Plus retains column slots; read the current query when rendering them.
                const query = props.columnQuery
                return h('span', { class: 'table-column-heading' }, [
                  field && query
                    ? h(TableColumnFilter, {
                        label: entry.label,
                        kind: field.kind || 'text',
                        options: field.options,
                        valueLabel: field.valueLabel,
                        condition: query.state.filters.find((item) => item.field === field.field),
                        loadOptions: query.loadOptions
                          ? (search: string, offset: number) =>
                              query.loadOptions!(field, search, offset)
                          : undefined,
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
                        onApply: (
                          value: string,
                          end: string,
                          details?: import('@/types/tableQuery').TableFilterDetails,
                        ) => query.filter(field, value, end, details),
                        onSort: (direction?: 'asc' | 'desc') => query.sort(field.field, direction),
                      })
                    : h(
                        'span',
                        { class: 'table-column-heading__label' },
                        cellSlots?.header?.(scope) || entry.label,
                      ),
                  props.columnSettings && index === first ? renderControl() : null,
                ])
              },
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
@media screen {
  table.column-managed-native > :is(thead, tbody, tfoot) > tr > :is(th, td) {
    text-align: center;
    vertical-align: middle;
  }
  .column-managed-native > thead {
    position: sticky;
    top: 0;
    z-index: 3;
    background: var(--el-table-header-bg-color, var(--wm-muted-surface, #fafafa));
  }
  .column-managed-native > :is(thead, tbody, tfoot) > tr > [data-fixed-column] {
    position: sticky;
    left: var(--fixed-column-left, 0px);
    z-index: 1;
    background: var(--el-bg-color, var(--wm-bg, #fff));
  }
  .column-managed-native > thead > tr > [data-fixed-column] {
    background: var(--el-table-header-bg-color, var(--wm-muted-surface, #fafafa));
  }
}
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
.table-column-settings--toolbar {
  display: inline-flex;
  align-items: center;
}
/* Keep complete actions visible, including lists that render their own button group. */
.el-table td.table-action-column > .cell,
.el-table td.table-action-column > .cell > div:not(.el-dropdown) {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 4px 8px;
  white-space: normal;
}
.el-table td.table-action-column > .cell > div:not(.el-dropdown) {
  max-width: 100%;
  min-width: 0;
}
.el-table td.table-action-column .el-button {
  flex: 0 0 auto;
  margin-inline: 0;
}
@media print {
  .table-column-settings,
  .table-column-settings--toolbar {
    display: none;
  }
}
</style>
