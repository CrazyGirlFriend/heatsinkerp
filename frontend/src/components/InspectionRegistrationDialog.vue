<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import {
  ElAlert,
  ElButton,
  ElCheckboxGroup,
  ElCheckboxButton,
  ElRadioGroup,
  ElRadioButton,
  ElDatePicker,
  ElForm,
  ElFormItem,
  ElInput,
  ElInputNumber,
  ElOption,
  ElPagination,
  ElSelect,
  ElTable,
  ElTableColumn,
} from 'element-plus'
import AppDialog from './AppDialog.vue'
import TeamEmployeeInput from './TeamEmployeeInput.vue'
import { useTeamDirectoryStore } from '@/stores/teamDirectory'
import { useAuthStore } from '@/stores/auth'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import { teamCanProcess } from '@/config/teamWorkspaces'
import { focusFirstInvalidField } from '@/composables/useDialogValidation'
import { materialRequestKey } from '@/utils/materialStock'
import {
  inspectionApi,
  type InspectionSource,
  type InspectionRecord,
  inspectionMethodLabels,
  inspectionItemLabels,
} from '@/services/inspectionApi'
import type { TeamDirectoryItem, TeamEmployee } from '@/types/teamBusiness'
const props = defineProps<{
  inspectionTeamId: number
  initialTeamId?: number
  recheck?: InspectionRecord | null
  kind?: InspectionRecord['kind']
  groupId?: number
}>()
const emit = defineEmits<{ close: []; saved: [] }>()
const visible = ref(true)
const directory = useTeamDirectoryStore(),
  auth = useAuthStore()
const teams = computed(() => directory.items.filter((team) => team.active && teamCanProcess(team)))
const kind = computed(() => props.recheck?.kind || props.kind || 'patrol')
const title = computed(() => (kind.value === 'inspection' ? '检验' : '巡检'))
const teamId = ref(
  props.recheck?.team_id ??
    (kind.value === 'inspection' ? props.inspectionTeamId : props.initialTeamId),
)
const scope = ref<InspectionRecord['scope']>('sample')
const methods = ref<InspectionRecord['methods']>([])
const items = ref<InspectionRecord['items']>([])
const involved = ref<number[]>([])
const problems = ref<TeamDirectoryItem[]>([])
const problemIds = ref<number[]>([])
const problemsLoading = ref(false)
const problemsError = ref('')
const validProblems = computed(
  () =>
    problemIds.value.length > 0 &&
    problemIds.value.every((id) => problems.value.some((problem) => problem.id === id)),
)
const dimension = ref(''),
  weight = ref('')
const involvedTeams = computed(() => directory.items.filter((t) => t.active))
const source = ref<InspectionSource | null>(null),
  rows = ref<InspectionSource[]>([])
const search = ref(''),
  applied = ref(''),
  page = ref(1),
  total = ref(0),
  loading = ref(false),
  error = ref('')
const person = ref<TeamEmployee | null>(null),
  checkedAt = ref<Date | null>(new Date())
const sample = ref<number>(),
  failed = ref<number>(0),
  notes = ref(''),
  submitted = ref(false),
  saving = ref(false)
const form = ref<InstanceType<typeof ElForm>>()
const writable = computed(
  () =>
    auth.isTeamAccount &&
    Number(auth.currentUser?.team_id) === props.inspectionTeamId &&
    !auth.currentUserError &&
    auth.currentUser?.active !== false,
)
let generation = 0,
  problemGeneration = 0,
  requestKey = '',
  fingerprint = ''
