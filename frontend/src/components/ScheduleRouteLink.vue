<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  ElAlert,
  ElButton,
  ElForm,
  ElFormItem,
  ElInput,
  ElOption,
  ElSelect,
  ElTable,
  ElTableColumn,
} from 'element-plus'
import AppDialog from './AppDialog.vue'
import FormWorkspace from './FormWorkspace.vue'
import CompactFormSection from './CompactFormSection.vue'
import ProcessRouteAttachments from './ProcessRouteAttachments.vue'
import { processRouteApi } from '@/services/processRouteApi'
import type { ProcessRoute } from '@/types/processRoute'
import ScheduleRouteSelect from './ScheduleRouteSelect.vue'
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
const previewRoute = ref<ProcessRoute>(),
  previewLoading = ref(false),
  previewError = ref('')
let previewGeneration = 0
async function loadPreview() {
  const generation = ++previewGeneration
  previewRoute.value = undefined
  previewError.value = ''
  previewLoading.value = false
  if (!selected.value) return
  previewLoading.value = true
  try {
    const route = await processRouteApi.detail(selected.value)
    if (generation === previewGeneration) previewRoute.value = route
  } catch (e) {
    if (generation === previewGeneration)
      previewError.value = e instanceof Error ? e.message : '工艺资料读取失败'
  } finally {
    if (generation === previewGeneration) previewLoading.value = false
  }
}
watch(selected, loadPreview)
onBeforeUnmount(() => ++previewGeneration)
const mappings = ref<Record<number, number | undefined>>({})
const nodes = props.task.nodes.filter((n) => !n.cancelled_at)
function steps() {
  const route = options.value.find((r) => r.id === selected.value)
  const serial = route?.execution_serial ?? props.task.serial_no
  return (route?.steps || [])
    .map((step, index) => ({ step, index }))
    .filter(({ step }) => !step.serial_nos.length || step.serial_nos.includes(serial))
}
function match() {
  mappings.value = {}
  const applicable = steps()
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
    width="min(1220px, 96vw)"
    append-to-body
    :show-close="!busy"
    :close-on-click-modal="false"
    :close-on-press-escape="!busy"
    @closed="emit('close')"
  >
    <ElAlert v-if="error" :title="error" type="error" :closable="false" />
    <FormWorkspace>
      <template #documents>
        <p v-if="previewLoading" class="route-documents-empty" role="status">读取工艺资料…</p>
        <template v-else-if="previewError">
          <ElAlert :title="previewError" type="error" :closable="false" />
          <ElButton size="small" @click="loadPreview">重新读取资料</ElButton>
        </template>
        <ProcessRouteAttachments
          v-else-if="previewRoute"
          :route="previewRoute"
          :documents="['word', 'drawing']"
        />
        <p v-else class="route-documents-empty">选择工艺后显示原件和图纸</p>
      </template>
      <ElForm label-position="top" @submit.prevent>
        <CompactFormSection title="工艺选择">
          <ElFormItem label="流水号" class="form-field--medium">
            <ElInput :model-value="task.serial_no" readonly aria-label="排期流水号" />
          </ElFormItem>
          <ElFormItem label="关联工艺" required class="form-field--long">
            <ScheduleRouteSelect
              v-model="selected"
              :options="options"
              :loading="busy"
              :disabled="busy"
              @change="match"
            />
          </ElFormItem>
        </CompactFormSection>
        <CompactFormSection title="节点映射">
          <ElTable class="business-table form-field--full" :data="nodes" border>
            <ElTableColumn label="排期班组" width="150"
              ><template #default="{ row }"
                >{{ row.team_name }} →
                {{ row.next_team_name || row.external_destination }}</template
              ></ElTableColumn
            >
            <ElTableColumn label="交货时间" width="160"
              ><template #default="{ row }">{{
                formatDateTime(row.due_at)
              }}</template></ElTableColumn
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
                    v-for="{ step, index } in steps()"
                    :key="index"
                    :value="index"
                    :label="`${step.sequence_no} · ${step.name}（${step.team_name}）`"
                    :disabled="step.team_id !== row.team_id" /></ElSelect></template
            ></ElTableColumn>
          </ElTable>
        </CompactFormSection>
      </ElForm>
    </FormWorkspace>
    <template #footer
      ><ElButton :disabled="busy" @click="visible = false">取消</ElButton
      ><ElButton type="primary" :loading="busy" @click="save">确认关联</ElButton></template
    >
  </AppDialog>
</template>
<style scoped>
.route-documents-empty {
  margin: 0;
  padding: 12px 0;
  color: var(--muted);
  font-size: 12px;
}
.el-table .el-select {
  width: 100%;
}
</style>
