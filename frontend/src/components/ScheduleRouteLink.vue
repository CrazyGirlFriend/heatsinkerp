<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElAlert, ElButton, ElOption, ElSelect, ElTable, ElTableColumn } from 'element-plus'
import AppDialog from './AppDialog.vue'
import { productionScheduleApi } from '@/services/productionScheduleApi'
import type { ScheduleTask, ScheduleRouteOption } from '@/types/productionSchedule'
import { formatDateTime } from '@/utils/format'
const props = defineProps<{ task: ScheduleTask }>()
const emit = defineEmits<{ close: []; saved: [task: ScheduleTask] }>()
const visible = ref(true),
  busy = ref(false),
  error = ref('')
const options = ref<ScheduleRouteOption[]>([]),
  selected = ref<number>()
const mappings = ref<Record<number, number | undefined>>({})
const nodes = props.task.nodes.filter((n) => !n.cancelled_at)
function steps() {
  return options.value.find((r) => r.id === selected.value)?.steps || []
}
function match() {
  mappings.value = {}
  const applicable = steps()
    .map((step, index) => ({ step, index }))
    .filter(({ step }) => !step.serial_nos.length || step.serial_nos.includes(props.task.serial_no))
  nodes.forEach((node) => {
    const matches = applicable.filter(
      ({ step }, position) =>
        step.team_id === node.team_id &&
        applicable[position + 1]?.step.team_id !== step.team_id &&
        (applicable[position + 1]?.step.team_id || null) === node.next_team_id,
    )
    if (matches.length === 1) mappings.value[node.id] = matches[0]!.index
  })
}
onMounted(async () => {
  busy.value = true
  try {
    options.value = await productionScheduleApi.routeOptions(props.task.id)
    selected.value = options.value[0]?.id
    match()
  } catch (e) {
    error.value = e instanceof Error ? e.message : '工艺读取失败'
  } finally {
    busy.value = false
  }
})
async function save() {
  const route = options.value.find((r) => r.id === selected.value)
  const chosen = nodes.filter((n) => mappings.value[n.id] !== undefined)
  if (!route || !chosen.length) {
    error.value = '请选择工艺及对应工序'
    return
  }
  busy.value = true
  error.value = ''
  try {
    const task = await productionScheduleApi.linkRoute(props.task.id, {
      expected_version: props.task.version,
      route_id: route.id,
      route_version: route.version,
      mappings: chosen.map((n) => ({
        schedule_id: n.id,
        expected_version: n.version,
        step_index: mappings.value[n.id]!,
      })),
    })
    emit('saved', task)
    visible.value = false
  } catch (e) {
    error.value = e instanceof Error ? e.message : '关联失败'
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <AppDialog
    v-model="visible"
    title="关联工艺"
    width="min(1000px, 94vw)"
    append-to-body
    :show-close="!busy"
    :close-on-click-modal="false"
    :close-on-press-escape="!busy"
    @closed="emit('close')"
  >
    <ElAlert v-if="error" :title="error" type="error" :closable="false" />
    <div class="route-choice">
      <span>流水号 {{ task.serial_no }}</span
      ><ElSelect
        v-model="selected"
        aria-label="关联工艺"
        :disabled="busy"
        placeholder="暂无可关联工艺"
        @change="match"
        ><ElOption
          v-for="r in options"
          :key="r.id"
          :value="r.id"
          :label="`${r.title} · ${formatDateTime(r.published_at)}`"
      /></ElSelect>
    </div>
    <ElTable :data="nodes" border class="business-table">
      <ElTableColumn label="排期班组" width="150"
        ><template #default="{ row }"
          >{{ row.team_name }} → {{ row.next_team_name || row.external_destination }}</template
        ></ElTableColumn
      >
      <ElTableColumn label="交货时间" width="160"
        ><template #default="{ row }">{{ formatDateTime(row.due_at) }}</template></ElTableColumn
      >
      <ElTableColumn label="当前关联" width="120"
        ><template #default="{ row }">{{
          row.route_link?.state === 'changed'
            ? '工艺有更新'
            : row.process_route_id
              ? '已关联'
              : '未关联'
        }}</template></ElTableColumn
      >
      <ElTableColumn label="对应工序"
        ><template #default="{ row }"
          ><ElSelect
            v-model="mappings[row.id]"
            clearable
            :aria-label="`${row.team_name}对应工序`"
            :disabled="busy"
            placeholder="保留当前关联"
            ><ElOption
              v-for="(step, index) in steps()"
              :key="index"
              :value="index"
              :label="`${step.sequence_no} · ${step.name}（${step.team_name}）`"
              :disabled="step.team_id !== row.team_id" /></ElSelect></template
      ></ElTableColumn>
    </ElTable>
    <template #footer
      ><ElButton :disabled="busy" @click="visible = false">取消</ElButton
      ><ElButton type="primary" :loading="busy" @click="save">确认关联</ElButton></template
    >
  </AppDialog>
</template>
<style scoped>
.route-choice {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 14px;
}
.route-choice > .el-select {
  flex: 1;
}
.el-table .el-select {
  width: 100%;
}
</style>
