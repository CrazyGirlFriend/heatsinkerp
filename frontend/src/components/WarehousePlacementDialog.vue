<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElAlert, ElForm, ElFormItem, ElOption, ElSelect } from 'element-plus'
import ElInputNumber from '@/components/AppNumberInput.vue'
import WatermelonDialog from './watermelon/WatermelonDialog.vue'
import WatermelonButton from './watermelon/WatermelonButton.vue'
import WeightInput from './WeightInput.vue'
import { useDialogValidation } from '@/composables/useDialogValidation'
import { warehouseLocationApi, type WarehouseLocation } from '@/services/warehouseLocationApi'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import type { StockBatch } from '@/types/teamMaterials'
import { formatAmount } from '@/utils/format'
import { sharedSerialLabel } from '@/types/sharedMaterial'
import { showToast } from '@/stores/toast'

const props = defineProps<{ teamId: number }>()
const selected = defineModel<StockBatch | null>({ default: null })
const emit = defineEmits<{ changed: [] }>()
const slots = ref<WarehouseLocation[]>([]),
  locationId = ref<number>()
const currentSlot = computed(() => slots.value.find((slot) => slot.id === locationId.value))
const slotAmount = (key: 'quantity' | 'weight') =>
  formatAmount(
    currentSlot.value?.batches
      .filter((batch) => batch.status === 'received')
      .reduce((sum, batch) => sum + batch[key], 0) || 0,
  )
const quantity = ref<number>(),
  weight = ref<number>(),
  slotsLoading = ref(false),
  saving = ref(false),
  formError = ref('')
let slotGeneration = 0,
  disposed = false
async function findSlots(query = '') {
  const current = ++slotGeneration
  const stock = selected.value?.transfer
  if (!stock) return
  slotsLoading.value = true
  formError.value = ''
  try {
    const result = await teamMaterialApi.warehouseLocations(props.teamId, query, '', {
      serial_no: stock.serial_no,
      material_name: stock.material_name || '',
      material_type: stock.material_type || '',
    })
    if (current !== slotGeneration) return
    slots.value = result.items.filter((row) => row.active && !row.draft_locked)
    if (!query && !locationId.value) locationId.value = slots.value[0]?.id
  } catch (e) {
    if (current === slotGeneration)
      formError.value = e instanceof Error ? e.message : '空闲仓位加载失败'
  } finally {
    if (current === slotGeneration) slotsLoading.value = false
  }
}
const validation = useDialogValidation(() => {
  const issues: Record<string, string> = {}
  if (!slots.value.some((slot) => slot.id === locationId.value)) issues.location = '请选择可用仓位'
  if (quantity.value === undefined || quantity.value < 0) issues.quantity = '请填写有效件数'
  if (weight.value === undefined || weight.value < 0) issues.weight = '请填写有效重量'
  if (quantity.value === 0 && weight.value === 0) issues.quantity = issues.weight = '不能同时为零'
  return issues
})
const { formRef, fieldErrors } = validation
function open(row: StockBatch) {
  validation.reset()
  locationId.value = undefined
  slots.value = []
  formError.value = ''
  quantity.value = row.unassigned_quantity
  weight.value = row.unassigned_weight
  void findSlots()
}
async function assign() {
  const row = selected.value,
    slot = slots.value.find((item) => item.id === locationId.value)
  if (!row || saving.value || slotsLoading.value) return
  formError.value = ''
  if (!validation.validate() || !slot) return
  saving.value = true
  formError.value = ''
  try {
    await warehouseLocationApi.place(slot.id, {
      source_transfer_id: Number(row.transfer.id),
      expected_version: slot.version,
      quantity: quantity.value!,
      weight: weight.value!,
    })
    if (disposed) return
    selected.value = null
    showToast('仓位已安排', 'success')
    emit('changed')
  } catch (e) {
    if (!disposed) formError.value = e instanceof Error ? e.message : '安排仓位失败'
  } finally {
    saving.value = false
  }
}

watch(
  selected,
  (row) => {
    ++slotGeneration
    if (row) open(row)
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  disposed = true
  ++slotGeneration
})
</script>

<template>
  <WatermelonDialog
    :model-value="!!selected"
    title="安排仓位"
    width="min(480px, 94vw)"
    :close-on-click-modal="!saving"
    :show-close="!saving"
    :close-on-press-escape="!saving"
    @update:model-value="!$event && (selected = null)"
  >
    <ElForm ref="formRef" label-position="top" :show-message="false"
      ><div class="warehouse-assignment-identity">
        <span>流水号</span><strong>{{ selected && sharedSerialLabel(selected.transfer) }}</strong
        ><span>批次号</span><span>{{ selected?.transfer.batch_no }}</span>
      </div>
      <div class="warehouse-assignment-fields">
        <ElFormItem class="form-field--long" label="仓位" :error="fieldErrors.location" required
          ><ElSelect
            v-model="locationId"
            :teleported="false"
            filterable
            remote
            :remote-method="findSlots"
            :loading="slotsLoading"
            :aria-busy="slotsLoading || undefined"
            aria-label="选择空闲仓位"
            placeholder="选择或搜索仓位"
            :disabled="saving"
            ><ElOption
              v-for="slot in slots"
              :key="slot.id"
              :value="slot.id"
              :label="slot.name" /></ElSelect
        ></ElFormItem>
        <p v-if="currentSlot?.batches.length" class="form-field--full">
          当前库存 {{ slotAmount('quantity') }} 件 · {{ slotAmount('weight') }} kg ·
          {{ currentSlot.batches.length }} 批
        </p>

        <ElFormItem class="form-field--long" label="件数" :error="fieldErrors.quantity" required
          ><ElInputNumber
            v-model="quantity"
            :min="0"
            :max="selected?.unassigned_quantity"
            :precision="0"
            :disabled="saving"
            aria-label="安排仓位件数"
            controls-position="right"
            ><template #suffix><span class="dialog-input-unit">件</span></template></ElInputNumber
          ></ElFormItem
        >
        <ElFormItem class="form-field--long" label="重量" :error="fieldErrors.weight" required
          ><WeightInput
            v-model="weight"
            :max="selected?.unassigned_weight"
            :disabled="saving"
            ariaLabel="安排仓位重量"
        /></ElFormItem>
      </div>
      <ElAlert v-if="formError" :title="formError" type="error" :closable="false" />
    </ElForm>

    <template #footer
      ><WatermelonButton :disabled="saving" @click="selected = null">取消</WatermelonButton
      ><WatermelonButton primary :loading="saving" :disabled="slotsLoading" @click="assign"
        >确认安排</WatermelonButton
      ></template
    >
  </WatermelonDialog>
</template>

<style scoped>
.warehouse-assignment-identity {
  display: grid;
  grid-template-columns: 60px 1fr;
  gap: 8px 12px;
  margin-bottom: 20px;
}
.warehouse-assignment-identity > :nth-child(odd) {
  color: var(--wm-muted, #71717a);
}
.warehouse-assignment-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 16px;
}
.warehouse-assignment-fields > :first-child,
.warehouse-assignment-fields > p {
  grid-column: 1 / -1;
}
.warehouse-assignment-fields .el-input-number {
  width: 100%;
}

.el-select {
  width: 100%;
}
</style>
