<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { LiveTeam } from '@/types/factoryLive'
import {
  curvePoint,
  number,
  teamPositions,
  zonePolygons,
  type Curve,
  type GlassLink,
} from '@/utils/factoryGlass'
const props = defineProps<{
  teams: LiveTeam[]
  links: GlassLink[]
  focus: string
  selectedRoute: string
  motion: boolean
  density: number
}>()
const emit = defineEmits<{ selectTeam: [code: string]; selectRoute: [key: string] }>()
const canvas = ref<HTMLCanvasElement>()
const activeCount = computed(() => props.links.filter((link) => link.pending_batches > 0).length)
const markers = computed(() => props.teams.filter((team) => teamPositions[team.code]))
const focusedLinks = computed(() => props.links.filter((link) => link.source.code === props.focus))
let frame = 0
function stroke(
  ctx: CanvasRenderingContext2D,
  curve: Curve,
  color: string,
  width: number,
  glow = 0,
) {
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.shadowColor = color
  ctx.shadowBlur = glow
  ctx.beginPath()
  ctx.moveTo(...curve[0])
  ctx.bezierCurveTo(...curve[1], ...curve[2], ...curve[3])
  ctx.stroke()
  ctx.shadowBlur = 0
}
function render() {
  cancelAnimationFrame(frame)
  const element = canvas.value,
    ctx = element?.getContext('2d')
  if (!element || !ctx) return
  const density = Math.min(props.density || 1, 2)
  element.width = 1672 * density
  element.height = 941 * density
  ctx.scale(density, density)
  const running = props.motion && activeCount.value > 0
  let previousFrame = 0
  const ordered = [...props.links].sort(
    (a, b) => Number(a.source.code === props.focus) - Number(b.source.code === props.focus),
  )
  function draw(time: number) {
    if (running) frame = requestAnimationFrame(draw)
    if (running && time - previousFrame < 32) return
    previousFrame = time
    ctx!.clearRect(0, 0, 1672, 941)
    const zone = zonePolygons[props.focus]
    if (zone && props.teams.some((team) => team.code === props.focus && team.id != null)) {
      ctx!.beginPath()
      zone.forEach((point, i) => (i ? ctx!.lineTo(...point) : ctx!.moveTo(...point)))
      ctx!.closePath()
      ctx!.fillStyle = '#00dfc411'
      ctx!.fill()
      ctx!.strokeStyle = '#6dfff4'
      ctx!.lineWidth = 2
      ctx!.shadowColor = '#00ead2'
      ctx!.shadowBlur = 15
      ctx!.stroke()
      ctx!.shadowBlur = 0
    }
    for (const link of ordered) {
      const curve = link.curve,
        active = link.pending_batches > 0,
        focused = link.source.code === props.focus
      const color = !active ? '#627d8b88' : focused ? '#00eed1' : '#6dccff'
      ctx!.setLineDash(active ? [] : [5, 6])
      stroke(ctx!, curve, active ? '#19687b66' : color, focused ? 5 : 3.3)
      stroke(ctx!, curve, color, focused ? 3 : 1.6, focused && active ? 17 : 3)
      ctx!.setLineDash([])
      if (active) {
        const tip = curve[3],
          before = curvePoint(curve, 0.97)
        ctx!.save()
        ctx!.translate(...tip)
        ctx!.rotate(Math.atan2(tip[1] - before[1], tip[0] - before[0]))
        ctx!.beginPath()
        ctx!.moveTo(0, 0)
        ctx!.lineTo(-17, -7)
        ctx!.lineTo(-12, 0)
        ctx!.lineTo(-17, 7)
        ctx!.closePath()
        ctx!.fillStyle = focused ? '#d5fff8' : '#ddf6ff'
        ctx!.shadowColor = color
        ctx!.shadowBlur = 6
        ctx!.fill()
        ctx!.restore()
      }
      if (active && running) {
        const colors = focused ? ['#6dffcf', '#88d6ff', '#ffd08d'] : ['#b9e9ff']
        colors.forEach((dotColor, dot) => {
          const phase = ((link.source_id * 7 + link.target_id * 3) % 13) / 13
          const t =
            (time / (link.key === props.selectedRoute ? 4100 : 5300) + phase - dot * 0.075 + 2) % 1
          const point = curvePoint(curve, t)
          ctx!.beginPath()
          ctx!.arc(...point, focused ? 6 : 2.7, 0, Math.PI * 2)
          ctx!.fillStyle = dotColor
          ctx!.shadowColor = dotColor
          ctx!.shadowBlur = focused ? 18 : 5
          ctx!.fill()
          ctx!.beginPath()
          ctx!.arc(...point, focused ? 2.4 : 1, 0, Math.PI * 2)
          ctx!.fillStyle = '#fff'
          ctx!.fill()
          ctx!.shadowBlur = 0
        })
      }
    }
  }
  draw(performance.now())
}
onMounted(render)
watch(() => [props.links, props.focus, props.selectedRoute, props.motion, props.density], render, {
  flush: 'post',
})
// The page may be revisited repeatedly; release the owned frame loop on teardown.
onBeforeUnmount(() => cancelAnimationFrame(frame))
</script>
<template>
  <div class="factory-scene">
    <canvas
      ref="canvas"
      :aria-label="`多对多流转图，${activeCount} 条线路待接收`"
      :data-active-links="activeCount"
      :data-motion="motion && activeCount > 0"
    />
    <button
      v-for="team in markers"
      :key="team.code"
      class="team-marker"
      :class="{ selected: team.code === focus, unavailable: team.id == null }"
      :disabled="team.id == null"
      :style="{
        left: teamPositions[team.code]![0] + 'px',
        top: teamPositions[team.code]![1] + 'px',
      }"
      :aria-pressed="team.code === focus"
      :aria-label="`查看${team.name}库存及流转`"
      @click="emit('selectTeam', team.code)"
    >
      {{ team.name }}<small v-if="team.id == null">未配置</small>
    </button>
    <button
      v-for="link in focusedLinks"
      :key="link.key"
      class="route-badge"
      :class="{ complete: !link.pending_batches, selected: link.key === selectedRoute }"
      :style="{ left: link.labelPoint[0] + 'px', top: link.labelPoint[1] + 'px' }"
      :aria-label="`查看${link.source.name}到${link.target.name}线路`"
      @click="emit('selectRoute', link.key)"
    >
      {{ link.pending_batches ? number(link.pending_batches) + ' 批' : '已接收' }}
    </button>
  </div>
</template>
