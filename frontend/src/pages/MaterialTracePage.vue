<script setup lang="ts">
import { ArrowRight, DataAnalysis, Location, Search, View } from '@element-plus/icons-vue'
import {
  ElButton,
  ElCard,
  ElIcon,
  ElInput,
  ElScrollbar,
  ElTag,
  ElTimeline,
  ElTimelineItem,
} from 'element-plus'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import MaterialTransferDrawer from '@/components/MaterialTransferDrawer.vue'
import RecordDateFilter from '@/components/RecordDateFilter.vue'
import SerialUrgencyBadge from '@/components/SerialUrgencyBadge.vue'
import StatePanel from '@/components/StatePanel.vue'
import LiveRefreshNotice from '@/components/LiveRefreshNotice.vue'
import { useLiveRefresh } from '@/composables/useLiveRefresh'
import { materialTransferApi } from '@/services/materialTransferApi'
import type { MaterialTransfer, MaterialTransferDirection, MaterialTransferFilterParams } from '@/types/materialTransfer'
import { teamDirectory } from '@/stores/teamDirectory'
import { externalActionLabel, isExternalTransfer, materialTransferStatusLabel, materialTransferStatusTone } from '@/types/materialTransfer'
import { formatDateTime } from '@/utils/format'

const route = useRoute()
const router = useRouter()
const scopeKey = computed(() => JSON.stringify([route.query.team_id ?? '', route.query.direction ?? 'all']))
const scopeTeamId = computed(() => Number(route.query.team_id))
const hasTeamScope = computed(() => route.query.team_id !== undefined)
const validScope = computed(() => !hasTeamScope.value || typeof route.query.team_id === 'string' && /^\d+$/.test(route.query.team_id) && Number.isSafeInteger(scopeTeamId.value) && scopeTeamId.value > 0)
const scopeParams = computed<MaterialTransferFilterParams>(() => hasTeamScope.value ? { team_id: scopeTeamId.value, direction: (['incoming', 'outgoing'].includes(String(route.query.direction)) ? route.query.direction : 'all') as MaterialTransferDirection } : {})
const scopeLabel = computed(() => teamDirectory.items.find(team => String(team.id) === String(scopeTeamId.value))?.name || `班组 ${scopeTeamId.value}`)
const scopeDirectionLabel = computed(() => scopeParams.value.direction === 'incoming' ? '接收' : scopeParams.value.direction === 'outgoing' ? '发出' : '相关交接')
const searchedScope = ref('')
const serialDraft = ref(typeof route.query.serial_no === 'string' ? route.query.serial_no : '')
const searchedSerial = ref('')
const dates = computed(() => ({ from: typeof route.query.date_from === 'string' ? route.query.date_from : '', to: typeof route.query.date_to === 'string' ? route.query.date_to : '' }))
const visibleTransfers = computed(() => chronologicalTransfers.value.filter(row => {
  if (!dates.value.from && !dates.value.to) return true
  const time = new Date(row.transferred_at)
  if (!Number.isFinite(time.getTime())) return false
  const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(time)
  return (!dates.value.from || day >= dates.value.from) && (!dates.value.to || day <= dates.value.to)
}))
const transfers = ref<MaterialTransfer[]>([])
const loading = ref(false)
const errorMessage = ref('')
const searched = ref(false)
const drawerOpen = ref(false)
const selected = ref<MaterialTransfer | null>(null)
let requestVersion = 0

const chronologicalTransfers = computed(() => [...transfers.value].sort((left, right) => {
  const leftTime = Date.parse(left.transferred_at)
  const rightTime = Date.parse(right.transferred_at)
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) return leftTime - rightTime
  return String(left.id).localeCompare(String(right.id), undefined, { numeric: true })
}))
const validTransfers = computed(() => chronologicalTransfers.value.filter((transfer) => transfer.status !== 'voided'))
const latestTransfer = computed(() => validTransfers.value.at(-1) ?? null)
const receivedCount = computed(() => transfers.value.filter((transfer) => transfer.status === 'received').length)
const dispatchedCount = computed(() => transfers.value.filter(transfer => transfer.status === 'dispatched').length)
const pendingCount = computed(() => transfers.value.filter((transfer) => transfer.status === 'pending').length)
const currentState = computed(() => {
  const latest = latestTransfer.value
  if (!latest) return { tone: 'info' as const, label: '暂无有效流转', location: '—', description: '该流水号没有有效转料记录' }
  if (isExternalTransfer(latest)) {
    const verb = externalActionLabel(latest.entry_kind)
    return { tone: latest.status === 'dispatched' ? 'success' as const : 'warning' as const, label: materialTransferStatusLabel(latest.status, latest.entry_kind), location: latest.external_destination || '未填写外部去向', description: latest.status === 'dispatched' ? `由${latest.source_team.name}确认${verb}，确认人：${latest.dispatched_by || '—'}` : `等待${latest.source_team.name}确认实际${verb}` }
  }
  if (latest.status === 'pending') {
    return {
      tone: 'warning' as const,
      label: '最近一笔在途',
      location: `${latest.source_team.name} → ${latest.next_team.name}`,
      description: `最近一笔正在等待${latest.next_team.name}确认接收`,
    }
  }
  return {
    tone: 'success' as const,
    label: latest.entry_kind === 'warehouse_receipt' ? '最近已入库' : '最近已接收',
    location: latest.next_team.name,
    description: `最近确认位置：${latest.next_team.name}`,
  }
})

