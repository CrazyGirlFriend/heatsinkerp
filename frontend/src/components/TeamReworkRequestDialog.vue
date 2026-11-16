<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ElFormItem, ElOption } from 'element-plus'
import AppDialog from './AppDialog.vue'
import AppButton from './AppButton.vue'
import AppAlert from './AppAlert.vue'
import AppSelect from './AppSelect.vue'
import ReworkRouteRequest from './ReworkRouteRequest.vue'
import { processRouteApi } from '@/services/processRouteApi'
import type { ReworkSource } from '@/types/processRoute'
import type { QuantityAdjustmentContext } from '@/types/teamMaterials'

const props = defineProps<{ teamId?: number }>()
const emit = defineEmits<{ close: []; saved: [] }>()
const visible = ref(true),
  busy = ref(false),
  loadingSources = ref(false),
  loadingContext = ref(false),
  sourceError = ref(''),
  contextError = ref('')
const query = ref(''),
  page = ref(1),
  total = ref(0)
const rows = ref<ReworkSource[]>([]),
  selected = ref<ReworkSource>(),
  context = ref<QuantityAdjustmentContext>()
const problemTeams = ref<{ id: number; name: string }[]>([])
const problemTeamId = ref<number>()
const options = computed(() =>
  selected.value && !rows.value.some((row) => row.id === selected.value?.id)
    ? [selected.value, ...rows.value]
    : rows.value,
)
let sourceGeneration = 0,
  contextGeneration = 0
async function load(nextPage = 1) {
  if (busy.value) return
  const token = ++sourceGeneration
  loadingSources.value = true
  sourceError.value = ''
  if (nextPage === 1) {
    rows.value = []
    page.value = 1
    total.value = 0
  }
  try {
    const data = await processRouteApi.reworkSources(query.value, nextPage, props.teamId)
    if (token !== sourceGeneration) return
    rows.value = nextPage === 1 ? data.items : [...rows.value, ...data.items]
    total.value = data.total
    page.value = nextPage
  } catch (e) {
    if (token === sourceGeneration)
      sourceError.value = e instanceof Error ? e.message : '批次读取失败'
  } finally {
    if (token === sourceGeneration) loadingSources.value = false
  }
}
function search(value: string) {
  query.value = value.trim()
  void load()
}
async function select(id?: number) {
  if (busy.value) return
  selected.value = options.value.find((row) => row.id === id)
  problemTeams.value = []
  problemTeamId.value = undefined
  await loadContext()
}
async function loadContext(teamId?: number) {
  if (busy.value) return
  const token = ++contextGeneration
  context.value = undefined
  contextError.value = ''
  loadingContext.value = Boolean(selected.value)
  if (!selected.value) return
  try {
    const result = teamId
      ? await processRouteApi.reworkSourceContext(selected.value.id, teamId)
      : await processRouteApi.reworkSourceContext(selected.value.id)
    if (token === contextGeneration) {
      context.value = result
      problemTeams.value = result.rework_problem_teams || []
      problemTeamId.value = result.rework_problem_team_id || undefined
    }
  } catch (e) {
    if (token === contextGeneration)
      contextError.value = e instanceof Error ? e.message : '批次读取失败'
  } finally {
    if (token === contextGeneration) loadingContext.value = false
  }
}
function saved() {
  visible.value = false
  emit('saved')
}
onMounted(() => load())
onBeforeUnmount(() => {
  ++sourceGeneration
  ++contextGeneration
})
</script>

<template>
  <AppDialog
    v-model="visible"
    title="提交问题"
    width="min(880px, calc(100vw - 24px))"
    append-to-body
    align-center
    :close-on-click-modal="!busy"
    :close-on-press-escape="!busy"
    :show-close="!busy"
    @closed="emit('close')"
  >
    <ReworkRouteRequest
      class="team-problem-form"
      :context="context"
      :loading="loadingContext"
      @busy="busy = $event"
      @changed="saved"
    >
      <template #source="{ submitted }">
        <ElFormItem
          class="form-field--full"
          label="问题批次"
          required
          :error="submitted && !selected ? '请选择问题批次' : ''"
        >
          <AppSelect
            :model-value="selected?.id"
            aria-label="问题批次"
            placeholder="搜索流水号或批次号"
            filterable
            remote
            clearable
            :remote-method="search"
            :loading="loadingSources"
            :disabled="busy"
            no-data-text="暂无可提交的在库批次"
            @change="select"
          >
            <ElOption
              v-for="row in options"
              :key="row.id"
              :value="row.id"
              :label="`${row.serial_no || '未关联流水号'} · ${row.batch_no}`"
            />
            <template #footer>
              <div class="source-actions">
                <AppButton
                  v-if="rows.length < total"
                  :disabled="loadingSources || busy"
                  @click.stop="load(page + 1)"
                  >更多批次</AppButton
                >
                <AppButton :disabled="loadingSources || busy" @click.stop="load()">刷新</AppButton>
              </div>
            </template>
          </AppSelect>
          <span v-if="context" class="stock-summary">
            在库 {{ context.quantity }} 件 · {{ context.weight }} kg
          </span>
        </ElFormItem>
        <ElFormItem
          v-if="problemTeams.length"
          class="form-field--full"
          label="疑似涉及班组"
          required
        >
          <AppSelect
            v-model="problemTeamId"
            aria-label="疑似涉及班组"
            :disabled="busy || loadingContext"
            @change="loadContext"
          >
            <ElOption
              v-for="team in problemTeams"
              :key="team.id"
              :value="team.id"
              :label="team.name"
            />
          </AppSelect>
        </ElFormItem>
        <AppAlert
          v-if="sourceError"
          class="form-field--full"
          :title="sourceError"
          type="error"
          :closable="false"
        >
          <AppButton :disabled="loadingSources || busy" @click="load()">重试</AppButton>
        </AppAlert>
        <AppAlert
          v-if="contextError"
          class="form-field--full"
          :title="contextError"
          type="error"
          :closable="false"
        >
          <AppButton :disabled="loadingContext || busy" @click="loadContext(problemTeamId)"
            >重试</AppButton
          >
        </AppAlert>
        <AppAlert
          v-if="context && !context.rework_task_records?.length && !context.rework_of_id"
          class="form-field--full"
          :title="
            problemTeams.length > 1
              ? '该班组暂无本批次的工艺记录，可选择其他涉及班组'
              : '本批次暂无可反馈的工艺记录'
          "
          type="warning"
          :closable="false"
        />
      </template>
    </ReworkRouteRequest>
  </AppDialog>
</template>

<style scoped>
.team-problem-form {
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
}
.app-select {
  width: 100%;
}
.source-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.stock-summary {
  color: var(--muted);
  font-size: 12px;
}
</style>
