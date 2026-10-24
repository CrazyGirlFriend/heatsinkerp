<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import {
  ElAlert,
  ElButton,
  ElCheckbox,
  ElForm,
  ElFormItem,
  ElInput,
  ElInputNumber,
  ElOption,
  ElSelect,
} from 'element-plus'
import AppDialog from './AppDialog.vue'
import { useDialogValidation } from '@/composables/useDialogValidation'
import ProcessRouteSteps from './ProcessRouteSteps.vue'
import WordDocumentPreview from './WordDocumentPreview.vue'
import ScheduleTaskEditor from './ScheduleTaskEditor.vue'
import { processRouteApi } from '@/services/processRouteApi'
import { useTeamDirectoryStore } from '@/stores/teamDirectory'
import type { ProcessRoute } from '@/types/processRoute'
import type { TeamProcessingTask, TeamPurpose } from '@/types/teamBusiness'
const props = defineProps<{ route: ProcessRoute; intake?: boolean }>()
const emit = defineEmits<{ close: []; saved: []; reviewed: [route: ProcessRoute] }>()
const visible = ref(true)
const draft = ref<ProcessRoute>(JSON.parse(JSON.stringify(props.route))),
  serialText = ref(props.route.serial_nos.join('、'))
const scheduleOpen = ref(false)
const busy = ref(false),
  error = ref(''),
  sourceOpen = ref(props.route.state === 'draft'),
  scheduleSerial = ref('')
const tasks = reactive<Record<number, TeamProcessingTask[]>>({}),
  purposes = reactive<Record<number, TeamPurpose[]>>({})