function numberText(value: number, unit: string): string {
  return `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 3 }).format(value)} ${unit}`
}

async function search(background = false): Promise<void> {
  const serialNo = background ? searchedSerial.value : serialDraft.value.trim()
  if (!serialNo || loading.value) return
  if (!validScope.value) { searched.value = true; errorMessage.value = '无效的班组范围，请从班组工作台重新打开追踪'; return }
  const version = ++requestVersion
  searched.value = true
  searchedSerial.value = serialNo
  searchedScope.value = scopeKey.value
  if (!background) loading.value = true
  errorMessage.value = ''
  if (!background) transfers.value = []
  const scope = { ...scopeParams.value }
  if (!background) await router.replace({ path: route.path, query: { ...route.query, serial_no: serialNo, ...(hasTeamScope.value ? { team_id: String(scope.team_id), direction: scope.direction } : {}) } })
  try {
    const collected: MaterialTransfer[] = []
    let nextPage = 1
    let expectedTotal = 1
    while (collected.length < expectedTotal) {
      const result = await materialTransferApi.list({ serial_no: serialNo, ...scope, page: nextPage, page_size: 100 })
      if (version !== requestVersion) return
      expectedTotal = result.total
      collected.push(...result.items)
      if (!result.items.length) break
      nextPage += 1
    }
    const uniqueTransfers = new Map(collected.map((transfer) => [String(transfer.id), transfer]))
    transfers.value = [...uniqueTransfers.values()].filter((transfer) => transfer.serial_no === serialNo)
  } catch (error) {
    if (version !== requestVersion) return
    if (background) throw error
    errorMessage.value = error instanceof Error ? error.message : '流水号查询失败'
  } finally {
    if (version === requestVersion) loading.value = false
  }
}
const liveRefresh = useLiveRefresh(() => search(true), {
  enabled: () => searched.value && Boolean(searchedSerial.value) && validScope.value,
  busy: () => loading.value,
})

function openTransfer(transfer: MaterialTransfer): void {
  selected.value = transfer
  drawerOpen.value = true
}

function updateTransfer(transfer: MaterialTransfer): void {
  const index = transfers.value.findIndex((item) => item.batch_no === transfer.batch_no)
  if (index >= 0) transfers.value.splice(index, 1, transfer)
  selected.value = transfer
}

watch([() => route.query.serial_no, scopeKey], ([value, scope]) => {
  const next = typeof value === 'string' ? value : ''
  if (next !== searchedSerial.value || scope !== searchedScope.value) {
    ++requestVersion
    transfers.value = []
    drawerOpen.value = false
    selected.value = null
    loading.value = false
    searched.value = false
    errorMessage.value = ''
    serialDraft.value = next
    if (next) void search()
  }
})

onMounted(() => { if (serialDraft.value.trim()) void search() })
onBeforeUnmount(() => { ++requestVersion })
</script>

