<script setup lang="ts">
import TableExportButton from '@/components/TableExportButton.vue'
import { tableExportSource } from '@/utils/tableExport'
import PageBackButton from '@/components/PageBackButton.vue'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  ElAlert,
  ElButton,
  ElDialog,
  ElLoading,
  ElPagination,
  ElPopover,
  ElRadioButton,
  ElRadioGroup,
  ElTable,
  ElTableColumn,
} from 'element-plus'
import { InfoFilled, Refresh } from '@element-plus/icons-vue'
import StatePanel from '@/components/StatePanel.vue'
import SerialMaterialDrawer from '@/components/SerialMaterialDrawer.vue'
import { factoryDashboardApi as api } from '@/services/factoryDashboardApi'
import { subscribeInventoryChanges } from '@/services/inventoryStream'
import type { FactoryDashboard, StockDetail } from '@/types/factoryDashboard'
import { dashboardNumber as number } from '@/utils/factoryDashboard'
import { materialTypeOptions } from '@/types/materialTransfer'
import { formatDateTime } from '@/utils/format'

const vLoading = ElLoading.directive
const report = ref<FactoryDashboard>(),
  loading = ref(false),
  error = ref('')
function exportSource() {
  if (!report.value) return null
  const stock = report.value.stock,
    key = stockUnit.value,
    unit = key === 'weight' ? 'kg' : '件'
  const rows = [
    ...stock.rows.map((row) => ({ ...row, amounts: { ...row.amounts } })),
    {
      team_id: null,
      team_code: 'TOTAL',
      team_name: '总计',
      active: true,
      amounts: Object.fromEntries(stock.materials.map((row) => [row.name, row])),
      total: stock.total,
    },
  ]
  return tableExportSource(
    `班组材质库存 · ${unit}`,
    rows.length,
    [
      { key: 'team_name', label: '班组', value: (row: (typeof rows)[number]) => row.team_name },
      ...stock.materials.map((material) => ({
        key: `material:${material.name}`,
        label: `${material.name} (${unit})`,
        value: (row: (typeof rows)[number]) =>
          row.total === null ? null : (row.amounts[material.name]?.[key] ?? 0),
      })),
      { key: 'total', label: `合计 (${unit})`, value: (row) => row.total?.[key] },
    ],
    async () => rows,
  )
}
const stockUnit = ref<'weight' | 'quantity'>('weight')
const hoveredMaterial = ref<string | null>(null)
const focusedMaterial = ref<string | null>(null)
const activeMaterial = computed(() => hoveredMaterial.value ?? focusedMaterial.value)
const materialHeadings = computed(() =>
  (report.value?.stock.materials || []).map(({ name }) => {
    // Split only at an existing name/code boundary; keep the original text and lookup key.
    const parts = name.match(/^(.+?)([\s-]+[A-Za-z0-9].*)$/u)
    return { name, label: parts?.[1] || name, code: parts?.[2] || '' }
  }),
)
const warning = computed(() => {
  const missing =
    report.value?.stock.rows.filter((r) => r.team_id === null).map((r) => r.team_name) || []
  return [
    missing.length ? `未配置班组：${missing.join('、')}` : '',
    report.value?.legacy_count ? `${report.value.legacy_count} 条历史接收未纳入库存` : '',
  ]
    .filter(Boolean)
    .join('；')
})
const stockOpen = ref(false),
  stockRows = ref<StockDetail[]>([]),
  stockMaterial = ref(''),
  stockTeam = ref<number>(),
  stockPage = ref(1),
  stockTotal = ref(0)
const stockSerial = ref<StockDetail | null>(null)
const stockTitle = computed(() =>
  [
    stockTeam.value
      ? report.value?.stock.rows.find((row) => row.team_id === stockTeam.value)?.team_name
      : '全厂',
    stockMaterial.value,
    '库存明细',
  ]
    .filter(Boolean)
    .join(' · '),
)
const detailLoading = ref(false),
  detailError = ref('')
let generation = 0,
  detailGeneration = 0,
  stop: (() => void) | undefined,
  refreshTimer: ReturnType<typeof setTimeout> | undefined,
  timer: ReturnType<typeof setInterval> | undefined
