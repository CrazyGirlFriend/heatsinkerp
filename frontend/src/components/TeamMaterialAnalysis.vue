<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElAlert, ElButton, ElDialog, ElOption, ElRadioButton, ElRadioGroup, ElSelect } from 'element-plus'
import TeamAnalyticsCharts from './TeamAnalyticsCharts.vue'
import MaterialAmount from './MaterialAmount.vue'
import StatePanel from './StatePanel.vue'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import type { TeamMaterialOverview } from '@/types/teamMaterials'
import type { MaterialAnalytics, Metric, SerialParams } from '@/types/materialAnalytics'

const props = defineProps<{ teamId: number; overview: TeamMaterialOverview }>()
const route = useRoute(), router = useRouter()
const days = computed<7 | 30>(() => route.query.days === '7' ? 7 : 30)
const metric = computed<Metric>(() => route.query.metric === 'quantity' ? 'quantity' : 'weight')
const data = ref<MaterialAnalytics | null>(null), error = ref(''), loading = ref(false), moreOpen = ref(false)
const refreshError = ref('')
let version = 0
function changeView(values: Record<string, string>) { void router.replace({ path: route.path, query: { tab: 'overview', days: String(days.value), metric: metric.value, ...values } }) }
function openSerials(params: SerialParams = {}, label = '') {
  moreOpen.value = false
  void router.push({ path: route.path, query: { tab: 'serials', days: String(days.value), metric: metric.value, ...Object.fromEntries(Object.entries(params).map(([key, value]) => [key, String(value)])), ...(label ? { filter_label: label } : {}) } })
}
async function load(background = false) {
  const current = ++version; loading.value = true; error.value = ''
  refreshError.value = ''
  try { const result = await teamMaterialApi.analytics(props.teamId, { days: days.value, metric: metric.value }); if (current === version) data.value = result }
  catch (e) { if (current === version) { if (background && data.value) refreshError.value = '分析更新失败，保留上次结果，请刷新重试。'; else { data.value = null; error.value = e instanceof Error ? e.message : '分析图表加载失败' } } }
  finally { if (current === version) loading.value = false }
}
watch([() => props.teamId, days, metric], () => { void load() }, { immediate: true })
watch(() => props.overview, () => { void load(true) })
onBeforeUnmount(() => { ++version })
</script>
<template>
  <div class="team-analysis-page">
    <ElAlert v-if="refreshError" :title="refreshError" type="warning" :closable="false" />
    <header class="analysis-toolbar">
      <div class="analysis-controls">
        <ElRadioGroup :model-value="metric" size="small" aria-label="图表统计单位" @update:model-value="changeView({ metric: String($event) })"><ElRadioButton value="weight">重量</ElRadioButton><ElRadioButton value="quantity">件数</ElRadioButton></ElRadioGroup>
        <ElSelect :model-value="days" size="small" aria-label="流转统计周期" @update:model-value="changeView({ days: String($event) })"><ElOption :value="7" label="近7天" /><ElOption :value="30" label="近30天" /></ElSelect>
        <ElButton size="small" :disabled="!data" @click="moreOpen = true">更多分析</ElButton>
        <ElButton size="small" type="primary" plain @click="openSerials()">查看流水号</ElButton>
      </div>
      <slot name="actions" />
    </header>
    <div class="analysis-balances" aria-label="班组库存汇总"><div><span>当前库存</span><MaterialAmount :quantity="overview.totals.on_hand_quantity" :weight="overview.totals.on_hand_weight" /></div><div><span>可用库存</span><MaterialAmount :quantity="overview.totals.available_quantity" :weight="overview.totals.available_weight" /></div><div title="已转出、下序尚未接收，不计入本班库存"><span>内部在途</span><MaterialAmount :quantity="overview.totals.in_transit_quantity" :weight="overview.totals.in_transit_weight" /></div></div>
    <StatePanel v-if="error" state="error" :description="error" @retry="load" />
    <StatePanel v-else-if="loading && !data" state="loading" title="正在读取分析图表" />
    <TeamAnalyticsCharts v-else-if="data" :data="data" :metric="metric" :class="{ 'charts-refreshing': loading }" @filter="openSerials" />
    <ElDialog v-model="moreOpen" title="上下序往来分析" width="min(1000px, 96vw)" append-to-body><TeamAnalyticsCharts v-if="data" :data="data" :metric="metric" mode="peers" @filter="openSerials" /></ElDialog>
  </div>
</template>
<style scoped>
.team-analysis-page { display: flex; flex: 0 0 auto; flex-direction: column; min-height: 0; min-width: 0; gap: 20px; padding-top: 16px; }
.analysis-toolbar, .analysis-balances, .analysis-controls { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.analysis-toolbar { justify-content: space-between; flex-shrink: 0; }
.analysis-balances { font-size: 13px; color: var(--subtle); }.analysis-balances :deep(strong) { font-size: 16px; }
.analysis-balances { flex-shrink: 0; gap: 12px 28px; }.analysis-balances > div { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.analysis-controls > .el-select { width: 96px; }.analysis-controls .el-button + .el-button { margin-left: 0; }
.charts-refreshing { opacity: .6; pointer-events: none; }
@media (max-width: 760px) { .analysis-balances, .analysis-controls { gap: 6px 8px; }.analysis-balances { font-size: 12px; }.analysis-balances :deep(strong) { font-size: 14px; } }
</style>
