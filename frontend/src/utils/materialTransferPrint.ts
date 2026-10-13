import {
  externalActionLabel,
  isExternalTransfer,
  isWeightOnlyType,
  materialDocumentTextFields,
  materialDocumentTitle,
  materialPurposeLabel,
  materialSourceLabel,
  materialSenderName,
  materialTransferStatusLabel,
  receiptSourceLabel,
  type MaterialTransfer,
} from '@/types/materialTransfer'
import { processingRoleLabels } from '@/types/materialProcessing'
import { formatAmount, formatDateTime } from './format'
import { sludgeFields } from './sludgeWeight'

export interface PrintField {
  label: string
  value: string
}
export interface TransferPrintBlock {
  key: string
  transfer: MaterialTransfer
  fields?: PrintField[]
  section?: string
}
export interface TransferPrintGroup {
  key: string
  items: MaterialTransfer[]
  blocks: TransferPrintBlock[]
}

export function transferPrintProfile(item: MaterialTransfer) {
  const kind = item.entry_kind || 'transfer',
    verb = externalActionLabel(kind)
  const profiles = {
    transfer: [
      '转出班组',
      '接收班组',
      '转料人',
      '转出留存联',
      '接收确认联',
      '转出方签字',
      '接收方签字',
    ],
    warehouse_receipt: [
      '入库来源',
      '入库库房',
      '登记人',
      '库房留存联',
      '入库凭证联',
      '登记人签字',
      '库房复核签字',
    ],
    opening_stock: [
      '入库来源',
      '登记班组',
      '登记人',
      '班组留存联',
      '初始库存登记联',
      '登记人签字',
      '班组复核签字',
    ],
    processing_output: [
      '加工来源',
      '加工班组',
      '加工登记人',
      '加工登记联',
      '班组留存联',
      '加工登记人签字',
      '班组复核签字',
    ],
    serial_reallocation: [
      '转投来源',
      '登记班组',
      '登记人',
      '转投留存联',
      '班组留存联',
      '登记人签字',
      '班组复核签字',
    ],
    warehouse_outbound: [
      `${verb}班组`,
      `${verb}去向`,
      '转料人',
      `${verb}留存联`,
      `${verb}凭证联`,
      '转料人签字',
      `${verb}确认人签字`,
    ],
    inspection_shipment: [
      `${verb}班组`,
      `${verb}去向`,
      '转料人',
      `${verb}留存联`,
      `${verb}凭证联`,
      '转料人签字',
      `${verb}确认人签字`,
    ],
  }
  const labels = profiles[kind]
  return {
    title: materialDocumentTitle(item),
    sourceLabel: labels[0]!,
    targetLabel: labels[1]!,
    senderLabel: labels[2]!,
    copies: labels.slice(3, 5),
    signatures: labels.slice(5),
    source: materialSourceLabel(item),
    target: isExternalTransfer(item) ? item.external_destination || '—' : item.next_team.name,
  }
}

// Small text fragments let long notes, including explicit newlines, continue
// across pages without clipping, shrinking the font, or dropping characters.
export function printTextParts(value: string): string[] {
  const parts: string[] = []
  let part = '',
    lines = 0,
    length = 0
  for (const char of value) {
    part += char
    length++
    if (char === '\n') lines++
    if (length >= 80 || lines >= 3) {
      parts.push(part)
      part = ''
      lines = 0
      length = 0
    }
  }
  if (part || !parts.length) parts.push(part)
  return parts
}

export function printMaterialValue(value?: string | null): string {
  return value && value.length > 24 ? '见下方明细' : value || '—'
}

