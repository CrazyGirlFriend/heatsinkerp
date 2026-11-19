<script setup lang="ts">
import AppDialog from '@/components/AppDialog.vue'
import ElInput from '@/components/AppInput.vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { focusFirstInvalidField } from '@/composables/useDialogValidation'
import ElButton from '@/components/AppButton.vue'
import { IconScan } from '@tabler/icons-vue'
import { useAuthStore } from '@/stores/auth'
import { showToast, type ToastTone } from '@/stores/toast'
import { materialTransferApi } from '@/services/materialTransferApi'
import {
  canConfirmMaterialTransfer,
  materialTransferVersion,
  type MaterialTransfer,
} from '@/types/materialTransfer'
import { isDispatchNumber } from '@/types/teamMaterials'
import { inventoryAmount } from '@/types/teamInventory'
import { sludgeSummary } from '@/utils/sludgeWeight'
import ReceiptPersonInput from './ReceiptPersonInput.vue'
import type { TeamEmployee } from '@/types/teamBusiness'

const props = defineProps<{ teamId: number; paused?: boolean }>()
const emit = defineEmits<{ received: [transfer: MaterialTransfer] }>()
const auth = useAuthStore()
const scanOpen = ref(false)
const barcode = ref<InstanceType<typeof ElInput>>()
const value = ref('')
const receiver = defineModel<TeamEmployee | null>('receiver', { default: null })
const receiverRequired = ref(false)
const scannerReceiver = ref<HTMLElement>()
const selectingReceiver = ref(false)
const queue = ref<string[]>([])
const currentCode = ref('')
const result = ref<{ message: string; tone: ToastTone } | null>(null)
const allowed = computed(
  () =>
    (auth.isAdmin || auth.isTeamAccount) &&
    auth.currentUser?.active !== false &&
    !auth.currentUserError &&
    (auth.isAdmin || Number(auth.currentUser?.team_id) === props.teamId),
)
const identity = computed(
  () =>
    `${auth.currentUser?.id}:${auth.currentUser?.team_id}:${props.teamId}:${allowed.value}:${Boolean(props.paused)}`,
)
const keys = new Map<string, string>()
let epoch = 0,
  disposed = false,
  hid = '',
  hidTime = 0

function report(message: string, tone: ToastTone) {
  result.value = { message, tone }
  showToast(message, tone)
}

async function receiveNext() {
  if (currentCode.value || !allowed.value || props.paused || disposed || !receiver.value) return
  const code = queue.value.shift()
  if (!code) return
  const person = receiver.value
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
    if (transfer.status === 'received') {
      report(`${code} 已入库，请勿重复扫码`, 'info')
      return
    }
    if (transfer.status === 'voided') throw new Error('单据已作废，不能入库')
    if (transfer.rejection_reason) throw new Error('单据已退回核对，需上序修改后再扫码')
    if (!canConfirmMaterialTransfer(transfer) || !transfer.version)
      throw new Error('该批物料当前不能签收入库，请刷新后重试')
    const requestIdentity = `${code}:${person.id}`
    let key = keys.get(requestIdentity)
    if (!key) {
      key =
        globalThis.crypto?.randomUUID?.() ||
        `scan-receipt-${Date.now()}-${Math.random().toString(16).slice(2)}`
      keys.set(requestIdentity, key)
    }
    // Keep the existing reserved location. A blank location stays unassigned.
    const received = await materialTransferApi.confirm(code, {
      idempotency_key: key,
      received_employee_id: person.id,
      ...materialTransferVersion(transfer),
    })
    if (!active()) return
    report(
      `${code} 已入库 · 接收人 ${received.received_employee_name || person.name} · ${inventoryAmount(received.quantity)} 件 / ${received.material_type === 'sludge' ? sludgeSummary(received) : `${inventoryAmount(received.weight)} kg`}`,
      'success',
    )
    emit('received', received)
  } catch (error) {
    if (active())
      report(`${code}：${error instanceof Error ? error.message : '入库失败，请重新扫码'}`, 'error')
  } finally {
    if (token === epoch) {
      currentCode.value = ''
      void receiveNext()
    }
  }
}

