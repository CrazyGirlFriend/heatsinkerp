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
const props = defineProps<{ context: QuantityAdjustmentContext; originalId?: number | null }>()
const emit = defineEmits<{ changed: []; busy: [boolean] }>()
const inspectionId = ref<number>()
const original = ref(props.originalId || props.context.rework_of_id || null)
const quantity = ref(props.context.quantity),
  weight = ref(props.context.weight),
  reason = ref('')
const busy = ref(false),
  error = ref(''),
  submitted = ref(false)
const key = materialRequestKey()
async function save() {
  submitted.value = true
  if (
    busy.value ||
    !original.value ||
    quantity.value <= 0 ||
    weight.value <= 0 ||
    !reason.value.trim()
  )
    return
  busy.value = true
  emit('busy', true)
  error.value = ''
  try {
    await processRouteApi.requestRework({
      ...(inspectionId.value ? { inspection_id: inspectionId.value } : {}),
      source_transfer_id: props.context.source_transfer_id,
      rework_of_id: original.value,
      expected_revision: props.context.revision,
      quantity: quantity.value,
      weight: weight.value,
      reason: reason.value.trim(),
      idempotency_key: key,
    })
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
  <section class="rework-request" aria-label="登记返工事项">
    <ElAlert v-if="error" :title="error" type="error" :closable="false" />
    <h3>登记返工事项</h3>
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
      <ElFormItem v-if="context.rework_inspections?.length" label="关联质量问题">
        <ElSelect
          v-model="inspectionId"
          clearable
          placeholder="选择检验或巡检记录"
          aria-label="关联质量问题"
        >
          <ElOption
            v-for="item in context.rework_inspections"
            :key="item.id"
            :value="item.id"
            :label="`${item.kind === 'patrol' ? '巡检' : '检验'} #${item.id}`"
          />
        </ElSelect>
      </ElFormItem>
      <div class="rework-amounts">
        <ElFormItem label="返工件数" required
          ><ElInputNumber
            v-model="quantity"
            :min="1"
            :max="context.quantity"
            :precision="0"
            aria-label="返工件数"
        /></ElFormItem>
        <ElFormItem label="返工重量（kg）" required
          ><ElInputNumber
            v-model="weight"
            :min="0.000001"
            :max="context.weight"
            :precision="6"
            aria-label="返工重量"
        /></ElFormItem>
      </div>
      <ElFormItem
        label="返工原因"
        required
        :error="submitted && !reason.trim() ? '请填写返工原因' : ''"
        ><ElInput v-model="reason" type="textarea" :rows="2" maxlength="2000" aria-label="返工原因"
      /></ElFormItem>
      <footer>
        <span>登记后由工艺人员制定返工工艺</span
        ><ElButton type="primary" :loading="busy" native-type="submit">提交返工事项</ElButton>
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
h3 {
  margin: 0 0 16px;
  font-size: 15px;
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
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
footer span {
  color: var(--muted);
  font-size: 12px;
}
</style>