function blocksFor(item: MaterialTransfer): TransferPrintBlock[] {
  const value = (v: unknown) => (v == null || v === '' ? '—' : String(v))
  const fields: (PrintField & { section?: string })[] = [
    { label: '上一批次', value: value(item.source_transfer_batch_no) },
    { label: '原单批号', value: value(item.source_batch_no) },
  ]
  if (!item.shared_unallocated)
    fields.push(
      { label: '客户代码', value: value(item.customer_code) },
      { label: '成品规格', value: value(item.finished_specification) },
      { label: '要求发货日期', value: value(item.delivery_date) },
      {
        label: '应发成品件数',
        value: item.delivery_quantity == null ? '—' : `${item.delivery_quantity} 件`,
      },
    )
  if (item.shared_origin_batch_no)
    fields.push({ label: '共投来源批次', value: item.shared_origin_batch_no })
  if (item.shared_unallocated) {
    fields.push({ label: '共投状态', value: '未分配；实物件数和重量仅计一份' })
    for (const member of item.shared_serials || []) {
      fields.push(
        ...[
          { label: '关联流水号', value: member.serial_no },
          { label: '客户代码', value: member.customer_code || '—' },
          { label: '成品规格', value: member.finished_specification || '—' },
          { label: '计划切割尺寸', value: member.planned_specification || '未登记' },
          {
            label: '计划用料重量',
            value: member.planned_weight == null ? '未登记' : `${member.planned_weight} kg`,
          },
          {
            label: '计划切出件数',
            value: member.planned_quantity == null ? '未登记' : `${member.planned_quantity} 件`,
          },
          { label: '要求发货日期', value: member.delivery_date || '—' },
          {
            label: '应发成品件数',
            value: member.delivery_quantity == null ? '—' : `${member.delivery_quantity} 件`,
          },
        ].map((field) => ({ ...field, section: `${item.batch_no}:shared:${member.serial_no}` })),
      )
    }
  }
  if (item.shared_group_id && !item.shared_unallocated) {
    const member = item.shared_serials?.find((member) => member.serial_no === item.serial_no)
    if (member)
      fields.push(
        {
          label: '计划用料重量',
          value: member.planned_weight == null ? '未登记' : `${member.planned_weight} kg`,
        },
        {
          label: '计划切出件数',
          value: member.planned_quantity == null ? '未登记' : `${member.planned_quantity} 件`,
        },
        { label: '计划切割尺寸', value: member.planned_specification || '未登记' },
      )
  }
  if (item.delivery_origin_batch_no)
    fields.push({ label: '交期源头批次', value: item.delivery_origin_batch_no })
  if (item.finished_quantity != null)
    fields.push({ label: '成品件数', value: `${item.finished_quantity} 件` })
  if (
    item.next_team.kind === 'warehouse' ||
    item.next_team.code === 'FACTORY-WAREHOUSE' ||
    item.warehouse_location
  )
    fields.push({ label: '入库仓位', value: value(item.warehouse_location) })
  if (item.processing_role)
    fields.push({ label: '加工类别', value: processingRoleLabels[item.processing_role] })
  if (item.source_serial_no) fields.push({ label: '原流水号', value: item.source_serial_no })
  if (item.entry_kind === 'warehouse_receipt')
    fields.push(
      { label: '入库来源类别', value: receiptSourceLabel(item) },
      { label: '原出库批次', value: value(item.return_dispatch_no) },
    )
  fields.push(...sludgeFields(item))
  if (item.material_type === 'sludge')
    fields.push({
      label: item.sludge_content_percent == null ? '历史账重' : '折算重量',
      value: `${item.weight} kg`,
    })
  for (const [label, content] of [
    ['材质', item.material_name],
    ['实际尺寸', item.transfer_specification],
    ['接收业务', materialPurposeLabel(item)],
  ] as const) {
    if (content && content.length > 24) fields.push({ label, value: content })
  }
  for (const field of materialDocumentTextFields) {
    if ((field.group === 'extra' || field.multiline) && item[field.key])
      fields.push({ label: field.label, value: item[field.key]! })
  }
  const internal = !item.entry_kind || item.entry_kind === 'transfer'
  const audit: PrintField[] = [
    {
      label: internal
        ? '转料时间'
        : item.entry_kind === 'processing_output'
          ? '加工时间'
          : '登记时间',
      value: formatDateTime(item.transferred_at),
    },
    { label: '状态', value: materialTransferStatusLabel(item.status, item.entry_kind) },
  ]
  if (isExternalTransfer(item))
    audit.push(
      {
        label: `${externalActionLabel(item.entry_kind)}确认人`,
        value: item.status === 'dispatched' ? item.dispatched_by || '未记录' : '',
      },
      {
        label: `${externalActionLabel(item.entry_kind)}确认时间`,
        value:
          item.status === 'dispatched'
            ? item.dispatched_at
              ? formatDateTime(item.dispatched_at)
              : '未记录'
            : '',
      },
    )
  if (item.notes)
    fields.push({
      label: internal
        ? '转料说明'
        : item.entry_kind === 'processing_output'
          ? '加工说明'
          : item.entry_kind === 'serial_reallocation'
            ? '转投原因'
            : item.entry_kind === 'warehouse_receipt'
              ? '入库说明'
              : '备注',
      value: item.notes,
    })
  const compactAudit = audit.length === 4 && audit.every((field) => field.value.length <= 24)
  if (!compactAudit) fields.push(...audit)
  const parts = fields.flatMap((field) =>
    printTextParts(field.value).map((part, index) => ({
      ...field,
      label: field.label + (index ? '（续）' : ''),
      value: part,
    })),
  )
  const details: TransferPrintBlock[] = []
  for (let index = 0; index < parts.length;) {
    const count = parts[index + 1] && parts[index]!.section === parts[index + 1]!.section ? 2 : 1
    details.push({
      key: `${item.batch_no}:fields:${index}`,
      transfer: item,
      section: parts[index]!.section,
      fields: parts.slice(index, index + count).map(({ label, value }) => ({ label, value })),
    })
    index += count
  }
  return [
    { key: `${item.batch_no}:material`, transfer: item },
    ...details,
    ...(compactAudit ? [{ key: `${item.batch_no}:audit`, transfer: item, fields: audit }] : []),
  ]
}

