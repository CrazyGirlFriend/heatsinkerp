<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ElForm, ElFormItem, ElOption, ElTableColumn } from 'element-plus'
import AppDialog from './AppDialog.vue'
import AppButton from './AppButton.vue'
import AppAlert from './AppAlert.vue'
import AppInput from './AppInput.vue'
import AppNumberInput from './AppNumberInput.vue'
import AppSelect from './AppSelect.vue'
import AppDisclosure from './AppDisclosure.vue'
import WorkspaceTable from './WorkspaceTable.vue'
import WeightInput from './WeightInput.vue'
import TeamEmployeeInput from './TeamEmployeeInput.vue'
import { externalDestinationOptions } from '@/types/materialTransfer'
import type { ShipmentStock } from '@/types/teamMaterials'
import type { TeamEmployee } from '@/types/teamBusiness'
import { teamMaterialApi, TeamMaterialApiError } from '@/services/teamMaterialApi'
import { materialRequestKey } from '@/utils/materialStock'
import { formatAmount } from '@/utils/format'

const props = defineProps<{ teamId: number; groupId: number; serialNo: string }>()
const emit = defineEmits<{ close: []; saved: [] }>()
const stock = ref<ShipmentStock | null>(null)
const loading = ref(false),
  busy = ref(false),
  error = ref('')
const quantity = ref<number | undefined>(),
  weight = ref<number | undefined>()
const destination = ref(''),
  notes = ref(''),
  employee = ref<TeamEmployee | null>(null)
let key = materialRequestKey(),
  request = 0
let pending: Parameters<typeof teamMaterialApi.createDispatch>[1] | null = null
const allocation = computed(() => {
  let q = quantity.value || 0,
    w = Math.round((weight.value || 0) * 1e6)
  return (stock.value?.items || []).flatMap((row) => {
    const pieces = Math.min(q, row.quantity),
      mass = Math.min(w, Math.round(row.weight * 1e6))
    q -= pieces
    w -= mass
    return pieces || mass ? [{ ...row, quantity: pieces, weight: mass / 1e6 }] : []
  })
})
async function load() {
  if (pending) {
    error.value = '上次提交结果未确认，请先重试原提交'
    return
  }
  const current = ++request
  loading.value = true
  error.value = ''
  try {
    const result = await teamMaterialApi.shipmentStock(props.teamId, props.groupId)
    if (current !== request) return
    stock.value = result
    pending = null
    key = materialRequestKey()
  } catch (reason) {
    if (current === request) {
      stock.value = null
      error.value = reason instanceof Error ? reason.message : '库存加载失败'
    }
  } finally {
    if (current === request) loading.value = false
  }
}
async function submit() {
  if (busy.value || loading.value || !stock.value) return
  error.value = ''
  if (!employee.value || !destination.value) {
    error.value = '请选择发货人和去向'
    return
  }
  const q = quantity.value || 0,
    w = weight.value || 0
  if (!Number.isInteger(q) || q < 0 || w < 0 || (!q && !w)) {
    error.value = '请填写有效发货件数或重量'
    return
  }
  if (q > stock.value.quantity || w > stock.value.weight) {
    error.value = '发货量超过可发库存'
    return
  }
  const body = {
    entry_kind: 'inspection_shipment' as const,
    external_destination: destination.value,
    sent_employee_id: employee.value.id,
    notes: notes.value,
    lines: [],
    inventory_total: {
      group_id: props.groupId,
      revision: stock.value.revision,
      quantity: q,
      weight: w,
    },
    idempotency_key: key,
  }
  // A lost response can safely retry the exact request without a second deduction.
  if (pending && JSON.stringify(pending) !== JSON.stringify(body)) {
    error.value = '上次提交结果未确认，请先重试原提交'
    return
  }
  pending = body
  busy.value = true
  try {
    await teamMaterialApi.createDispatch(props.teamId, body)
    emit('saved')
    emit('close')
  } catch (reason) {
    if (reason instanceof TeamMaterialApiError && reason.status >= 400 && reason.status < 500)
      pending = null
    error.value = reason instanceof Error ? reason.message : '发货失败，请重试'
  } finally {
    busy.value = false
  }
}
onMounted(load)
onBeforeUnmount(() => {
  ++request
})
</script>

<template>
  <AppDialog
    :model-value="true"
    title="汇总发货"
    width="860px"
    :close-on-click-modal="false"
    :before-close="
      (done: () => void) => {
        if (!busy) done()
      }
    "
    @update:model-value="emit('close')"
  >
    <div class="shipment-summary">
      <strong>{{ serialNo }}</strong
      ><span
        >可发 {{ formatAmount(stock?.quantity) }} 件 · {{ formatAmount(stock?.weight) }} kg</span
      ><AppButton :loading="loading" :disabled="busy" @click="load">刷新库存</AppButton>
    </div>
    <AppAlert v-if="error" :title="error" type="error" :closable="false" />
    <ElForm label-position="top" class="shipment-fields" :disabled="busy || loading">
      <ElFormItem label="发货件数" required
        ><AppNumberInput v-model="quantity" :min="0" :precision="0" aria-label="发货总件数"
      /></ElFormItem>
      <ElFormItem label="发货重量" required
        ><WeightInput v-model="weight" ariaLabel="发货总重量"
      /></ElFormItem>
      <ElFormItem label="发货人" required
        ><TeamEmployeeInput v-model="employee" :team-id="teamId" label="发货人" :disabled="busy"
      /></ElFormItem>
      <ElFormItem label="去向" required
        ><AppSelect v-model="destination" aria-label="发货去向" placeholder="选择去向"
          ><ElOption
            v-for="item in externalDestinationOptions"
            :key="item"
            :value="item"
            :label="item" /></AppSelect
      ></ElFormItem>
      <ElFormItem label="备注" class="shipment-notes"
        ><AppInput v-model="notes" maxlength="2000"
      /></ElFormItem>
    </ElForm>
    <AppDisclosure>
      <template #summary>自动分配明细 · {{ allocation.length }} 批</template>
      <p class="allocation-note">按入库先后分别分配件数和重量，保留原批次记录。</p>
      <WorkspaceTable :data="allocation" height="240"
        ><ElTableColumn prop="batch_no" label="来源批次" min-width="200" /><ElTableColumn
          prop="quantity"
          label="发货件数"
        /><ElTableColumn label="发货重量 (kg)"
          ><template #default="{ row }">{{ formatAmount(row.weight) }}</template></ElTableColumn
        ></WorkspaceTable
      >
    </AppDisclosure>
    <template #footer
      ><AppButton :disabled="busy" @click="emit('close')">取消</AppButton
      ><AppButton
        type="primary"
        :loading="busy"
        :disabled="loading || !stock?.items.length"
        @click="submit"
        >确认发货</AppButton
      ></template
    >
  </AppDialog>
</template>

<style scoped>
.shipment-summary {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
}
.shipment-summary span {
  flex: 1;
  color: var(--muted);
}
.shipment-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 16px;
  margin-top: 12px;
}
.shipment-notes {
  grid-column: 1 / -1;
}
.allocation-note {
  color: var(--muted);
  font-size: var(--font-size-meta);
}
@media (max-width: 600px) {
  .shipment-fields {
    grid-template-columns: 1fr;
  }
  .shipment-summary {
    flex-wrap: wrap;
  }
}
</style>
