<script setup lang="ts">
import { ref } from 'vue'
import { ElAlert, ElButton, ElOption, ElSelect } from 'element-plus'
import ProcessRouteEditor from './ProcessRouteEditor.vue'
import { formatDateTime } from '@/utils/format'
import { processRouteApi } from '@/services/processRouteApi'
import { productionScheduleApi } from '@/services/productionScheduleApi'
import type { ProcessRoute } from '@/types/processRoute'
import type { ScheduleTask, ScheduleReworkOption } from '@/types/productionSchedule'
const props = defineProps<{ task: ScheduleTask; manage: boolean }>()
const emit = defineEmits<{ saved: [task: ScheduleTask] }>()
const options = ref<ScheduleReworkOption[]>([]),
  adding = ref(false),
  busy = ref(false),
  error = ref('')
const selected = ref<number>(),
  planId = ref<number>(),
  route = ref<ProcessRoute>()
const states = { awaiting_route: '待制定工艺', processing: '返工中', processed: '已完成返工' }
function plans() {
  return options.value.find((o) => o.route_id === selected.value)?.plans || []
}
async function add() {
  selected.value = undefined
  planId.value = undefined
  busy.value = true
  error.value = ''
  try {
    options.value = await productionScheduleApi.reworkOptions(props.task.id)
    adding.value = true
  } catch (e) {
    error.value = e instanceof Error ? e.message : '返工读取失败'
  } finally {
    busy.value = false
  }
}
async function save() {
  const item = options.value.find((o) => o.route_id === selected.value)
  if (!item || !planId.value) {
    error.value = '请选择返工批次和原排期节点'
    return
  }
  busy.value = true
  error.value = ''
  try {
    emit(
      'saved',
      await productionScheduleApi.linkRework(props.task.id, {
        expected_version: props.task.version,
        route_id: item.route_id,
        route_version: item.route_version,
        schedule_id: planId.value,
      }),
    )
    adding.value = false
  } catch (e) {
    error.value = e instanceof Error ? e.message : '关联失败'
  } finally {
    busy.value = false
  }
}
async function view(id: number) {
  busy.value = true
  error.value = ''
  try {
    route.value = await processRouteApi.detail(id)
  } catch (e) {
    error.value = e instanceof Error ? e.message : '工艺读取失败'
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <section v-if="manage || task.reworks?.length" class="schedule-reworks">
    <div class="rework-heading">
      <strong>返工跟进</strong
      ><ElButton v-if="manage" size="small" :disabled="busy" @click="add">关联返工问题</ElButton>
    </div>
    <ElAlert v-if="error" :title="error" type="error" :closable="false" />
    <div v-if="adding" class="rework-link">
      <ElSelect
        v-model="selected"
        aria-label="返工批次"
        placeholder="选择返工批次"
        :disabled="busy"
        @change="planId = plans().length === 1 ? plans()[0]?.id : undefined"
        ><ElOption
          v-for="item in options"
          :key="item.route_id"
          :value="item.route_id"
          :label="`${item.batch_no} · ${item.problem}`"
      /></ElSelect>
      <ElSelect v-model="planId" aria-label="原排期节点" placeholder="原排期节点" :disabled="busy"
        ><ElOption
          v-for="item in plans()"
          :key="item.id"
          :value="item.id"
          :label="`${item.team_name} · ${formatDateTime(item.due_at)}`"
      /></ElSelect>
      <ElButton :disabled="busy" @click="adding = false">取消</ElButton
      ><ElButton :loading="busy" @click="save">确认关联</ElButton>
    </div>
    <div v-if="task.reworks?.length" class="rework-grid-wrap">
      <table class="rework-grid" aria-label="返工跟进">
        <colgroup>
          <col style="width: 185px" />
          <col />
          <col style="width: 145px" />
          <col style="width: 95px" />
          <col style="width: 135px" />
          <col style="width: 110px" />
        </colgroup>
        <thead>
          <tr>
            <th>返工批次</th>
            <th>问题</th>
            <th>原交货节点</th>
            <th>返工范围</th>
            <th>进度</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in task.reworks" :key="row.route_id">
            <td>{{ row.batch_no }}</td>
            <td class="rework-problem">
              <span :title="row.problem">{{ row.problem }}</span>
            </td>
            <td>
              {{ task.nodes.find((n) => n.id === row.schedule_id)?.sequence_no }} ·
              {{ task.nodes.find((n) => n.id === row.schedule_id)?.team_name }}
            </td>
            <td>{{ row.quantity }} 件</td>
            <td>{{ states[row.state] }}</td>
            <td>
              <ElButton
                size="small"
                :disabled="busy || (!manage && row.state === 'awaiting_route')"
                @click="view(row.route_id)"
                >查看工艺</ElButton
              >
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <ProcessRouteEditor v-if="route" :route="route" view-only @close="route = undefined" />
  </section>
</template>
<style scoped>
.schedule-reworks {
  margin-top: 18px;
}
.rework-heading,
.rework-link {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.rework-heading {
  justify-content: space-between;
  font-size: 14px;
}
.rework-link > .el-select:first-child {
  flex: 2;
}
.rework-link > .el-select {
  flex: 1;
}
.rework-grid-wrap {
  overflow-x: auto;
  border: 1px solid #dce4e0;
  border-radius: 6px;
}
.rework-grid {
  width: 100%;
  min-width: 900px;
  border-collapse: collapse;
  table-layout: fixed;
  background: #fff;
  color: #262b28;
  font-size: 13px;
}
.rework-grid th,
.rework-grid td {
  padding: 10px 12px;
  border-right: 1px solid #e4e9e6;
  border-bottom: 1px solid #e4e9e6;
  text-align: center;
  vertical-align: middle;
}
.rework-grid th {
  background: #f5f8f6;
  font-weight: 500;
}
.rework-grid th:last-child,
.rework-grid td:last-child {
  border-right: 0;
}
.rework-grid tr:last-child td {
  border-bottom: 0;
}
.rework-grid .rework-problem {
  text-align: left;
}
.rework-problem span {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
