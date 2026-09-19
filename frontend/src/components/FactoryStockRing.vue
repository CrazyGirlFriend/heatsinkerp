<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { init, use, type EChartsType } from 'echarts/core'
import { PieChart } from 'echarts/charts'
import { CanvasRenderer } from 'echarts/renderers'
import { kg, sumAmounts, type StockType } from '@/utils/factoryGlass'
use([PieChart, CanvasRenderer])
const props = defineProps<{ items: StockType[]; motion: boolean }>()
const element = ref<HTMLElement>()
let chart: EChartsType | undefined
function draw() {
  chart?.setOption({ animation: props.motion, animationDuration: 450, animationDurationUpdate: 650,
    series: [{ type: 'pie', radius: ['58%', '91%'], center: ['50%', '50%'], startAngle: 90,
      silent: true, label: { show: false }, minAngle: 0, itemStyle: { borderColor: '#e4f7f3', borderWidth: 1 },
      data: props.items.filter(item => item.weight > 0).map(item => ({ name: item.key, value: Math.round(item.weight * 1000), itemStyle: { color: item.color } })),
    }],
  }, { notMerge: true })
}
onMounted(() => { if (element.value) chart = init(element.value, null, { renderer: 'canvas', devicePixelRatio: Math.min(window.devicePixelRatio || 1, 2) }); draw() })
watch(() => [props.items, props.motion], draw)
onBeforeUnmount(() => chart?.dispose())
</script>
<template>
  <div class="stock-ring">
    <div ref="element" class="ring-chart" role="img" aria-label="库存类型按重量占比；件数和重量见右侧明细" />
    <div class="ring-number"><strong>{{ kg(sumAmounts(items).weight) }}</strong><span>kg</span></div>
  </div>
</template>
