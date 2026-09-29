<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElButton, ElInput, type InputInstance } from 'element-plus'
import { FullScreen } from '@element-plus/icons-vue'
import { useAuthStore } from '@/stores/auth'
import { showToast, type ToastTone } from '@/stores/toast'
import { materialTransferApi } from '@/services/materialTransferApi'
import { canConfirmMaterialTransfer, materialTransferVersion, type MaterialTransfer } from '@/types/materialTransfer'
import { isDispatchNumber } from '@/types/teamMaterials'
import { inventoryAmount } from '@/types/teamInventory'
import { sludgeSummary } from '@/utils/sludgeWeight'

const props = defineProps<{ teamId: number; paused?: boolean }>()
const emit = defineEmits<{ received: [transfer: MaterialTransfer] }>()
const auth = useAuthStore()
const input = ref<InputInstance>()
const value = ref('')
const queue = ref<string[]>([])
const currentCode = ref('')
const result = ref<{ message: string; tone: ToastTone } | null>(null)
const allowed = computed(() => auth.isTeamAccount && auth.currentUser?.active !== false && !auth.currentUserError && Number(auth.currentUser?.team_id) === props.teamId)
const identity = computed(() => `${auth.currentUser?.id}:${auth.currentUser?.team_id}:${props.teamId}:${allowed.value}:${Boolean(props.paused)}`)
const keys = new Map<string, string>()
let epoch = 0, disposed = false, hid = '', hidTime = 0

function report(message: string, tone: ToastTone) {
  result.value = { message, tone }
  showToast(message, tone)
}

async function receiveNext() {
  if (currentCode.value || !allowed.value || props.paused || disposed) return
  const code = queue.value.shift()
  if (!code) return
  const token = epoch
  const active = () => token === epoch && !disposed && allowed.value && !props.paused
  currentCode.value = code
  try {
    // Refresh permissions before writing; scanning never grants receiver rights.
    await auth.refreshCurrentUser()
    if (!active()) return
    if (isDispatchNumber(code)) throw new Error('请扫描每批物料的独立条码')
    const transfer = await materialTransferApi.get(code)
    if (!active()) return
    if (transfer.entry_kind !== 'transfer') throw new Error('此单据不是待接收的内部转料单')
    if (Number(transfer.next_team.id) !== props.teamId) throw new Error('接收班组与当前工作台不符')
    if (transfer.status === 'received') { report(`${code} 已入库，请勿重复扫码`, 'info'); return }
    if (transfer.status === 'voided') throw new Error('单据已作废，不能入库')
    if (transfer.rejection_reason) throw new Error('单据已退回核对，需上序修改后再扫码')
    if (!canConfirmMaterialTransfer(transfer) || !transfer.version) throw new Error('该批物料当前不能签收入库，请刷新后重试')
    let key = keys.get(code)
    if (!key) { key = globalThis.crypto?.randomUUID?.() || `scan-receipt-${Date.now()}-${Math.random().toString(16).slice(2)}`; keys.set(code, key) }
    // Keep the existing reserved location. A blank location stays unassigned.
    const received = await materialTransferApi.confirm(code, { idempotency_key: key, ...materialTransferVersion(transfer) })
    if (!active()) return
    report(`${code} 已入库 · ${inventoryAmount(received.quantity)} 件 / ${received.material_type === 'sludge' ? sludgeSummary(received) : `${inventoryAmount(received.weight)} kg`}`, 'success')
    emit('received', received)
  } catch (error) {
    if (active()) report(`${code}：${error instanceof Error ? error.message : '入库失败，请重新扫码'}`, 'error')
  } finally {
    if (token === epoch) { currentCode.value = ''; void receiveNext() }
  }
}

function scan(raw = value.value) {
  if (!allowed.value || props.paused || disposed) return
  const code = raw.trim().toUpperCase()
  if (!code) return
  value.value = ''
  if (code === currentCode.value || queue.value.includes(code)) { showToast(`${code} 正在处理，请勿重复扫码`, 'info'); return }
  queue.value.push(code)
  void receiveNext()
}

function handleKey(event: KeyboardEvent) {
  if (!allowed.value || props.paused || document.hidden || event.isComposing || event.ctrlKey || event.altKey || event.metaKey || (event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable=true],[role=dialog]'))) { hid = ''; return }
  const now = Date.now()
  if (now - hidTime > 100) hid = ''
  hidTime = now
  if (event.key === 'Enter') { if (hid.length >= 6) { event.preventDefault(); scan(hid) } hid = '' }
  else if (event.key.length === 1) hid += event.key
  else hid = ''
}
function focus() { input.value?.focus() }
defineExpose({ focus })
watch(identity, () => { ++epoch; queue.value = []; currentCode.value = ''; value.value = ''; result.value = null; keys.clear(); hid = '' }, { flush: 'sync' })
onMounted(() => document.addEventListener('keydown', handleKey))
onBeforeUnmount(() => { disposed = true; ++epoch; queue.value = []; document.removeEventListener('keydown', handleKey) })
</script>

<template>
  <div class="receipt-scanner">
    <div class="incoming-scan">
      <strong>扫码入库</strong>
      <div class="scanner-inline">
        <ElInput ref="input" v-model="value" aria-label="扫描转料批次号" placeholder="扫描批次条码，自动签收入库" autocomplete="off" :disabled="!allowed || paused" @keyup.enter="scan()" />
        <ElButton :icon="FullScreen" :disabled="!allowed || paused || !value.trim()" @click="scan()">入库</ElButton>
      </div>
      <span v-if="currentCode" class="scanner-progress" role="status">正在入库<span v-if="queue.length"> · {{ queue.length }} 批排队中</span></span>
    </div>
    <p v-if="result" class="scanner-result" :class="`scanner-result--${result.tone}`" :role="result.tone === 'error' ? 'alert' : 'status'">{{ result.message }}</p>
  </div>
</template>

<style scoped>
.receipt-scanner { flex-shrink: 0; min-width: 0; margin: 0 12px 12px; padding: 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--workspace-bg); }
.incoming-scan { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; }
.incoming-scan strong { font-size: 14px; font-weight: 500; }
.scanner-inline { display: flex; flex: 0 1 420px; min-width: 0; gap: 8px; }
.scanner-inline > .el-input { flex: 1; min-width: 0; }
.scanner-inline > .el-button { height: 36px; margin-left: 0; }
.scanner-progress { color: var(--muted); font-size: 13px; }
.scanner-result { margin: 8px 0 0; overflow-wrap: anywhere; font-size: 13px; color: var(--muted); }
.scanner-result--success { color: var(--primary); }
.scanner-result--error { color: var(--danger); }
@media (max-width: 760px) { .scanner-inline { flex-basis: 100%; } }
</style>
