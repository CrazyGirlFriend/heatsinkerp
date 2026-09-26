<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { ElAlert, ElButton, ElDialog, ElPagination, ElTable, ElTableColumn } from 'element-plus'
import { ArrowRight, FullScreen, QuestionFilled, Refresh } from '@element-plus/icons-vue'
import StatePanel from '@/components/StatePanel.vue'
import FactoryShipmentChart from '@/components/FactoryShipmentChart.vue'
import FactoryShippingAnalysis from '@/components/FactoryShippingAnalysis.vue'
import FactoryDeliveryPlans from '@/components/FactoryDeliveryPlans.vue'
import { factoryDashboardApi as api } from '@/services/factoryDashboardApi'
import { subscribeInventoryChanges } from '@/services/inventoryStream'
import type { FactoryDashboard, StockDetail, TeamYield, YieldRow } from '@/types/factoryDashboard'
import {
  dashboardNumber as number,
  dashboardColors as colors,
  deliveryStatus,
  shipmentColors,
  yieldStatus,
} from '@/utils/factoryDashboard'
import { materialTypeOptions } from '@/types/materialTransfer'
import { formatDateTime } from '@/utils/format'

const report = ref<FactoryDashboard>(),
  loading = ref(false),
  error = ref('')
const stockUnit = ref<'weight' | 'quantity'>('weight'),
  attentionTab = ref('全部')
const analysis = ref(false),
  plans = ref(false),
  rules = ref(false),
  analysisTrigger = ref<HTMLButtonElement>()
