<script setup lang="ts">
import { ArrowRight, Check, House, User } from '@element-plus/icons-vue'
import { ElIcon } from 'element-plus'
import { computed, nextTick, ref, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { externalActionLabel, isExternalTransfer, isWarehouseReceipt, materialTransferStatusLabel, type MaterialTransfer } from '@/types/materialTransfer'

const props = withDefaults(defineProps<{ transfer: MaterialTransfer; compact?: boolean }>(), { compact: false })
const auth = useAuthStore()
const external = computed(() => isExternalTransfer(props.transfer))
const moving = computed(() => !isWarehouseReceipt(props.transfer) && props.transfer.status === 'pending' && !props.transfer.locked)
const track = ref<HTMLElement | null>(null)
const colors = ['blue', 'violet', 'amber'] as const
const isCurrentTeam = (id: string | number) => auth.currentUser?.team_id != null && String(auth.currentUser.team_id) === String(id)

// Settle the visible light when this record becomes locked; changing records must not replay that transition.
watch(() => [props.transfer.batch_no, moving.value] as const, async ([batch, active], [previousBatch, wasActive], onCleanup) => {
  const fades: Animation[] = []
  let cancelled = false
  onCleanup(() => { cancelled = true; fades.forEach(animation => animation.cancel()) })
  if (active || !wasActive || batch !== previousBatch || !track.value || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  const lights = [...track.value.querySelectorAll<HTMLElement>('.flow-core, .flow-inner, .flow-halo, .flow-reflection, .flow-link')]
  const before = lights.map(light => ({ opacity: getComputedStyle(light).opacity, transform: getComputedStyle(light).transform }))
  await nextTick()
  if (cancelled) return
  lights.forEach((light, index) => {
    if (!light.isConnected || typeof light.animate !== 'function') return
    const after = getComputedStyle(light)
    fades.push(light.animate([before[index], { opacity: after.opacity, transform: after.transform }], {
      duration: props.compact ? 300 : 520,
      easing: 'cubic-bezier(.22, 1, .36, 1)',
    }))
  })
})
</script>

<template>
  <div v-if="isWarehouseReceipt(transfer)" class="receipt-flow" :class="{ 'receipt-flow--compact': compact }" data-animated="false" :aria-label="`库房手工入库 → ${transfer.next_team.name}，已入库`">
    <div><small v-if="!compact">入库来源</small><strong>库房手工入库</strong></div><ElIcon><ArrowRight /></ElIcon><div><small v-if="!compact">入库库房</small><strong>{{ transfer.next_team.name }}</strong></div>
  </div>
  <div v-else class="transfer-flow" :class="{ 'transfer-flow--compact': compact, 'transfer-flow--moving': moving, 'transfer-flow--voided': transfer.status === 'voided', 'transfer-flow--external': external }" :data-status="transfer.status" :data-animated="moving" :aria-label="`${transfer.source_team.name} → ${external ? '外部去向：' : ''}${transfer.next_team.name}，${materialTransferStatusLabel(transfer.status, transfer.entry_kind)}`">
    <div class="flow-node" :class="{ 'flow-node--current': isCurrentTeam(transfer.source_team.id) }">
      <ElIcon class="flow-node__icon"><House /></ElIcon>
      <strong :title="transfer.source_team.name">{{ transfer.source_team.name }}</strong>
      <small v-if="!compact">{{ external ? '本班组确认' : '转出' }}</small>
    </div>
    <div ref="track" class="flow-track" aria-hidden="true">
      <div class="flow-cluster">
        <span class="flow-link" /><span class="flow-link flow-link--second" />
        <span v-for="color in colors" :key="color" class="flow-photon" :class="`flow-photon--${color}`">
          <span class="flow-halo" /><span class="flow-core" /><span class="flow-inner" /><span class="flow-reflection" />
        </span>
      </div>
    </div>
    <div class="flow-node flow-node--receiver" :class="{ 'flow-node--current': isCurrentTeam(transfer.next_team.id) }">
      <ElIcon class="flow-node__icon"><Check v-if="transfer.status === 'received' || transfer.status === 'dispatched'" /><ArrowRight v-else-if="external" /><User v-else /></ElIcon>
      <strong :title="transfer.next_team.name">{{ transfer.next_team.name }}</strong>
      <small v-if="!compact">{{ external ? `${externalActionLabel(transfer.entry_kind)}去向` : transfer.status === 'received' ? '已接收' : '接收' }}</small>
    </div>
  </div>
</template>

<style scoped>
.receipt-flow { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 15px 0; }
.receipt-flow > div { display: grid; gap: 7px; min-width: 0; }
.receipt-flow > div:last-child { text-align: right; }
.receipt-flow small { color: var(--subtle); font-size: 12px; }
.receipt-flow strong { color: var(--text); font-size: 14px; font-weight: 500; overflow-wrap: anywhere; }
.receipt-flow > .el-icon { color: #a99abb; flex-shrink: 0; }
.receipt-flow--compact { justify-content: flex-start; padding: 0; gap: 10px; }
.receipt-flow--compact strong { font-size: 13px; font-weight: 400; }
.transfer-flow {
  --flow-cycle: 3.2s;
  --flow-blue: #548fef;
  --flow-violet: #9972ee;
  --flow-amber: #eeac59;
  display: grid;
  grid-template-columns: minmax(56px, .75fr) minmax(80px, 1.5fr) minmax(56px, .75fr);
  align-items: start;
  gap: 10px;
  color: var(--text);
}
.flow-node { display: flex; min-width: 0; align-items: center; flex-direction: column; gap: 7px; text-align: center; }
.flow-node__icon { width: 56px; height: 56px; border: 1px solid #e9e3f6; border-radius: 17px; color: #9283ab; background: linear-gradient(150deg, #fff, #f5f2fa); box-shadow: 0 5px 14px rgb(70 49 109 / 3%); font-size: 25px; }
.flow-node--current .flow-node__icon { color: var(--primary); }
.flow-node strong { max-width: 100%; font-size: 14px; font-weight: 500; line-height: 1.4; overflow-wrap: anywhere; }
.flow-node small { color: var(--subtle); font-size: 12px; line-height: 1.4; white-space: nowrap; }
.flow-track { display: flex; align-items: center; position: relative; min-width: 0; height: 56px; }
.flow-track::before, .flow-track::after { content: ''; height: 1px; flex: 1; background: #e9e3f4; }
.flow-cluster { display: flex; align-items: center; justify-content: space-between; position: relative; width: min(244px, 100%); height: 56px; flex: 0 0 auto; }
.flow-link { position: absolute; top: 27px; left: 12px; width: calc(50% - 12px); height: 3px; border-radius: 3px; background: linear-gradient(90deg, var(--flow-blue), var(--flow-violet)); opacity: .1; --flow-delay: calc(var(--flow-cycle) * -.02); }
.flow-link--second { left: 50%; background: linear-gradient(90deg, var(--flow-violet), var(--flow-amber)); --flow-delay: calc(var(--flow-cycle) * .13); }
.flow-photon { position: relative; width: 24px; height: 24px; flex: 0 0 24px; isolation: isolate; }
.flow-photon--blue { --photon-color: var(--flow-blue); --flow-delay: calc(var(--flow-cycle) * -.1); }
.flow-photon--violet { --photon-color: var(--flow-violet); --flow-delay: calc(var(--flow-cycle) * .05); }
.flow-photon--amber { --photon-color: var(--flow-amber); --flow-delay: calc(var(--flow-cycle) * .2); }
.flow-core { position: absolute; inset: 1px; border-radius: 50%; background: radial-gradient(circle at 32% 26%, #ffffffed 0%, color-mix(in srgb, var(--photon-color) 45%, white) 24%, var(--photon-color) 68%, color-mix(in srgb, var(--photon-color) 86%, #59496f) 100%); box-shadow: inset 0 1px 2px #ffffffb0, inset 0 -2px 4px #65568816, 0 4px 12px color-mix(in srgb, var(--photon-color) 26%, transparent); opacity: .25; transform: scale(.88); }
.flow-inner { position: absolute; top: 5px; left: 5px; width: 7px; height: 5px; border-radius: 50%; background: #fff; box-shadow: 0 0 5px 2px #ffffff6b; opacity: 0; }
.flow-halo { position: absolute; inset: -32px; z-index: -1; border-radius: 50%; background: radial-gradient(circle, color-mix(in srgb, var(--photon-color) 60%, transparent) 0%, color-mix(in srgb, var(--photon-color) 30%, transparent) 28%, color-mix(in srgb, var(--photon-color) 12%, transparent) 46%, transparent 70%); opacity: 0; transform: scale(.7); }
.flow-reflection { position: absolute; top: 31px; left: -15px; right: -15px; height: 12px; border-radius: 50%; background: radial-gradient(ellipse, color-mix(in srgb, var(--photon-color) 30%, transparent), transparent 70%); opacity: 0; }
.transfer-flow--moving .flow-core { animation: handoff-core var(--flow-cycle) ease-in-out var(--flow-delay) infinite; }
.transfer-flow--moving .flow-inner { animation: handoff-inner var(--flow-cycle) ease-in-out var(--flow-delay) infinite; }
.transfer-flow--moving .flow-halo { animation: handoff-halo var(--flow-cycle) ease-in-out var(--flow-delay) infinite; }
.transfer-flow--moving .flow-reflection { animation: handoff-reflection var(--flow-cycle) ease-in-out var(--flow-delay) infinite; }
.transfer-flow--moving .flow-link { animation: handoff-link var(--flow-cycle) ease-in-out var(--flow-delay) infinite; }
.transfer-flow:is([data-status='received'], [data-status='dispatched']) .flow-node--receiver .flow-node__icon { color: #498974; background: #f2f8f5; border-color: #e3eee8; }
.transfer-flow--voided .flow-node { color: var(--subtle); }
.transfer-flow--voided .flow-node__icon { border-color: var(--line); color: var(--subtle); }
.transfer-flow--voided .flow-cluster { filter: grayscale(1); }
.transfer-flow--external:not(.transfer-flow--compact) { grid-template-columns: 56px minmax(72px, 1fr) minmax(112px, 1.2fr); }
.transfer-flow--external:not(.transfer-flow--compact) .flow-node--receiver strong { font-size: 12px; line-height: 1.6; }
.transfer-flow--compact { --flow-cycle: 3.8s; width: 100%; max-width: 270px; grid-template-columns: minmax(0, 1fr) 46px minmax(0, 1fr); align-items: center; gap: 9px; }
.transfer-flow--compact .flow-node { flex-direction: row; gap: 0; text-align: left; }
.transfer-flow--compact .flow-node__icon { display: none; }
.transfer-flow--compact .flow-node strong { overflow: hidden; font-size: 15px; font-weight: 400; text-overflow: ellipsis; white-space: nowrap; }
.transfer-flow--compact .flow-track, .transfer-flow--compact .flow-cluster { height: 26px; }
.transfer-flow--compact .flow-photon { width: 9px; height: 9px; flex-basis: 9px; }
.transfer-flow--compact .flow-core { inset: 0; box-shadow: inset 0 1px 1px #ffffff90; }
.transfer-flow--compact .flow-inner { top: 2px; left: 2px; width: 3px; height: 2px; box-shadow: none; }
.transfer-flow--compact .flow-halo { inset: -7px; }
.transfer-flow--compact .flow-reflection { display: none; }
.transfer-flow--compact .flow-link { top: 12px; left: 4px; width: calc(50% - 4px); height: 1px; }
.transfer-flow--compact .flow-link--second { left: 50%; }
@keyframes handoff-core { 0%, 52%, 100% { opacity: .58; transform: scale(.88); } 17% { opacity: 1; transform: scale(1.2); } 30% { opacity: .92; transform: scale(1.02); } }
@keyframes handoff-inner { 0%, 48%, 100% { opacity: .3; } 18% { opacity: .95; } 32% { opacity: .4; } }
@keyframes handoff-halo { 0%, 58%, 100% { opacity: .14; transform: scale(.7); } 20% { opacity: 1; transform: scale(1.12); } 37% { opacity: .3; transform: scale(1.35); } }
@keyframes handoff-reflection { 0%, 52%, 100% { opacity: .12; } 22% { opacity: 1; } }
@keyframes handoff-link { 0%, 50%, 100% { opacity: .12; } 20% { opacity: .65; } }
@media (prefers-reduced-motion: reduce) {
  .transfer-flow--moving :is(.flow-core, .flow-inner, .flow-halo, .flow-reflection, .flow-link) { animation: none; }
  .transfer-flow--moving .flow-core { opacity: .85; transform: none; }
  .transfer-flow--moving .flow-halo { opacity: .25; transform: none; }
}
</style>
