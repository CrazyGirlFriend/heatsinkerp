<script setup lang="ts">
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
import { Refresh } from '@element-plus/icons-vue'
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
const stockUnit = ref<'weight' | 'quantity'>('weight')
const activeMaterial = ref<string | null>(null)
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
          <h1>班组材质库存</h1>
          <p v-if="report" class="stock-count">
            {{ report.stock.rows.length }} 个班组 · {{ report.stock.materials.length }} 种材质
          </p>
        </div>
        <div class="stock-tools">
          <div class="stock-actions">
            <ElRadioGroup v-model="stockUnit" aria-label="库存显示单位">
              <ElRadioButton value="weight">重量 kg</ElRadioButton>
              <ElRadioButton value="quantity">件数</ElRadioButton>
            </ElRadioGroup>
            <ElPopover trigger="click" placement="bottom-end" :width="320">
              <template #reference><ElButton text>统计口径</ElButton></template>
              <p class="stock-scope-note">
                转出待签收的物料仍计在上游，签收后转入下游；对外待确认的物料仍计在转出班组。全厂库存只计一次。
              </p>
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
      <div v-else class="stock-wrap" tabindex="0" role="region" aria-label="班组材质库存表">
        <table
          class="stock-table"
          :aria-label="`班组材质库存（${stockUnit === 'weight' ? 'kg' : '件'}）`"
          @mouseleave="activeMaterial = null"
        >
          <thead>
            <tr>
              <th scope="col">班组</th>
              <th
                v-for="material in report.stock.materials"
                :key="material.name"
                scope="col"
                :class="{ 'is-column-active': activeMaterial === material.name }"
              >
                {{ material.name }}
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
                  @mouseenter="activeMaterial = material.name"
                  @focus="activeMaterial = material.name"
                  @blur="activeMaterial = null"
                  @click="stockDetails(material.name, team.team_id!)"
                >
                  {{ team.total === null ? '—' : stockValue(team.amounts[material.name]) }}
                </button>
              </td>
              <td class="sum-col" @mouseenter="activeMaterial = null">
                <button
                  :disabled="!team.team_id"
                  :aria-label="`${team.team_name}全部材质库存明细`"
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
                  @mouseenter="activeMaterial = material.name"
                  @focus="activeMaterial = material.name"
                  @blur="activeMaterial = null"
                  @click="stockDetails(material.name)"
                >
                  {{ stockValue(material) }}
                </button>
              </td>
              <td class="sum-col">
                <button aria-label="全厂全部库存明细" @click="stockDetails()">
                  {{ stockValue(report.stock.total) }}
                </button>
              </td>
            </tr>
          </tfoot>
        </table>
        <p v-if="!report.stock.materials.length" class="stock-empty">暂无材质库存</p>
        <footer class="stock-footer"><span>点击库存数字查看明细</span></footer>
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
  padding: 20px 24px;
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
  gap: 20px;
  padding: 30px 28px;
}
.stock-heading h1 {
  margin: 0;
  font-size: 32px;
  font-weight: 600;
  line-height: 1.4;
  letter-spacing: -0.02em;
  color: var(--text);
}
.stock-count {
  margin: 8px 0 0;
  font-size: 14px;
  color: var(--muted);
}
.stock-tools {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 12px;
}
.stock-updated {
  color: var(--muted);
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}
.stock-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
.stock-actions :deep(.el-button),
.stock-actions :deep(.el-radio-button__inner) {
  font-size: 16px;
}
.stock-actions :deep(.el-button) {
  height: 38px;
}
.stock-actions :deep(.el-radio-button__inner) {
  padding: 10px 18px;
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
  flex: 1;
  min-width: 0;
  min-height: 0;
  margin: 0 28px;
  overflow: auto;
}
.stock-wrap:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: -2px;
}
.stock-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-variant-numeric: tabular-nums;
  color: var(--text);
  border: 1px solid var(--line);
}
.stock-table th,
.stock-table td {
  height: 76px;
  min-width: 160px;
  padding: 12px 24px;
  border-bottom: 1px solid var(--line);
  white-space: nowrap;
  text-align: center;
  background: #fff;
}
.stock-table th {
  font-size: 19px;
  font-weight: 600;
}
.stock-table td {
  font-size: 22px;
  line-height: 28px;
}
.stock-table th:first-child {
  position: sticky;
  left: 0;
  z-index: 2;
  min-width: 128px;
  width: 128px;
}
.stock-table thead th {
  position: sticky;
  top: 0;
  z-index: 3;
  height: 68px;
  font-size: 18px;
  background: var(--table-header-bg, #edf2ee);
}
.stock-table thead th:first-child {
  z-index: 4;
}
.stock-table .sum-col {
  position: sticky;
  right: 0;
  z-index: 2;
  background: #f2f7f3;
  border-left: 1px solid var(--line);
  font-weight: 600;
  color: var(--primary);
}
.stock-table thead .sum-col {
  z-index: 4;
}
.stock-table tbody .is-zero {
  color: var(--muted);
}
.stock-table tbody tr:hover > *,
.stock-table tbody tr:focus-within > *,
.stock-table .is-column-active {
  background: var(--table-hover-bg, #f3f7f4);
}
.stock-table tbody td:hover,
.stock-table tbody td:focus-within {
  background: var(--primary-soft);
  color: var(--primary);
}
.stock-table tfoot > tr > * {
  height: 80px;
  background: #edf5ef;
  color: var(--primary);
  font-weight: 600;
  border-top: 1px solid var(--table-header-line);
  border-bottom: 0;
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
  min-height: 44px;
  padding: 6px 0;
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
.stock-footer {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  padding: 20px 0 24px;
  color: var(--muted);
  font-size: 14px;
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
    align-items: flex-start;
    max-width: 100%;
  }
  .stock-actions {
    gap: 8px;
    flex-wrap: wrap;
  }
  .stock-wrap {
    margin-inline: 16px;
  }
  .stock-panel > .el-alert {
    margin-inline: 16px;
  }
  .stock-footer {
    padding-block: 16px;
  }
  .stock-table th,
  .stock-table td {
    min-width: 136px;
    padding-inline: 16px;
  }
  .stock-table th:first-child {
    min-width: 96px;
    width: 96px;
  }
  .stock-table .sum-col {
    min-width: 100px;
  }
  .stock-table td {
    font-size: 18px;
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
