<script setup lang="ts">
import { computed } from 'vue'
import { ElTableColumn } from 'element-plus'
import WorkspaceTable from './WorkspaceTable.vue'
import AppButton from './AppButton.vue'
import type { MaterialTrace } from '@/types/materialTrace'
import { traceProcessRows } from '@/utils/traceProcessTable'
import { formatAmount, formatDateTime } from '@/utils/format'
const props = defineProps<{ trace: MaterialTrace }>()
defineEmits<{ open: [batchNo: string] }>()
const rows = computed(() => traceProcessRows(props.trace))
</script>
<template>
  <div class="process-table">
    <WorkspaceTable
      columns-key="TraceProcessTable-1"
      :data="rows"
      row-key="key"
      height="min(65vh, 760px)"
    >
      <ElTableColumn type="expand" width="40"
        ><template #default="{ row }">
          <div class="process-batches">
            <span v-if="!row.batches.length">尚无收料记录</span>
            <div v-for="batch in row.batches" :key="batch.id">
              <AppButton link @click="$emit('open', batch.batch_no)">{{ batch.batch_no }}</AppButton
              ><span>{{ formatDateTime(batch.received_at) }}</span
              ><span>{{ batch.transfer_specification || '未记录尺寸' }}</span>
            </div>
          </div>
        </template></ElTableColumn
      >
      <ElTableColumn prop="sequence" label="序号" width="85" fixed />
      <ElTableColumn prop="name" label="工序" min-width="120" fixed />
      <ElTableColumn prop="team" label="班组" min-width="100" />
      <ElTableColumn prop="planned" label="计划加工数量" width="130" />
      <ElTableColumn label="收料"
        ><ElTableColumn prop="received" label="件数" width="100" align="right" /><ElTableColumn
          label="重量 kg"
          width="125"
          align="right"
          ><template #default="{ row }">{{
            formatAmount(row.receivedWeight)
          }}</template></ElTableColumn
        ></ElTableColumn
      >
      <ElTableColumn label="加工完成"
        ><ElTableColumn label="件次" width="100" align="right"
          ><template #default="{ row }">{{ formatAmount(row.completed) }}</template></ElTableColumn
        ><ElTableColumn label="重量 kg" width="125" align="right"
          ><template #default="{ row }">{{
            formatAmount(row.completedWeight)
          }}</template></ElTableColumn
        ></ElTableColumn
      >
      <ElTableColumn label="转出（含在途）"
        ><ElTableColumn prop="sent" label="件数" width="100" align="right" /><ElTableColumn
          label="重量 kg"
          width="125"
          align="right"
          ><template #default="{ row }">{{ formatAmount(row.sentWeight) }}</template></ElTableColumn
        ></ElTableColumn
      >
      <ElTableColumn label="当前在库"
        ><ElTableColumn label="件数" width="100" align="right"
          ><template #default="{ row }">{{ formatAmount(row.stock) }}</template></ElTableColumn
        ><ElTableColumn label="重量 kg" width="125" align="right"
          ><template #default="{ row }">{{
            formatAmount(row.stockWeight)
          }}</template></ElTableColumn
        ></ElTableColumn
      >
      <ElTableColumn label="丢失"
        ><ElTableColumn prop="lost" label="件数" width="100" align="right" /><ElTableColumn
          label="重量 kg"
          width="125"
          align="right"
          ><template #default="{ row }">{{ formatAmount(row.lostWeight) }}</template></ElTableColumn
        ></ElTableColumn
      >
      <ElTableColumn label="最近检验不合格" width="145" align="right"
        ><template #default="{ row }">{{ formatAmount(row.failed) }}</template></ElTableColumn
      >
    </WorkspaceTable>
  </div>
</template>
<style scoped>
.process-table {
  min-width: 0;
  flex: 1;
}
.process-batches {
  padding: 8px 16px;
}
.process-batches > div {
  display: flex;
  gap: 20px;
  align-items: center;
  min-height: 36px;
}
</style>