async function load() {
  const version = ++generation
  loading.value = true
  try {
    const data = await api.get()
    if (version === generation) {
      report.value = data
      error.value = ''
    }
  } catch {
    if (version === generation)
      error.value = report.value
        ? '更新失败，当前显示上次成功读取的数据。'
        : '班组材质库存读取失败，请重试。'
  } finally {
    if (version === generation) loading.value = false
  }
}
function refresh() {
  void load()
  if (stockOpen.value) void loadStock()
}
function scheduleRefresh() {
  clearTimeout(refreshTimer)
  refreshTimer = setTimeout(refresh, 250)
}
function visibility() {
  if (document.hidden) {
    stop?.()
    stop = undefined
    clearTimeout(refreshTimer)
    ++generation
    ++detailGeneration
    loading.value = false
    detailLoading.value = false
  } else {
    refresh()
    connect()
  }
}
function connect() {
  stop?.()
  stop = subscribeInventoryChanges({
    onData: scheduleRefresh,
    onState: (state) => {
      if (state === 'live') scheduleRefresh()
      if (state === 'expired') error.value = '登录或访问凭证已失效，请重新验证。'
    },
  })
}
async function stockDetails(material = '', team?: number) {
  stockSerial.value = null
  stockMaterial.value = material
  stockTeam.value = team
  stockPage.value = 1
  stockRows.value = []
  stockTotal.value = 0
  stockOpen.value = true
  await loadStock()
}
async function loadStock() {
  const version = ++detailGeneration
  detailLoading.value = true
  detailError.value = ''
  try {
    const data = await api.stockDetail(stockMaterial.value, stockTeam.value, stockPage.value)
    if (version === detailGeneration) {
      stockRows.value = data.items
      stockTotal.value = data.total
    }
  } catch {
    if (version === detailGeneration) detailError.value = '库存明细读取失败'
  } finally {
    if (version === detailGeneration) detailLoading.value = false
  }
}
const stockValue = (value: { quantity: number; weight: number } | null | undefined) =>
  value === null ? '—' : number(value?.[stockUnit.value] || 0, stockUnit.value === 'weight' ? 3 : 0)
const isZero = (value: { quantity: number; weight: number } | null | undefined) =>
  value !== null && !value?.[stockUnit.value]
const typeLabel = (kind: string | null) =>
  materialTypeOptions.find((o) => o.value === kind)?.label || '未分类'
onMounted(() => {
  load()
  if (!document.hidden) connect()
  timer = setInterval(() => {
    if (!document.hidden && !loading.value) refresh()
  }, 60000)
  document.addEventListener('visibilitychange', visibility)
})
onBeforeUnmount(() => {
  ++generation
  ++detailGeneration
  stop?.()
  clearTimeout(refreshTimer)
  clearInterval(timer)
  document.removeEventListener('visibilitychange', visibility)
})
</script>

