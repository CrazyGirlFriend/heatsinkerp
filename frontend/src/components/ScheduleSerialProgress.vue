<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElTableColumn, ElTag as AppTag } from 'element-plus'
import StatePanel from './StatePanel.vue'
import DataTable from './watermelon/WatermelonDataTable.vue'
import ScheduleProgressMeter from './ScheduleProgressMeter.vue'
import { productionScheduleApi } from '@/services/productionScheduleApi'
import type { ProductionSchedule, ScheduleSerialProgress } from '@/types/productionSchedule'
import { scheduleStatusLabels, scheduleStatusTone } from '@/types/productionSchedule'
import { boardTeamColor } from '@/utils/scheduleBoard'
import { nodeCompletion, nodeTarget } from '@/utils/scheduleProgress'
import { plannedDueLabel } from '@/utils/schedulePlanning'
import { formatAmount, formatDateTime } from '@/utils/format'
import { useLiveRefresh } from '@/composables/useLiveRefresh'

const props = defineProps<{ taskId: number }>()
const data = ref<ScheduleSerialProgress>()
const loading = ref(false),
  fetching = ref(false),
  error = ref('')
let generation = 0
const live = useLiveRefresh(() => load(true), { busy: () => fetching.value })
async function load(background = false) {
  const token = ++generation
  fetching.value = true
  if (!background) loading.value = true
  error.value = ''
  try {
    const result = await productionScheduleApi.serialProgress(props.taskId)
    if (token === generation) data.value = result
  } catch (e) {
    if (background) throw e
    if (token === generation) error.value = e instanceof Error ? e.message : '进度读取失败'
  } finally {
    if (token === generation) {
      loading.value = false
      fetching.value = false
    }
  }
}
watch(
  () => props.taskId,
  () => load(),
  { immediate: true },
)
onBeforeUnmount(() => {
  generation++
})
const shippingPercent = computed(() =>
  data.value?.planned_quantity && data.value.planned_quantity > 0
    ? Math.min(100, (data.value.shipped_quantity / data.value.planned_quantity) * 100)
    : null,
)
const remaining = computed(() =>
  data.value?.planned_quantity == null
    ? null
    : Math.max(0, data.value.planned_quantity - data.value.shipped_quantity),
)
const shipmentState = computed(() =>
  data.value?.shipped_quantity ? (remaining.value === 0 ? '已发齐' : '部分发货') : '未发货',
)
const asNode = (row: unknown) => row as ProductionSchedule
</script>

