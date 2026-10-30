<script setup lang="ts">
import { awaitingReview } from '@/utils/schedulePlanning'
import { computed, ref } from 'vue'
import { ElAlert, ElButton, ElInput, ElTable, ElTableColumn, ElTag } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import { productionScheduleApi } from '@/services/productionScheduleApi'
import type { ProductionSchedule } from '@/types/productionSchedule'
import { formatDateTime, formatAmount } from '@/utils/format'
const props = defineProps<{ schedule: ProductionSchedule }>()
const emit = defineEmits<{ changed: [ProductionSchedule] }>()
const auth = useAuthStore(),
  allowed = computed(() => auth.isDispatch && !props.schedule.order_locked)
const saving = ref(false),
  returning = ref(false),
  reason = ref(''),
  error = ref('')
async function review(approve: boolean) {
  if (!allowed.value || saving.value) return
  if (!approve && !reason.value.trim()) {
    error.value = '请填写退回原因'
    return
  }
  saving.value = true
  error.value = ''
  try {
    emit(
      'changed',
      await productionScheduleApi.reviewPlan(props.schedule.id, {
        expected_version: props.schedule.version,
        approve,
        reason: reason.value.trim(),
      }),
    )
    returning.value = false
    reason.value = ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : '确认失败'
  } finally {
    saving.value = false
  }
}
</script>
<template>
  <section
    v-if="awaitingReview(schedule) && schedule.pending_batches?.length"
    class="plan-review"
    aria-label="待调度确认的计划"
  >
    <header>
      <h3>本次提交</h3>
      <ElTag type="warning">待调度确认</ElTag
      ><ElTag v-if="schedule.order_locked" type="info">订单已锁定</ElTag>
    </header>
    <ElAlert v-if="error" :title="error" type="error" :closable="false" />
    <ElTable :data="schedule.pending_batches" border size="small"
      ><ElTableColumn label="批次" prop="batch_number" width="80" /><ElTableColumn
        label="数量（件）"
        width="110"
        ><template #default="{ row }">{{
          formatAmount(row.target_quantity)
        }}</template></ElTableColumn
      ><ElTableColumn label="重量（kg）" width="110"
        ><template #default="{ row }">{{
          formatAmount(row.target_weight)
        }}</template></ElTableColumn
      ><ElTableColumn label="计划开始" min-width="170"
        ><template #default="{ row }">{{
          formatDateTime(row.planned_start_at)
        }}</template></ElTableColumn
      ><ElTableColumn label="计划转出" min-width="170"
        ><template #default="{ row }">{{ formatDateTime(row.due_at) }}</template></ElTableColumn
      ></ElTable
    >
    <div v-if="allowed" class="review-actions">
      <ElInput
        v-if="returning"
        v-model="reason"
        placeholder="退回原因"
        maxlength="2000"
        aria-label="退回原因"
      /><ElButton v-if="returning" :disabled="saving" @click="returning = false">取消</ElButton
      ><ElButton v-if="returning" type="warning" :loading="saving" @click="review(false)"
        >确认退回</ElButton
      ><template v-else
        ><ElButton :disabled="saving" @click="returning = true">退回修改</ElButton
        ><ElButton type="primary" :loading="saving" @click="review(true)"
          >确认交期</ElButton
        ></template
      >
    </div>
  </section>
</template>
<style scoped>
.plan-review {
  margin: 16px 0;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  padding: 12px;
}
.plan-review header,
.review-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.plan-review header {
  margin-bottom: 10px;
}
.plan-review h3 {
  font-size: 14px;
  margin: 0;
}
.review-actions {
  justify-content: flex-end;
  margin-top: 10px;
}
.review-actions .el-input {
  flex: 1;
}
</style>
