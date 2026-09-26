<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { ElAlert, ElButton, ElDialog, ElIcon } from 'element-plus'
import {
  ArrowRight,
  Box,
  CircleCheck,
  Flag,
  Monitor,
  Refresh,
  Tickets,
  Van,
} from '@element-plus/icons-vue'
import LedgerChart from '@/components/LedgerChart.vue'
import StatePanel from '@/components/StatePanel.vue'
import { factoryLiveApi } from '@/services/factoryLiveApi'
import type { InventoryConnection } from '@/services/inventoryStream'
import type { FactoryLive, LiveTeam } from '@/types/factoryLive'
import { inventoryReconciles, kg, number, stockTypes, sumAmounts } from '@/utils/factoryGlass'
import { formatDateTime } from '@/utils/format'

const report = ref<FactoryLive | null>(null)
const loading = ref(false),
  error = ref('')
const connection = ref<InventoryConnection>('connecting')
const reduced = ref(false),
  hidden = ref(document.hidden)
const typeDialog = ref(false),
  selectedTeam = ref<string | null>(null)
let version = 0,
  unsubscribe: (() => void) | undefined
let media: MediaQueryList | undefined
const motion = computed(() => !reduced.value && !hidden.value && !error.value)
const teams = computed(() => report.value?.teams || [])
const connectionLabel = computed(
  () =>
    ({ connecting: '正在连接', live: '实时同步', reconnecting: '正在重连', expired: '凭证已失效' })[
      connection.value
    ],
)
const updatedAt = computed(() => (report.value ? formatDateTime(report.value.as_of) : '—'))
const warning = computed(() => {
  if (!report.value) return ''
  const missing = teams.value.filter((team) => !team.id).map((team) => team.name)
  const inactive = teams.value.filter((team) => team.id && !team.active).map((team) => team.name)
  return [
    missing.length ? `未配置：${missing.join('、')}，汇总范围不完整` : '',
    inactive.length ? `已停用班组仍保留库存：${inactive.join('、')}` : '',
    report.value.legacy_received_count
      ? `${report.value.legacy_received_count} 条历史接收未纳入库存`
      : '',
    !inventoryReconciles(report.value) ? '班组与物料分类合计未核平，请核对库存明细' : '',
  ]
    .filter(Boolean)
    .join('；')
})
const colors = ['#58986f', '#a2c899', '#79a9ce', '#a6afb6']
const allTypes = computed(() => stockTypes(report.value?.material_types || []))
const mainTypes = computed(() =>
  [
    ...allTypes.value.slice(0, 3),
    { key: 'others', label: '其余类型', color: colors[3]!, ...sumAmounts(allTypes.value.slice(3)) },
  ].map((item, i) => ({ ...item, color: colors[i]! })),
)
const focusedTeam = computed(() => teams.value.find((team) => team.code === selectedTeam.value))
const dialogTypes = computed(() =>
  selectedTeam.value ? stockTypes(focusedTeam.value?.material_types || []) : allTypes.value,
)
const dialogTotal = computed(() => sumAmounts(dialogTypes.value))
const maxWeight = computed(() =>
  Math.max(1, ...teams.value.map((team) => team.balance?.on_hand_weight || 0)),
)
const ringOption = computed(() => ({
  tooltip: { trigger: 'item', valueFormatter: (value: unknown) => `${kg(Number(value))} kg` },
  series: [
    {
      type: 'pie',
      radius: ['66%', '86%'],
      center: ['50%', '50%'],
      label: { show: false },
      itemStyle: { borderWidth: 2, borderColor: '#fff' },
      emphasis: { scaleSize: 4 },
      data: mainTypes.value
        .filter((item) => item.weight > 0)
        .map((item) => ({
          name: item.label,
          value: item.weight,
          itemStyle: { color: item.color },
        })),
    },
  ],
}))
// A pending batch can contain many serials. Use the server's complete batch rows
// for amounts; the capped per-team serial feed cannot safely reconstruct totals.
const recentPending = computed(() =>
  (report.value?.recent_batches || [])
    .filter(
      (row) =>
        row.entry_kind === 'transfer' &&
        ['pending', 'partial'].includes(row.status) &&
        row.source_id != null &&
        row.target_id != null,
    )
    .slice(0, 4),
)
const attentionTab = ref<'pending' | 'urgent'>('pending')
const attentionTeams = computed(() =>
  teams.value
    .filter((team) =>
      attentionTab.value === 'pending'
        ? (team.pending_incoming?.batches || 0) > 0
        : (team.urgent_serial_count || 0) > 0,
    )
    .sort((a, b) =>
      attentionTab.value === 'pending'
        ? (b.pending_incoming?.batches || 0) - (a.pending_incoming?.batches || 0)
        : (b.urgent_serial_count || 0) - (a.urgent_serial_count || 0),
    ),
)
const pendingLink = {
  path: '/transfer-batches',
  query: { status: 'pending', entry_kind: 'transfer' },
}
function teamLink(team: LiveTeam, tab = 'stock', urgent = false) {
  return {
    path: `/team-workspaces/${team.id}`,
    query: { tab, ...(urgent ? { urgent_only: 'true' } : {}) },
  }
}
function showTypes(team?: LiveTeam) {
  selectedTeam.value = team?.code ?? null
  typeDialog.value = true
}
function load() {
  const current = ++version
  unsubscribe?.()
  // All homepage sections switch together on a single authoritative snapshot.
  unsubscribe = factoryLiveApi.subscribe({
    onData(next) {
      if (current === version) {
        report.value = next
        loading.value = false
        error.value = ''
      }
    },
    onState(state) {
      if (current !== version) return
      connection.value = state
      loading.value = state === 'connecting'
      if (state === 'live') error.value = ''
      if (state === 'reconnecting' || state === 'expired') {
        error.value = report.value
          ? '实时连接中断，当前显示上次成功读取的数据。'
          : '库存数据连接失败，正在自动重连。'
        if (state === 'expired') error.value = '登录或访问凭证已失效，请重新验证。'
      }
    },
  })
}
function syncMotion() {
  reduced.value = Boolean(media?.matches)
}
function syncVisibility() {
  hidden.value = document.hidden
  if (hidden.value) {
    ++version
    unsubscribe?.()
    unsubscribe = undefined
  } else load()
}
onMounted(() => {
  media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
  syncMotion()
  media?.addEventListener('change', syncMotion)
  document.addEventListener('visibilitychange', syncVisibility)
  if (!document.hidden) load()
})
onBeforeUnmount(() => {
  ++version
  unsubscribe?.()
  media?.removeEventListener('change', syncMotion)
  document.removeEventListener('visibilitychange', syncVisibility)
})
</script>