const directory = useTeamDirectoryStore()
const readonly = computed(() => draft.value.state === 'published')
const duplicate = computed(() =>
  draft.value.steps
    .map((step) => step.sequence_no)
    .filter((value, i, list) => list.indexOf(value) !== i),
)
function warehouse(id: number | null) {
  return directory.items.some((team) => Number(team.id) === id && team.code === 'FACTORY-WAREHOUSE')
}
const activeSource = ref('')
const warehouseMapping = computed(() =>
  draft.value.steps.some((step) => step.name.trim() === '中转库' && warehouse(step.team_id)),
)
const activeSourceLabel = computed(() => {
  const [table, line] = activeSource.value.split(':')
  return table && line ? `原表 ${table} · 第 ${line} 行` : activeSource.value
})
function focusOriginal(row?: string | null) {
  activeSource.value = row || ''
}
async function options(id: number | null) {
  if (!id || tasks[id]) return
  try {
    const choices = await processRouteApi.options(id)
    tasks[id] = choices.tasks
    purposes[id] = choices.purposes
  } catch (e) {
    error.value = e instanceof Error ? e.message : '班组业务与任务读取失败'
  }
}
function teamChanged(index: number) {
  const step = draft.value.steps[index]!
  step.processing_task_id = null
  step.purpose_id = null
  void options(step.team_id)
}
const { formRef, fieldErrors, validate } = useDialogValidation(() => {
  const errors: Record<string, string> = {}
  if (!draft.value.title.trim()) errors.title = '请填写派工名称'
  if (!serialText.value.trim()) errors.serials = '请填写流水号'
  if (!draft.value.review_note?.trim()) errors.review = '请填写核对结论'
  draft.value.steps.forEach((step, index) => {
    if (step.sequence_no < 0 || duplicate.value.includes(step.sequence_no))
      errors[`${index}.sequence`] = '请核对工序序号'
    if (!step.name.trim()) errors[`${index}.name`] = '请填写工序名称'
    if (!step.instructions.trim()) errors[`${index}.instructions`] = '请填写工艺要求'
    if (!step.team_id) errors[`${index}.team`] = '请选择执行班组'
    if (!warehouse(step.team_id)) {
      if (!step.processing_task_id) errors[`${index}.task`] = '请选择具体任务'
      if (!step.purpose_id) errors[`${index}.purpose`] = '请选择对应业务'
    }
  })
  return errors
})
async function save(publish = false) {
  if (publish && !validate()) return
  draft.value.serial_nos = serialText.value
    .split(/[、,，\n]/)
    .map((value) => value.trim())
    .filter(Boolean)
  if (props.intake) {
    emit('reviewed', JSON.parse(JSON.stringify(draft.value)))
    return
  }
  busy.value = true
  error.value = ''
  try {
    draft.value = await processRouteApi.save(draft.value)
    if (publish) draft.value = await processRouteApi.publish(draft.value)
    emit('saved')
  } catch (e) {
    error.value = e instanceof Error ? e.message : '工艺保存失败'
  } finally {
    busy.value = false
  }
}
async function revise() {
  busy.value = true
  error.value = ''
  try {
    draft.value = await processRouteApi.revise(draft.value.id)
    sourceOpen.value = true
    emit('saved')
  } catch (e) {
    error.value = e instanceof Error ? e.message : '创建修订稿失败'
  } finally {
    busy.value = false
  }
}
onMounted(async () => {
  await directory.refreshTeamDirectory()
  const stockTeam = directory.items.find((team) => team.active && team.code === 'FACTORY-WAREHOUSE')
  if (stockTeam && !readonly.value) {
    draft.value.steps.forEach((step) => {
      if (!step.team_id && step.name.trim() === '中转库') step.team_id = Number(stockTeam.id)
    })
  }
  for (const id of new Set(draft.value.steps.map((step) => step.team_id))) await options(id)
})
</script>
<template>
  <AppDialog
    v-model="visible"
    :title="intake ? '核对本次入库工艺' : readonly ? '已发布工艺' : '核对派工工艺草稿'"
    width="min(1360px, 96vw)"
    append-to-body
    :close-on-click-modal="false"
    :show-close="!busy"
    :close-on-press-escape="!busy"
    @closed="emit('close')"
  >
    <ElAlert v-if="error" :title="error" type="error" :closable="false" />
    <ElForm
      ref="formRef"
      label-position="top"
      :show-message="false"
      :disabled="busy"
      @submit.prevent
    >
      <div class="route-summary">
        <ElFormItem label="派工名称" required :error="fieldErrors.title"
          ><ElInput v-model="draft.title" :disabled="readonly || busy"
        /></ElFormItem>
        <ElFormItem label="本次派工流水号" required :error="fieldErrors.serials"
          ><ElInput
            v-model="serialText"
            :disabled="readonly || busy || intake"
            placeholder="多个流水号用顿号分隔"
        /></ElFormItem>
        <ElButton
          :disabled="busy"
          @click="processRouteApi.download(draft).catch(() => (error = '原件下载失败，请重试'))"
          >下载 Word 原件</ElButton
        >
        <ElButton @click="sourceOpen = !sourceOpen">{{
          sourceOpen ? '收起对照' : '展开原文对照'
        }}</ElButton>
      </div>
      <p v-if="warehouseMapping" class="route-warehouse-mapping">原文“中转库” → 执行班组“库房”</p>
      <div v-if="!readonly && draft.source_data.issues.length" class="route-import-notes">
        <strong>原文待核对</strong
        ><span v-for="issue in draft.source_data.issues" :key="issue">{{ issue }}</span
        ><small>提醒保留供核对；发布以修订后的工序和核对结论为准。</small>
      </div>
      <div class="route-comparison" :class="{ 'route-comparison--open': sourceOpen }">
        <div class="route-editor-main">
          <ProcessRouteSteps v-if="readonly" :route="draft" />
          <div v-else class="route-edit-steps">
            <article
              v-for="(step, index) in draft.steps"
              :key="index"
              class="route-edit-step"
              @focusin="focusOriginal(step.source_row)"
              :class="{ 'route-edit-step--duplicate': duplicate.includes(step.sequence_no) }"
            >
              <div class="route-step-fields">
                <ElFormItem
                  label="序号"
                  class="route-step-number"
                  :error="fieldErrors[`${index}.sequence`]"
                  ><ElInputNumber
                    v-model="step.sequence_no"
                    :min="0"
                    :max="999"
                    controls-position="right"
                    :disabled="busy"
                /></ElFormItem>
                <ElFormItem label="工序名称" required :error="fieldErrors[`${index}.name`]"
                  ><ElInput v-model="step.name" :disabled="busy"
                /></ElFormItem>
                <ElFormItem label="执行班组" required :error="fieldErrors[`${index}.team`]"
                  ><ElSelect
                    v-model="step.team_id"
                    placeholder="明确选择班组"
                    :disabled="busy"
                    @change="teamChanged(index)"
                    ><ElOption
                      v-for="team in directory.items.filter((team) => team.active)"
                      :key="team.id"
                      :value="Number(team.id)"
                      :label="team.name" /></ElSelect
                ></ElFormItem>
                <ElFormItem
                  label="具体任务"
                  :required="!warehouse(step.team_id)"
                  :error="fieldErrors[`${index}.task`]"
                  ><ElSelect
                    v-model="step.processing_task_id"
                    :disabled="busy || !step.team_id || warehouse(step.team_id)"
                    placeholder="选择本班组任务"
                    ><ElOption
                      v-for="task in (tasks[step.team_id || 0] || []).filter((task) => task.active)"
                      :key="task.id"
                      :value="Number(task.id)"
                      :label="task.name" /></ElSelect
                ></ElFormItem>
                <ElFormItem
                  label="对应业务"
                  :required="!warehouse(step.team_id)"
                  :error="fieldErrors[`${index}.purpose`]"
                  ><ElSelect
                    v-model="step.purpose_id"
                    :disabled="busy || !step.team_id"
                    placeholder="选择业务"
                    ><ElOption
                      v-for="purpose in (purposes[step.team_id || 0] || []).filter(
                        (purpose) => purpose.active,
                      )"
                      :key="purpose.id"
                      :value="Number(purpose.id)"
                      :label="purpose.name" /></ElSelect
                ></ElFormItem>
                <ElButton
                  type="danger"
                  link
                  :disabled="busy || draft.steps.length < 2"
                  @click="draft.steps.splice(index, 1)"
                  >删除行</ElButton
                >
              </div>
              <ElFormItem label="工艺要求" required :error="fieldErrors[`${index}.instructions`]"
                ><ElInput
                  v-model="step.instructions"
                  type="textarea"
                  :autosize="{ minRows: 2, maxRows: 5 }"
                  :disabled="busy"
                  maxlength="10000"
              /></ElFormItem>
              <div class="route-step-details">
                <ElFormItem label="参考天数"
                  ><ElInput v-model="step.planned_days" :disabled="busy"
                /></ElFormItem>
                <ElFormItem label="原文计划数量"
                  ><ElInput v-model="step.planned_quantity" :disabled="busy"
                /></ElFormItem>
                <ElFormItem label="适用流水号"
                  ><ElSelect
                    v-model="step.serial_nos"
                    multiple
                    collapse-tags
                    :disabled="busy"
                    placeholder="公共工序（未分支）"
                    ><ElOption
                      v-for="serial in serialText
                        .split(/[、,，\n]/)
                        .map((v) => v.trim())
                        .filter(Boolean)"
                      :key="serial"
                      :value="serial"
                      :label="serial" /></ElSelect
                ></ElFormItem>
                <ElCheckbox
                  v-if="serialText.split(/[、,，\n]/).filter((v) => v.trim()).length > 1"
                  v-model="step.split_here"
                  :disabled="busy"
                  >在此登记共投实际拆分</ElCheckbox
                >
                <small v-if="step.source_row">原文行 {{ step.source_row }}</small>
              </div>
            </article>
            <ElButton
              :disabled="busy || draft.steps.length >= 100"
              @click="
                draft.steps.push({
                  sequence_no: (draft.steps.at(-1)?.sequence_no || 0) + 1,
                  name: '',
                  instructions: '',
                  planned_days: '',
                  planned_quantity: '',
                  team_id: null,
                  processing_task_id: null,
                  purpose_id: null,
                  serial_nos: [],
                  split_here: false,
                })
              "
              >增加工序</ElButton
            >
            <ElFormItem label="核对结论" required class="route-review" :error="fieldErrors.review"
              ><ElInput
                v-model="draft.review_note"
                type="textarea"
                :rows="2"
                :disabled="busy"
                placeholder="写明原文核对、重复工序处理和班组任务映射结果"
                maxlength="2000"
            /></ElFormItem>
          </div>
        </div>
        <aside v-if="sourceOpen" class="route-original-panel" aria-label="Word原文对照">
          <header><strong>Word 原件</strong><span>只读对照</span></header>
          <p class="route-original-filename">{{ draft.filename }}</p>
          <p v-if="activeSource" class="route-original-line">
            当前工序对应 {{ activeSourceLabel }}
          </p>
          <div class="route-original">
            <WordDocumentPreview :route="draft" />
          </div>
        </aside>
      </div>
    </ElForm>
    <template #footer>
      <span class="route-footer-note">{{
        intake
          ? '工艺与入库信息将在确认入库时一起保存。'
          : readonly
            ? '已发布工艺不能覆盖，修订稿不改变已绑定批次。'
            : '计划天数仅供参考；交货排期需另外明确到小时。'
      }}</span>
      <ElButton :disabled="busy" @click="visible = false">关闭</ElButton>
      <template v-if="readonly && !intake"
        ><ElSelect v-model="scheduleSerial" placeholder="选择流水号" style="width: 180px"
          ><ElOption
            v-for="serial in draft.serial_nos"
            :key="serial"
            :value="serial"
            :label="serial" /></ElSelect
        ><ElButton :disabled="!scheduleSerial" @click="scheduleOpen = true">建立工艺排期</ElButton
        ><ElButton :disabled="busy" @click="revise">另建修订稿</ElButton></template
      >
      <template v-else
        ><ElButton v-if="!intake" :loading="busy" @click="save()">保存草稿</ElButton
        ><ElButton type="primary" :loading="busy" @click="save(true)">{{
          intake ? '确认工艺，返回入库' : '核对并发布'
        }}</ElButton></template
      >
    </template>
    <ScheduleTaskEditor
      v-if="scheduleOpen"
      :process-route="draft"
      :route-serial="scheduleSerial.trim()"
      @close="scheduleOpen = false"
      @saved="scheduleOpen = false"
    />
  </AppDialog>