async function loadProblems() {
  const token = ++problemGeneration
  problemsLoading.value = true
  problemsError.value = ''
  problems.value = []
  try {
    const result = await teamMaterialApi.inspectionProblems(props.inspectionTeamId)
    if (token === problemGeneration) problems.value = result.filter((item) => item.active)
  } catch (e) {
    if (token === problemGeneration)
      problemsError.value = e instanceof Error ? e.message : '检验问题选项读取失败'
  } finally {
    if (token === problemGeneration) problemsLoading.value = false
  }
}
async function load() {
  const token = ++generation
  rows.value = []
  source.value = null
  error.value = ''
  loading.value = false
  total.value = 0
  if (!teamId.value) return
  loading.value = true
  try {
    const result = await inspectionApi.sources({
      team_id: teamId.value,
      kind: kind.value,
      recheck_id: props.recheck?.id,
      group_id: props.groupId,
      query: applied.value || undefined,
      page: page.value,
      page_size: 8,
    })
    if (token !== generation) return
    if ((props.recheck || props.groupId != null) && result.total === 1 && result.items[0])
      selectSource(result.items[0])
    rows.value = result.items
    total.value = result.total
  } catch (e) {
    if (token === generation) error.value = e instanceof Error ? e.message : '巡检批次读取失败'
  } finally {
    if (token === generation) loading.value = false
  }
}
function searchSources() {
  applied.value = search.value.trim()
  page.value = 1
  void load()
}
function changePage(value: number) {
  page.value = value
  void load()
}
function selectSource(row: InspectionSource) {
  source.value = row
  sample.value = scope.value === 'full' ? row.quantity : undefined
  submitted.value = false
}
async function submit() {
  if (saving.value || !writable.value) return
  submitted.value = true
  if (
    !source.value ||
    !person.value ||
    !checkedAt.value ||
    !methods.value.length ||
    !items.value.length ||
    (failed.value > 0 && (problemsLoading.value || problemsError.value || !validProblems.value)) ||
    (failed.value > 0 && !props.recheck && !involved.value.length) ||
    !sample.value ||
    sample.value > source.value.quantity ||
    failed.value == null ||
    failed.value < 0 ||
    failed.value > sample.value
  ) {
    await nextTick()
    focusFirstInvalidField(form.value?.$el)
    return
  }
  const body = {
    kind: kind.value,
    scope: scope.value,
    methods: methods.value,
    items: items.value,
    involved_team_ids: failed.value > 0 && !props.recheck ? involved.value : [],
    problem_type_ids: failed.value > 0 ? problemIds.value : [],
    dimension_result: items.value.includes('dimension') ? dimension.value.trim() : '',
    weight_result: items.value.includes('weight') ? weight.value.trim() : '',
    source_transfer_id: source.value.source_transfer_id,
    expected_revision: source.value.revision,
    inspector_employee_id: person.value.id,
    checked_at: checkedAt.value.toISOString(),
    sample_quantity: sample.value,
    failed_quantity: failed.value,
    notes: notes.value.trim(),
    ...(props.recheck ? { parent_id: props.recheck.id } : {}),
  }
  const next = JSON.stringify(body)
  if (!requestKey || fingerprint !== next) {
    requestKey = materialRequestKey()
    fingerprint = next
  }
  saving.value = true
  error.value = ''
  try {
    await inspectionApi.create({ ...body, idempotency_key: requestKey })
    emit('saved')
  } catch (e) {
    error.value = e instanceof Error ? e.message : '巡检登记失败'
  } finally {
    saving.value = false
  }
}
watch(scope, (value) => {
  if (value === 'full' && source.value) sample.value = source.value.quantity
})
watch(failed, (value) => {
  if (value === 0) problemIds.value = []
})
watch(
  () => props.inspectionTeamId,
  () => {
    problemIds.value = []
    void loadProblems()
  },
  { immediate: true },
)
watch(
  teamId,
  () => {
    page.value = 1
    applied.value = search.value = ''
    void load()
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  ++generation
  ++problemGeneration
})
</script>
<template>
  <AppDialog
    v-model="visible"
    :title="recheck ? `${title}复检登记` : `${title}登记`"
    width="min(1060px, calc(100vw - 40px))"
    align-center
    append-to-body
    :close-on-click-modal="false"
    :close-on-press-escape="!saving"
    :show-close="!saving"
    class="inspection-registration"
    @closed="emit('close')"
  >
    <ElAlert v-if="error" type="error" :closable="false" :title="error" />
    <ElForm ref="form" label-position="top" :disabled="saving" @submit.prevent="submit">
      <div v-if="!source" class="inspection-source-picker">
        <div class="inspection-pick-toolbar">
          <ElFormItem label="被检班组" required :class="{ 'is-error': submitted && !teamId }"
            ><ElSelect
              v-model="teamId"
              :disabled="kind === 'inspection'"
              aria-label="被检班组"
              placeholder="选择班组"
              ><ElOption
                v-for="team in teams"
                :key="team.id"
                :value="Number(team.id)"
                :label="team.name" /></ElSelect
          ></ElFormItem>
          <ElFormItem :label="kind === 'inspection' ? '查找在库批次' : '查找已加工批次'"
            ><ElInput
              v-model="search"
              placeholder="流水号、批次号、材质"
              @keyup.enter="searchSources"
          /></ElFormItem>
          <ElButton :loading="loading" class="action-warm" @click="searchSources">查询</ElButton>
        </div>
        <ElTable
          :data="rows"
          class="business-table"
          height="240"
          :empty-text="
            kind === 'inspection' ? '暂无可检验的在库批次' : '请选择班组，查询已加工的在库批次'
          "
        >
          <ElTableColumn
            prop="serial_no"
            label="流水号"
            min-width="135"
            align="center"
            show-overflow-tooltip
          />
          <ElTableColumn prop="material_name" label="材质" min-width="100" align="center" />
          <ElTableColumn prop="quantity" label="在库件数" width="95" align="center" />
          <ElTableColumn prop="batch_no" label="批次号" min-width="205" align="center" />
          <ElTableColumn label="操作" width="130" align="center"
            ><template #default="{ row }"
              ><ElButton link type="primary" @click="selectSource(row as InspectionSource)"
                >选择</ElButton
              ></template
            ></ElTableColumn
          >
        </ElTable>
        <ElPagination
          :current-page="page"
          :total="total"
          :page-size="8"
          layout="prev, pager, next"
          @current-change="changePage"
        />
      </div>
      <div v-else class="inspection-selected">
        <div>
          <strong>{{ source.serial_no }}</strong
          ><span>{{ source.material_name }}</span
          ><span>{{ source.batch_no }}</span>
        </div>
        <div>
          <span>当前库存 {{ source.quantity }} 件</span
          ><ElButton
            v-if="rows.length > 1 || (groupId == null && !recheck)"
            link
            @click="source = null"
            >更换批次</ElButton
          >
        </div>
      </div>
      <div class="inspection-check-options">
        <ElFormItem label="检验范围" required>
          <ElRadioGroup v-model="scope"
            ><ElRadioButton value="sample">抽检</ElRadioButton
            ><ElRadioButton value="full">全检</ElRadioButton></ElRadioGroup
          >
        </ElFormItem>
        <ElFormItem label="检查手段" required :class="{ 'is-error': submitted && !methods.length }">
          <ElCheckboxGroup v-model="methods"
            ><ElCheckboxButton
              v-for="(name, key) in inspectionMethodLabels"
              :key="key"
              :value="key"
              >{{ name }}</ElCheckboxButton
            ></ElCheckboxGroup
          >
        </ElFormItem>
        <ElFormItem label="检查项目" required :class="{ 'is-error': submitted && !items.length }">
          <ElCheckboxGroup v-model="items"
            ><ElCheckboxButton
              v-for="(name, key) in inspectionItemLabels"
              :key="key"
              :value="key"
              >{{ name }}</ElCheckboxButton
            ></ElCheckboxGroup
          >
        </ElFormItem>
      </div>
      <div class="inspection-fields">
        <ElFormItem :label="`${title}人`" required :class="{ 'is-error': submitted && !person }"
          ><TeamEmployeeInput
            v-model="person"
            :team-id="inspectionTeamId"
            :label="`${title}人`"
            :invalid="submitted && !person"
        /></ElFormItem>
        <ElFormItem
          :label="`${title}时间`"
          required
          :class="{ 'is-error': submitted && !checkedAt }"
          ><ElDatePicker
            v-model="checkedAt"
            type="datetime"
            aria-:label="`${title}时间`"
            format="YYYY-MM-DD HH:mm"
        /></ElFormItem>
        <ElFormItem
          :label="scope === 'full' ? '全检件数' : '抽检件数'"
          required
          :class="{ 'is-error': submitted && (!sample || (source && sample > source.quantity)) }"
          ><ElInputNumber
            v-model="sample"
            :disabled="scope === 'full'"
            :min="1"
            :max="source?.quantity"
            :precision="0"
            controls-position="right"
            aria-:label="scope === 'full' ? '全检件数' : '抽检件数'"
        /></ElFormItem>
        <ElFormItem
          label="不合格件数"
          required
          :class="{
            'is-error':
              submitted && (failed == null || failed < 0 || (sample != null && failed > sample)),
          }"
          ><ElInputNumber
            v-model="failed"
            :min="0"
            :max="sample"
            :precision="0"
            controls-position="right"
            aria-label="不合格件数"
        /></ElFormItem>
      </div>
      <div class="inspection-result" :class="{ 'inspection-result--failed': failed > 0 }">
        <strong
          >{{ scope === 'sample' ? '样本合格' : '检验合格' }}
          {{ Math.max(0, (sample || 0) - (failed || 0)) }} 件</strong
        >
        <span>{{
          scope === 'sample'
            ? '结果仅代表样本；处理方式由检验班组长决定'
            : '保存检查结果，不执行发货、返工或库存变更'
        }}</span>
      </div>
      <div
        v-if="items.includes('dimension') || items.includes('weight')"
        class="inspection-measurements"
      >
        <ElFormItem v-if="items.includes('dimension')" label="尺寸要求与实测结果（选填）"
          ><ElInput
            v-model="dimension"
            type="textarea"
            :rows="2"
            maxlength="2000"
            placeholder="例如：要求 30 ± 0.1 mm；实测 30.2 mm"
        /></ElFormItem>
        <ElFormItem v-if="items.includes('weight')" label="重量要求与实测结果（选填）"
          ><ElInput
            v-model="weight"
            type="textarea"
            :rows="2"
            maxlength="2000"
            placeholder="填写要求、实测重量及单位"
        /></ElFormItem>
      </div>
      <ElFormItem
        v-if="failed > 0"
        label="检出问题（可多选）"
        required
        :class="{ 'is-error': submitted && !validProblems }"
      >
        <ElSelect
          v-model="problemIds"
          multiple
          filterable
          collapse-tags
          collapse-tags-tooltip
          :max-collapse-tags="3"
          :loading="problemsLoading"
          :disabled="problemsLoading || !!problemsError || !problems.length"
          aria-label="检出问题"
          placeholder="选择检验问题"
        >
          <ElOption
            v-for="problem in problems"
            :key="problem.id"
            :value="problem.id"
            :label="problem.name"
          />
        </ElSelect>
        <div v-if="problemsError" class="inspection-problem-note">
          <span>{{ problemsError }}</span>
          <ElButton link type="primary" @click="loadProblems">重新读取</ElButton>
        </div>
        <p v-else-if="!problemsLoading && !problems.length" class="inspection-problem-note">
          暂无启用的检验问题，请检验班组长在“班组设置 → 检验问题”中配置。
        </p>
      </ElFormItem>
      <ElFormItem
        v-if="failed > 0 && !recheck"
        label="问题涉及班组（可多选）"
        required
        :class="{ 'is-error': submitted && !involved.length }"
      >
        <ElCheckboxGroup v-model="involved"
          ><ElCheckboxButton
            v-for="team in involvedTeams"
            :key="team.id"
            :value="Number(team.id)"
            >{{ team.name }}</ElCheckboxButton
          ></ElCheckboxGroup
        >
      </ElFormItem>
      <ElFormItem :label="recheck ? '处理与复检说明（选填）' : '补充说明（选填）'"
        ><ElInput v-model="notes" type="textarea" :rows="2" maxlength="2000" show-word-limit
      /></ElFormItem>
    </ElForm>
    <template #footer
      ><ElButton :disabled="saving" @click="visible = false">取消</ElButton
      ><ElButton
        type="primary"
        :loading="saving"
        :disabled="!source || !writable"
        @click="submit"
        >{{ recheck ? '保存复检结果' : `保存${title}` }}</ElButton
      ></template
    >
  </AppDialog>