<template>
  <section class="page workspace-page material-trace-page reading-workspace">
    <LiveRefreshNotice :message="liveRefresh.message.value" @retry="liveRefresh.request" />
    <header class="page-heading trace-heading">
      <div><h1>流水号追踪</h1><span v-if="hasTeamScope && validScope">{{ `${scopeLabel} · ${scopeDirectionLabel}记录` }}</span></div>
    </header>

    <ElCard class="trace-search" shadow="never">
      <form @submit.prevent="search()">
        <ElInput v-model="serialDraft" autocomplete="off" clearable placeholder="输入完整流水号" aria-label="流水号" @clear="errorMessage = ''">
          <template #prefix><ElIcon><Search /></ElIcon></template>
        </ElInput>
        <RecordDateFilter :model-value="dates" @update:model-value="router.replace({ path: route.path, query: { ...route.query, date_from: $event.from || undefined, date_to: $event.to || undefined } })" />
        <ElButton type="primary" native-type="submit" :loading="loading" :disabled="!serialDraft.trim()">查询</ElButton>
      </form>
    </ElCard>

    <div v-if="!searched && !loading" class="trace-welcome">
      <ElIcon><DataAnalysis /></ElIcon><strong>输入流水号查询流转轨迹</strong>
    </div>
    <StatePanel v-else-if="loading" class="trace-state" state="loading" title="正在查询流转记录" />
    <StatePanel v-else-if="errorMessage" class="trace-state" state="error" :description="errorMessage" @retry="search" />

    <div v-else class="trace-result">
      <ElCard class="trace-summary" shadow="never">
        <div class="serial-identity"><span>流水号</span><strong>{{ searchedSerial }}</strong><SerialUrgencyBadge :urgency="transfers[0]?.urgency" /></div>
        <div class="location-summary">
          <ElIcon><Location /></ElIcon>
          <div><span>{{ hasTeamScope ? '所选班组范围内的最近流转状态' : '最近流转状态' }}</span><strong>{{ currentState.location }}</strong><small>{{ currentState.description }}</small></div>
          <ElTag :type="currentState.tone" effect="plain">{{ currentState.label }}</ElTag>
        </div>
        <div class="trace-metrics" aria-label="流转统计">
          <article><span>流转记录</span><strong>{{ transfers.length }}</strong></article>
          <article><span>待确认</span><strong>{{ pendingCount }}</strong></article>
          <article><span>已接收 / 入库</span><strong>{{ receivedCount }}</strong></article><article><span>已出库 / 发货</span><strong>{{ dispatchedCount }}</strong></article>
        </div>
      </ElCard>

      <ElCard class="trace-chain" shadow="never">
        <template #header><div class="chain-heading"><strong>流转轨迹</strong><span>{{ dates.from || dates.to ? `日期内 ${visibleTransfers.length} 条 · 最近状态按完整记录显示` : '按单据时间顺序排列' }}</span></div></template>
        <ElScrollbar v-if="visibleTransfers.length" class="chain-scroll">
          <ElTimeline class="transfer-timeline">
            <ElTimelineItem
              v-for="(transfer, index) in visibleTransfers"
              :key="transfer.batch_no"
              :type="materialTransferStatusTone(transfer.status)"
              :timestamp="formatDateTime(transfer.transferred_at)"
              placement="top"
            >
              <ElButton text class="chain-item" @click="openTransfer(transfer)">
                <span class="chain-index">{{ String(index + 1).padStart(2, '0') }}</span>
                <span class="chain-body">
                  <span class="chain-top"><strong>{{ transfer.batch_no }}</strong><ElTag :type="materialTransferStatusTone(transfer.status)" size="small" effect="plain">{{ materialTransferStatusLabel(transfer.status, transfer.entry_kind) }}</ElTag></span>
                  <span class="chain-route"><b><template v-if="transfer.entry_kind === 'warehouse_receipt'">入库来源：</template>{{ transfer.source_team.name }}</b><ElIcon><ArrowRight /></ElIcon><b><template v-if="isExternalTransfer(transfer)">外部去向：</template>{{ transfer.next_team.name }}</b></span>
                  <span class="chain-meta"><i>{{ numberText(transfer.quantity, transfer.quantity_unit) }}</i><i>{{ numberText(transfer.weight, transfer.weight_unit) }}</i><i>{{ transfer.entry_kind === 'warehouse_receipt' || isExternalTransfer(transfer) ? '登记人' : '转料人' }}：{{ transfer.transferred_by || '—' }}</i><i v-if="transfer.received_at && transfer.entry_kind !== 'warehouse_receipt' && !isExternalTransfer(transfer)">接收：{{ transfer.received_by || '—' }} · {{ formatDateTime(transfer.received_at) }}</i><i v-if="transfer.dispatched_at">{{ externalActionLabel(transfer.entry_kind) }}确认：{{ transfer.dispatched_by || '—' }} · {{ formatDateTime(transfer.dispatched_at) }}</i></span>
                </span>
                <ElIcon class="chain-view"><View /></ElIcon>
              </ElButton>
            </ElTimelineItem>
          </ElTimeline>
        </ElScrollbar>
        <StatePanel v-else state="empty" title="暂无流转记录" :description="dates.from || dates.to ? '所选日期内暂无记录，可清空日期查看完整轨迹。' : '该流水号尚未创建转料单。'" />
      </ElCard>
    </div>

    <MaterialTransferDrawer :key="scopeKey" v-model="drawerOpen" :batch-no="selected?.batch_no" :transfer="selected" :trace-scope="scopeParams" @changed="updateTransfer" />
  </section>
</template>