<template>
  <StatePanel v-if="loading" state="loading" compact />
  <StatePanel v-else-if="error" state="error" :description="error" @retry="load()" />
  <div v-else-if="data" class="serial-progress">
    <p v-if="live.message.value" role="status" class="serial-progress__scope">
      {{ live.message.value }}
    </p>
    <section class="serial-progress__shipping" aria-label="客户发货进度">
      <header>
        <h3>客户发货</h3>
        <AppTag :type="shipmentState === '已发齐' ? 'success' : 'info'">{{ shipmentState }}</AppTag
        ><span class="serial-progress__scope">{{ data.serial_no }} · 累计</span>
      </header>
      <div class="serial-progress__numbers">
        <div>
          <span>计划数量</span
          ><strong>{{ formatAmount(data.planned_quantity) }} <small>件</small></strong>
        </div>
        <div>
          <span>已发货</span
          ><strong>{{ formatAmount(data.shipped_quantity) }} <small>件</small></strong>
        </div>
        <div>
          <span>待发货</span><strong>{{ formatAmount(remaining) }} <small>件</small></strong>
        </div>
        <div>
          <span>最近发货</span><b>{{ formatDateTime(data.last_shipped_at) }}</b>
        </div>
      </div>
      <ScheduleProgressMeter :percent="shippingPercent" color="#168779" label="客户发货完成比例" />
      <small class="serial-progress__scope">仅计成品“对外转料”；内部交接和外协不计入。</small>
    </section>
    <section v-for="task in data.tasks" :key="task.id" class="serial-progress__task">
      <header>
        <h3>{{ task.title }}</h3>
        <span>{{ task.task_no }}</span
        ><AppTag v-if="task.id === taskId" type="info">当前任务</AppTag
        ><span class="serial-progress__deadline"
          >最终交期 {{ formatDateTime(task.final_due_at) }}</span
        >
      </header>
      <DataTable
        :data="task.nodes.filter((n) => n.status !== 'cancelled')"
        row-key="id"
        columns-key="ScheduleSerialProgress-operations"
        aria-label="班组加工与交接进度"
      >
        <ElTableColumn label="工序 / 班组" min-width="130"
          ><template #default="{ row }"
            ><span class="serial-progress__team"
              ><i :style="{ background: boardTeamColor(row.team_name) }" />{{ row.sequence_no }} ·
              {{ row.team_name }}</span
            ></template
          ></ElTableColumn
        >
        <ElTableColumn label="计划量" min-width="100"
          ><template #default="{ row }">{{ nodeTarget(asNode(row)) }}</template></ElTableColumn
        >
        <ElTableColumn label="已加工" min-width="140"
          ><template #default="{ row }"
            ><span v-if="row.assessment_enabled === false">—</span>
            <div v-else class="serial-progress__amount">
              <span>{{ formatAmount(row.processed_quantity) }} 件</span
              ><ScheduleProgressMeter
                :percent="nodeCompletion(asNode(row)).processed"
                :color="boardTeamColor(row.team_name)"
                :label="`${row.sequence_no} ${row.team_name}加工比例`"
              /></div></template
        ></ElTableColumn>
        <ElTableColumn label="已转出" min-width="140"
          ><template #default="{ row }"
            ><div class="serial-progress__amount">
              <span
                >{{ formatAmount(row.dispatched_quantity) }} 件<span
                  v-if="row.completion_basis !== 'quantity'"
                >
                  · {{ formatAmount(row.dispatched_weight) }} kg</span
                ></span
              ><ScheduleProgressMeter
                :percent="nodeCompletion(asNode(row)).dispatched"
                :color="boardTeamColor(row.team_name)"
                :label="`${row.sequence_no} ${row.team_name}转出比例`"
              /></div></template
        ></ElTableColumn>
        <ElTableColumn label="下序签收" min-width="110"
          ><template #default="{ row }"
            >{{ formatAmount(row.received_quantity) }} 件</template
          ></ElTableColumn
        >
        <ElTableColumn label="约定转交" min-width="175"
          ><template #default="{ row }">{{ plannedDueLabel(asNode(row)) }}</template></ElTableColumn
        >
        <ElTableColumn label="交期状态" min-width="120"
          ><template #default="{ row }"
            ><AppTag :type="scheduleStatusTone(row.status)">{{
              scheduleStatusLabels[row.status as keyof typeof scheduleStatusLabels]
            }}</AppTag></template
          ></ElTableColumn
        >
      </DataTable>
    </section>
    <section class="serial-progress__shipments">
      <header>
        <h3>发货记录</h3>
        <span>{{
          data.shipment_count > data.shipments.length
            ? `最近 ${data.shipments.length} 笔 / 共 ${data.shipment_count} 笔`
            : `${data.shipment_count} 笔`
        }}</span>
      </header>
      <DataTable
        :data="data.shipments"
        row-key="id"
        columns-key="ScheduleSerialProgress-shipments"
        aria-label="成品发货记录"
      >
        <template #empty>尚未向客户发货</template>
        <ElTableColumn prop="batch_no" label="发货批次" min-width="150" />
        <ElTableColumn prop="team_name" label="发货班组" min-width="100" />
        <ElTableColumn label="数量（件）" min-width="110"
          ><template #default="{ row }">{{ formatAmount(row.quantity) }}</template></ElTableColumn
        >
        <ElTableColumn label="重量（kg）" min-width="110"
          ><template #default="{ row }">{{ formatAmount(row.weight) }}</template></ElTableColumn
        >
        <ElTableColumn label="发货时间" min-width="175"
          ><template #default="{ row }">{{
            formatDateTime(row.shipped_at)
          }}</template></ElTableColumn
        >
      </DataTable>
    </section>
  </div>
</template>

<style scoped>
.serial-progress {
  display: grid;
  gap: 24px;
}
.serial-progress header {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.serial-progress h3 {
  margin: 0;
  font-size: 15px;
  color: var(--text);
}
.serial-progress header > span,
.serial-progress__scope {
  color: var(--muted);
  font-size: 12px;
}
.serial-progress__deadline {
  margin-left: auto;
}
.serial-progress__shipping {
  padding: 18px 20px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--surface);
}
.serial-progress__numbers {
  display: grid;
  grid-template-columns: repeat(3, 1fr) 1.5fr;
  gap: 16px;
  margin-block: 18px;
}
.serial-progress__numbers > div {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.serial-progress__numbers span {
  color: var(--muted);
  font-size: 12px;
}
.serial-progress__numbers strong {
  font-size: 24px;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.serial-progress__numbers strong small {
  font-size: 12px;
  color: var(--muted);
  font-weight: normal;
}
.serial-progress__numbers b {
  font-size: 14px;
  font-weight: 500;
}
.serial-progress__shipping > small {
  display: block;
  margin-top: 10px;
}
.serial-progress__team {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.serial-progress__team i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}
.serial-progress__amount {
  display: grid;
  gap: 5px;
}
@media (max-width: 700px) {
  .serial-progress__numbers {
    grid-template-columns: 1fr 1fr;
  }
  .serial-progress__deadline {
    margin-left: 0;
  }
}
</style>
