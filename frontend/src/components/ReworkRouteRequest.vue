<script setup lang="ts">
import { ref } from 'vue'
import {
  ElAlert,
  ElButton,
  ElForm,
  ElFormItem,
  ElInput,
  ElInputNumber,
  ElOption,
  ElSelect,
} from 'element-plus'
import type { QuantityAdjustmentContext } from '@/types/teamMaterials'
import { processRouteApi } from '@/services/processRouteApi'
import { materialRequestKey } from '@/utils/materialStock'
const props = defineProps<{
  context: QuantityAdjustmentContext
  inspectionId?: number
  initialReason?: string
}>()
const emit = defineEmits<{ changed: []; busy: [boolean] }>()
const original = ref(props.context.rework_of_id || null)
const quantity = ref<number>(),
  weight = ref<number>(),
  reason = ref(props.initialReason || '')
const busy = ref(false),
  error = ref(''),
  submitted = ref(false)
let key = '',
  fingerprint = ''
async function save() {
  submitted.value = true
  if (
    busy.value ||
    !original.value ||
    quantity.value == null ||
    weight.value == null ||
    !Number.isFinite(quantity.value) ||
    quantity.value <= 0 ||
    !Number.isFinite(weight.value) ||
    weight.value <= 0 ||
    !reason.value.trim()
  )
    return
  busy.value = true
  emit('busy', true)
  error.value = ''
  try {
    const body = {
      inspection_id: props.inspectionId,
      source_transfer_id: props.context.source_transfer_id,
      rework_of_id: original.value,
      expected_revision: props.context.revision,
      quantity: quantity.value,
      weight: weight.value,
      reason: reason.value.trim(),
    }
    const next = JSON.stringify(body)
    if (next !== fingerprint) {
      fingerprint = next
      key = materialRequestKey()
    }
    await processRouteApi.requestRework({ ...body, idempotency_key: key })
    emit('changed')
  } catch (e) {
    error.value = e instanceof Error ? e.message : '返工事项登记失败'
  } finally {
    busy.value = false
    emit('busy', false)
  }
}
</script>
<template>
  <section class="rework-request" aria-label="提交返工问题">
    <ElAlert v-if="error" :title="error" type="error" :closable="false" />
    <ElForm label-position="top" :disabled="busy" @submit.prevent="save">
      <ElFormItem
        label="原加工记录"
        required
        :error="submitted && !original ? '请选择原加工记录' : ''"
      >
        <ElSelect v-model="original" aria-label="返工原加工记录" placeholder="选择需要返工的工序">
          <ElOption
            v-for="record in context.rework_task_records"
            :key="record.rework_of_id"
            :value="record.rework_of_id"
            :label="`${record.process_step_name || record.processing_task_name || '加工'} · #${record.rework_of_id}`"
          />
          <ElOption
            v-if="
              original && !context.rework_task_records?.some((row) => row.rework_of_id === original)
            "
            :value="original"
            :label="`原加工记录 #${original}`"
          />
        </ElSelect>
      </ElFormItem>
      <div class="rework-amounts">
        <ElFormItem
          label="返工件数"
          required
          :error="submitted && (!quantity || quantity <= 0) ? '请填写返工件数' : ''"
          ><ElInputNumber
            v-model="quantity"
            :min="1"
            :max="context.quantity"
            :precision="0"
            aria-label="返工件数"
        /></ElFormItem>
        <ElFormItem
          label="返工重量（kg）"
          required
          :error="submitted && (!weight || weight <= 0) ? '请填写返工重量' : ''"
          ><ElInputNumber
            v-model="weight"
            :min="0.000001"
            :max="context.weight"
            :step="0.000001"
            :precision="6"
            aria-label="返工重量"
        /></ElFormItem>
      </div>
      <ElFormItem
        label="问题描述"
        required
        :error="submitted && !reason.trim() ? '请填写问题描述' : ''"
        ><ElInput v-model="reason" type="textarea" :rows="2" maxlength="2000" aria-label="问题描述"
      /></ElFormItem>
      <footer>
        <ElButton type="primary" :loading="busy" native-type="submit">提交问题</ElButton>
      </footer>
    </ElForm>
  </section>
</template>
<style scoped>
.rework-request {
  margin-top: 20px;
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--surface, #fff);
}
.rework-amounts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.el-input-number,
.el-select {
  width: 100%;
}
footer {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 12px;
}
</style>