function scan(raw = value.value) {
  if (!allowed.value || props.paused || disposed) return
  if (selectingReceiver.value) return
  if (!receiver.value) {
    receiverRequired.value = true
    void nextTick(() => focusFirstInvalidField(scannerReceiver.value))
    return
  }
  const code = raw.trim().toUpperCase()
  if (!code) return
  value.value = ''
  if (scanOpen.value) barcode.value?.focus()
  if (code === currentCode.value || queue.value.includes(code)) {
    showToast(`${code} 正在处理，请勿重复扫码`, 'info')
    return
  }
  queue.value.push(code)
  void receiveNext()
}

function handleKey(event: KeyboardEvent) {
  if (
    !allowed.value ||
    props.paused ||
    selectingReceiver.value ||
    document.hidden ||
    event.isComposing ||
    event.ctrlKey ||
    event.altKey ||
    event.metaKey ||
    (event.target instanceof Element &&
      event.target.closest('input,textarea,select,[contenteditable=true],[role=dialog]'))
  ) {
    hid = ''
    return
  }
  const now = Date.now()
  if (now - hidTime > 100) hid = ''
  hidTime = now
  if (event.key === 'Enter') {
    if (hid.length >= 6) {
      event.preventDefault()
      scan(hid)
    }
    hid = ''
  } else if (event.key.length === 1) hid += event.key
  else hid = ''
}
watch(
  () => `${auth.currentUser?.id}:${auth.currentUser?.team_id}:${props.teamId}:${allowed.value}`,
  () => {
    receiver.value = null
    receiverRequired.value = false
  },
)
watch(receiver, (value) => {
  if (value) receiverRequired.value = false
  hid = ''
})
watch(
  identity,
  () => {
    ++epoch
    queue.value = []
    currentCode.value = ''
    scanOpen.value = false
    value.value = ''
    result.value = null
    keys.clear()
    hid = ''
  },
  { flush: 'sync' },
)
onMounted(() => document.addEventListener('keydown', handleKey))
onBeforeUnmount(() => {
  disposed = true
  ++epoch
  queue.value = []
  document.removeEventListener('keydown', handleKey)
})
</script>

<template>
  <div ref="scannerReceiver" class="receipt-scanner" role="group" aria-label="收料操作">
    <ReceiptPersonInput
      v-if="allowed"
      :key="`${auth.currentUser?.id}:${teamId}`"
      v-model="receiver"
      class="scanner-receiver"
      :team-id="teamId"
      :disabled="!!currentCode || queue.length > 0 || paused"
      :invalid="receiverRequired && !receiver"
      @open-change="selectingReceiver = $event"
    />
    <ElButton
      aria-haspopup="dialog"
      :aria-expanded="scanOpen"
      :disabled="!allowed || paused || !receiver"
      @click="scanOpen = true"
    >
      <IconScan :size="17" aria-hidden="true" />扫码入库
    </ElButton>
    <AppDialog
      v-model="scanOpen"
      title="扫码入库"
      width="min(420px, 94vw)"
      append-to-body
      align-center
      destroy-on-close
      @opened="barcode?.focus()"
      @close="value = ''"
    >
      <ElInput
        ref="barcode"
        v-model="value"
        aria-label="扫描转料批次号"
        placeholder="扫描或输入批次号"
        autocomplete="off"
        :disabled="!allowed || paused || !receiver"
        @keyup.enter="scan()"
      />
      <p v-if="currentCode" role="status">
        正在入库<span v-if="queue.length"> · {{ queue.length }} 批排队中</span>
      </p>
      <p v-if="result" :role="result.tone === 'error' ? 'alert' : 'status'">
        {{ result.message }}
      </p>
      <template #footer>
        <ElButton @click="scanOpen = false">关闭</ElButton>
        <ElButton
          type="primary"
          :disabled="!allowed || paused || !receiver || !value.trim()"
          @click="scan()"
          >入库</ElButton
        >
      </template>
    </AppDialog>
  </div>
</template>

<style scoped>
.receipt-scanner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  max-width: 100%;
}
.scanner-receiver {
  width: auto;
  max-width: 10rem;
}
</style>