export function groupTransferPrintItems(items: MaterialTransfer[]): TransferPrintGroup[] {
  const groups = new Map<string, TransferPrintGroup>(),
    seen = new Set<string>()
  for (const item of items) {
    if (seen.has(item.batch_no)) continue
    seen.add(item.batch_no)
    const profile = transferPrintProfile(item)
    const key = JSON.stringify([
      item.entry_kind || 'transfer',
      item.source_team.id,
      profile.source,
      item.next_team.id,
      profile.target,
      item.sent_employee_id ?? null,
      materialSenderName(item),
      formatDateTime(item.transferred_at).slice(0, 10),
    ])
    if (!groups.has(key)) groups.set(key, { key, items: [], blocks: [] })
    groups.get(key)!.items.push(item)
    groups.get(key)!.blocks.push(...blocksFor(item))
  }
  return [...groups.values()]
}

export function transferPrintTotals(items: MaterialTransfer[]) {
  const active = items.filter((item) => item.status !== 'voided'),
    countable = active.filter((item) => !isWeightOnlyType(item.material_type))
  return {
    batches: active.length,
    quantity: countable.length
      ? countable.reduce((sum, item) => sum + item.quantity, 0).toLocaleString('zh-CN')
      : '—',
    weight: formatAmount(
      active.reduce((sum, item) => sum + Math.round(item.weight * 1e6), 0) / 1e6,
    ),
    sludge: active.some((item) => item.material_type === 'sludge'),
  }
}

export function paginateTransferBlocks(
  blocks: TransferPrintBlock[],
  heights: number[],
  capacity: number,
): TransferPrintBlock[][] {
  const pages: TransferPrintBlock[][] = [],
    material = new Map(
      blocks.filter((block) => !block.fields).map((block) => [block.transfer.batch_no, block]),
    )
  const sizes = new Map(blocks.map((block, index) => [block.key, heights[index] || 0]))
  const sections = new Map<string, TransferPrintBlock[]>()
  for (const block of blocks)
    if (block.section) sections.set(block.section, [...(sections.get(block.section) || []), block])
  let page: TransferPrintBlock[] = [],
    used = 0
  for (const [index, block] of blocks.entries()) {
    const height = sizes.get(block.key)!
    const section = block.section ? sections.get(block.section) : undefined
    if (section?.[0] === block && page.length) {
      const sectionHeight = section.reduce((sum, row) => sum + sizes.get(row.key)!, 0)
      const contextHeight = sizes.get(material.get(block.transfer.batch_no)!.key)!
      if (sectionHeight + contextHeight <= capacity && used + sectionHeight > capacity) {
        pages.push(page)
        page = []
        used = 0
      }
    }
    if (!block.fields && page.length) {
      let batchHeight = height
      for (let next = index + 1; next < blocks.length && blocks[next]!.fields; next++)
        batchHeight += sizes.get(blocks[next]!.key)!
      if (batchHeight <= capacity && used + batchHeight > capacity) {
        pages.push(page)
        page = []
        used = 0
      }
    }
    if (page.length && used + height > capacity) {
      pages.push(page)
      page = []
      used = 0
    }
    if (!page.length && block.fields) {
      const context = material.get(block.transfer.batch_no)!
      page.push(context)
      used += sizes.get(context.key)!
      // A long plan may span pages; repeat its serial number beside the batch barcode.
      if (section?.[0] && section[0] !== block) {
        page.push(section[0])
        used += sizes.get(section[0].key)!
      }
    }
    if (used + height > capacity)
      throw new Error('打印内容超出纸张范围，请检查过长的流水号或单据字段')
    page.push(block)
    used += height
  }
  if (page.length) pages.push(page)
  return pages
}