<template>
  <section class="page factory-stock-page" aria-label="班组材质库存">
    <section class="stock-panel">
      <header class="stock-heading">
        <div class="stock-title">
          <PageBackButton />
          <h1>班组材质库存</h1>
          <p v-if="report" class="stock-count">
            {{ report.stock.rows.length }} 个班组 · {{ report.stock.materials.length }} 种材质
          </p>
        </div>
        <div class="stock-tools">
          <div class="stock-actions">
            <TableExportButton
              :source="exportSource"
              :disabled="loading || !report || !!error"
              :context="stockUnit"
            />
            <ElRadioGroup v-model="stockUnit" class="stock-unit-switch" aria-label="库存显示单位">
              <ElRadioButton value="weight">重量 kg</ElRadioButton>
              <ElRadioButton value="quantity">件数</ElRadioButton>
            </ElRadioGroup>
            <ElPopover trigger="click" placement="bottom-end" :width="320">
              <template #reference
                ><ElButton
                  class="stock-info-button"
                  :icon="InfoFilled"
                  text
                  aria-label="统计说明"
                  title="统计说明"
              /></template>
              <p class="stock-scope-note">下序签收前计入上序班组库存，签收后转入下序班组。</p>
            </ElPopover>
            <ElButton :icon="Refresh" :loading="loading" aria-label="刷新库存" @click="refresh"
              >刷新</ElButton
            >
          </div>
          <time v-if="report" :datetime="report.as_of" class="stock-updated"
            >更新于 {{ formatDateTime(report.as_of) }}</time
          >
        </div>
      </header>
      <ElAlert v-if="error && report" :title="error" type="warning" :closable="false" show-icon />
      <ElAlert v-if="warning" :title="warning" type="warning" :closable="false" show-icon />
      <StatePanel v-if="!report && error" state="error" :description="error" @retry="load" />
      <StatePanel v-else-if="!report" state="loading" title="正在读取班组材质库存" />
      <div
        v-else
        class="stock-wrap"
        :style="{
          '--stock-material-count': Math.max(1, report.stock.materials.length),
          '--stock-row-count': report.stock.rows.length + 1,
        }"
        tabindex="0"
        role="region"
        aria-label="班组材质库存表"
      >
        <table
          class="stock-table"
          :aria-label="`班组材质库存（${stockUnit === 'weight' ? 'kg' : '件'}）`"
          @mouseleave="hoveredMaterial = null"
        >
          <colgroup>
            <col class="stock-team-col" />
            <col
              v-for="material in report.stock.materials"
              :key="material.name"
              class="stock-material-col"
            />
            <col class="stock-total-col" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">班组</th>
              <th
                v-for="material in materialHeadings"
                :key="material.name"
                scope="col"
                :title="material.name"
                :class="{ 'is-column-active': activeMaterial === material.name }"
              >
                <span class="material-heading">{{ material.label }}</span
                ><span v-if="material.code" class="material-code">{{ material.code }}</span>
              </th>
              <th scope="col" class="sum-col">合计</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="team in report.stock.rows" :key="team.team_code">
              <th scope="row">
                {{ team.team_name
                }}<span v-if="!team.active && team.team_id" class="stock-retired">已停用</span>
              </th>
              <td
                v-for="material in report.stock.materials"
                :key="material.name"
                :class="{
                  'is-column-active': activeMaterial === material.name,
                  'is-zero': team.total !== null && isZero(team.amounts[material.name]),
                }"
              >
                <button
                  :disabled="!team.team_id"
                  :aria-label="`${team.team_name} ${material.name} 库存明细`"
                  :title="`查看${team.team_name} · ${material.name}库存明细`"
                  @mouseenter="hoveredMaterial = material.name"
                  @focus="focusedMaterial = material.name"
                  @blur="focusedMaterial = null"
                  @click="stockDetails(material.name, team.team_id!)"
                >
                  {{ team.total === null ? '—' : stockValue(team.amounts[material.name]) }}
                </button>
              </td>
              <td
                class="sum-col"
                :class="{ 'is-zero': isZero(team.total) }"
                @mouseenter="hoveredMaterial = null"
              >
                <button
                  :disabled="!team.team_id"
                  :aria-label="`${team.team_name}全部材质库存明细`"
                  :title="`查看${team.team_name}全部材质库存明细`"
                  @click="stockDetails('', team.team_id!)"
                >
                  {{ stockValue(team.total) }}
                </button>
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">总计</th>
              <td
                v-for="material in report.stock.materials"
                :key="material.name"
                :class="{ 'is-column-active': activeMaterial === material.name }"
              >
                <button
                  :aria-label="`全厂${material.name}库存明细`"
                  :title="`查看全厂${material.name}库存明细`"
                  @mouseenter="hoveredMaterial = material.name"
                  @focus="focusedMaterial = material.name"
                  @blur="focusedMaterial = null"
                  @click="stockDetails(material.name)"
                >
                  {{ stockValue(material) }}
                </button>
              </td>
              <td class="sum-col grand-total">
                <button
                  aria-label="全厂全部库存明细"
                  title="查看全厂全部库存明细"
                  @click="stockDetails()"
                >
                  {{ stockValue(report.stock.total) }}
                </button>
              </td>
            </tr>
          </tfoot>
        </table>
        <p v-if="!report.stock.materials.length" class="stock-empty">暂无材质库存</p>
      </div>
    </section>
    <ElDialog
      v-model="stockOpen"
      :title="stockTitle"
      width="min(950px, 96vw)"
      class="factory-detail-dialog"
    >
      <p v-if="detailError" role="alert">
        {{ detailError }}<ElButton link @click="loadStock">重试</ElButton>
      </p>
      <ElTable v-loading="detailLoading" :data="stockRows" max-height="460" empty-text="暂无库存">
        <ElTableColumn prop="team_name" label="班组" width="90" align="center" />
        <ElTableColumn prop="serial_no" label="流水号" min-width="160" align="center">
          <template #default="{ row }">
            <ElButton
              link
              type="primary"
              :aria-label="`查看${row.team_name} ${row.serial_no}流水号详情`"
              @click="stockSerial = row as StockDetail"
              >{{ row.serial_no }}</ElButton
            >
          </template>
        </ElTableColumn>
        <ElTableColumn prop="material" label="材质" min-width="100" align="center" />
        <ElTableColumn label="类型" width="100" align="center"
          ><template #default="{ row }">{{ typeLabel(row.material_type) }}</template></ElTableColumn
        >
        <ElTableColumn label="件数" align="center"
          ><template #default="{ row }">{{ number(row.quantity, 0) }}</template></ElTableColumn
        >
        <ElTableColumn label="重量 kg" align="center"
          ><template #default="{ row }">{{ number(row.weight, 3) }}</template></ElTableColumn
        >
      </ElTable>
      <ElPagination
        v-model:current-page="stockPage"
        :page-size="30"
        :total="stockTotal"
        layout="total, prev, pager, next"
        @current-change="loadStock"
      />
    </ElDialog>
    <SerialMaterialDrawer
      v-if="stockOpen && stockSerial"
      :model-value="true"
      :team-id="stockSerial.team_id"
      :serial-no="stockSerial.serial_no"
      :can-write="false"
      @update:model-value="!$event && (stockSerial = null)"
      @changed="refresh"
    />
  </section>