const attention = computed(
  () =>
    report.value?.attention.filter(
      (row) => attentionTab.value === '全部' || row.reasons.includes(attentionTab.value),
    ) || [],
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
const lineColors = computed(() =>
  shipmentColors(report.value?.shipping.series.map((row) => row.serial_no) || []),
)
const yieldOpen = ref(false),
  yieldRows = ref<YieldRow[]>([]),
  teamRows = ref<TeamYield[]>([]),
  yieldMaterial = ref(''),
  yieldSerial = ref(''),
  yieldPage = ref(1),
  yieldTotal = ref(0)
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
        : '全厂总览读取失败，请重试。'
  } finally {
    if (version === generation) loading.value = false
  }
}
function scheduleRefresh() {
  clearTimeout(refreshTimer)
  refreshTimer = setTimeout(load, 250)
}
function visibility() {
  if (document.hidden) {
    stop?.()
    stop = undefined
    clearTimeout(refreshTimer)
    ++generation
    loading.value = false
  } else {
    load()
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
  stockMaterial.value = material
  stockTeam.value = team
  stockPage.value = 1
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
async function yieldDetails(material = '') {
  yieldMaterial.value = material
  yieldSerial.value = ''
  yieldPage.value = 1
  yieldOpen.value = true
  await loadYields()
}
async function loadYields() {
  const version = ++detailGeneration
  detailLoading.value = true
  detailError.value = ''
  yieldSerial.value = ''
  try {
    const data = await api.yields(yieldMaterial.value, yieldPage.value)
    if (version === detailGeneration) {
      yieldRows.value = data.items
      yieldTotal.value = data.total
    }
  } catch {
    if (version === detailGeneration) detailError.value = '成品率读取失败'
  } finally {
    if (version === detailGeneration) detailLoading.value = false
  }
}
async function teamYields(row: YieldRow) {
  const version = ++detailGeneration
  yieldSerial.value = row.serial_no!
  detailLoading.value = true
  detailError.value = ''
  try {
    const data = await api.teamYields(row.serial_no!, row.material)
    if (version === detailGeneration) teamRows.value = data.items
  } catch {
    if (version === detailGeneration) detailError.value = '班组成品率读取失败'
  } finally {
    if (version === detailGeneration) detailLoading.value = false
  }
}
function closeAnalysis() {
  analysis.value = false
  nextTick(() => analysisTrigger.value?.focus())
}
const visibleYields = computed<(YieldRow | TeamYield)[]>(() =>
  yieldSerial.value ? teamRows.value : yieldRows.value,
)
const rate = (value: number | null) => (value == null ? '—' : `${number(value)}%`)
const stockValue = (value: { quantity: number; weight: number } | null | undefined) =>
  value === null ? '—' : number(value?.[stockUnit.value] || 0, stockUnit.value === 'weight' ? 3 : 0)
const typeLabel = (kind: string | null) =>
  materialTypeOptions.find((o) => o.value === kind)?.label || '未分类'
onMounted(() => {
  load()
  if (!document.hidden) connect()
  timer = setInterval(() => {
    if (!document.hidden && !loading.value) load()
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
  <section class="page factory-dashboard" aria-label="全厂库存总览">
    <header class="overview-heading">
      <h1>全厂库存总览</h1>
      <div>
        <span v-if="report" class="updated">{{ formatDateTime(report.as_of) }} 更新</span
        ><button class="text-button" :disabled="loading" aria-label="刷新总览" @click="load">
          <Refresh /></button
        ><button class="text-button" @click="rules = true"><QuestionFilled />统计说明</button>
      </div>
    </header>
    <ElAlert
      v-if="error && report"
      :title="error"
      type="warning"
      :closable="false"
      show-icon
    /><ElAlert v-if="warning" :title="warning" type="warning" :closable="false" show-icon />
    <StatePanel
      v-if="!report && error"
      state="error"
      :description="error"
      @retry="load"
    /><StatePanel v-else-if="!report" state="loading" title="正在读取全厂总览" />
    <div v-else class="dashboard">
      <section class="panel inventory">
        <div class="panel-heading">
          <h2>班组材质库存</h2>
          <div class="segmented" aria-label="库存显示单位">
            <button :class="{ selected: stockUnit === 'weight' }" @click="stockUnit = 'weight'">
              重量 kg</button
            ><button
              :class="{ selected: stockUnit === 'quantity' }"
              @click="stockUnit = 'quantity'"
            >
              件数
            </button>
          </div>
        </div>
        <div class="stock-wrap">
          <table class="stock-table">
            <thead>
              <tr>
                <th>班组</th>
                <th v-for="(m, i) in report.stock.materials" :key="m.name">
                  <i class="dot" :style="{ background: colors[i % colors.length] }"></i>{{ m.name }}
                </th>
                <th class="sum-col">合计</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="team in report.stock.rows" :key="team.team_code">
                <th>{{ team.team_name }}</th>
                <td v-for="m in report.stock.materials" :key="m.name">
                  <button
                    :disabled="!team.team_id"
                    :aria-label="`${team.team_name} ${m.name} 库存明细`"
                    @click="stockDetails(m.name, team.team_id!)"
                  >
                    {{ team.total === null ? '—' : stockValue(team.amounts[m.name]) }}
                  </button>
                </td>
                <td class="sum-col">{{ stockValue(team.total) }}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <th>总计</th>
                <td v-for="m in report.stock.materials" :key="m.name">{{ stockValue(m) }}</td>
                <td class="sum-col">{{ stockValue(report.stock.total) }}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <button class="panel-foot" @click="stockDetails()">库存明细<ArrowRight /></button>
      </section>
      <section class="panel yield">
        <div class="panel-heading">
          <h2>成品率</h2>
          <span class="muted">已完结</span>
        </div>
        <div class="yield-head">
          <span>材质</span><span>投入 / 成品 kg</span><span>成品率</span>
        </div>
        <div class="yield-list">
          <button
            v-for="(row, i) in report.yields"
            :key="row.material"
            class="yield-row"
            @click="yieldDetails(row.material)"
          >
            <div class="yield-values">
              <strong
                ><i class="dot" :style="{ background: colors[i % colors.length] }"></i
                >{{ row.material }}</strong
              ><span>{{
                row.completed_count
                  ? number(row.input_weight) + ' / ' + number(row.output_weight)
                  : '暂无已完结'
              }}</span
              ><b>{{ row.completed_count ? rate(row.rate) : '进行中' }}</b>
            </div>
            <div class="meter">
              <span
                :style="{ width: (row.rate ?? 0) + '%', background: colors[i % colors.length] }"
              ></span>
            </div>
          </button>
          <p v-if="!report.yields.length" class="empty">暂无成品率数据</p>
        </div>
        <button class="panel-foot" @click="yieldDetails()">查看流水号与班组<ArrowRight /></button>
      </section>
      <section class="panel deadline">
        <div class="panel-heading">
          <h2>交期与超时</h2>
          <button class="text-button" aria-label="查看交付计划" @click="plans = true">
            <ArrowRight />
          </button>
        </div>
        <div class="deadline-summary">
          <div>
            <b>{{ rate(report.delivery.on_time_rate) }}</b
            ><span>到期批次按期率</span>
          </div>
          <div class="late">
            <b>{{ report.delivery.overdue_count }}<small>批</small></b
            ><span>已超期</span>
          </div>
          <div>
            <b>{{ report.delivery.upcoming_count }}<small>批</small></b
            ><span>近 3 天到期</span>
          </div>
        </div>
        <div class="delivery-list">
          <button
            v-for="row in report.delivery.items"
            :key="row.serial_no + row.index"
            class="delivery-item"
            @click="plans = true"
          >
            <div>
              <strong>{{ row.serial_no }}</strong
              ><span class="badge" :class="{ late: row.status === 'overdue' }">{{
                row.status === 'overdue'
                  ? '超期 ' + row.overdue_days + ' 天'
                  : deliveryStatus(row.status)
              }}</span>
            </div>
            <p>
              {{ row.label }} · {{ row.due_date.slice(5)
              }}<span
                >还差 <b>{{ number(row.remaining, 0) }}</b> 件</span
              >
            </p>
            <div class="meter">
              <span
                :style="{ width: Math.min(100, (row.shipped / row.quantity) * 100) + '%' }"
              ></span>
            </div>
            <small>已发 {{ number(row.shipped, 0) }} / 应发 {{ number(row.quantity, 0) }} 件</small>
          </button>
          <p v-if="!report.delivery.items.length" class="empty">
            {{ report.delivery.total ? '当前没有待交批次' : '尚未设置交付计划' }}
          </p>
        </div>
        <button class="panel-foot" @click="plans = true">查看全部交付计划<ArrowRight /></button>
      </section>
      <section class="panel shipping">
        <div class="panel-heading">
          <h2>流水号发货速率</h2>
          <span class="muted">最新 {{ report.shipping.series.length }} 条</span>
        </div>
        <div class="chart-toolbar">
          <span
            >{{ report.shipping.dates[0]?.slice(5) }} —
            {{ report.shipping.dates.at(-1)?.slice(5) }}</span
          ><button ref="analysisTrigger" class="text-button" @click="analysis = true">
            <FullScreen />展开分析
          </button>
        </div>
        <div
          class="shipping-chart"
          role="button"
          tabindex="0"
          aria-label="展开发货速率分析画布"
          @click="analysis = true"
          @keydown.enter.prevent="analysis = true"
          @keydown.space.prevent="analysis = true"
        >
          <FactoryShipmentChart :data="report.shipping" />
        </div>
        <div class="legend">
          <span v-for="row in report.shipping.series" :key="row.serial_no"
            ><i :style="{ background: lineColors[row.serial_no] }"></i>{{ row.serial_no }}</span
          >
        </div>
      </section>
      <section class="panel attention">
        <div class="panel-heading">
          <h2>重点关注流水号</h2>
          <div class="tabs">
            <button
              v-for="tab in ['全部', '超期', '加急', '库龄']"
              :key="tab"
              :class="{ selected: attentionTab === tab }"
              @click="attentionTab = tab"
            >
              {{ tab }}
            </button>
          </div>
        </div>
        <div class="attention-table-wrap">
          <table class="attention-table">
            <thead>
              <tr>
                <th>流水号</th>
                <th>材质</th>
                <th>关注原因</th>
                <th>当前班组</th>
                <th>待交件数</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in attention" :key="row.serial_no">
                <td>
                  <RouterLink
                    :to="{ path: '/material-trace', query: { serial_no: row.serial_no } }"
                    >{{ row.serial_no }}</RouterLink
                  >
                </td>
                <td>{{ row.materials.join('、') || '—' }}</td>
                <td>
                  <span
                    v-for="reason in row.reasons"
                    :key="reason"
                    class="badge"
                    :class="{ late: reason === '超期' }"
                    >{{
                      reason === '超期'
                        ? '超期 ' + row.overdue_days + ' 天'
                        : reason === '库龄'
                          ? '库龄 ' + row.age_days + ' 天'
                          : '加急'
                    }}</span
                  >
                </td>
                <td>{{ row.teams.join('、') || '—' }}</td>
                <td>{{ number(row.remaining, 0) }}</td>
              </tr>
            </tbody>
          </table>
          <p v-if="!attention.length" class="empty">暂无需要关注的流水号</p>
        </div>
      </section>
    </div>
    <FactoryShippingAnalysis
      v-if="analysis && report"
      :initial-selection="report.shipping.series"
      :today="report.today"
      @close="closeAnalysis"
    />
    <FactoryDeliveryPlans v-if="plans" @close="plans = false" @saved="load" />
    <ElDialog
      v-model="stockOpen"
      :title="(stockMaterial || '全厂') + ' · 库存明细'"
      width="950px"
      class="factory-detail-dialog"
      ><p v-if="detailError" role="alert">
        {{ detailError }}<ElButton link @click="loadStock">重试</ElButton>
      </p>
      <ElTable v-loading="detailLoading" :data="stockRows" max-height="460" empty-text="暂无库存"
        ><ElTableColumn prop="team_name" label="班组" width="90" /><ElTableColumn
          prop="serial_no"
          label="流水号"
          min-width="140"
        /><ElTableColumn prop="material" label="材质" min-width="100" /><ElTableColumn
          label="类型"
          width="100"
          ><template #default="{ row }">{{ typeLabel(row.material_type) }}</template></ElTableColumn
        ><ElTableColumn label="件数" align="right"
          ><template #default="{ row }">{{ number(row.quantity, 0) }}</template></ElTableColumn
        ><ElTableColumn label="重量 kg" align="right"
          ><template #default="{ row }">{{ number(row.weight, 3) }}</template></ElTableColumn
        ></ElTable
      ><ElPagination
        v-model:current-page="stockPage"
        :page-size="30"
        :total="stockTotal"
        layout="total, prev, pager, next"
        @current-change="loadStock"
    /></ElDialog>
    <ElDialog
      v-model="yieldOpen"
      :title="
        yieldSerial
          ? yieldSerial + ' · 班组成品率'
          : (yieldMaterial || '全部材质') + ' · 流水号成品率'
      "
      width="950px"
      class="factory-detail-dialog"
      ><p v-if="detailError" role="alert">{{ detailError }}</p>
      <ElButton v-if="yieldSerial" link type="primary" @click="loadYields">返回流水号</ElButton
      ><ElTable
        v-loading="detailLoading"
        :data="visibleYields"
        max-height="460"
        empty-text="暂无成品率数据"
        ><ElTableColumn v-if="yieldSerial" prop="team_name" label="班组" /><ElTableColumn
          v-else
          prop="serial_no"
          label="流水号"
          min-width="140"
        /><ElTableColumn v-if="!yieldSerial" prop="material" label="材质" /><ElTableColumn
          label="投入 kg"
          align="right"
          ><template #default="{ row }">{{ number(row.input_weight, 3) }}</template></ElTableColumn
        ><ElTableColumn :label="yieldSerial ? '合格产出 kg' : '成品 kg'" align="right"
          ><template #default="{ row }">{{ number(row.output_weight, 3) }}</template></ElTableColumn
        ><ElTableColumn label="成品率" align="right"
          ><template #default="{ row }">{{ rate(row.rate) }}</template></ElTableColumn
        ><ElTableColumn label="状态"
          ><template #default="{ row }">{{ yieldStatus(row.status) }}</template></ElTableColumn
        ><ElTableColumn v-if="!yieldSerial" width="90"
          ><template #default="{ row }"
            ><ElButton link type="primary" @click="teamYields(row as YieldRow)"
              >各班组</ElButton
            ></template
          ></ElTableColumn
        ></ElTable
      ><ElPagination
        v-if="!yieldSerial"
        v-model:current-page="yieldPage"
        :page-size="30"
        :total="yieldTotal"
        layout="total, prev, pager, next"
        @current-change="loadYields"
    /></ElDialog>
    <ElDialog v-model="rules" title="统计说明" width="620px" class="factory-detail-dialog"
      ><dl class="rule-list">
        <dt>库存归属</dt>
        <dd>
          待接收的内部转料计在上游，接收后转入下游；待确认的外部发货仍计在发货班组。全厂只计一次，预留的料不可再次领用。
        </dd>
        <dt>成品率</dt>
        <dd>
          成品确认发货重量 ÷
          库房外部入库重量，仅汇总库存及待确认记录已结清的流水号。班组按确认交出的合格料重量 ÷
          收料重量计算；尚未做完显示“进行中”。期初库存、历史未追踪记录或退货造成投入不可比时显示“投入待核对”。
        </dd>
        <dt>发货速率</dt>
        <dd>
          按工厂当地日期，统计每条流水号每天确认发出的成品件数；默认显示最新创建的5条，展开可搜索全部流水号。
        </dd>
        <dt>交期与超时</dt>
        <dd>
          同一流水号的确认发货件数按交期先后抵扣各批计划。批次发满应发件数才完成。按期率只统计交期已经过去的批次，超期未完成也计入分母。
        </dd>
        <dt>重点关注</dt>
        <dd>展示超期、加急及仍有库存且库龄达到7天的流水号。库龄从仍有结存的批次接收时间计算。</dd>
      </dl></ElDialog
    >
  </section>
</template>

<style scoped>
.factory-dashboard {
  height: calc(100dvh - var(--topbar-height, 56px));
  min-height: 0;
  padding: 16px 24px 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  background: #f6f8f7;
  color: #24312a;
  --green: #337d4d;
  --muted: #64726a;
  --line: #e5ebe7;
}
.overview-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 38px;
  flex-shrink: 0;
}
.overview-heading h1 {
  font-size: 23px;
  letter-spacing: -0.6px;
  font-weight: 550;
  margin: 0;
}
.overview-heading > div {
  display: flex;
  gap: 16px;
  align-items: center;
}
.updated {
  font-size: 11px;
  color: var(--muted);
}
.factory-dashboard button {
  font: inherit;
  color: inherit;
  border: 0;
  background: none;
  cursor: pointer;
}
.factory-dashboard button:disabled {
  opacity: 0.5;
  cursor: default;
}
.factory-dashboard button:focus-visible {
  outline: 2px solid var(--green);
  outline-offset: 2px;
}
.factory-dashboard svg {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
}
.factory-dashboard .text-button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--green);
  padding: 0;
  white-space: nowrap;
}
.dashboard {
  display: grid;
  grid-template-columns: minmax(0, 1.78fr) minmax(0, 1fr) minmax(0, 1fr);
  grid-template-areas: 'inventory yield deadline' 'shipping attention attention';
  grid-template-rows: minmax(300px, 1.06fr) minmax(252px, 1fr);
  gap: 14px;
  flex: 1;
  min-height: 566px;
}
.panel {
  min-width: 0;
  min-height: 0;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.inventory {
  grid-area: inventory;
}
.yield {
  grid-area: yield;
}
.deadline {
  grid-area: deadline;
}
.shipping {
  grid-area: shipping;
}
.attention {
  grid-area: attention;
}
.panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 15px 17px 11px;
  min-height: 49px;
  flex-shrink: 0;
}
.panel-heading h2 {
  font-size: 15px;
  font-weight: 550;
  margin: 0;
  letter-spacing: -0.25px;
  white-space: nowrap;
}
.muted {
  font-size: 11px;
  color: var(--muted);
}
.segmented {
  display: flex;
  background: #f4f7f5;
  border-radius: 6px;
  padding: 2px;
  flex-shrink: 0;
}
.segmented button {
  font-size: 11px;
  color: var(--muted);
  border-radius: 4px;
  padding: 3px 8px;
}
.segmented .selected {
  background: #fff;
  color: var(--green);
  box-shadow: 0 1px 3px #24312a13;
  font-weight: 550;
}
.stock-wrap {
  padding: 0 15px;
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
}
.stock-table {
  width: 100%;
  border-collapse: collapse;
  font-variant-numeric: tabular-nums;
  table-layout: auto;
  min-width: 100%;
}
.stock-table th,
.stock-table td {
  border-bottom: 1px solid #edf1ee;
  padding: 3px 7px;
  white-space: nowrap;
  text-align: right;
}
.stock-table th {
  font-weight: 400;
  font-size: 11px;
  color: var(--muted);
}
.stock-table th:first-child {
  text-align: left;
  min-width: 55px;
}
.stock-table tbody th {
  font-size: 12px;
  color: #36483c;
}
.stock-table td {
  font-size: 13px;
  line-height: 19px;
}
.stock-table td button {
  padding: 0;
  width: 100%;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.stock-table td button:hover {
  color: var(--green);
}
.sum-col {
  background: #f6f9f7;
  font-weight: 550;
}
.stock-table tfoot {
  background: #edf5ef;
  font-weight: 600;
}
.stock-table tfoot th {
  color: var(--green);
  font-weight: 550;
}
.dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  margin-right: 5px;
  vertical-align: middle;
}
.factory-dashboard .panel-foot {
  display: flex;
  gap: 5px;
  align-items: center;
  padding: 9px 17px;
  font-size: 11px;
  color: var(--green);
  border-top: 1px solid #f0f3f1;
  flex-shrink: 0;
  margin-top: auto;
  min-height: 33px;
  text-align: left;
}
.panel-foot svg {
  width: 12px;
}
.yield-head {
  display: flex;
  justify-content: space-between;
  margin: 0 17px;
  font-size: 10px;
  color: #718077;
  gap: 8px;
}
.yield-list {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.yield-row {
  margin: 0 17px;
  padding: 9px 0;
  text-align: left;
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: 50px;
}
.yield-values {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 5px;
  font-size: 11px;
}
.yield-values strong {
  font-size: 12px;
  max-width: 35%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.yield-values > span {
  font-size: 10px;
  color: var(--muted);
  white-space: nowrap;
}
.yield-values b {
  font-size: 21px;
  font-weight: 550;
  letter-spacing: -0.6px;
  white-space: nowrap;
}
.meter {
  height: 4px;
  background: #eef2ef;
  border-radius: 4px;
  overflow: hidden;
  margin-top: 7px;
}
.meter span {
  display: block;
  height: 100%;
  border-radius: 4px;
  background: #84a791;
}
.deadline-summary {
  display: grid;
  grid-template-columns: 1.4fr 1fr 1fr;
  margin: 3px 17px 5px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--line);
  gap: 8px;
}
.deadline-summary > div {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.deadline-summary b {
  font-size: 24px;
  font-weight: 550;
  line-height: 1.1;
  letter-spacing: -1px;
}
.deadline-summary small {
  font-size: 11px;
  margin-left: 2px;
  font-weight: 400;
  letter-spacing: 0;
}
.deadline-summary span {
  font-size: 10px;
  color: var(--muted);
  white-space: nowrap;
}
.late {
  color: #ad6544;
}
.delivery-list {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: auto;
}
.delivery-item {
  padding: 9px 17px;
  text-align: left;
  flex: 1;
  min-height: 88px;
}
.delivery-item + .delivery-item {
  border-top: 1px solid #f0f3f1;
}
.delivery-item > div:first-child {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 5px;
  font-size: 11px;
}
.delivery-item strong {
  font-weight: 550;
}
.badge {
  display: inline-block;
  font-size: 10px;
  padding: 2px 5px;
  border-radius: 4px;
  background: #f0f3f1;
  white-space: nowrap;
  margin-right: 4px;
}
.badge.late {
  background: #fbf0e9;
}
.delivery-item p {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 10px;
  color: var(--muted);
  margin: 5px 0 0;
}
.delivery-item .meter {
  height: 3px;
}
.delivery-item > small {
  display: block;
  color: #78877d;
  font-size: 10px;
  margin-top: 5px;
}
.chart-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 17px;
  font-size: 11px;
  color: var(--muted);
}
.shipping-chart {
  flex: 1;
  display: flex;
  min-height: 120px;
  margin: 0 14px 0 10px;
  cursor: pointer;
}
.legend {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 6px 14px;
  padding: 0 12px 12px;
  font-size: 10px;
  color: var(--muted);
}
.legend > span {
  display: flex;
  align-items: center;
  gap: 5px;
}
.legend i {
  height: 3px;
  width: 14px;
  border-radius: 3px;
}
.tabs {
  display: flex;
  gap: 13px;
}
.tabs button {
  position: relative;
  font-size: 11px;
  color: var(--muted);
  padding: 0 0 4px;
}
.tabs .selected {
  color: var(--green);
  border-bottom: 2px solid var(--green);
}
.attention-table-wrap {
  padding: 0 15px 10px;
  overflow: auto;
  flex: 1;
  min-height: 0;
}
.attention-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.attention-table th {
  text-align: left;
  font-weight: 400;
  color: #6c7c72;
  background: #f6f9f7;
  font-size: 10px;
  padding: 7px 6px;
  white-space: nowrap;
}
.attention-table td {
  padding: 13px 6px;
  border-bottom: 1px solid #edf1ee;
  white-space: nowrap;
}
.attention-table td:last-child,
.attention-table th:last-child {
  text-align: right;
}
.attention-table a {
  color: var(--green);
  text-decoration: none;
}
.attention-table a:hover {
  text-decoration: underline;
}
.empty {
  flex: 1;
  display: grid;
  place-items: center;
  font-size: 12px;
  color: var(--muted);
  min-height: 65px;
  text-align: center;
  margin: 0;
  padding: 15px;
}
.el-pagination {
  margin-top: 16px;
  justify-content: flex-end;
}
.rule-list dt {
  font-weight: 550;
  margin-top: 20px;
}
.rule-list dd {
  color: var(--muted);
  line-height: 1.8;
  margin: 6px 0 0;
}
@media (min-width: 1250px) and (min-height: 840px) {
  .stock-table td {
    font-size: 14px;
  }
  .stock-table tbody th {
    font-size: 13px;
  }
  .yield-values b {
    font-size: 23px;
  }
  .attention-table td {
    font-size: 12px;
    padding-block: 15px;
  }
  .panel-heading h2 {
    font-size: 16px;
  }
}
@media (max-width: 1249px) {
  .factory-dashboard {
    height: auto;
    min-height: calc(100dvh - var(--topbar-height, 56px));
  }
  .dashboard {
    grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr);
    grid-template-rows: 350px 325px 310px;
    grid-template-areas: 'inventory yield' 'shipping deadline' 'attention attention';
    flex: none;
  }
  .updated {
    display: none;
  }
}
@media (max-width: 800px) {
  .factory-dashboard {
    padding: 12px;
  }
  .dashboard {
    grid-template-columns: 1fr;
    grid-template-rows: 335px 315px 300px 340px 300px;
    grid-template-areas: 'inventory' 'yield' 'shipping' 'deadline' 'attention';
    gap: 12px;
  }
  .overview-heading h1 {
    font-size: 20px;
  }
  .overview-heading > div {
    gap: 10px;
  }
  .attention .panel-heading {
    align-items: flex-start;
    flex-direction: column;
  }
  .stock-table td {
    font-size: 13px;
  }
  .attention-table {
    min-width: 550px;
  }
}
</style>
<style>
.factory-detail-dialog {
  max-width: calc(100vw - 28px);
}
.factory-detail-dialog .el-table {
  font-size: 13px;
}
</style>
