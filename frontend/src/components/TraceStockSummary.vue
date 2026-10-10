<script setup lang="ts">
import { computed } from 'vue'
import { ElPopover } from 'element-plus'
import type { MaterialTrace, TraceAmount } from '@/types/materialTrace'
import { isScrapType, materialTypeLabel } from '@/types/materialTransfer'
import { teamWorkspaceProfiles } from '@/config/teamWorkspaces'
import { historyNumber as num } from '@/utils/serialHistoryChart'
import type { FlowMetric } from '@/utils/flowPreview'

const props = defineProps<{ trace: MaterialTrace; teams: string[]; metric: FlowMetric; range: { start: number; end: number }; appendTo?: HTMLElement; compact?: boolean }>()
const emit = defineEmits<{ 'update:metric': [value: FlowMetric] }>()
const unit = computed(() => props.metric === 'weight' ? 'kg' : '件')
const available = computed(() => props.trace.holdings !== undefined)
const add = (total: TraceAmount, amount: TraceAmount) => {
  total.quantity += amount.quantity
  total.weight = Math.round((total.weight + amount.weight) * 1000000) / 1000000
}
const stock = computed(() => {
  const teams = new Map<string, { quantity: number; weight: number; natures: Array<TraceAmount & { name: string }> }>()
  const total = { quantity: 0, weight: 0 }, scrap = { quantity: 0, weight: 0 }
  const waste = new Map<string, { quantity: number; weight: number; teams: Array<TraceAmount & { name: string }> }>()
  for (const holding of props.trace.holdings || []) {
    const name = teamWorkspaceProfiles.find(team => team.code === holding.team_code)?.name || holding.team_name
    const row = teams.get(name) || { quantity: 0, weight: 0, natures: [] }
    for (const nature of holding.material_types) {
      if (isScrapType(nature.material_type)) {
        const type = materialTypeLabel(nature.material_type)
        const group = waste.get(type) || { quantity: 0, weight: 0, teams: [] }
        add(group, nature); add(scrap, nature)
        group.teams.push({ ...nature, name }); waste.set(type, group)
      } else {
        add(row, nature); add(total, nature)
        row.natures.push({ ...nature, name: materialTypeLabel(nature.material_type) })
      }
    }
    teams.set(name, row)
  }
  const shipped = { quantity: 0, weight: 0 }
  for (const batch of props.trace.items) {
    if (batch.status === 'dispatched' && batch.material_type === 'finished') add(shipped, batch)
  }
  return { teams, total, scrap, waste: [...waste].map(([name, row]) => ({ name, ...row })), shipped }
})
const rows = computed(() => props.teams.map((name, index) => ({ name,
  external: name.startsWith('外部 · '),
  amount: stock.value.teams.get(name) || { quantity: 0, weight: 0, natures: [] },
  top: ((index + .5) / props.teams.length * 100 - props.range.start) / (props.range.end - props.range.start) * 100,
})))
</script>

<template>
  <aside class="trace-stock-summary" :class="{ compact, 'has-gap': metric === 'weight' && trace.shortage && trace.shortage.weight > 0 }" aria-label="流水号当前库存">
    <header class="stock-heading"><h2>当前正常料库存</h2><div class="stock-unit" role="group" aria-label="库存单位"><button type="button" :aria-pressed="metric === 'quantity'" @click="emit('update:metric', 'quantity')">件数</button><button type="button" :aria-pressed="metric === 'weight'" @click="emit('update:metric', 'weight')">重量</button></div></header>
    <div class="stock-rows">
      <div v-for="row in rows" :key="row.name" class="stock-row" :class="{ 'stock-row--external': row.external }" :style="{ top: `${row.top}%`, height: `${10000 / teams.length / (range.end - range.start)}%` }" :data-team="row.name">
        <span class="stock-team">{{ row.name }}</span>
        <span v-if="row.external || !available" class="stock-unavailable">—</span>
        <ElPopover v-else-if="row.amount.natures.length" trigger="click" placement="left" :width="280" :append-to="appendTo" :title="`${row.name}库存`">
          <template #reference><button class="stock-value" :class="{ 'stock-value--shortage': row.amount[metric] < 0 }" type="button" :aria-label="`${row.name}库存 ${num(row.amount[metric])} ${unit}，查看物料类型`"><strong>{{ num(row.amount[metric]) }}</strong><small>{{ unit }}</small></button></template>
          <div class="stock-breakdown"><div v-for="nature in row.amount.natures" :key="nature.name"><span>{{ nature.name }}</span><b>{{ num(nature[metric]) }} {{ unit }}</b></div></div>
        </ElPopover>
        <span v-else class="stock-zero">0 <small>{{ unit }}</small></span>
      </div>
    </div>
    <footer class="stock-totals">
      <div class="stock-total"><span>正常料合计</span><strong>{{ available ? num(stock.total[metric]) : '—' }} <small v-if="available">{{ unit }}</small></strong></div>
      <ElPopover trigger="click" placement="left-end" :width="300" :append-to="appendTo" title="废料库存">
        <template #reference><button type="button" class="stock-waste" :disabled="!stock.waste.length" aria-label="查看废料分类与存放班组"><span>废料另计 <i v-if="stock.waste.length">›</i></span><b>{{ available ? num(stock.scrap.weight) : '—' }} <small v-if="available">kg</small></b></button></template>
        <div class="stock-breakdown stock-waste-details"><section v-for="nature in stock.waste" :key="nature.name"><header><b>{{ nature.name }}</b><b>{{ num(nature.weight) }} kg</b></header><div v-for="team in nature.teams" :key="team.name"><span>{{ team.name }}</span><span>{{ num(team.weight) }} kg<template v-if="team.quantity"> · {{ num(team.quantity) }} 件</template></span></div></section></div>
      </ElPopover>
      <div v-if="metric === 'weight' && trace.shortage && trace.shortage.weight > 0" class="stock-gap"><span>重量差异</span><b>{{ num(trace.shortage[metric]) }} <small>{{ unit }}</small></b></div>
      <div class="stock-shipped"><span>成品已发货</span><b>{{ num(stock.shipped[metric]) }} <small>{{ unit }}</small></b></div>
    </footer>
  </aside>