</template>

<style scoped>
.factory-stock-page {
  height: 100%;
  min-height: 0;
  padding: 20px;
  display: flex;
  flex-direction: column;
}
.stock-panel {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--surface, #fff);
}
.stock-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  flex-shrink: 0;
  gap: 16px;
  padding: 24px;
}
.stock-title {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px 16px;
}
.stock-heading h1 {
  margin: 0;
  font-size: 24px;
  font-weight: 550;
  line-height: 1.35;
  letter-spacing: -0.02em;
  color: var(--text);
}
.stock-count {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
}
.stock-tools {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 20px;
}
.stock-updated {
  order: -1;
  color: var(--muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.stock-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.stock-actions :deep(.el-button),
.stock-actions :deep(.el-radio-button__inner) {
  font-size: 14px;
}
.stock-actions :deep(.el-button) {
  height: 40px;
  border-radius: 7px;
}
.stock-unit-switch {
  padding: 3px;
  border: 1px solid #e2e9e4;
  border-radius: 8px;
  background: #f1f5f2;
}
.stock-unit-switch :deep(.el-radio-button__inner) {
  padding: 6px 12px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: #54685b;
  line-height: 20px;
  box-shadow: none;
}
.stock-unit-switch :deep(.el-radio-button.is-active .el-radio-button__inner) {
  color: #fff;
  background: var(--primary);
  box-shadow: 0 1px 3px rgb(33 83 49 / 12%);
}
.stock-actions :deep(.stock-info-button) {
  width: 36px;
  padding: 0;
  color: var(--muted);
  font-size: 17px;
}
.stock-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}
.stock-panel > .el-alert {
  flex-shrink: 0;
  width: auto;
  margin: 0 24px 12px;
}
.stock-panel > .state-panel {
  flex: 1;
}
.stock-wrap {
  container-type: size;
  --stock-team-width: 112px;
  --stock-total-width: 128px;
  --stock-header-height: 64px;
  flex: 1;
  min-width: 0;
  min-height: 0;
  margin: 0 24px 20px;
  overflow: auto;
}
.stock-wrap:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: -2px;
}
.stock-table {
  --stock-material-width: calc(
    (100cqw - var(--stock-team-width) - var(--stock-total-width) - 2px) /
      var(--stock-material-count)
  );
  --stock-number-size: clamp(18px, calc(var(--stock-material-width) * 0.16), 20px);
  --stock-row-height: clamp(
    48px,
    calc((100cqh - var(--stock-header-height) - 2px) / var(--stock-row-count)),
    76px
  );
  width: 100%;
  min-width: calc(
    var(--stock-team-width) + var(--stock-total-width) + var(--stock-material-count) * 96px
  );
  border-collapse: separate;
  border-spacing: 0;
  font-variant-numeric: tabular-nums;
  color: var(--text);
  border: 1px solid #dfe8e1;
  border-radius: 8px;
}
.stock-team-col {
  width: var(--stock-team-width);
}
.stock-total-col {
  width: var(--stock-total-width);
}
.stock-material-col {
  width: max(96px, var(--stock-material-width));
}
.stock-table th,
.stock-table td {
  height: var(--stock-row-height);
  padding: 6px 8px;
  border-bottom: 1px solid #edf1ee;
  white-space: nowrap;
  text-align: center;
  background: #fff;
  transition: background-color 140ms ease;
}
.stock-table th {
  font-size: clamp(16px, calc(var(--stock-material-width) * 0.14), 17px);
  font-weight: 500;
  white-space: normal;
  overflow-wrap: anywhere;
  line-height: 1.4;
}
.stock-table td {
  font-size: var(--stock-number-size);
  font-weight: 400;
  line-height: 1.4;
}
.stock-table th:first-child {
  position: sticky;
  left: 0;
  z-index: 2;
  min-width: var(--stock-team-width);
  width: var(--stock-team-width);
}
.stock-table thead th {
  position: sticky;
  top: 0;
  z-index: 3;
  height: var(--stock-header-height);
  font-size: clamp(16px, calc(var(--stock-material-width) * 0.14), 17px);
  color: #354d3e;
  background: #edf3ef;
  border-bottom-color: #dce6df;
}
.stock-table thead th:first-child {
  z-index: 4;
  border-top-left-radius: 7px;
}
.material-heading,
.material-code {
  display: block;
}
.material-heading {
  text-wrap: balance;
}
.material-code {
  margin-top: 3px;
  color: #5f7166;
  font-size: 13px;
  font-weight: 400;
  line-height: 1.3;
}
.stock-table tbody th {
  background: #fbfcfb;
  border-right: 1px solid #edf1ee;
}
.stock-table .sum-col {
  min-width: var(--stock-total-width);
  position: sticky;
  right: 0;
  z-index: 2;
  background: #f3f7f4;
  border-left: 1px solid #e2ebe5;
  font-weight: 550;
  color: var(--primary);
}
.stock-table thead .sum-col {
  z-index: 4;
  border-top-right-radius: 7px;
}
.stock-table tbody .is-zero {
  color: #6b766e;
  font-weight: 400;
}
.stock-table tbody tr:hover > *,
.stock-table tbody tr:focus-within > *,
.stock-table .is-column-active {
  background: #f1f6f2;
}
.stock-table tbody td:hover,
.stock-table tbody td:focus-within {
  background: #eaf3ec;
  color: #285f3b;
  box-shadow: inset 0 0 0 1px #c6dbcc;
}
.stock-table tfoot > tr > * {
  background: #f0f6f2;
  color: #346b47;
  font-weight: 550;
  border-top: 1px solid var(--table-header-line);
  border-bottom: 0;
}
.stock-table tfoot th {
  border-bottom-left-radius: 7px;
}
.stock-table tfoot .grand-total {
  border-bottom-right-radius: 7px;
  background: #e2eee5;
  color: #205c35;
  font-weight: 600;
}
.stock-retired {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  font-weight: 400;
  color: var(--muted);
}
.stock-table button {
  display: block;
  width: 100%;
  min-height: 34px;
  padding: 4px 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}
