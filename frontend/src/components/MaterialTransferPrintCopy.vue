<script setup lang="ts">
import { computed } from 'vue'
import BarcodeCard from './BarcodeCard.vue'
import { isWeightOnlyType, materialPurposeLabel, materialTypeLabel } from '@/types/materialTransfer'
import {
  printMaterialValue,
  transferPrintProfile,
  transferPrintTotals,
  type TransferPrintBlock,
  type TransferPrintGroup,
} from '@/utils/materialTransferPrint'
import { formatDateTime } from '@/utils/format'
const props = defineProps<{
  group: TransferPrintGroup
  blocks: TransferPrintBlock[]
  copyName: string
  pageNumber: number
  pageCount: number
}>()
const profile = computed(() => transferPrintProfile(props.group.items[0]!))
const totals = computed(() => transferPrintTotals(props.group.items))
</script>

<template>
  <section class="transfer-print-copy" :aria-label="copyName">
    <div class="transfer-print-heading">
      <header>
        <span>热沉事业部</span>
        <h1>{{ profile.title }}</h1>
        <div>
          <strong>{{ copyName }}</strong
          ><small>第 {{ pageNumber }} / {{ pageCount }} 页</small>
        </div>
      </header>
      <table class="transfer-print-parties">
        <tbody>
          <tr>
            <th>{{ profile.sourceLabel }}</th>
            <td>{{ profile.source }}</td>
            <th>{{ profile.targetLabel }}</th>
            <td>{{ profile.target }}</td>
          </tr>
          <tr>
            <th>{{ profile.senderLabel }}</th>
            <td>{{ group.items[0]!.transferred_by || '—' }}</td>
            <th>单据日期</th>
            <td>{{ formatDateTime(group.items[0]!.transferred_at).slice(0, 10) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <table class="transfer-print-lines" aria-label="批次转料明细">
      <colgroup>
        <col style="width: 12%" />
        <col style="width: 8%" />
        <col style="width: 10%" />
        <col style="width: 15%" />
        <col style="width: 7%" />
        <col style="width: 10%" />
        <col style="width: 13%" />
        <col style="width: 25%" />
      </colgroup>
      <thead>
        <tr>
          <th>流水号</th>
          <th>材质</th>
          <th>物料类型</th>
          <th>实际尺寸</th>
          <th>件数</th>
          <th>重量 (kg)</th>
          <th>
            {{ group.items[0]!.entry_kind === 'processing_output' ? '本班组业务' : '接收业务' }}
          </th>
          <th>本次批次 / 条码</th>
        </tr>
      </thead>
      <tbody
        v-for="block in blocks"
        :key="block.key"
        :data-print-block="block.key"
        :data-batch-no="block.transfer.batch_no"
      >
        <tr v-if="!block.fields" class="transfer-print-material">
          <td>
            {{
              block.transfer.shared_unallocated
                ? '共投（关联流水号见明细）'
                : block.transfer.serial_no
            }}
          </td>
          <td>{{ printMaterialValue(block.transfer.material_name) }}</td>
          <td>{{ materialTypeLabel(block.transfer.material_type) }}</td>
          <td>{{ printMaterialValue(block.transfer.transfer_specification) }}</td>
          <td>
            {{ isWeightOnlyType(block.transfer.material_type) ? '—' : block.transfer.quantity }}
          </td>
          <td>
            {{ block.transfer.weight
            }}<small v-if="block.transfer.material_type === 'sludge'">{{
              block.transfer.sludge_content_percent == null ? '历史账重' : '折算重量'
            }}</small>
          </td>
          <td>{{ printMaterialValue(materialPurposeLabel(block.transfer)) }}</td>
          <td class="transfer-print-barcode">
            <BarcodeCard :value="block.transfer.batch_no" compact entity-label="批次号" />
          </td>
        </tr>
        <tr v-else>
          <td colspan="8" class="transfer-print-detail">
            <div
              class="transfer-print-pairs"
              :class="{ 'transfer-print-audit': block.fields.length === 4 }"
            >
              <div v-for="(field, index) in block.fields" :key="index">
                <strong>{{ field.label }}</strong
                ><span>{{ field.value }}</span>
              </div>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
    <footer class="transfer-print-footer">
      <div class="transfer-print-total">
        <span>本单合计 · {{ totals.batches }} 批（不含作废）</span
        ><span
          >件数 <b>{{ totals.quantity }}</b></span
        ><span
          >{{ totals.sludge ? '账面重量' : '重量' }} <b>{{ totals.weight }}</b> kg</span
        >
      </div>
      <div class="transfer-print-signatures">
        <span>{{ profile.signatures[0] }}：________________</span
        ><span>{{ profile.signatures[1] }}：________________</span>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.transfer-print-copy {
  box-sizing: border-box;
  position: relative;
  width: 186mm;
  height: 130mm;
  color: #111;
  background: #fff;
  font-family: 'Microsoft YaHei', 'PingFang SC', sans-serif;
  font-size: 8pt;
  line-height: 1.4;
  font-weight: 400;
}
.transfer-print-copy * {
  box-sizing: border-box;
}
header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-height: 12mm;
  gap: 3mm;
  padding-bottom: 2mm;
  border-bottom: 1pt solid #111;
}
header > span,
header > div {
  width: 35mm;
  flex-shrink: 0;
}
header > div {
  display: grid;
  justify-items: end;
  gap: 1mm;
}
header strong {
  border: 0.5pt solid #222;
  padding: 0.7mm 2mm;
  font-size: 8pt;
}
header h1 {
  margin: 0;
  font-size: 17pt;
  line-height: 1.2;
  font-weight: 700;
  white-space: nowrap;
}
header small {
  font-size: 7pt;
}
table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  font: inherit;
  color: #111;
  background: #fff;
}
th,
td {
  border: 0.5pt solid #333;
  text-align: center;
  vertical-align: middle;
  padding: 1mm;
  font-size: 8pt;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
th {
  background: #f3f3f3;
  font-weight: 600;
}
.transfer-print-parties {
  margin: 2mm 0;
}
.transfer-print-parties th {
  width: 14%;
}
.transfer-print-lines thead th {
  font-size: 7.5pt;
  height: 6mm;
}
.transfer-print-material {
  height: 14mm;
}
.transfer-print-material small {
  display: block;
  font-size: 6.5pt;
}
.transfer-print-barcode {
  padding: 1.5mm 2.5mm;
}
.transfer-print-barcode :deep(.barcode-card) {
  min-height: 10mm;
  overflow: visible;
}
.transfer-print-barcode :deep(svg) {
  display: block;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  height: auto;
}
.transfer-print-detail {
  padding: 0;
}
.transfer-print-pairs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.transfer-print-pairs > div {
  display: grid;
  grid-template-columns: 24mm minmax(0, 1fr);
  min-height: 5mm;
}
.transfer-print-pairs > div + div {
  border-left: 0.5pt solid #333;
}
.transfer-print-pairs strong {
  padding: 0.5mm 1mm;
  border-right: 0.5pt solid #333;
  background: #f3f3f3;
  font-size: 7.5pt;
  font-weight: 600;
}
.transfer-print-pairs strong,
.transfer-print-pairs span {
  align-content: center;
  text-align: center;
}
.transfer-print-pairs span {
  padding: 0.5mm 1.5mm;
  white-space: pre-wrap;
  min-width: 0;
}
.transfer-print-audit {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}
.transfer-print-audit > div {
  grid-template-columns: 16mm minmax(0, 1fr);
}
.transfer-print-audit strong,
.transfer-print-audit span {
  font-size: 7pt;
  padding: 0.5mm 0.8mm;
}
.transfer-print-footer {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding-top: 2mm;
  font-size: 8pt;
}
.transfer-print-total {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.5mm 2mm;
  border-top: 0.5pt solid #333;
  border-bottom: 0.5pt solid #333;
  gap: 3mm;
}
.transfer-print-total b {
  margin-left: 2mm;
}
.transfer-print-signatures {
  display: flex;
  justify-content: space-between;
  padding: 4mm 2mm 1mm;
  gap: 5mm;
}
@media print {
  thead {
    display: table-header-group;
  }
  tbody {
    break-inside: avoid;
  }
}
</style>
