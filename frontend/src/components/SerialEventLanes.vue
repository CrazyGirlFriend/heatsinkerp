<script setup lang="ts">
import { computed } from 'vue'
import type { SerialHistoryEvent, SerialHistoryGroup } from '@/types/teamBusiness'
import { historyKindNames, historyNumber as num, historyTimeline, purposeColors } from '@/utils/serialHistoryChart'
import { formatDateTime } from '@/utils/format'

const props = defineProps<{ groups: SerialHistoryGroup[]; focus: string; direction: string; replay: number }>()
const emit = defineEmits<{ select: [event: SerialHistoryEvent] }>()
const colors = computed(() => purposeColors(props.groups))
const lanes = computed(() => props.groups.filter(group => !props.focus || props.focus === group.key).map(group => ({
  ...group,
  events: historyTimeline([group]).map(point => point.event).filter(event => !props.direction || props.direction === 'all'
    || (props.direction === 'incoming' ? ['incoming', 'opening'] : ['outgoing', 'adjusted', 'voided']).includes(event.kind)),
})))
const columns = computed(() => Math.max(3, ...lanes.value.map(lane => lane.events.length)))
const shortKind = (event: SerialHistoryEvent) => ({ incoming: '收进', opening: '期初', outgoing: '转出', adjusted: '改量', voided: '撤回', loss: '丢失' })[event.kind]
</script>

<template>
  <div class="event-lanes" tabindex="0" aria-label="本班组各业务收发时间线，可横向滚动">
    <div class="lane-axis"><span>本班组业务 / 当前结存</span><span>每个业务独立按时间从左向右排列 <b>点击节点查看批次</b></span></div>
    <div v-for="lane in lanes" :key="lane.key" class="event-lane" :style="{ '--lane-color': colors.get(lane.key), '--track-width': `${columns * 234 + 36}px`, '--columns': columns, '--steps': Math.max(0, lane.events.length - 1) }">
      <aside class="lane-label"><i /><strong>{{ lane.name }}</strong><span>{{ num(lane.on_hand_quantity) }} <small>件</small></span><span>{{ num(lane.on_hand_weight) }} <small>kg</small></span></aside>
      <div :key="replay" class="lane-track">
        <div class="lane-rail" />
        <button v-for="(event, index) in lane.events" :key="event.id" class="lane-event" :class="event.kind" :style="{ '--event-delay': `${Math.min(index * 80, 640)}ms` }" :aria-label="`${historyKindNames[event.kind]} ${event.counterpart} ${event.quantity}件 ${event.weight}kg，批次 ${event.batch_no}`" @click="emit('select', event)">
          <time>{{ formatDateTime(event.at) }}</time>
          <span class="event-mark">{{ shortKind(event) }}</span>
          <strong class="event-peer" :title="event.counterpart">{{ event.counterpart || historyKindNames[event.kind] }}</strong>
          <span class="event-amount">{{ num(event.quantity) }} <small>件</small><i>·</i>{{ num(event.weight) }} <small>kg</small></span>
          <span class="event-batch" :title="event.batch_no">{{ event.batch_no }}</span>
        </button>
        <span v-if="!lane.events.length" class="lane-empty">所选范围内无收发事件</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.event-lanes { overflow-x: auto; padding-bottom: 8px; scrollbar-width: thin; scrollbar-color: #c8ccdb transparent; }
.lane-axis { display: flex; min-width: max-content; margin: 0 0 6px; color: #758198; font-size: 13px; }
.lane-axis > span:first-child { width: 196px; padding: 0 22px; flex: none; position: sticky; left: 0; z-index: 3; background: #fff; }
.lane-axis > span:last-child { padding-left: 32px; }.lane-axis b { margin-left: 32px; font-weight: 400; }
.event-lane { display: flex; width: max-content; min-width: 100%; border-bottom: 1px solid #edf0f5; }
.event-lane:last-child { border-bottom: 0; }
.lane-label { box-sizing: border-box; width: 196px; flex: none; position: sticky; left: 0; z-index: 2; display: flex; flex-direction: column; justify-content: center; align-items: flex-start; gap: 6px; padding: 24px 22px; background: #fff; border-right: 1px solid #e9edf4; box-shadow: 8px 0 16px -14px #34456445; }
.lane-label > i { width: 24px; height: 3px; background: var(--lane-color); border-radius: 4px; margin-bottom: 6px; }
.lane-label strong { font-size: 18px; color: #1c2a42; line-height: 1.4; max-width: 150px; overflow-wrap: anywhere; }
.lane-label > span { color: #53637c; font-size: 17px; font-variant-numeric: tabular-nums; }.lane-label small { font-size: 13px; }
.lane-track { position: relative; min-width: var(--track-width); flex: 1; display: grid; grid-template-columns: repeat(var(--columns), minmax(206px, 1fr)); gap: 28px; padding: 18px 32px 24px; box-sizing: border-box; }
.lane-rail { position: absolute; top: 67px; left: 56px; width: calc((100% - 36px) / var(--columns) * var(--steps)); height: 2px; transform-origin: left; background: color-mix(in srgb, var(--lane-color) 30%, #fff); animation: trace-lane-draw 1.2s ease-out both; }
.lane-event { position: relative; width: 206px; flex: none; padding: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 8px; border: 0; background: transparent; color: #283850; font: inherit; text-align: left; cursor: pointer; animation: trace-event-enter .5s var(--event-delay) both; }
.lane-event time { color: #738198; font-size: 13px; line-height: 22px; font-variant-numeric: tabular-nums; }
.event-mark { display: flex; align-items: center; justify-content: center; height: 36px; min-width: 48px; box-sizing: border-box; padding-inline: 8px; margin-bottom: 5px; background: #fff; color: var(--lane-color); border: 1.5px solid var(--lane-color); border-radius: 8px; font-size: 14px; font-weight: 600; box-shadow: 0 0 0 5px #fff; }
.incoming .event-mark, .opening .event-mark { color: #fff; background: var(--lane-color); }.loss .event-mark { border-color: #d35267; color: #ba3650; }.voided .event-mark, .adjusted .event-mark { border-style: dashed; }
.event-peer { max-width: 202px; font-size: 18px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.event-amount { font-size: 17px; font-variant-numeric: tabular-nums; white-space: nowrap; }.event-amount small { color: #66758b; font-size: 13px; }.event-amount i { color: #aab2c0; margin-inline: 8px; font-style: normal; }
.event-batch { color: #78859a; font-size: 12px; max-width: 202px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; letter-spacing: .02em; }
.lane-event:hover .event-peer { color: var(--lane-color); }.lane-event:hover .event-mark { box-shadow: 0 0 0 5px color-mix(in srgb, var(--lane-color) 10%, #fff); }.lane-event:focus-visible { outline: 2px solid var(--lane-color); outline-offset: 5px; border-radius: 4px; }
.lane-empty { align-self: center; margin-top: 45px; font-size: 14px; color: #8590a3; }
@keyframes trace-lane-draw { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@keyframes trace-event-enter { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
@media(max-width: 760px) { .lane-label, .lane-axis > span:first-child { width: 148px; padding-inline: 14px; }.lane-label strong { max-width: 118px; } }
@media(prefers-reduced-motion: reduce) { .lane-rail, .lane-event { animation: none; } }
</style>