</template>

<style scoped>
.trace-stock-summary { position: relative; width: 184px; flex: 0 0 184px; border-left: 1px solid var(--line); color: var(--text); font-variant-numeric: tabular-nums; }
.stock-heading { height: 64px; display: flex; flex-direction: column; align-items: flex-end; gap: 9px; padding: 0 12px; box-sizing: border-box; }
.stock-heading h2 { margin: 0; font-size: 15px; font-weight: 600; }.stock-unit { display: flex; padding: 2px; border-radius: 20px; background: var(--surface-soft); }
.stock-unit button { border: 0; padding: 3px 10px; border-radius: 16px; font: inherit; font-size: 12px; color: var(--muted); background: transparent; cursor: pointer; }.stock-unit button[aria-pressed=true] { color: var(--primary); background: var(--glass-surface); box-shadow: var(--glass-shadow); }
.stock-rows { position: absolute; top: 64px; bottom: 144px; left: 0; right: 0; overflow: hidden; }
.stock-row { position: absolute; left: 0; right: 0; transform: translateY(-50%); display: flex; align-items: center; justify-content: flex-end; padding: 0 12px; box-sizing: border-box; border-bottom: 1px solid var(--line-light); }.stock-row:nth-child(odd) { background: var(--surface-soft); }.stock-team { display: none; }
.stock-value { padding: 5px 0 5px 8px; border: 0; border-bottom: 1px dashed var(--el-color-primary-light-5); background: transparent; color: var(--primary); cursor: pointer; font: inherit; }.stock-value strong { font-size: 18px; font-weight: 600; }.stock-value:hover { border-bottom-style: solid; }
small { font-size: 11px; font-weight: 400; color: var(--muted); margin-left: 4px; }.stock-zero, .stock-unavailable { color: var(--subtle); font-size: 16px; }
.stock-totals { position: absolute; bottom: 0; left: 0; right: 0; height: 144px; padding: 14px 12px 10px; box-sizing: border-box; background: var(--surface); border-top: 1px solid var(--line); display: flex; flex-direction: column; gap: 14px; font-size: 12px; }
.stock-totals > div, .stock-waste { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }.stock-total strong { font-size: 17px; color: var(--primary); }.stock-totals b { font-weight: 500; }.stock-waste { border: 0; padding: 0; background: none; color: var(--el-color-warning-dark-2); cursor: pointer; font: inherit; text-align: left; }.stock-waste i { font-size: 17px; font-style: normal; }.stock-waste:disabled { color: var(--muted); cursor: default; }.stock-shipped { color: var(--muted); }
.stock-breakdown { max-height: min(420px, 55vh); overflow: auto; font-size: 13px; color: var(--text); }.stock-breakdown > div, .stock-breakdown section > div, .stock-breakdown header { display: flex; justify-content: space-between; gap: 16px; padding: 8px 0; }.stock-breakdown b { font-weight: 500; }.stock-waste-details section + section { border-top: 1px solid var(--line); margin-top: 4px; }.stock-waste-details section > div { color: var(--muted); padding-top: 0; }
button:focus-visible { outline: 2px solid var(--primary); outline-offset: 3px; }
.compact { width: 190px; flex-basis: 190px; }.compact .stock-heading { height: 44px; gap: 5px; }.compact .stock-heading h2 { font-size: 13px; }.compact .stock-unit button { padding-block: 2px; font-size: 11px; }.compact .stock-rows { top: 44px; bottom: 100px; }.compact .stock-totals { height: 100px; gap: 10px; padding-top: 12px; }.compact .stock-value strong { font-size: 16px; }
@media (max-width: 1100px) {
  .trace-stock-summary { width: auto; flex: none; border-left: 0; border-top: 1px solid var(--line); padding-top: 16px; }.stock-heading { height: auto; flex-direction: row; justify-content: space-between; align-items: center; padding-bottom: 12px; }
  .stock-rows { position: static; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }.stock-row { position: static; height: auto !important; min-height: 42px; transform: none; justify-content: space-between; gap: 8px; }.stock-team { display: inline; font-size: 13px; }.stock-row--external { display: none; }.stock-value strong { font-size: 16px; }
  .stock-totals { position: static; height: auto; margin-top: 8px; }.stock-totals > div, .stock-waste { min-height: 22px; }
}
@media (max-width: 1100px) { .compact { width: auto; flex-basis: auto; }.compact .stock-heading { height: auto; }.compact .stock-totals { height: auto; }.compact .stock-rows { position: static; } }
.stock-value--shortage, .stock-gap { color: var(--el-color-danger); }
.compact.has-gap .stock-totals { gap: 3px; padding-top: 8px; padding-bottom: 6px; }
</style>