<style scoped>
.trace-heading span { display: block; margin-top: 8px; color: var(--subtle); font-size: 14px; }
.trace-search { flex: 0 0 auto; border: 1px solid var(--line); border-radius: 8px; margin-bottom: 12px; }
.trace-search :deep(.el-card__body) { padding: 12px; }
.trace-search form { display: flex; align-items: center; max-width: 660px; gap: 12px; }
.trace-search .el-button { min-width: 90px; }
.trace-welcome, .trace-state { display: flex; align-items: center; justify-content: center; flex: 1; min-height: 260px; gap: 16px; border-top: 1px solid var(--line); color: var(--subtle); }
.trace-welcome > .el-icon { color: var(--subtle); font-size: 32px; }
.trace-welcome strong { font-size: 15px; font-weight: 500; }
.trace-result { display: flex; flex: 1; min-height: 0; gap: 12px; flex-direction: column; }
.trace-summary { flex: 0 0 auto; border-radius: 8px; }
.trace-summary :deep(.el-card__body) { display: grid; grid-template-columns: minmax(180px, .85fr) minmax(280px, 1.3fr) auto; align-items: center; min-height: 90px; padding: 16px; gap: 20px; }
.serial-identity { display: grid; min-width: 0; gap: 8px; }
.serial-identity span, .location-summary > div > span, .location-summary small { color: var(--subtle); font-size: 13px; }
.serial-identity strong { color: var(--text); font-size: 20px; font-weight: 600; overflow-wrap: anywhere; }
.location-summary { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 16px; }
.location-summary > .el-icon { display: none; }
.location-summary > div { display: grid; min-width: 0; gap: 6px; }
.location-summary strong { color: var(--text); font-size: 16px; font-weight: 500; }
.trace-metrics { display: flex; border-left: 1px solid var(--line); }
.trace-metrics article { display: grid; justify-items: center; padding-inline: 16px; gap: 8px; }
.trace-metrics span { color: var(--subtle); font-size: 13px; white-space: nowrap; }
.trace-metrics strong { color: var(--text); font-size: 24px; font-weight: 600; line-height: 1.2; }
.trace-chain { flex: 1; min-height: 0; overflow: hidden; }
.trace-chain :deep(.el-card__header) { height: 48px; padding: 12px 16px; }
.trace-chain :deep(.el-card__body) { height: calc(100% - 48px); min-height: 0; padding: 0; }
.chain-heading { display: flex; align-items: baseline; gap: 16px; }
.chain-heading span { color: var(--subtle); font-size: 13px; }
.chain-scroll { height: 100%; }
.transfer-timeline { margin: 0; padding: 16px 20px 4px 28px; }
.transfer-timeline :deep(.el-timeline-item) { padding-bottom: 12px; }
.transfer-timeline :deep(.el-timeline-item__timestamp) { color: var(--subtle); font-size: 13px; }
.chain-item { display: grid; grid-template-columns: minmax(0, 1fr) 24px; width: 100%; height: auto; min-height: 88px; margin: 0; padding: 8px 0 12px; gap: 12px; border-bottom: 1px solid var(--line); border-radius: 0; text-align: left; }
.chain-item :deep(> span) { display: contents; }
.chain-index { display: none; }
.chain-body { display: grid; min-width: 0; gap: 8px; }
.chain-top, .chain-route, .chain-meta { display: flex; align-items: center; gap: 12px; }
.chain-top { justify-content: space-between; }
.chain-top strong { color: var(--primary); font-size: 14px; font-weight: 500; overflow-wrap: anywhere; }
.chain-route { color: var(--text); }
.chain-route b { font-size: 15px; font-weight: 500; }
.chain-route .el-icon { color: var(--subtle); }
.chain-meta { white-space: normal; line-height: 1.6; flex-wrap: wrap; color: var(--subtle); font-size: 13px; }
.chain-meta i { font-style: normal; }
.chain-view { align-self: center; color: var(--subtle); }
@media (max-width: 1200px) { .trace-summary :deep(.el-card__body) { grid-template-columns: 1fr 1.5fr; } .trace-metrics { grid-column: 1 / -1; justify-content: flex-start; border-left: 0; } .trace-metrics article { padding: 0 32px 0 0; justify-items: start; } }
@media (max-width: 760px) {
  .material-trace-page { height: auto; min-height: calc(100dvh - var(--topbar-height)); overflow: auto; }
  .trace-result { flex: none; min-height: 670px; gap: 20px; }
  .trace-summary :deep(.el-card__body) { grid-template-columns: 1fr; padding: 20px; }
  .trace-metrics { grid-column: auto; }
  .trace-chain { min-height: 460px; }
  .transfer-timeline { padding: 20px 16px 0 20px; }
  .chain-item { grid-template-columns: minmax(0, 1fr); }
  .chain-view { display: none; }
  .chain-heading { gap: 10px; }
}
</style>