<template>
  <section class="page inventory-home" aria-label="全厂库存总览">
    <div class="home-content">
      <header class="home-heading">
        <div>
          <h1>全厂库存总览</h1>
          <p>看清库存分布，及时完成班组交接</p>
        </div>
        <div class="home-actions">
          <ElButton :icon="Refresh" :loading="loading" aria-label="刷新库存" circle @click="load" />
          <RouterLink :to="pendingLink" class="home-button home-button--primary"
            ><ElIcon><Tickets /></ElIcon>查看待接收<span v-if="report" class="button-count">{{
              number(report.internal_pending.batches)
            }}</span></RouterLink
          >
          <RouterLink to="/factory-live" class="home-button"
            ><ElIcon><Monitor /></ElIcon>大屏展示</RouterLink
          >
        </div>
      </header>
      <ElAlert v-if="error && report" :title="error" type="warning" :closable="false" show-icon />
      <ElAlert v-if="warning" :title="warning" type="warning" :closable="false" show-icon />
      <StatePanel v-if="!report && error" state="error" :description="error" @retry="load" />
      <StatePanel v-else-if="!report" state="loading" title="正在读取库存" />
      <template v-else>
        <section class="home-metrics" aria-label="全厂关键数据">
          <article class="home-metric">
            <ElIcon><Box /></ElIcon>
            <div>
              <h2>全厂在库</h2>
              <p>
                <strong>{{ number(report.totals.on_hand_quantity) }}</strong> 件
              </p>
              <span>{{ kg(report.totals.on_hand_weight) }} kg</span>
            </div>
          </article>
          <article class="home-metric">
            <ElIcon><Van /></ElIcon>
            <div>
              <h2>内部在途</h2>
              <p>
                <strong>{{ number(report.totals.in_transit_quantity) }}</strong> 件
              </p>
              <span>{{ kg(report.totals.in_transit_weight) }} kg</span>
            </div>
          </article>
          <article class="home-metric">
            <ElIcon><Tickets /></ElIcon>
            <div>
              <h2>待接收</h2>
              <p>
                <strong>{{ number(report.internal_pending.batches) }}</strong> 批
              </p>
              <span>班组间待确认</span>
            </div>
          </article>
          <article class="home-metric">
            <ElIcon><CircleCheck /></ElIcon>
            <div>
              <h2>今日已接收</h2>
              <p>
                <strong>{{ number(report.today.received_batches) }}</strong> 批
              </p>
              <span>{{ updatedAt.slice(0, 10) }}</span>
            </div>
          </article>
        </section>
        <div class="home-grid">
          <section class="home-panel team-panel" aria-labelledby="team-stock-title">
            <header class="panel-heading">
              <div>
                <h2 id="team-stock-title">班组库存分布</h2>
                <p>按在库重量展示 · 件数与重量同时核对</p>
              </div>
              <RouterLink to="/factory-stock" class="text-action"
                >查看明细<ElIcon><ArrowRight /></ElIcon
              ></RouterLink>
            </header>
            <div class="team-head" aria-hidden="true">
              <span>班组</span><span>库存分布</span><span>件数</span><span>重量 kg</span
              ><span>分类</span>
            </div>
            <div
              v-for="team in teams"
              :key="team.code"
              class="team-stock-row"
              :data-team-code="team.code"
            >
              <div class="team-name">
                <RouterLink
                  v-if="team.id && team.active"
                  :to="teamLink(team)"
                  :aria-label="`查看${team.name}库存明细`"
                  >{{ team.name }}</RouterLink
                ><span v-else>{{ team.name }}</span
                ><small v-if="!team.id || !team.active">{{ team.id ? '已停用' : '未配置' }}</small>
              </div>
              <meter
                :value="Math.max(0, team.balance?.on_hand_weight || 0)"
                min="0"
                :max="maxWeight"
                :aria-label="`${team.name}在库重量 ${kg(team.balance?.on_hand_weight)} kg`"
              />
              <span class="stock-quantity numeric">{{
                number(team.balance?.on_hand_quantity)
              }}</span
              ><span class="stock-weight numeric">{{ kg(team.balance?.on_hand_weight) }}</span>
              <button
                class="type-detail"
                :disabled="!team.balance"
                :aria-label="`查看${team.name}物料分类`"
                @click="showTypes(team)"
              >
                <ElIcon><ArrowRight /></ElIcon>
              </button>
            </div>
            <footer class="team-panel-footer">
              <span>{{ teams.length }} 个班组</span><span>库存含余料及废料，内部在途单列</span>
            </footer>
          </section>
          <section class="home-panel type-panel" aria-labelledby="stock-types-title">
            <header class="panel-heading">
              <div>
                <h2 id="stock-types-title">物料类型</h2>
                <p>按在库重量</p>
              </div>
            </header>
            <div class="home-ring">
              <LedgerChart
                :option="ringOption"
                :smooth-update="true"
                :enter-duration="250"
                label="物料类型在库重量占比，件数及重量见下方明细"
                :motion="motion"
                :empty="!mainTypes.some((item) => item.weight > 0)"
                @select="showTypes()"
              />
              <div v-if="mainTypes.some((item) => item.weight > 0)" class="ring-total">
                <strong>{{ kg(report.totals.on_hand_weight) }}</strong
                ><span>kg</span>
              </div>
            </div>
            <table class="type-table">
              <thead>
                <tr>
                  <th>类型</th>
                  <th>件数</th>
                  <th>重量 kg</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in mainTypes" :key="item.key">
                  <td>
                    <span class="type-key" :style="{ color: item.color }">●</span>{{ item.label }}
                  </td>
                  <td>{{ number(item.quantity) }}</td>
                  <td>{{ kg(item.weight) }}</td>
                </tr>
              </tbody>
            </table>
            <footer class="type-footer">
              <span>其余含余料、废品、废料等</span
              ><button class="text-action" @click="showTypes()">
                全部类型<ElIcon><ArrowRight /></ElIcon>
              </button>
            </footer>
          </section>
          <section class="home-panel pending-panel" aria-labelledby="pending-title">
            <header class="panel-heading">
              <div><h2 id="pending-title">待接收转料</h2></div>
              <RouterLink :to="pendingLink" class="text-action"
                >查看全部<ElIcon><ArrowRight /></ElIcon
              ></RouterLink>
            </header>
            <div v-if="recentPending.length" class="pending-scroll">
              <table class="pending-table">
                <thead>
                  <tr>
                    <th>批次</th>
                    <th>班组流向</th>
                    <th>件数 / 重量</th>
                    <th>状态</th>
                    <th aria-label="操作"></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in recentPending" :key="row.batch_no">
                    <td>
                      <span class="batch-number" :title="row.batch_no">{{ row.batch_no }}</span>
                    </td>
                    <td>{{ row.source_name }} → {{ row.target_name }}</td>
                    <td>{{ number(row.quantity) }} 件 / {{ kg(row.weight) }} kg</td>
                    <td>
                      <span class="pending-label">{{
                        row.status === 'partial' ? '部分接收' : '待接收'
                      }}</span>
                    </td>
                    <td>
                      <RouterLink
                        :to="{ path: '/transfer-batches/scan', query: { batch_no: row.batch_no } }"
                        class="text-action"
                        :aria-label="`查看批次 ${row.batch_no}`"
                        >查看</RouterLink
                      >
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-else class="home-empty">
              <ElIcon><CircleCheck /></ElIcon
              ><strong>{{
                report.internal_pending.batches
                  ? '近期记录中没有待接收批次'
                  : '暂无班组间待接收物料'
              }}</strong>
              <p>
                {{
                  report.internal_pending.batches
                    ? '可通过“查看全部”查询历史待接收记录。'
                    : '新的班组交接会在这里显示。'
                }}
              </p>
            </div>
            <p v-if="recentPending.some((row) => row.status === 'partial')" class="amount-note">
              部分接收显示整批件数与重量，剩余待接收量请进入批次查看。
            </p>
          </section>
          <section class="home-panel attention-panel" aria-labelledby="attention-title">
            <header class="panel-heading">
              <h2 id="attention-title">重点关注</h2>
              <ElIcon><Flag /></ElIcon>
            </header>
            <div class="attention-tabs" role="group" aria-label="关注类别">
              <button :aria-pressed="attentionTab === 'pending'" @click="attentionTab = 'pending'">
                待接收班组</button
              ><button :aria-pressed="attentionTab === 'urgent'" @click="attentionTab = 'urgent'">
                在库加急
              </button>
            </div>
            <div v-if="attentionTeams.length" class="attention-list">
              <div v-for="team in attentionTeams" :key="team.code" class="attention-row">
                <div>
                  <strong>{{ team.name }}</strong
                  ><span>{{
                    attentionTab === 'pending'
                      ? `${number(team.pending_incoming?.quantity)} 件 / ${kg(team.pending_incoming?.weight)} kg`
                      : '在库加急流水号'
                  }}</span>
                </div>
                <RouterLink
                  v-if="team.id && team.active"
                  :to="
                    teamLink(
                      team,
                      attentionTab === 'pending' ? 'pending' : 'stock',
                      attentionTab === 'urgent',
                    )
                  "
                  :aria-label="`查看${team.name}${attentionTab === 'pending' ? '待接收' : '加急物料'}`"
                  >{{
                    number(
                      attentionTab === 'pending'
                        ? team.pending_incoming?.batches
                        : team.urgent_serial_count,
                    )
                  }}
                  {{ attentionTab === 'pending' ? '批' : '个'
                  }}<ElIcon><ArrowRight /></ElIcon></RouterLink
                ><span v-else>已停用</span>
              </div>
            </div>
            <div v-else class="home-empty attention-empty">
              <ElIcon><CircleCheck /></ElIcon>
              <p>{{ attentionTab === 'pending' ? '各班组暂无待接收记录' : '暂无在库加急物料' }}</p>
            </div>
          </section>
        </div>
        <footer class="home-footer">
          <span>在库含废料，不含已转出待确认物料；内部在途单独统计。</span>
          <div>
            <span role="status">{{ connectionLabel }}</span
            ><time :datetime="report.as_of">{{ updatedAt }}</time
            ><RouterLink to="/factory-analysis">数据分析</RouterLink>
          </div>
        </footer>
      </template>
    </div>
    <ElDialog
      v-model="typeDialog"
      :title="`${focusedTeam?.name || '全厂'} · 在库物料分类`"
      width="560px"
      class="home-types-dialog"
    >
      <p class="type-dialog-summary">
        合计 {{ number(dialogTotal.quantity) }} 件 / {{ kg(dialogTotal.weight) }} kg
      </p>
      <table class="type-table type-table--dialog">
        <thead>
          <tr>
            <th>类型</th>
            <th>件数</th>
            <th>重量 kg</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in dialogTypes" :key="item.key">
            <td>{{ item.label }}</td>
            <td>{{ number(item.quantity) }}</td>
            <td>{{ kg(item.weight) }}</td>
          </tr>
        </tbody>
      </table>
      <template #footer><ElButton @click="typeDialog = false">关闭</ElButton></template>
    </ElDialog>
  </section>
