<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { ElAlert, ElButton, ElTable, ElTableColumn, ElTag } from 'element-plus'
import AnimatedMetric from '@/components/AnimatedMetric.vue'
import StatePanel from '@/components/StatePanel.vue'
import { factoryOverviewApi } from '@/services/factoryOverviewApi'
import type { InventoryConnection } from '@/services/inventoryStream'
import type { FactoryOverview, FactoryStockRow } from '@/types/factoryOverview'
import { formatDateTime } from '@/utils/format'

const report = ref<FactoryOverview | null>(null)
const connection = ref<InventoryConnection>('connecting')
const error = ref('')
const reduced = ref(false)
const narrow = ref(false)
const changed = ref(new Set<string>())
const animate = computed(() => !reduced.value && connection.value === 'live')
const status = computed(
  () =>
    ({ connecting: '正在连接', live: '实时同步', reconnecting: '正在重连', expired: '验证已失效' })[
      connection.value
    ],
)
const matrix = computed(() => report.value?.stock_matrix)
const columns = computed(() => [
  ...(matrix.value?.materials.map((material) => ({
    key: `material:${material.name}`,
    label: material.name,
    total: false,
  })) ?? []),
  { key: 'total', label: '班组合计', total: true },
])
const rows = computed<FactoryStockRow[]>(() =>
  matrix.value
    ? [
        ...matrix.value.rows,
        {
          team_id: null,
          team_code: '__total',
          team_name: '全厂总计',
          active: true,
          amounts: Object.fromEntries(
            matrix.value.materials.map((material) => [material.name, material]),
          ),
          total: matrix.value.total,
        },
      ]
    : [],
)
const warning = computed(() => {
  const missing =
    matrix.value?.rows.filter((row) => row.team_id === null).map((row) => row.team_name) ?? []
  return [
    missing.length ? `未配置班组：${missing.join('、')}，总计仅含已配置班组。` : '',
    report.value?.legacy_received_count
      ? `${report.value.legacy_received_count} 条历史接收未纳入库存。`
      : '',
  ]
    .filter(Boolean)
    .join(' ')
})
const zero = { quantity: 0, weight: 0 }
function amount(value: unknown, column: { label: string; total: boolean }) {
  const row = value as FactoryStockRow
  return column.total
    ? row.total
    : (row.amounts[column.label] ?? (row.total === null ? null : zero))
}
function cellKey(row: unknown, key: string) {
  return `${(row as FactoryStockRow).team_code}:${key}`
}
function rowClass({ row }: { row: FactoryStockRow }) {
  return row.team_code === '__total' ? 'matrix-total-row' : ''
}
let stop: (() => void) | undefined,
  generation = 0
let timer: ReturnType<typeof setTimeout> | undefined
let media: MediaQueryList | undefined
let viewport: MediaQueryList | undefined
function clearChanges() {
  clearTimeout(timer)
  changed.value = new Set()
}
function accept(next: FactoryOverview) {
  if (!next.stock_matrix) {
    error.value = '库存明细数据不可用，请检查服务版本。'
    return
  }
  const before = new Map(rows.value.map((row) => [row.team_code, row]))
  report.value = next
  error.value = ''
  clearChanges()
  if (!animate.value || !before.size) return
  const updates = new Set<string>()
  for (const row of rows.value) {
    const previous = before.get(row.team_code)
    if (!previous) continue
    for (const column of columns.value) {
      const old = amount(previous, column),
        current = amount(row, column)
      if (old?.quantity !== current?.quantity || old?.weight !== current?.weight)
        updates.add(cellKey(row, column.key))
    }
  }
  changed.value = updates
  timer = setTimeout(clearChanges, 1800)
}
function connect() {
  const current = ++generation
  stop?.()
  stop = factoryOverviewApi.subscribe({
    onData(next) {
      if (current === generation) accept(next)
    },
    onState(state) {
      if (current !== generation) return
      connection.value = state
      if (state === 'reconnecting' || state === 'expired') {
        clearChanges()
        error.value =
          state === 'expired'
            ? '登录或访问凭证已失效，请重新验证。'
            : report.value
              ? '实时连接中断，当前保留上次数据，正在重连。'
              : '库存数据连接失败，正在重连。'
      }
    },
  })
}
function visibility() {
  if (document.hidden) {
    ++generation
    stop?.()
    stop = undefined
    clearChanges()
  } else connect()
}
function motionPreference() {
  reduced.value = Boolean(media?.matches)
  if (reduced.value) clearChanges()
}
function viewportSize() {
  narrow.value = Boolean(viewport?.matches)
}
onMounted(() => {
  media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
  viewport = window.matchMedia?.('(max-width: 640px)')
  motionPreference()
  viewportSize()
  media?.addEventListener('change', motionPreference)
  viewport?.addEventListener('change', viewportSize)
  document.addEventListener('visibilitychange', visibility)
  if (!document.hidden) connect()
})
onBeforeUnmount(() => {
  ++generation
  stop?.()
  clearChanges()
  media?.removeEventListener('change', motionPreference)
  viewport?.removeEventListener('change', viewportSize)
  document.removeEventListener('visibilitychange', visibility)
})
</script>

