<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import AppAlert from './AppAlert.vue'
import AppButton from './AppButton.vue'
import AppDetailTable from './AppDetailTable.vue'
import PersonName from './PersonName.vue'
import { processRouteApi } from '@/services/processRouteApi'
import { reworkProgressLabels, type ReworkRound } from '@/types/processRoute'
import { formatDateTime } from '@/utils/format'

const props = defineProps<{ routeId: number; version: number }>()
const rows = ref<ReworkRound[]>([]),
  loading = ref(false),
  error = ref('')
const selectedId = ref<number>()
const selected = computed(() => rows.value.find((row) => row.route_id === selectedId.value))
let generation = 0
async function load() {
  const token = ++generation
  loading.value = true
  error.value = ''
  rows.value = []
  selectedId.value = undefined
  try {
    const data = await processRouteApi.reworkRounds(props.routeId)
    if (token === generation) rows.value = data
  } catch (e) {
    if (token === generation) error.value = e instanceof Error ? e.message : '返工记录读取失败'
  } finally {
    if (token === generation) loading.value = false
  }
}
watch(() => [props.routeId, props.version], load, { immediate: true })
onBeforeUnmount(() => ++generation)
</script>

<template>
  <section class="rework-rounds" aria-label="返工记录">
    <div class="rounds-heading">
      <h3>返工记录</h3>
      <AppButton :disabled="loading" @click="load">刷新</AppButton>
    </div>
    <AppAlert v-if="error" :title="error" type="error" :closable="false" />
    <p v-if="loading">读取中</p>
    <AppDetailTable v-else-if="rows.length" aria-label="各轮返工记录">
      <thead>
        <tr>
          <th>轮次</th>
          <th>批次号</th>
          <th>问题</th>
          <th>执行班组</th>
          <th>工艺</th>
          <th>加工件数</th>
          <th>处理进度</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.route_id">
          <td>
            第 {{ row.request.round }} 轮<span v-if="row.route_id === routeId" class="round-current"
              >本轮</span
            >
          </td>
          <td>{{ row.request.batch_no }}</td>
          <td class="round-problem">{{ row.request.reason }}</td>
          <td>{{ row.request.execution_team_names?.join('、') || '待指定' }}</td>
          <td>{{ row.state === 'published' ? '已制定' : '待制定' }}</td>
          <td>{{ row.progress.completed_quantity }} / {{ row.progress.quantity }}</td>
          <td>{{ reworkProgressLabels[row.progress.state] }}</td>
          <td>
            <AppButton
              @click="selectedId = selectedId === row.route_id ? undefined : row.route_id"
              >{{ selectedId === row.route_id ? '收起' : '明细' }}</AppButton
            >
          </td>
        </tr>
      </tbody>
    </AppDetailTable>
    <div v-if="selected" class="round-details">
      <div class="rounds-heading">
        <h4>第 {{ selected.request.round }} 轮 · {{ selected.request.batch_no }}</h4>
        <PersonName :name="selected.engineering_employee_name || '待制定'" />
      </div>
      <AppDetailTable v-if="selected.steps.length" aria-label="本轮工艺要求">
        <thead>
          <tr>
            <th>序号</th>
            <th>执行班组</th>
            <th>工艺要求</th>
            <th>计划加工数量</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(step, index) in selected.steps" :key="index">
            <td>{{ step.sequence_no }}</td>
            <td>{{ step.team_name || step.name }}</td>
            <td>{{ step.instructions }}</td>
            <td>{{ step.planned_quantity || selected.request.quantity }}</td>
          </tr>
        </tbody>
      </AppDetailTable>
      <p v-else>工艺待制定</p>
      <AppDetailTable v-if="selected.progress.inspections.length" aria-label="本轮复检记录">
        <thead>
          <tr>
            <th>复检批次</th>
            <th>检查范围</th>
            <th>检查件数</th>
            <th>不合格件数</th>
            <th>检验人</th>
            <th>检查时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="check in selected.progress.inspections" :key="check.id">
            <td>{{ check.batch_no }}</td>
            <td>{{ check.scope === 'full' ? '全检' : '抽检' }}</td>
            <td>{{ check.sample_quantity }}</td>
            <td>{{ check.failed_quantity }}</td>
            <td><PersonName :name="check.inspector_name" /></td>
            <td>{{ formatDateTime(check.checked_at) }}</td>
          </tr>
        </tbody>
      </AppDetailTable>
      <p v-else class="round-current">暂无复检记录</p>
    </div>
  </section>
</template>

<style scoped>
.rework-rounds {
  margin: 12px 0 20px;
  overflow-x: auto;
}
.rework-rounds :deep(.app-detail-table:not(.app-detail-table--themed)) {
  width: 100%;
  border-collapse: collapse;
  background: var(--surface);
  color: var(--text);
  font-size: var(--font-size-body);
  line-height: var(--line-height-body);
}
.rework-rounds :deep(.app-detail-table:not(.app-detail-table--themed) th),
.rework-rounds :deep(.app-detail-table:not(.app-detail-table--themed) td) {
  border: 1px solid var(--line);
  padding: 8px 10px;
  text-align: left;
}
.rework-rounds :deep(.app-detail-table:not(.app-detail-table--themed) th) {
  background: var(--table-header-bg);
  font-weight: var(--font-weight-medium);
}
.rounds-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}
.rounds-heading h3,
.rounds-heading h4 {
  margin: 0;
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-medium);
}
.round-current {
  display: block;
  color: var(--muted);
  font-size: var(--font-size-meta);
}
.round-problem {
  min-width: 160px;
  overflow-wrap: anywhere;
}
.round-details {
  margin-top: 12px;
}
.round-details :deep(table) {
  margin-bottom: 12px;
}
</style>
