import {
  cloneVNode,
  Comment,
  createTextVNode,
  Fragment,
  isVNode,
  type VNode,
  type InjectionKey,
  type Ref,
} from 'vue'
import type { InventoryColumnChoice } from '@/types/inventoryColumns'

export const tableColumnScopeKey: InjectionKey<Readonly<Ref<string | number | null>>> =
  Symbol('table-column-scope')

// Only flatten structural fragments. Cell slots are deliberately left unevaluated.
export function tableNodes(nodes: VNode[]): VNode[] {
  return nodes.flatMap((node) =>
    node.type === Fragment
      ? tableNodes(node.children as VNode[])
      : node.type === Comment
        ? []
        : [node],
  )
}

export function nodeChildren(node: VNode): VNode[] {
  return Array.isArray(node.children) ? tableNodes(node.children.filter(isVNode)) : []
}

export function nodeText(node: VNode): string {
  return typeof node.children === 'string'
    ? node.children
    : nodeChildren(node).map(nodeText).join('')
}

export function withChildren(node: VNode, children: VNode[]): VNode {
  const copy = cloneVNode(node)
  copy.children = children
  // These children were reordered; Vue's original compiled block no longer describes them.
  Object.assign(copy, { dynamicChildren: null })
  copy.shapeFlag = (copy.shapeFlag & ~(8 | 32)) | 16
  copy.patchFlag = 0
  return copy
}

export interface TableColumnEntry {
  key: string
  label: string
  node: VNode
  index: number
  pinned: boolean
  required: boolean
}

export function tableColumnEntries(nodes: VNode[], native: boolean, required: readonly string[]) {
  const occurrences = new Map<string, number>()
  return nodes.map((node, index): TableColumnEntry => {
    const props = node.props || {}
    const label = String(native ? nodeText(node).trim() : props.label || '')
    const identity = String(
      props['column-key'] || props.columnKey || props.prop || node.key || label || index,
    )
    const occurrence = occurrences.get(identity) || 0
    occurrences.set(identity, occurrence + 1)
    return {
      key: `${identity}:${occurrence}`,
      label,
      node,
      index,
      pinned:
        !label ||
        !!props.fixed ||
        ['selection', 'expand', 'index'].includes(props.type) ||
        label === '操作',
      required: required.includes(label) || required.includes(identity),
    }
  })
}

export function orderedTableColumns(
  entries: TableColumnEntry[],
  choices: InventoryColumnChoice<string>[],
) {
  const configurable = entries.filter((entry) => !entry.pinned)
  const selected = choices.flatMap((choice) => {
    const entry = configurable.find((column) => column.key === choice.key)
    return entry && (choice.visible || entry.required) ? [entry] : []
  })
  selected.push(
    ...configurable.filter((entry) => !choices.some((choice) => choice.key === entry.key)),
  )
  // Keep at least one data column, including when old or manually edited preferences hide all.
  if (!selected.length && configurable[0]) selected.push(configurable[0])
  return [
    ...entries.filter(
      (entry) => entry.pinned && entry.label !== '操作' && entry.node.props?.fixed !== 'right',
    ),
    ...selected,
    ...entries.filter(
      (entry) => entry.pinned && (entry.label === '操作' || entry.node.props?.fixed === 'right'),
    ),
  ]
}

export function projectNativeTable(
  nodes: VNode[],
  entries: TableColumnEntry[],
  selected: TableColumnEntry[],
  control: VNode,
) {
  const headerIndex = selected.findIndex((entry) => !entry.pinned)
  return nodes.map((section) => {
    if (!['thead', 'tbody', 'tfoot', 'colgroup'].includes(String(section.type))) return section
    const project = (row: VNode, header = false) => {
      const cells = nodeChildren(row)
      if (cells.length === 1 && Number(cells[0]?.props?.colspan) > 1) {
        return withChildren(row, [cloneVNode(cells[0]!, { colspan: selected.length })])
      }
      const sourceCells = cells.flatMap((cell) =>
        Array.from({ length: Number(cell.props?.colspan) || 1 }, () => cell),
      )
      if (sourceCells.length !== entries.length) return row
      const projected: {
        source: VNode
        entry: TableColumnEntry
        position: number
        span: number
      }[] = []
      selected.forEach((entry, position) => {
        const source = sourceCells[entry.index]!
        const previous = projected.at(-1)
        if (previous?.source === source) previous.span += 1
        else projected.push({ source, entry, position, span: 1 })
      })
      return withChildren(
        row,
        projected.map(({ source, entry, position, span }) => {
          const cell = cloneVNode(source, {
            key: entry.key,
            'data-column-index': entry.index + 1,
            ...(source.props?.colspan ? { colspan: span } : {}),
          })
          return header && position === headerIndex
            ? withChildren(cell, [
                ...(typeof cell.children === 'string'
                  ? [createTextVNode(cell.children)]
                  : nodeChildren(cell)),
                control,
              ])
            : cell
        }),
      )
    }
    if (section.type === 'colgroup') return project(section)
    return withChildren(
      section,
      nodeChildren(section).map((row) => project(row, section.type === 'thead')),
    )
  })
}
