<script setup lang="ts">
import ElInput from '@/components/AppInput.vue'
import { computed, ref, watch } from 'vue'
import { ElTableColumn } from 'element-plus'
import AppButton from './AppButton.vue'
import AppNumberInput from './AppNumberInput.vue'
import WorkspaceTable from './WorkspaceTable.vue'
import MaterialInput from './MaterialInput.vue'
import { processRouteApi } from '@/services/processRouteApi'
import type { ProcessRoute } from '@/types/processRoute'
import type { SharedMaterialSerial } from '@/types/sharedMaterial'

const props = defineProps<{
  modelValue: SharedMaterialSerial[]
  teamId: number
  disabled?: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [SharedMaterialSerial[]]
  'routes-change': [ProcessRoute[]]
  'validation-change': [string]
}>()
const routes = ref<Record<string, ProcessRoute>>({})
const errors = ref<Record<string, string>>({})
const loading = ref(false)
function update(index: number, patch: Partial<SharedMaterialSerial>) {
  emit(
    'update:modelValue',
    props.modelValue.map((row, i) => (i === index ? { ...row, ...patch } : row)),
  )
}
const problem = computed(() => {
  const serials = props.modelValue.map((row) => row.serial_no.trim())
  if (serials.some((serial) => !serial)) return '请填写每个共投流水号'
  if (new Set(serials.map((serial) => serial.toLowerCase())).size !== serials.length)
    return '共投流水号不能重复'
  if (loading.value) return '正在读取共投工艺'
  const error = Object.values(errors.value).find(Boolean)
  if (error) return error
  if (props.modelValue.some((row) => !row.process_route_id)) return '请为每个共投流水号读取工艺'
  if (
    props.modelValue.some(
      (row) =>
        !(Number(row.planned_weight) > 0) ||
        !Number.isSafeInteger(row.planned_quantity) ||
        !(Number(row.planned_quantity) > 0) ||
        !row.planned_specification?.trim(),
    )
  )
    return '请填写各流水号的计划用料、切出件数和切割尺寸'
  return ''
})
watch(problem, (value) => emit('validation-change', value), { immediate: true })
watch(
  () => JSON.stringify([props.teamId, props.modelValue.map((row) => row.serial_no.trim())]),
  (_, __, onCleanup) => {
    let cancelled = false
    routes.value = {}
    errors.value = {}
    emit('routes-change', [])
    emit(
      'update:modelValue',
      props.modelValue.map((row) => ({
        ...row,
        process_route_id: undefined,
        process_route_version: undefined,
      })),
    )
    loading.value = true
    const timer = setTimeout(async () => {
      for (let index = 0; index < props.modelValue.length; index++) {
        const serial = props.modelValue[index]!.serial_no.trim()
        if (!serial) continue
        try {
          const route = await processRouteApi.resolve(serial)
          if (cancelled) return
          if (
            route.state !== 'published' ||
            route.route_kind === 'rework' ||
            route.steps[0]?.team_id !== props.teamId
          )
            throw new Error(`${serial}：请选择从本库房开始的正常工艺`)
          if (!route.filename || !route.drawings?.length)
            throw new Error(`${serial}：工艺原件或图纸未齐全`)
          const scheduled = await processRouteApi.dispatchOrder(route.id, serial)
          if (cancelled) return
          const order =
            scheduled?.document ||
            (route.source_data.order_document?.serial_no === serial
              ? route.source_data.order_document
              : undefined)
          if (!order) throw new Error(`${serial}：缺少订单表`)
          const fields = order.receipt_fields
          const hasDelivery = Boolean(
            fields.delivery_date?.value && fields.delivery_quantity?.value,
          )
          update(index, {
            process_route_id: route.id,
            process_route_version: route.version,
            customer_code: String(fields.customer_code?.value || ''),
            finished_specification: String(fields.finished_specification?.value || ''),
            delivery_date: hasDelivery ? String(fields.delivery_date!.value) : null,
            delivery_quantity: hasDelivery ? Number(fields.delivery_quantity!.value) : null,
          })
          routes.value = { ...routes.value, [serial]: route }
        } catch (error) {
          if (cancelled) return
          errors.value = {
            ...errors.value,
            [serial]: error instanceof Error ? error.message : `${serial}：工艺读取失败`,
          }
        }
      }
      if (!cancelled) {
        loading.value = false
        emit(
          'routes-change',
          props.modelValue.flatMap((row) => routes.value[row.serial_no.trim()] || []),
        )
      }
    }, 300)
    onCleanup(() => {
      cancelled = true
      clearTimeout(timer)
    })
  },
  { immediate: true },
)
</script>