</template>

<style scoped>
.inventory-home {
  --primary: #337d4d;
  --text: #24312a;
  --muted: #67756d;
  --subtle: #67756d;
  --line: #e5ebe7;
  --surface-soft: #edf5ef;
  --el-color-primary: #337d4d;
  padding: 20px 28px;
  background: #f6f8f7;
  color: var(--text);
  font-family: 'HeatSink Inter', 'PingFang SC', 'Microsoft YaHei', sans-serif;
}
.home-content {
  max-width: 1600px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.home-heading,
.home-actions,
.panel-heading,
.home-footer,
.home-footer > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.home-heading {
  margin-bottom: 0;
}
.home-heading h1 {
  margin: 0;
  font-size: 26px;
  line-height: 1.3;
  font-weight: 550;
  letter-spacing: -0.5px;
}
.home-heading p,
.panel-heading p {
  margin: 6px 0 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--muted);
}
.home-actions {
  gap: 10px;
  flex-shrink: 0;
}
.home-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 40px;
  gap: 8px;
  padding: 8px 14px;
  border: 1px solid #d9e2dc;
  border-radius: 8px;
  background: #fff;
  font-size: 13px;
  white-space: nowrap;
}
.home-button:hover {
  border-color: var(--primary);
}
.home-button--primary {
  color: #fff;
  border-color: var(--primary);
  background: var(--primary);
}
.button-count {
  padding: 1px 6px;
  border-radius: 4px;
  background: #e9f3dc;
  color: #245633;
  font-size: 12px;
}
.home-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}
.home-metric {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  padding: 15px 22px;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 12px;
}
.home-metric > .el-icon {
  flex: 0 0 40px;
  height: 40px;
  font-size: 23px;
  border-radius: 9px;
  color: var(--primary);
  background: #eef6f0;
}
.home-metric > div {
  min-width: 0;
}
.home-metric h2 {
  margin: 0 0 5px;
  font-size: 13px;
  font-weight: 400;
  color: var(--muted);
}
.home-metric p {
  line-height: 1.3;
  margin: 0 0 4px;
  font-size: 13px;
  white-space: nowrap;
}
.home-metric strong {
  font-size: clamp(22px, 2vw, 30px);
  font-weight: 550;
  letter-spacing: -0.7px;
  font-variant-numeric: tabular-nums;
}
.home-metric span {
  font-size: 13px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.home-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.75fr) minmax(310px, 1fr);
  gap: 16px;
}
.home-panel {
  padding: 18px 22px;
  min-width: 0;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: #fff;
}
.panel-heading {
  min-height: 28px;
  margin-bottom: 16px;
  align-items: flex-start;
}
.panel-heading h2 {
  margin: 0;
  font-size: 17px;
  font-weight: 550;
  letter-spacing: -0.3px;
}
.text-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  flex-shrink: 0;
  color: var(--primary);
  background: none;
  border: 0;
  padding: 2px 0;
  font: inherit;
  font-size: 13px;
}
.text-action:hover {
  text-decoration: underline;
}
.team-head,
.team-stock-row {
  display: grid;
  grid-template-columns: 66px minmax(40px, 1fr) 76px 88px 28px;
  column-gap: 12px;
  align-items: center;
}
.team-head {
  font-size: 12px;
  color: var(--muted);
  padding: 8px 0;
}
.team-head > :nth-child(n + 3),
.numeric {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.team-stock-row {
  min-height: 33px;
  border-bottom: 1px solid #f0f3f1;
  font-size: 14px;
}
.team-name {
  display: flex;
  flex-direction: column;
}
.team-name a:hover {
  color: var(--primary);
  text-decoration: underline;
}
.team-name small {
  font-size: 10px;
  color: var(--muted);
}
.stock-weight {
  color: var(--muted);
}
meter {
  width: 100%;
  height: 9px;
  border: none;
  background: #eef2f0;
  border-radius: 3px;
  appearance: none;
}
meter::-webkit-meter-bar {
  border: 0;
  border-radius: 3px;
  background: #eef2f0;
  height: 9px;
}
meter::-webkit-meter-optimum-value {
  background: #80ab8c;
  border-radius: 3px;
}
meter::-moz-meter-bar {
  background: #80ab8c;
  border-radius: 3px;
}
.type-detail {
  border: 0;
  background: none;
  color: var(--primary);
  width: 28px;
  height: 32px;
  padding: 0;
  display: grid;
  place-items: center;
}
.type-detail:disabled {
  color: #b9c3bc;
  cursor: default;
}
.team-panel-footer {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  color: var(--muted);
  font-size: 12px;
  margin-top: 14px;
}
.home-ring {
  height: 146px;
  position: relative;
  display: flex;
  margin: -4px 0 8px;
}
.ring-total {
  pointer-events: none;
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 4px;
}
.ring-total strong {
  font-size: 22px;
  font-weight: 550;
  font-variant-numeric: tabular-nums;
}
.ring-total span {
  font-size: 12px;
  color: var(--muted);
}
.type-table {
  border-collapse: collapse;
  width: 100%;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.type-table th {
  font-size: 12px;
  color: var(--muted);
  font-weight: 400;
}
.type-table th,
.type-table td {
  padding: 4px 0;
  border-bottom: 1px solid #f0f3f1;
  text-align: right;
}
.type-table :is(th, td):first-child {
  text-align: left;
}
.type-key {
  margin-right: 9px;
  font-size: 16px;
}
.type-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
  font-size: 11px;
  color: var(--muted);
}
.pending-scroll {
  position: relative;
  overflow-x: auto;
}
.pending-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.pending-table th {
  color: var(--muted);
  font-weight: 400;
  background: #f7f9f8;
  font-size: 12px;
}
.pending-table th,
.pending-table td {
  line-height: 20px;
  padding: 6px 8px;
  border-bottom: 1px solid #edf1ee;
  text-align: left;
  white-space: nowrap;
}
.pending-table th:first-child,
.pending-table td:first-child {
  padding-left: 0;
}
.batch-number {
  display: block;
  max-width: 155px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pending-label {
  padding: 3px 7px;
  border-radius: 5px;
  color: #94600f;
  background: #fff5e4;
  font-size: 12px;
}
.attention-tabs {
  display: flex;
  gap: 16px;
  margin-top: -4px;
  border-bottom: 1px solid var(--line);
}
.attention-tabs button {
  font: inherit;
  font-size: 13px;
  color: var(--muted);
  background: none;
  border: 0;
  padding: 7px 0 10px;
  border-bottom: 2px solid transparent;
}
.attention-tabs button[aria-pressed='true'] {
  color: var(--primary);
  border-bottom-color: var(--primary);
}
.attention-list {
  max-height: 124px;
  overflow-y: auto;
}
.attention-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px solid #f0f3f1;
}
.attention-row > div {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.attention-row strong {
  font-size: 13px;
  font-weight: 500;
}
.attention-row span {
  font-size: 12px;
  color: var(--muted);
}
.attention-row a {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--primary);
  font-size: 13px;
}
.attention-row a:hover {
  text-decoration: underline;
}
.home-empty {
  display: flex;
  min-height: 170px;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 10px;
  color: var(--muted);
  text-align: center;
}
.home-empty > .el-icon {
  font-size: 25px;
  color: #82a88d;
}
.home-empty strong {
  font-size: 14px;
  font-weight: 500;
}
.home-empty p {
  margin: 0;
  font-size: 13px;
}
.attention-empty {
  min-height: 150px;
}
.amount-note {
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 0;
}
.home-footer {
  font-size: 11px;
  color: var(--muted);
  gap: 10px;
  flex-wrap: wrap;
}
.home-footer > div {
  gap: 12px;
  flex-wrap: wrap;
}
.home-footer a {
  color: var(--primary);
}
.home-footer [role='status'] {
  color: var(--primary);
}
.pending-panel .panel-heading {
  margin-bottom: 12px;
}
.home-actions :deep(.el-button) {
  border-color: #d9e2dc;
  color: #64726a;
}
.type-panel .panel-heading > div {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.type-panel .panel-heading p {
  margin: 0;
}
.type-dialog-summary {
  margin: 0 0 20px;
  color: #52645a;
}
.type-table--dialog {
  font-size: 14px;
}
.type-table--dialog td {
  padding-block: 11px;
}

@media (min-width: 1800px) and (min-height: 950px) {
  .inventory-home {
    padding: 36px;
  }
  .home-content {
    gap: 24px;
  }
  .home-panel {
    padding: 28px;
  }
  .team-stock-row {
    min-height: 44px;
  }
  .home-ring {
    height: 220px;
  }
}
@media (max-width: 1180px) {
  .inventory-home {
    padding: 22px;
  }
  .home-metric {
    padding: 16px;
    gap: 10px;
  }
  .home-metric > .el-icon {
    flex-basis: 32px;
    height: 32px;
    font-size: 20px;
  }
  .home-grid {
    grid-template-columns: minmax(0, 1.55fr) minmax(280px, 1fr);
    gap: 16px;
  }
  .home-panel {
    padding: 18px;
  }
  .team-head,
  .team-stock-row {
    grid-template-columns: 54px minmax(28px, 1fr) 64px 68px 24px;
    gap: 8px;
  }
}
@media (max-width: 1000px) {
  .home-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .home-grid {
    grid-template-columns: 1fr;
  }
  .home-heading {
    flex-wrap: wrap;
  }
  .home-ring {
    height: 185px;
  }
  .type-panel .type-table {
    font-size: 14px;
  }
  .home-footer {
    line-height: 1.8;
  }
}
@media (max-width: 640px) {
  .inventory-home {
    padding: 20px 14px;
  }
  .home-content {
    gap: 16px;
  }
  .home-heading h1 {
    font-size: 23px;
  }
  .home-actions {
    width: 100%;
    gap: 8px;
  }
  .home-button {
    font-size: 12px;
    padding-inline: 10px;
  }
  .home-metrics {
    gap: 10px;
  }
  .home-metric {
    padding: 14px 12px;
    gap: 10px;
  }
  .home-metric strong {
    font-size: 24px;
  }
  .home-metric > .el-icon {
    display: none;
  }
  .home-panel {
    padding: 16px;
  }
  .team-head,
  .team-stock-row {
    grid-template-columns: 48px minmax(10px, 1fr) 65px 66px 22px;
    gap: 5px;
  }
  .team-head > :last-child {
    font-size: 10px;
    white-space: nowrap;
  }
  .team-panel-footer {
    flex-wrap: wrap;
  }
  .home-heading p {
    font-size: 12px;
  }
  .home-footer > div {
    gap: 8px;
  }
}

/* Allocate desktop panels from the available viewport, including browser chrome.
   Narrow windows and zoomed layouts retain normal page scrolling. */
@media (min-width: 1100px) and (min-height: 650px) {
  .inventory-home {
    --home-gap: clamp(8px, 1.4dvh, 16px);
    padding-block: clamp(8px, 1.4dvh, 20px);
  }
  .home-content {
    height: 100%;
    gap: var(--home-gap);
  }
  .home-heading,
  .home-metrics,
  .home-footer {
    flex-shrink: 0;
  }
  .home-grid {
    flex: 1;
    min-height: 0;
    grid-template-rows: minmax(264px, 1.5fr) minmax(138px, 1fr);
    gap: var(--home-gap);
  }
  .home-panel {
    min-height: 0;
    display: flex;
    flex-direction: column;
    padding-block: clamp(9px, 1.4dvh, 18px);
  }
  .panel-heading,
  .pending-panel .panel-heading {
    flex-shrink: 0;
    min-height: 24px;
    margin-bottom: 8px;
  }
  .team-head,
  .team-panel-footer,
  .type-table,
  .type-footer,
  .attention-tabs {
    flex-shrink: 0;
  }
  .team-head {
    padding-block: 3px;
  }
  .team-stock-row {
    flex: 1;
    min-height: 22px;
  }
  .type-detail {
    height: 24px;
  }
  .team-panel-footer {
    margin-top: 6px;
  }
  .home-ring {
    flex: 1;
    height: auto;
    min-height: 60px;
    max-height: 220px;
    margin: 0 0 6px;
  }
  .pending-scroll,
  .attention-list {
    min-height: 0;
    overflow: auto;
  }
  .attention-list {
    flex: 1;
    max-height: none;
  }
  .home-empty {
    flex: 1;
    min-height: 0;
  }
  .amount-note {
    flex-shrink: 0;
    margin-top: 4px;
  }
  /* Keep connection and reconciliation warnings visible even if they need a
     second screen; never clip a business warning to meet the dashboard fit. */
  .home-content:has(> .el-alert) {
    height: auto;
    min-height: 100%;
  }
}
@media (min-width: 1100px) and (min-height: 650px) and (max-height: 950px) {
  .home-heading > div:first-child {
    display: flex;
    align-items: baseline;
    gap: 14px;
  }
  .home-heading h1 {
    font-size: 23px;
    white-space: nowrap;
  }
  .home-heading p {
    margin: 0;
    font-size: 12px;
  }
  .home-button {
    min-height: 36px;
    padding-block: 6px;
  }
  .home-metric {
    padding: 6px 16px;
    gap: 12px;
    align-items: center;
  }
  .home-metric h2 {
    margin-bottom: 2px;
    font-size: 12px;
    line-height: 16px;
  }
  .home-metric > div {
    line-height: 16px;
  }
  .home-metric p {
    margin: 0;
    line-height: 28px;
  }
  .home-metric strong {
    font-size: 26px;
  }
  .home-metric span {
    font-size: 12px;
    line-height: 16px;
  }
  .panel-heading,
  .pending-panel .panel-heading {
    min-height: 22px;
    margin-bottom: 4px;
  }
  .panel-heading h2 {
    font-size: 16px;
    line-height: 22px;
  }
  .team-panel .panel-heading p {
    display: none;
  }
  .team-head {
    padding-block: 1px;
  }
  .team-panel-footer {
    margin-top: 4px;
  }
  .type-panel .type-table :is(th, td) {
    padding-block: 1px;
  }
  .type-footer {
    margin-top: 4px;
  }
  .ring-total strong {
    font-size: 18px;
  }
  .ring-total {
    gap: 0;
  }
  .pending-table :is(th, td) {
    padding-block: 1px;
  }
  .attention-tabs button {
    padding-block: 5px;
  }
  .attention-row {
    padding-block: 6px;
  }
}
@media (min-width: 1100px) and (min-height: 650px) and (max-height: 780px) {
  .type-panel {
    display: grid;
    grid-template-columns: minmax(80px, 1fr) minmax(0, 2fr);
    grid-template-rows: auto minmax(0, 1fr) auto;
    column-gap: 12px;
  }
  .type-panel .panel-heading,
  .type-footer {
    grid-column: 1 / -1;
  }
  .home-ring {
    align-self: stretch;
    max-height: none;
    margin: 0;
  }
  .type-panel .type-table {
    align-self: center;
  }
  .type-key {
    margin-right: 5px;
  }
  .ring-total strong {
    font-size: clamp(13px, 1.2vw, 16px);
  }
}
</style>
<style>
.home-types-dialog {
  max-width: calc(100vw - 28px);
  border-radius: 12px;
}
</style>
