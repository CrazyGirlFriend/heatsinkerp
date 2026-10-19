<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import {
  ElAlert,
  ElButton,
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
import { teamCanProcess } from '@/config/teamWorkspaces'
import { focusFirstInvalidField } from '@/composables/useDialogValidation'
import { materialRequestKey } from '@/utils/materialStock'
import {
  inspectionApi,
  type InspectionSource,
  type InspectionRecord,
} from '@/services/inspectionApi'
import type { TeamEmployee } from '@/types/teamBusiness'
const props = defineProps<{
  inspectionTeamId: number
  initialTeamId?: number
  recheck?: InspectionRecord | null
}>()
const emit = defineEmits<{ close: []; saved: [] }>()
const directory = useTeamDirectoryStore(),
  auth = useAuthStore()
const teams = computed(() => directory.items.filter((team) => team.active && teamCanProcess(team)))
const teamId = ref(props.recheck?.team_id ?? props.initialTeamId)
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
  requestKey = '',
  fingerprint = ''
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
    if (props.recheck) {
      const context = await inspectionApi.recheckContext(props.recheck.id)
      if (token !== generation) return
      source.value = context
      if (!context.quantity) error.value = '本批当前无可抽检库存，请刷新核对'
      return
    }
    const result = await inspectionApi.sources({
      team_id: teamId.value,
      query: applied.value || undefined,
      page: page.value,
      page_size: 8,
    })
    if (token !== generation) return
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
  sample.value = undefined
  submitted.value = false
}
async function submit() {
  if (saving.value || !writable.value) return
  submitted.value = true
  if (
    !source.value ||
    !person.value ||
    !checkedAt.value ||
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
})
</script>
<template>
  <AppDialog
    :model-value="true"
    :title="recheck ? '复检与放行' : '现场巡检登记'"
    width="min(1060px, calc(100vw - 40px))"
    align-center
    append-to-body
    :close-on-click-modal="false"
    :close-on-press-escape="!saving"
    :show-close="!saving"
    class="inspection-registration"
    @close="emit('close')"
  >
    <ElAlert v-if="error" type="error" :closable="false" :title="error" />
    <ElForm ref="form" label-position="top" :disabled="saving" @submit.prevent="submit">
      <div v-if="!source" class="inspection-source-picker">
        <div class="inspection-pick-toolbar">
          <ElFormItem label="被检班组" required :class="{ 'is-error': submitted && !teamId }"
            ><ElSelect
              v-model="teamId"
              :disabled="!!recheck"
              aria-label="被检班组"
              placeholder="选择班组"
              ><ElOption
                v-for="team in teams"
                :key="team.id"
                :value="Number(team.id)"
                :label="team.name" /></ElSelect
          ></ElFormItem>
          <ElFormItem label="查找已加工批次"
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
          empty-text="请选择班组，查询已加工的在库批次"
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
              ><ElButton
                link
                type="primary"
                :disabled="!!row.hold_id"
                :title="row.hold_id ? '请从待处理巡检记录发起复检' : undefined"
                @click="selectSource(row as InspectionSource)"
                >{{ row.hold_id ? '待复检' : '选择' }}</ElButton
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
          ><ElButton v-if="!recheck" link @click="source = null">更换批次</ElButton>
        </div>
      </div>
      <div class="inspection-fields">
        <ElFormItem label="巡检人" required :class="{ 'is-error': submitted && !person }"
          ><TeamEmployeeInput
            v-model="person"
            :team-id="inspectionTeamId"
            label="巡检人"
            :invalid="submitted && !person"
        /></ElFormItem>
        <ElFormItem label="巡检时间" required :class="{ 'is-error': submitted && !checkedAt }"
          ><ElDatePicker
            v-model="checkedAt"
            type="datetime"
            aria-label="巡检时间"
            format="YYYY-MM-DD HH:mm"
        /></ElFormItem>
        <ElFormItem
          label="抽检件数"
          required
          :class="{ 'is-error': submitted && (!sample || (source && sample > source.quantity)) }"
          ><ElInputNumber
            v-model="sample"
            :min="1"
            :max="source?.quantity"
            :precision="0"
            controls-position="right"
            aria-label="抽检件数"
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
        <strong>抽检合格 {{ Math.max(0, (sample || 0) - (failed || 0)) }} 件</strong
        ><span>{{
          failed > 0
            ? '提交后整批暂停转出，需复检合格后放行'
            : recheck
              ? '提交复检合格结果后，解除本次巡检锁定'
              : '仅代表抽样结果，不增加库存或加工产量'
        }}</span>
      </div>
      <ElFormItem :label="recheck ? '处理与复检说明（选填）' : '检查与问题说明（选填）'"
        ><ElInput v-model="notes" type="textarea" :rows="2" maxlength="2000" show-word-limit
      /></ElFormItem>
    </ElForm>
    <template #footer
      ><ElButton :disabled="saving" @click="emit('close')">取消</ElButton
      ><ElButton
        type="primary"
        :loading="saving"
        :disabled="!source || !writable"
        @click="submit"
        >{{ recheck && failed === 0 ? '复检合格并放行' : '保存巡检' }}</ElButton
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