<template>
  <section class="shared-dispatch-fields" aria-label="共投流水号明细">
    <WorkspaceTable :data="modelValue" size="small" :height="undefined" :fill="false">
      <ElTableColumn label="流水号" min-width="165">
        <template #default="{ row, $index }">
          <MaterialInput
            :model-value="row.serial_no"
            field="serial_no"
            :label="`共投流水号 ${$index + 1}`"
            :disabled="disabled"
            @update:model-value="update($index, { serial_no: $event })"
          />
        </template>
      </ElTableColumn>
      <ElTableColumn label="关联工艺" min-width="140">
        <template #default="{ row }"
          ><span :title="errors[row.serial_no.trim()] || routes[row.serial_no.trim()]?.title">{{
            errors[row.serial_no.trim()]
              ? '读取失败'
              : routes[row.serial_no.trim()]?.title || (loading ? '读取中…' : '—')
          }}</span></template
        >
      </ElTableColumn>
      <ElTableColumn label="计划用料（kg）" width="155">
        <template #default="{ row, $index }"
          ><AppNumberInput
            :model-value="row.planned_weight ?? undefined"
            :min="0.000001"
            :precision="6"
            :controls="false"
            :disabled="disabled"
            :aria-label="`计划用料 ${$index + 1}`"
            @update:model-value="update($index, { planned_weight: $event })"
        /></template>
      </ElTableColumn>
      <ElTableColumn label="切出件数" width="125">
        <template #default="{ row, $index }"
          ><AppNumberInput
            :model-value="row.planned_quantity ?? undefined"
            :min="1"
            :precision="0"
            :controls="false"
            :disabled="disabled"
            :aria-label="`切出件数 ${$index + 1}`"
            @update:model-value="update($index, { planned_quantity: $event })"
        /></template>
      </ElTableColumn>
      <ElTableColumn label="切割尺寸" min-width="170">
        <template #default="{ row, $index }"
          ><ElInput
            :model-value="row.planned_specification || ''"
            placeholder="长 × 宽 × 厚 mm"
            :maxlength="240"
            :disabled="disabled"
            :aria-label="`切割尺寸 ${$index + 1}`"
            @update:model-value="update($index, { planned_specification: $event })"
        /></template>
      </ElTableColumn>
      <ElTableColumn label="操作" width="70">
        <template #default="{ $index }"
          ><AppButton
            link
            :disabled="disabled || modelValue.length <= 2"
            @click="
              emit(
                'update:modelValue',
                modelValue.filter((_, i) => i !== $index),
              )
            "
            >移除</AppButton
          ></template
        >
      </ElTableColumn>
    </WorkspaceTable>
    <p v-for="(message, serial) in errors" :key="serial" class="field-error" role="alert">
      {{ message }}
    </p>
    <AppButton
      size="small"
      :disabled="disabled || modelValue.length >= 20"
      @click="emit('update:modelValue', [...modelValue, { serial_no: '' }])"
      >增加流水号</AppButton
    >
  </section>
</template>

<style scoped>
.shared-dispatch-fields {
  display: grid;
  gap: 10px;
  padding: 0 16px 16px;
  min-width: 0;
}
.shared-dispatch-fields > .el-button {
  justify-self: start;
}
.shared-dispatch-fields :deep(.el-input-number) {
  width: 100%;
}
</style>