</template>
<style scoped>
.inspection-pick-toolbar {
  display: grid;
  grid-template-columns: 200px minmax(180px, 1fr) auto;
  align-items: center;
  gap: 16px;
}
.inspection-selected {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 18px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 16px;
  background: var(--el-fill-color-blank);
  margin-bottom: 20px;
}
.inspection-selected > div {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 14px;
}
.inspection-selected span {
  color: var(--muted);
  font-size: 13px;
}
.inspection-check-options,
.inspection-measurements {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}
.inspection-measurements {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.inspection-check-options .is-error :deep(.el-checkbox-button__inner) {
  border-color: var(--el-color-danger);
}
.inspection-fields {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}
.inspection-fields :deep(.el-input-number),
.inspection-fields :deep(.el-date-editor),
.inspection-fields :deep(.team-employee) {
  width: 100%;
}
.inspection-result {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 0 18px;
}
.inspection-result span {
  font-size: 13px;
  color: var(--muted);
}
.inspection-result--failed strong {
  color: var(--el-color-danger);
}
.inspection-problem-note {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 6px 0 0;
  color: var(--muted);
  font-size: 13px;
}
@media (max-width: 1100px) {
  .inspection-fields {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
<style>
.inspection-registration.el-dialog {
  display: flex;
  flex-direction: column;
  max-height: calc(100dvh - 40px);
}
.inspection-registration > .el-dialog__body {
  min-height: 0;
  overflow: auto;
  padding-bottom: 24px;
}
.inspection-registration > .el-dialog__header,
.inspection-registration > .el-dialog__footer {
  flex-shrink: 0;
}
</style>
