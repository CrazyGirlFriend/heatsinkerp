<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElForm, ElFormItem, ElOption } from 'element-plus'
import AppAlert from './AppAlert.vue'
import AppSelect from './AppSelect.vue'
import CompactFormSection from './CompactFormSection.vue'
import TeamEmployeeInput from './TeamEmployeeInput.vue'
import WarehouseLocationSelect from './WarehouseLocationSelect.vue'
import WeightInput from './WeightInput.vue'
import { useAuthStore } from '@/stores/auth'
import { useTeamDirectoryStore } from '@/stores/teamDirectory'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import type { TeamEmployee } from '@/types/teamBusiness'
import { externalDestinationOptions, materialTypeOptions } from '@/types/materialTransfer'
import type { CreateDispatch, CreatedMaterialBatches } from '@/types/teamMaterials'
import { createMaterialSubmissionKey } from '@/utils/materialStock'

const props = defineProps<{ teamId: number; canWrite: boolean }>()
const emit = defineEmits<{ saved: [result: CreatedMaterialBatches]; busy: [value: boolean] }>()
const auth = useAuthStore()
const directory = useTeamDirectoryStore()
const submission = createMaterialSubmissionKey()
const source = computed(() =>
  directory.items.find((t) => Number(t.id) === props.teamId && t.active),
)
const external = computed(() => source.value?.code === 'FACTORY-WAREHOUSE')
const warehouses = computed(() =>
  directory.items.filter(
    (t) => t.active && t.kind === 'warehouse' && Number(t.id) !== props.teamId,
  ),
)
const material = ref<NonNullable<CreateDispatch['recovery']>['material_type']>()
const options = materialTypeOptions.filter((t) =>
  ['waste', 'slag', 'scrap_chips', 'sludge'].includes(t.value),
)
const weight = ref<number>()
const sender = ref<TeamEmployee | null>(null)
const warehouseId = ref<number>()
const needsLocation = computed(
  () =>
    warehouses.value.find((team) => Number(team.id) === warehouseId.value)?.code ===
    'FACTORY-WAREHOUSE',
)
const destination = ref('')
const location = ref('')
const lease = ref('')
const locationBusy = ref(false)
const saving = ref(false)
const submitted = ref(false)
const error = ref('')
watch(
  warehouses,
  (items) => {
    if (!items.some((t) => Number(t.id) === warehouseId.value))
      warehouseId.value = items.length === 1 ? Number(items[0]!.id) : undefined
  },
  { immediate: true },
)
watch(warehouseId, () => {
  location.value = ''
  lease.value = ''
})

const ready = computed(
  () =>
    !!source.value &&
    !!material.value &&
    Number(weight.value) > 0 &&
    !!sender.value &&
    (external.value
      ? !!destination.value
      : !!warehouseId.value && (!needsLocation.value || (!!location.value && !!lease.value))),
)
let active = true
onBeforeUnmount(() => {
  active = false
})
async function submit() {
  submitted.value = true
  if (!ready.value || !props.canWrite || saving.value || locationBusy.value) return
  const body = {
    sent_employee_id: sender.value!.id,
    lines: [],
    recovery: {
      material_type: material.value!,
      weight: weight.value!,
      ...(needsLocation.value && !external.value
        ? { warehouse_location: location.value, warehouse_location_reservation_key: lease.value }
        : {}),
    },
    ...(external.value
      ? { entry_kind: 'warehouse_outbound' as const, external_destination: destination.value }
      : { next_team_id: warehouseId.value! }),
  }
  error.value = ''
  saving.value = true
  emit('busy', true)
  try {
    await auth.refreshCurrentUser()
    if (!active) return
    if (!props.canWrite) throw new Error('当前账号无权为该班组出库')
    const result = await teamMaterialApi.createDispatch(props.teamId, {
      ...body,
      idempotency_key: submission.get({ teamId: props.teamId, body }),
    })
    if (active) emit('saved', result)
  } catch (e) {
    error.value = e instanceof Error ? e.message : '回收料出库失败'
  } finally {
    saving.value = false
    emit('busy', false)
  }
}
defineExpose({ submit })
</script>

<template>
  <ElForm label-position="top" :disabled="saving || !canWrite" @submit.prevent="submit">
    <AppAlert v-if="error" :title="error" type="error" :closable="false" />
    <CompactFormSection title="整桶称重">
      <ElFormItem
        label="回收料类型"
        required
        :error="submitted && !material ? '请选择回收料类型' : ''"
        class="form-field--long"
      >
        <AppSelect v-model="material" aria-label="回收料类型" placeholder="请选择回收料类型">
          <ElOption
            v-for="item in options"
            :key="item.value"
            :value="item.value"
            :label="item.label"
          />
        </AppSelect>
      </ElFormItem>
      <ElFormItem
        label="扣皮后实重"
        required
        class="form-field--long"
        :error="submitted && !(Number(weight) > 0) ? '请填写大于零的实重' : ''"
      >
        <WeightInput v-model="weight" ariaLabel="扣皮后实重" />
      </ElFormItem>
    </CompactFormSection>
    <CompactFormSection title="收发信息">
      <ElFormItem
        label="转料人"
        required
        class="form-field--long"
        :error="submitted && !sender ? '请选择转料人' : ''"
      >
        <TeamEmployeeInput v-model="sender" :team-id="teamId" label="转料人" />
      </ElFormItem>
      <ElFormItem
        v-if="external"
        label="出库去向"
        required
        class="form-field--long"
        :error="submitted && !destination ? '请选择出库去向' : ''"
      >
        <AppSelect v-model="destination" aria-label="出库去向" placeholder="请选择去向">
          <ElOption
            v-for="item in externalDestinationOptions"
            :key="item"
            :value="item"
            :label="item"
          />
        </AppSelect>
      </ElFormItem>
      <template v-else>
        <ElFormItem
          label="接收库房"
          required
          class="form-field--long"
          :error="submitted && !warehouseId ? '请选择接收库房' : ''"
        >
          <AppSelect v-model="warehouseId" aria-label="接收库房" placeholder="请选择库房">
            <ElOption
              v-for="team in warehouses"
              :key="team.id"
              :value="Number(team.id)"
              :label="team.name"
            />
          </AppSelect>
        </ElFormItem>
        <ElFormItem
          v-if="needsLocation && warehouseId"
          label="入库仓位"
          required
          class="form-field--long"
          :error="submitted && !lease ? '请选择仓位' : ''"
        >
          <WarehouseLocationSelect
            :key="warehouseId"
            v-model="location"
            v-model:reservation-key="lease"
            :team-id="warehouseId"
            required
            :disabled="saving || !canWrite"
            :show-stock-preview="false"
            @busy-change="locationBusy = $event"
          />
        </ElFormItem>
      </template>
    </CompactFormSection>
    <p class="dialog-field-hint">
      多批合称，按本次实重开一张单。已登记库存的回收料请从对应批次出库。
    </p>
  </ElForm>
</template>