.stock-table button:hover:not(:disabled) {
  color: var(--primary);
}
.stock-table button:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 3px;
  border-radius: 3px;
}
.stock-table button:disabled {
  cursor: default;
  color: var(--muted);
}
.stock-empty {
  margin: 0;
  padding: 48px 20px;
  color: var(--muted);
  text-align: center;
}
.stock-scope-note {
  margin: 0;
  line-height: 1.8;
  color: var(--text);
}
.el-pagination {
  margin-top: 16px;
  justify-content: flex-end;
}
@media (max-width: 800px) {
  .factory-stock-page {
    padding: 12px;
  }
  .stock-heading {
    padding: 16px;
  }
  .stock-heading h1 {
    font-size: 24px;
  }
  .stock-tools {
    width: 100%;
    max-width: 100%;
  }
  .stock-updated {
    order: 1;
  }
  .stock-actions {
    gap: 6px;
    flex-wrap: wrap;
  }
  .stock-wrap {
    --stock-team-width: 96px;
    --stock-total-width: 112px;
    margin-inline: 16px;
  }
  .stock-panel > .el-alert {
    margin-inline: 16px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .stock-table th,
  .stock-table td {
    transition: none;
  }
}
@media (max-width: 640px) {
  /* On a phone, two frozen sides would conceal the material being read. */
  .stock-table .sum-col {
    position: static;
    right: auto;
  }
  .stock-table thead .sum-col {
    position: sticky;
  }
}
</style>
<style>
.factory-detail-dialog {
  max-width: calc(100vw - 28px);
}
.factory-detail-dialog .el-table {
  font-size: 14px;
}
</style>