<template>
  <section class="page reading-workspace factory-stock-matrix">
    <h1 class="sr-only">全厂库存明细</h1>
    <div class="matrix-toolbar">
      <span class="matrix-scope">当前在库 · 含废料，不含在途</span>
      <div class="matrix-tools">
        <span
          class="matrix-connection"
          :class="{ 'is-live': connection === 'live' && !error }"
          role="status"
          ><i />{{ status }}</span
        >
        <time v-if="report" :datetime="report.as_of">{{ formatDateTime(report.as_of) }}</time>
        <ElButton
          :icon="Refresh"
          :loading="connection === 'connecting'"
          aria-label="重新连接库存数据"
          @click="connect"
          >重连</ElButton
        >
      </div>
    </div>
    <ElAlert v-if="error" :title="error" type="warning" :closable="false" show-icon />
    <ElAlert v-if="warning" :title="warning" type="warning" :closable="false" show-icon />
    <StatePanel
      v-if="!matrix"
      :state="error ? 'error' : 'loading'"
      :description="error || undefined"
      :title="error ? '库存加载失败' : '正在读取库存'"
      @retry="connect"
    />
    <template v-else>
      <ElTable
        :data="rows"
        row-key="team_code"
        border
        scrollbar-always-on
        class="business-table matrix-table"
        :row-class-name="rowClass"
        aria-label="班组材质库存汇总表"
      >
        <ElTableColumn label="班组 / 材质" fixed :width="narrow ? 120 : 140" align="center">
          <template #default="{ row }"
            ><strong class="matrix-team">{{ row.team_name }}</strong
            ><ElTag v-if="row.total === null" type="info" effect="plain" size="small">未配置</ElTag
            ><ElTag v-else-if="!row.active" type="info" effect="plain" size="small"
              >已停用</ElTag
            ></template
          >
        </ElTableColumn>
        <ElTableColumn
          v-for="column in columns"
          :key="column.key"
          :column-key="column.key"
          :label="column.label"
          :fixed="column.total && !narrow ? 'right' : undefined"
          :min-width="150"
          align="center"
          :class-name="column.total ? 'matrix-total-column' : ''"
        >
          <template #default="{ row }">
            <div
              class="matrix-amount"
              :class="{ 'is-changed': changed.has(cellKey(row, column.key)) }"
              :data-cell="cellKey(row, column.key)"
            >
              <span class="matrix-quantity"
                ><AnimatedMetric
                  :value="amount(row, column)?.quantity ?? null"
                  :animate="animate"
                  :precision="0"
                /><small>件</small></span
              >
              <span class="matrix-weight"
                ><AnimatedMetric
                  :value="amount(row, column)?.weight ?? null"
                  :animate="animate"
                  :precision="3"
                /><small>kg</small></span
              >
            </div>
          </template>
        </ElTableColumn>
      </ElTable>
      <footer class="matrix-footer">
        <span>{{ matrix.rows.length }} 个班组 · {{ matrix.materials.length }} 种在库材质</span
        ><span v-if="!matrix.materials.length">暂无在库物料</span
        ><span v-else>件数 / 重量（kg）</span>
      </footer>
    </template>
  </section>
</template>

<style scoped>
.factory-stock-matrix {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.matrix-toolbar,
.matrix-tools,
.matrix-footer {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
.matrix-toolbar,
.matrix-footer {
  justify-content: space-between;
  flex-shrink: 0;
}
.matrix-toolbar {
  min-height: 40px;
}
.matrix-scope,
.matrix-footer,
.matrix-tools time {
  color: var(--muted);
  font-size: 14px;
}
.matrix-tools .el-button {
  height: 40px;
  font-size: 14px;
}
.matrix-connection {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--muted);
  font-size: 14px;
}
.matrix-connection i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #9ba99f;
}
.matrix-connection.is-live i {
  background: #258058;
}
.matrix-table {
  flex: 0 0 auto;
  width: 100%;
  font-size: 14px;
  border-radius: var(--card-radius);
  --el-table-header-bg-color: var(--table-header-bg);
  --el-table-header-text-color: var(--text);
  --el-table-border-color: var(--line);
  --el-table-text-color: var(--text);
  --business-table-padding: 8px;
}
.matrix-table :deep(th.el-table__cell) {
  height: 44px;
  font-weight: 550;
}
.matrix-table :deep(.cell) {
  padding: 0 12px;
  line-height: 24px;
  overflow-wrap: anywhere;
}
.matrix-table :deep(.matrix-total-column),
.matrix-table :deep(.matrix-total-row > td) {
  background: var(--surface-soft);
}
.matrix-table :deep(.matrix-total-row > td) {
  border-top: 2px solid var(--table-header-line);
}
.matrix-table :deep(.matrix-total-row .matrix-quantity),
.matrix-table :deep(.matrix-total-column .matrix-quantity) {
  font-weight: 550;
  color: var(--primary);
}
.matrix-team {
  display: block;
  font-size: 14px;
  font-weight: 550;
}
.matrix-amount {
  padding: 4px 8px;
  border-radius: 5px;
  font-variant-numeric: tabular-nums;
}
.matrix-quantity,
.matrix-weight {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 6px;
  white-space: nowrap;
}
.matrix-quantity {
  font-size: 16px;
}
.matrix-weight,
.matrix-amount small {
  color: var(--muted);
  font-size: 14px;
  font-weight: 400;
}
.matrix-amount.is-changed {
  animation: stock-cell-update 1800ms ease-out;
}
.matrix-footer {
  padding: 0 4px;
}
@keyframes stock-cell-update {
  0%,
  35% {
    background: var(--surface-soft);
    box-shadow: inset 0 0 0 1px #99bea5;
  }
  100% {
    background: transparent;
    box-shadow: none;
  }
}
@media (max-width: 640px) {
  .matrix-tools {
    width: 100%;
    gap: 10px;
  }
  .matrix-tools .el-button {
    margin-left: auto;
  }
  .matrix-tools time {
    font-size: 12px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .matrix-amount.is-changed {
    animation: none;
  }
}
</style>
