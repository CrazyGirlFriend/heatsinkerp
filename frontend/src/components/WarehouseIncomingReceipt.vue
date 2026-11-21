<script setup lang="ts">
import { computed, ref } from 'vue'
import { sharedSerialLabel } from '@/types/sharedMaterial'
import AppButton from './AppButton.vue'
import AppDetailTable from './AppDetailTable.vue'
import MaterialTransferDetailFrame from './MaterialTransferDetailFrame.vue'
import { materialTransferApi, MaterialTransferApiError } from '@/services/materialTransferApi'
import { materialRequestKey } from '@/utils/materialStock'
import { formatScheduleBatch } from '@/utils/scheduleBatch'
import { inventoryAmount } from '@/types/teamInventory'
import {
  materialTypeLabel,
  canConfirmMaterialTransfer,
  type MaterialTransfer,
} from '@/types/materialTransfer'
import type { TeamEmployee } from '@/types/teamBusiness'
import { showToast } from '@/stores/toast'

const props = defineProps<{
  row: MaterialTransfer
  receiver: TeamEmployee | null
  canWrite: boolean
}>()
const emit = defineEmits<{ close: []; refresh: [] }>()
const busy = ref(false),
  error = ref('')
const key = materialRequestKey()
const sources = computed(() =>
  props.row.feeding_sources?.length
    ? props.row.feeding_sources.map((part) => ({
        ...props.row,
        source_serial_no: part.serial_no,
        source_transfer_batch_no: part.batch_no,
        quantity: part.quantity,
        weight: part.weight,
      }))
    : props.row.pending_receipt_lines || [],
)
async function receive() {
  if (busy.value || !props.canWrite || !props.receiver || !canConfirmMaterialTransfer(props.row))
    return
  busy.value = true
  error.value = ''
  try {
    await materialTransferApi.confirmWarehouseReceipt(props.row, props.receiver.id, key)
    showToast('转料单已签收', 'success')
    emit('close')
    emit('refresh')
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '签收失败'
    if (reason instanceof MaterialTransferApiError && reason.status === 409) {
      showToast(error.value, 'error')
      emit('close')
      emit('refresh')
    }
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <MaterialTransferDetailFrame
    :model-value="true"
    :busy="busy"
    title="核对来料"
    @close="emit('close')"
  >
    <p>
      目标流水号 <strong>{{ sharedSerialLabel(row) }}</strong
      ><span v-if="row.task_batch_number"> · {{ formatScheduleBatch(row) }}</span> ·
      {{ sources.length }} 个来源批次 · {{ inventoryAmount(row.quantity) }} 件 /
      {{ inventoryAmount(row.weight) }} kg
    </p>
    <p v-if="row.feeding_sources?.length">
      转出批次 {{ row.batch_no }} · {{ row.material_name }} ·
      {{ materialTypeLabel(row.material_type) }}
    </p>
    <AppDetailTable fields aria-label="来源批次" class="business-document-table">
      <thead>
        <tr>
          <th>来源流水号</th>
          <th>来源批次</th>
          <th v-if="!row.feeding_sources?.length">转出批次</th>
          <th v-if="!row.feeding_sources?.length">材质</th>
          <th v-if="!row.feeding_sources?.length">物料类型</th>
          <th>件数</th>
          <th>重量 (kg)</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="line in sources"
          :key="row.feeding_sources?.length ? line.source_transfer_batch_no! : line.batch_no"
        >
          <td>{{ line.source_serial_no || '—' }}</td>
          <td>{{ line.source_transfer_batch_no || '—' }}</td>
          <td v-if="!row.feeding_sources?.length">{{ line.batch_no }}</td>
          <td v-if="!row.feeding_sources?.length">{{ line.material_name || '—' }}</td>
          <td v-if="!row.feeding_sources?.length">
            {{ materialTypeLabel(line.material_type) }}{{ line.is_outsourced ? ' · 外委产品' : '' }}
          </td>
          <td>{{ inventoryAmount(line.quantity) }}</td>
          <td>{{ inventoryAmount(line.weight) }}</td>
        </tr>
      </tbody>
    </AppDetailTable>
    <p v-if="receiver">接收人 {{ receiver.name }}</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <template #footer
      ><AppButton :disabled="busy" @click="emit('close')">关闭</AppButton>
      <AppButton
        v-if="canWrite && canConfirmMaterialTransfer(row)"
        type="primary"
        :disabled="!receiver"
        :loading="busy"
        @click="receive"
        >确认签收</AppButton
      ></template
    >
  </MaterialTransferDetailFrame>
</template>
