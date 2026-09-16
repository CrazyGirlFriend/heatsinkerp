<script setup lang="ts">
import { computed } from 'vue'
import { ElButton, ElIcon, ElTag } from 'element-plus'
import { ArrowRight } from '@element-plus/icons-vue'
import type { LiveTeam } from '@/types/factoryLive'
const props = defineProps<{ team: LiveTeam; index: number; source: boolean; target: boolean }>()
defineEmits<{ open: [team: LiveTeam] }>()
const assets = ['warehouse', 'rolling', 'annealing', 'grinding', 'wire-cut', 'engraving', 'plating', 'inspection']
const number = (value: number | null | undefined) => value == null ? '—' : new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 3 }).format(value)
const badge = computed(() => !props.team.id ? '未配置' : !props.team.active ? '已停用' : props.source ? '本批上序' : props.target ? '本批下序' : '')
</script>
<template>
  <article class="live-team" :class="{ 'is-source': source, 'is-target': target, 'is-missing': !team.id }" :data-team-code="team.code">
    <img class="live-team__machine" :src="'/assets/factory-live/' + assets[index] + '.png'" :alt="team.name + '设备示意'" draggable="false" />
    <div class="live-team__data">
      <header><h2>{{ team.name }}</h2><ElTag v-if="badge" size="small" :type="!team.id || !team.active ? 'info' : 'primary'">{{ badge }}</ElTag></header>
      <span class="live-team__label">当前结存</span>
      <div class="live-team__stock"><strong>{{ number(team.balance?.on_hand_weight) }}<small> kg</small></strong><span>｜</span><b>{{ number(team.balance?.on_hand_quantity) }}<small> 件</small></b></div>
      <footer><span>待接收 <b>{{ number(team.incoming) }}</b></span><span class="live-team__outgoing">待转出 <b>{{ number(team.outgoing) }}</b></span></footer>
    </div>
    <ElButton class="live-team__open" link :disabled="!team.id || !team.active" :aria-label="'查看' + team.name + '流水号台账'" @click="$emit('open', team)"><ElIcon><ArrowRight /></ElIcon></ElButton>
  </article>
</template>
<style scoped>
.live-team { position: relative; min-width: 0; min-height: 0; display: grid; grid-template-columns: 34% minmax(0, 1fr); align-items: center; gap: 10px; padding: 6px 24px 6px 8px; background: #031e2e; border: 1px solid #1a495f; border-radius: 6px; transition: border-color .4s, background-color .4s; }
.live-team.is-source, .live-team.is-target { border-color: #55dce7; background: #062b3a; }.is-missing { opacity: .65; }
.live-team__machine { width: 100%; height: 92px; max-height: 100%; object-fit: contain; mix-blend-mode: lighten; }
.live-team__data { min-width: 0; }.live-team header { display: flex; align-items: center; gap: 16px; margin-bottom: 1px; line-height: 25px; }.live-team h2 { margin: 0; font-size: 21px; color: #edf5ff; font-weight: 600; white-space: nowrap; }
.live-team :deep(.el-tag) { font-size: 11px; height: 21px; --el-tag-text-color: #67e9ef; --el-tag-bg-color: #073743; --el-tag-border-color: #257f8c; }
.live-team__label { display: block; line-height: 14px; font-size: 11px; color: #90bbd0; }.live-team__stock { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px; margin: 1px 0 4px; line-height: 22px; font-variant-numeric: tabular-nums; }
.live-team__stock strong, .live-team__stock b { color: #e5f4ff; font-size: 18px; font-weight: 600; white-space: nowrap; }.live-team__stock > span { color: #34718a; font-size: 12px; }.live-team__stock small { font-size: 11px; font-weight: 400; color: #a8cee5; }
.live-team footer { display: flex; align-items: center; gap: 20px; font-size: 11px; line-height: 16px; color: #a4cce3; }.live-team footer b { margin-left: 5px; color: #daf7ff; font-size: 14px; font-weight: 550; }.live-team__outgoing { color: #7fa9bc; }
.live-team__open { position: absolute; right: 5px; top: 50%; transform: translateY(-50%); color: #80d7ed; padding: 10px 0; width: 20px; height: 36px; margin: 0; }
@media (prefers-reduced-motion: reduce) { .live-team { transition: none; } }
</style>
