<script setup lang="ts">
import { computed } from 'vue'
import type { LiveTeam, LiveTransfer } from '@/types/factoryLive'
const props = defineProps<{ team: LiveTeam; index: number; rows: LiveTransfer[]; selected: boolean }>()
defineEmits<{ select: [team: LiveTeam]; open: [row: LiveTransfer] }>()
const assets = ['warehouse', 'rolling', 'annealing', 'grinding', 'wire-cut', 'engraving', 'plating', 'inspection']
const number = (value: number) => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 3 }).format(value)
const emptyLabel = computed(() => !props.team.id ? '班组未配置' : '暂无待接收转料')
</script>
<template>
  <article class="live-team" :class="{ 'is-selected': selected, 'is-right': index >= 4 }" :data-team-code="team.code">
    <header class="live-team__heading">
      <button type="button" class="live-team__select" :aria-label="'展示' + team.name + '转料'" :aria-pressed="selected" :disabled="!team.id" @click="$emit('select', team)">{{ team.name }}</button>
      <img class="live-team__machine" :src="'/assets/factory-live/' + assets[index] + '.png'" :alt="team.name + '设备示意'" draggable="false" />
    </header>
    <div class="live-team__table" role="table" :aria-label="team.name + '待接收转料'">
      <div class="live-team__columns" role="row"><span role="columnheader">流水号</span><span role="columnheader">来源班组</span><span role="columnheader">件数 / 重量</span></div>
      <div class="live-team__rows" role="rowgroup">
        <div class="live-team__track" :class="{ 'is-scrolling': rows.length > 3 }">
          <div v-for="(row, position) in rows" :key="JSON.stringify([row.batch_no, row.serial_no])" role="row" class="live-team__row" :class="{ 'is-current': selected && position === 0 }" :data-batch="row.batch_no">
            <span role="cell"><button type="button" class="live-team__serial" :title="row.serial_no" :tabindex="position === 3 ? -1 : undefined" :aria-label="'查看流水号 ' + row.serial_no + ' 的转料单 ' + row.batch_no" @click="$emit('open', row)">{{ row.serial_no }}</button></span>
            <span role="cell" class="live-team__source" :title="row.source_name || '未记录上序'">{{ row.source_name || '未记录上序' }}</span>
            <span role="cell" class="live-team__amount" :title="number(row.quantity) + ' 件 / ' + number(row.weight) + ' kg'">{{ number(row.quantity) }} 件 / {{ number(row.weight) }} kg</span>
          </div>
        </div>
      </div>
      <p v-if="!rows.length" class="live-team__empty">{{ emptyLabel }}</p>
    </div>
  </article>
</template>
<style scoped>
.live-team { position: relative; min-width: 0; min-height: 0; padding: 4px 0 8px; display: grid; grid-template-rows: minmax(48px, 1fr) 124px; }
.live-team + .live-team { border-top: 1px solid #306077; }
.live-team__heading { display: flex; align-items: center; justify-content: space-between; min-height: 0; padding: 0 16px; }
.live-team__select { color: #eff7ff; border: 0; background: transparent; padding: 0; font: inherit; font-size: 28px; font-weight: 600; cursor: pointer; white-space: nowrap; }
.live-team__select:disabled { color: #a2becd; cursor: default; }
.live-team__machine { width: 100px; height: 68px; max-height: 100%; object-fit: contain; mix-blend-mode: lighten; }
.is-right .live-team__heading { flex-direction: row-reverse; }
.live-team__table { position: relative; min-width: 0; font-size: 16px; font-variant-numeric: tabular-nums; }
.live-team__columns, .live-team__row { display: grid; grid-template-columns: minmax(0, 1fr) 92px 148px; align-items: center; column-gap: 8px; padding: 0 16px; }
.live-team__columns { height: 28px; color: #a9ecf6; background: #053348; border-block: 1px solid #155b76; border-radius: 4px; font-size: 15px; font-weight: 550; }
.live-team__columns > :nth-child(2), .live-team__source { text-align: center; }
.live-team__columns > :last-child, .live-team__amount { text-align: right; }
.live-team__rows { position: relative; height: 96px; overflow: hidden; }
.live-team__track.is-scrolling { transform: translate3d(0, var(--transfer-offset, 0px), 0); will-change: transform; }
.live-team__row { height: 32px; color: #eaf3ff; border-bottom: 1px solid #1b4053; box-sizing: border-box; }
.live-team__row > span { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.live-team__serial { display: block; width: 100%; padding: 0; border: 0; background: transparent; color: inherit; text-align: left; font: inherit; line-height: 30px; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.live-team__serial:hover { color: #75eff7; text-decoration: underline; }
.live-team__source { color: #70e3ed; }
.is-current { background: #104055; box-shadow: inset 2px 0 #78e7f0; }
.live-team__empty { position: absolute; inset: 28px 0 0; display: grid; place-items: center; margin: 0; font-size: 15px; color: #8daebf; }
@media (prefers-reduced-motion: reduce) { .live-team__track.is-scrolling { transform: none; will-change: auto; } }
@media (max-width: 650px) { .live-team__columns, .live-team__row { grid-template-columns: minmax(0, 1fr) 64px 104px; gap: 6px; padding-inline: 6px; font-size: 12px; }.live-team__heading { padding-inline: 6px; } }
</style>