</template>
<style scoped>
.route-summary {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) minmax(280px, 1.3fr) auto auto;
  align-items: end;
  gap: 16px;
  margin-bottom: 18px;
}
.route-summary .el-form-item {
  margin: 0;
  display: block;
}
.route-import-notes {
  display: flex;
  gap: 8px 18px;
  flex-wrap: wrap;
  padding: 12px 16px;
  border: 1px solid var(--el-color-warning-light-7);
  border-radius: 12px;
  margin-bottom: 18px;
  color: var(--el-color-warning-dark-2);
  background: var(--el-color-warning-light-9);
}
.route-import-notes small {
  width: 100%;
}
.route-warehouse-mapping {
  margin: 0 0 14px;
  color: var(--el-color-primary);
  font-size: 13px;
}
.route-comparison {
  display: grid;
  gap: 18px;
  align-items: start;
}
.route-comparison--open {
  grid-template-columns: minmax(0, 1fr) minmax(320px, 0.65fr);
}
.route-editor-main {
  min-width: 0;
}
.route-original-panel {
  position: sticky;
  top: 0;
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 16px;
  background: var(--surface);
  min-width: 0;
  max-height: min(620px, 55dvh);
  display: flex;
  flex-direction: column;
}
.route-original-panel > header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.route-original-panel > header span {
  color: var(--muted);
  font-size: 12px;
}
.route-original-filename {
  color: var(--muted);
  font-size: 12px;
  margin: 6px 0 16px;
  overflow-wrap: anywhere;
}
.route-original {
  overflow: auto;
  min-height: 0;
  flex: 1;
}
.route-original-line {
  margin: 0 0 12px;
  color: var(--el-color-primary);
  font-size: 12px;
}
.route-comparison--open .route-step-fields {
  grid-template-columns: 90px repeat(5, minmax(0, 1fr));
}
.route-comparison--open .route-step-fields .el-form-item:nth-child(2),
.route-comparison--open .route-step-fields .el-form-item:nth-child(5) {
  grid-column: span 2;
}
.route-comparison--open .route-step-fields .el-form-item:nth-child(3),
.route-comparison--open .route-step-fields .el-form-item:nth-child(4) {
  grid-column: span 3;
}
.route-comparison--open .route-step-details {
  grid-template-columns: 90px 130px minmax(0, 1fr);
}
.route-comparison--open .route-step-details > .el-checkbox {
  grid-column: span 2;
}
@media (max-width: 1050px) {
  .route-comparison--open {
    grid-template-columns: minmax(0, 1fr);
  }
  .route-original-panel {
    grid-row: 1;
    position: static;
    max-height: 300px;
  }
}
.route-edit-steps {
  display: grid;
  gap: 14px;
}
.route-edit-step {
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: 16px;
  padding: 16px 18px;
}
.route-edit-step--duplicate {
  border-color: var(--el-color-danger);
}
.route-step-fields {
  display: grid;
  grid-template-columns: 90px minmax(110px, 0.8fr) repeat(3, minmax(140px, 1fr)) auto;
  align-items: end;
  gap: 14px;
}
.route-step-fields .el-form-item,
.route-step-details .el-form-item {
  display: block;
  min-width: 0;
  margin: 0 0 14px;
}
.route-step-number .el-input-number {
  width: 90px;
}
.route-step-fields > .el-button {
  margin-bottom: 19px;
}
.route-step-details {
  display: grid;
  grid-template-columns: 100px 150px minmax(200px, 1fr) auto auto;
  align-items: center;
  gap: 16px;
}
.route-step-details .el-form-item {
  margin-bottom: 0;
}
.route-step-details small,
.route-footer-note {
  color: var(--muted);
  font-size: 12px;
}
.route-review {
  margin: 4px 0 0;
}
.route-footer-note {
  margin-right: auto;
  text-align: left;
}
@media (max-width: 1150px) {
  .route-step-fields {
    grid-template-columns: 90px repeat(5, minmax(0, 1fr));
  }
  .route-step-fields .el-form-item:nth-child(2),
  .route-step-fields .el-form-item:nth-child(5) {
    grid-column: span 2;
  }
  .route-step-fields .el-form-item:nth-child(3),
  .route-step-fields .el-form-item:nth-child(4) {
    grid-column: span 3;
  }
  .route-step-fields > .el-button {
    justify-self: end;
  }
  .route-step-details {
    grid-template-columns: 100px 150px minmax(200px, 1fr);
  }
  .route-step-details > .el-checkbox {
    grid-column: span 2;
  }
  .route-summary {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
