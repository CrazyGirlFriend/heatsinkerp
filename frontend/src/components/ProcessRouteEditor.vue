<script setup lang="ts">
import AppDisclosure from './AppDisclosure.vue'
import AppDetailTable from './AppDetailTable.vue'
import ReworkRoundsTable from './ReworkRoundsTable.vue'
import AsyncStatus from './AsyncStatus.vue'
import { AppMessageBox as ElMessageBox } from '@/utils/messageBox'
import ElAlert from '@/components/AppAlert.vue'
import ElInput from '@/components/AppInput.vue'
import AppPopover from '@/components/AppPopover.vue'
import ElSelect from '@/components/AppSelect.vue'
import PersonName from './PersonName.vue'
import { RouterLink } from 'vue-router'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElForm, ElFormItem, ElIcon, ElOption, ElTooltip } from 'element-plus'
import ElInputNumber from '@/components/AppNumberInput.vue'
import ElButton from '@/components/AppButton.vue'
import AppDialog from './AppDialog.vue'
import FormWorkspace from './FormWorkspace.vue'
import CompactFormSection from './CompactFormSection.vue'
import ImportedDataConfirmation from './ImportedDataConfirmation.vue'
import AutofillBadge from './AutofillBadge.vue'
import TeamEmployeeInput from './TeamEmployeeInput.vue'
import { useAuthStore } from '@/stores/auth'
import type { TeamEmployee } from '@/types/teamBusiness'
import { formatDateTime } from '@/utils/format'
import { useDialogValidation } from '@/composables/useDialogValidation'
import ProcessRouteMaterials from './ProcessRouteMaterials.vue'
import { mergeRouteMaterials } from '@/utils/routeMaterials'

import { ArrowDown, Document, Upload, WarningFilled } from '@element-plus/icons-vue'
import ProcessRouteAttachments from './ProcessRouteAttachments.vue'
import { processRouteApi, ProcessRouteSerialConflictError } from '@/services/processRouteApi'
import { useTeamDirectoryStore } from '@/stores/teamDirectory'
import type { ProcessRoute, ProcessRouteStep, ProcessRouteDrawing } from '@/types/processRoute'
const props = defineProps<{ route?: ProcessRoute; viewOnly?: boolean; startEditing?: boolean }>()
const emit = defineEmits<{ opened: []; close: []; saved: [] }>()
const visible = ref(true)
function blankStep(sequence = 0): ProcessRouteStep {
  return {
    sequence_no: sequence,
    name: sequence ? '' : '库房',
    instructions: '',
    planned_days: '',
    planned_quantity: '',
    team_id: null,
    processing_task_id: null,
    purpose_id: null,
    serial_nos: [],
    split_here: false,
  }
}
const draft = ref<ProcessRoute>(
  props.route
    ? JSON.parse(JSON.stringify(props.route))
    : {
        id: 0,
        title: '',
        filename: '',
        state: 'draft',
        version: 1,
        parent_id: null,
        serial_nos: [],
        steps: [blankStep()],
        review_note: '',
        drawings: [],
        source_data: { tables: [], issues: [] },
        created_by: '',
        created_at: '',
        published_at: null,
      },
)
const headerSerial = draft.value.source_data.receipt_fields?.serial_no?.value
if (
  draft.value.state === 'draft' &&
  !draft.value.parent_id &&
  typeof headerSerial === 'string' &&
  draft.value.serial_nos.includes(headerSerial) &&
  !draft.value.steps.some((step) => step.serial_nos.length || step.split_here)
)
  draft.value.serial_nos = [headerSerial]
if (draft.value.route_kind === 'rework' && !draft.value.steps.length) {
  const step = blankStep(1)
  step.team_id = draft.value.rework_request?.team_id || null
  step.planned_quantity = String(draft.value.rework_request?.quantity || '')
  draft.value.steps = [step]
}
const primarySerial = ref(draft.value.serial_nos[0] || '')
const serialConflict = ref('')
// Preserve existing version bindings; new imports contain only the labelled primary serial.
const serials = computed(() =>
  [primarySerial.value.trim(), ...draft.value.serial_nos.slice(1)].filter(Boolean),
)
const sourceRoute = ref<ProcessRoute>()
const sourceLoading = ref(false)
const sourceError = ref('')
let sourceGeneration = 0
async function loadSourceRoute() {
  const current = ++sourceGeneration
  const id =
    draft.value.route_kind === 'rework' ? draft.value.rework_request?.resume_route_id : null
  sourceRoute.value = undefined
  sourceError.value = ''
  sourceLoading.value = false
  if (!id || id === draft.value.id) return
  sourceLoading.value = true
  try {
    const route = await processRouteApi.detail(id)
    if (current === sourceGeneration) sourceRoute.value = route
  } catch (error) {
    if (current === sourceGeneration)
      sourceError.value = error instanceof Error ? error.message : '原工艺读取失败'
  } finally {
    if (current === sourceGeneration) sourceLoading.value = false
  }
}
watch(() => draft.value.rework_request?.resume_route_id, loadSourceRoute, { immediate: true })
onBeforeUnmount(() => ++sourceGeneration)
const wordInput = ref<HTMLInputElement>(),
  drawingInput = ref<HTMLInputElement>()
const pendingWord = ref<File>(),
  pendingDrawings = ref<File[]>([])
const importsConfirmed = ref(!!draft.value.source_data.material_confirmation)
const requiresReview = computed(() => !!draft.value.source_data.review_required)
const editingSaved = ref(!props.route?.id || !!props.startEditing)
const modifying = computed(
  () => !!draft.value.parent_id || (editingSaved.value && draft.value.state === 'published'),
)
const editorMain = ref<HTMLElement>()
const instructionInputs = ref<InstanceType<typeof ElInput>[]>([])
let editorObserver: ResizeObserver | undefined
let resizeFrame = 0
let editorWidth = 0
watch(
  editorMain,
  (element) => {
    editorObserver?.disconnect()
    if (!element || typeof ResizeObserver === 'undefined') return
    editorWidth = 0
    editorObserver = new ResizeObserver(([entry]) => {
      if (!entry || entry.contentRect.width <= 0 || entry.contentRect.width === editorWidth) return
      editorWidth = entry.contentRect.width
      if (resizeFrame) cancelAnimationFrame(resizeFrame)
      resizeFrame = requestAnimationFrame(() => {
        instructionInputs.value.forEach((input) => input.resizeTextarea())
      })
    })
    editorObserver.observe(element)
  },
  { flush: 'post' },
)
onBeforeUnmount(() => {
  editorObserver?.disconnect()
  if (resizeFrame) cancelAnimationFrame(resizeFrame)
})
const issuesOpen = ref(false)
function addStep() {
  draft.value.steps.push(blankStep((draft.value.steps.at(-1)?.sequence_no ?? -1) + 1))
}
function removeStep(index: number) {
  draft.value.steps.splice(index, 1)
}
async function importWord(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || busy.value || readonly.value || draft.value.route_kind === 'rework') return
  if (
    draft.value.filename ||
    primarySerial.value.trim() ||
    draft.value.steps.some((s) => s.instructions.trim())
  ) {
    try {
      await ElMessageBox.confirm(
        '导入会替换当前表单的流水号和工序内容，人员与图纸保留。',
        '导入工艺单',
        { confirmButtonText: '导入', cancelButtonText: '取消', type: 'warning' },
      )
    } catch {
      return
    }
  }
  busy.value = true
  error.value = ''
  try {
    const parsed = await processRouteApi.parse(file)
    const data = mergeRouteMaterials(parsed.source_data, draft.value.source_data.order_document)
    draft.value = { ...draft.value, ...parsed, source_data: data, review_note: '' }
    importsConfirmed.value = false
    primarySerial.value = parsed.serial_nos[0] || ''
    pendingWord.value = file
    activeSource.value = ''
    issuesOpen.value = false
  } catch (e) {
    error.value = e instanceof Error ? e.message : '工艺单导入失败'
  } finally {
    busy.value = false
  }
}
function changeMaterial(key: string, value: string) {
  if (readonly.value || busy.value) return
  if (key === 'material_name' && !draft.value.source_data.receipt_fields?.material_name) {
    draft.value.source_data.receipt_fields ||= {}
    draft.value.source_data.receipt_fields.material_name = {
      value,
      label: '材质',
      source_kind: 'manual',
      source_row: '',
      source_label: '材质',
    }
    return
  }
  const field = draft.value.source_data.receipt_fields?.[key]
  if (!field) return
  field.parsed_value ??= field.value
  field.value = value
}
function addDrawings(event: Event) {
  const input = event.target as HTMLInputElement
  const files = [...(input.files || [])]
  input.value = ''
  if (busy.value || readonly.value || !files.length) return
  error.value = ''
  if ((draft.value.drawings?.length || 0) + pendingDrawings.value.length + files.length > 10) {
    error.value = '每个工艺最多上传 10 份图纸'
    return
  }
  if (
    files.some(
      (file) =>
        !file.name.toLowerCase().endsWith('.pdf') || file.size === 0 || file.size > 5 * 1024 * 1024,
    )
  ) {
    error.value = '请上传非空 PDF 图纸，每份不超过 5 MB'
    return
  }
  pendingDrawings.value.push(...files)
}
const removedDrawings = ref<ProcessRouteDrawing[]>([])
function removeDrawing(id: number) {
  const drawing = draft.value.drawings?.find((item) => item.id === id)
  if (!drawing || readonly.value || busy.value) return
  removedDrawings.value.push(drawing)
  draft.value.drawings = draft.value.drawings?.filter((item) => item.id !== id)
}
function removePending(file: File) {
  pendingDrawings.value = pendingDrawings.value.filter((item) => item !== file)
}
const sourceFilename = computed(() => pendingWord.value?.name || draft.value.filename)
const attachments = ref<InstanceType<typeof ProcessRouteAttachments>>()
const missingAttachments = computed(() =>
  draft.value.route_kind === 'rework'
    ? []
    : [
        !sourceFilename.value && '工艺原件',
        !draft.value.drawings?.length && !pendingDrawings.value.length && '图纸',
      ].filter(Boolean),
)
function showMaterialSource(kind: 'word' | 'order') {
  attachments.value?.open(kind)
}
const busy = ref(false),
  error = ref('')
const directory = useTeamDirectoryStore()
const auth = useAuthStore()
const canMaintain = computed(
  () =>
    !props.viewOnly &&
    !auth.currentUserError &&
    auth.currentUser?.active !== false &&
    (auth.isAdmin ||
      (auth.currentUser?.team?.code === 'FACTORY-PROCESS' &&
        auth.currentUser.team.kind === 'engineering')),
)
const readonly = computed(() => !canMaintain.value || !editingSaved.value)
watch(
  () => [primarySerial.value, draft.value.steps, draft.value.source_data.receipt_fields],
  () => {
    if (!readonly.value && !busy.value) {
      importsConfirmed.value = false
      delete draft.value.source_data.material_confirmation
    }
  },
  { deep: true, flush: 'sync' },
)
const dialogTitle = computed(() =>
  draft.value.route_kind === 'rework'
    ? readonly.value
      ? '返工工艺'
      : '制定返工工艺'
    : readonly.value
      ? '工艺详情'
      : draft.value.id
        ? '编辑工艺'
        : '新建工艺',
)
const showModifier = computed(
  () =>
    modifying.value ||
    !!(props.route && (props.route.version > 1 || props.route.modified_employee_id)),
)
const engineeringTeam = computed(() =>
  directory.items.find(
    (team) => team.active && team.code === 'FACTORY-PROCESS' && team.kind === 'engineering',
  ),
)
const person = ref<TeamEmployee | null>(
  draft.value.engineering_employee_id
    ? {
        id: draft.value.engineering_employee_id,
        name: draft.value.engineering_employee_name || '',
        team_id: Number(engineeringTeam.value?.id || 0),
        active: true,
        version: 1,
      }
    : null,
)
const modifier = ref<TeamEmployee | null>(
  draft.value.modified_employee_id && !props.startEditing
    ? {
        id: draft.value.modified_employee_id,
        name: draft.value.modified_employee_name || '',
        team_id: Number(engineeringTeam.value?.id || 0),
        active: true,
        version: 1,
      }
    : null,
)
watch(primarySerial, () => {
  if (error.value === serialConflict.value) error.value = ''
  serialConflict.value = ''
})
watch(modifier, (value) => {
  draft.value.modified_employee_id = value?.id ?? null
  draft.value.modified_employee_name = value?.name ?? null
})
watch(person, (value) => {
  draft.value.engineering_employee_id = value?.id ?? null
  draft.value.engineering_employee_name = value?.name ?? null
})
const duplicate = computed(() =>
  draft.value.steps
    .map((step) => step.sequence_no)
    .filter((value, i, list) => list.indexOf(value) !== i),
)
function sequenceProblem(index: number) {
  const sequence = draft.value.steps[index]!.sequence_no
  if (!Number.isInteger(sequence) || sequence < 0) return '序号待确认'
  if (duplicate.value.includes(sequence)) return '序号重复'
  if (index > 0 && sequence <= draft.value.steps[index - 1]!.sequence_no) return '顺序异常'
  return ''
}
function textProblem(index: number, key: 'name' | 'instructions') {
  const step = draft.value.steps[index]!
  return (readonly.value || step.source_row) && !step[key].trim()
    ? key === 'name'
      ? '工序名称缺失'
      : '工艺要求缺失'
    : ''
}
const unrecognizedRows = computed(() =>
  (draft.value.source_data.issues || [])
    .filter((issue) => issue.includes('列数不完整'))
    .map((issue) => issue.match(/表(\d+)第(\d+)行/))
    .filter((row): row is RegExpMatchArray => !!row)
    .map((row) => `原表 ${row[1]} · 第 ${row[2]} 行`)
    .join('、'),
)
const stepIssues = computed(() =>
  draft.value.steps.flatMap((step, index) =>
    (['sequence', 'name', 'instructions'] as const).flatMap((field) => {
      const label = field === 'sequence' ? sequenceProblem(index) : textProblem(index, field)
      return label ? [{ index, field, label, source: step.source_row }] : []
    }),
  ),
)
async function locateIssue(issue: (typeof stepIssues.value)[number]) {
  issuesOpen.value = false
  focusOriginal(issue.source)
  await nextTick()
  const row = editorMain.value?.querySelectorAll<HTMLElement>('.route-edit-step')[issue.index]
  row?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  if (readonly.value) {
    row?.focus({ preventScroll: true })
    attachments.value?.open('word')
  } else {
    const column = { sequence: 0, name: 1, instructions: 2 }[issue.field]
    row?.children[column]
      ?.querySelector<HTMLElement>('input,textarea')
      ?.focus({ preventScroll: true })
  }
}
const issueCount = computed(() => stepIssues.value.length + (unrecognizedRows.value ? 1 : 0))
const activeSource = ref('')
function focusOriginal(row?: string | null) {
  activeSource.value = row || ''
}
function teamChanged(index: number) {
  const step = draft.value.steps[index]!
  step.team_name = directory.items.find((team) => Number(team.id) === step.team_id)?.name
  if (!step.name.trim()) step.name = step.team_name || ''
  step.processing_task_id = null
  step.purpose_id = null
}
const { formRef, fieldErrors, validate } = useDialogValidation(() => {
  const errors: Record<string, string> = {}
  if (engineeringTeam.value && !modifying.value && !person.value) errors.person = '请选择工艺人员'
  if (engineeringTeam.value && modifying.value && !modifier.value)
    errors.modifier = '请选择修改人员'
  if (!primarySerial.value.trim() || /[、,，\n]/.test(primarySerial.value))
    errors.serials = '请填写一个主流水号'
  if (serialConflict.value) errors.serials = serialConflict.value
  if (requiresReview.value && !importsConfirmed.value) errors.imports = '请确认自动填入的资料和工序'
  if (missingAttachments.value.length)
    errors.attachments = `缺少：${missingAttachments.value.join('、')}`
  draft.value.steps.forEach((step, index) => {
    if (sequenceProblem(index)) errors[`${index}.sequence`] = '请核对工序序号'
    if (!step.name.trim()) errors[`${index}.name`] = '请填写工序名称'
    if (!step.instructions.trim()) errors[`${index}.instructions`] = '请填写工艺要求'
    if (!step.team_id) errors[`${index}.team`] = '请选择执行班组'
  })
  return errors
})
async function save() {
  if (!canMaintain.value || readonly.value || busy.value) return
  draft.value.serial_nos = serials.value
  if (!primarySerial.value.trim()) {
    validate()
    return
  }
  if (!draft.value.title.trim()) draft.value.title = serials.value.join('、').slice(0, 160)
  if (!validate()) return
  busy.value = true
  error.value = ''
  try {
    const materialFields = JSON.parse(JSON.stringify(draft.value.source_data.receipt_fields || {}))
    let hasPendingSource = !!pendingWord.value
    if (editingSaved.value && draft.value.state === 'published') {
      const revision = await processRouteApi.revise(draft.value.id)
      draft.value = {
        ...draft.value,
        id: revision.id,
        parent_id: revision.parent_id,
        version: revision.version,
        state: revision.state,
      }
    }
    if (!draft.value.id) {
      draft.value = await processRouteApi.create(
        draft.value,
        pendingWord.value!,
        pendingDrawings.value,
      )
      pendingWord.value = undefined
      pendingDrawings.value = []
      hasPendingSource = false
    } else {
      draft.value = hasPendingSource
        ? await processRouteApi.save(draft.value, false)
        : await processRouteApi.save(draft.value)
    }
    while (removedDrawings.value.length) {
      const removed = removedDrawings.value[0]!
      const current = draft.value.drawings?.find(
        (item) => (removed.sha256 && item.sha256 === removed.sha256) || item.id === removed.id,
      )
      if (!current) throw new Error('图纸内容已变化，请刷新后重试')
      draft.value = await processRouteApi.removeDrawing(draft.value, current.id)
      removedDrawings.value.shift()
    }
    if (pendingWord.value) {
      draft.value = await processRouteApi.attachSource(draft.value, pendingWord.value)
      pendingWord.value = undefined
    }
    if (hasPendingSource) {
      if (materialFields.material_name && !draft.value.source_data.receipt_fields?.material_name) {
        draft.value.source_data.receipt_fields ||= {}
        draft.value.source_data.receipt_fields.material_name = materialFields.material_name
      }
      for (const [key, field] of Object.entries(draft.value.source_data.receipt_fields || {})) {
        if (key !== 'serial_no' && materialFields[key]) field.value = materialFields[key].value
      }
      draft.value = await processRouteApi.save(draft.value)
    }
    while (pendingDrawings.value.length) {
      const file = pendingDrawings.value[0]!
      draft.value = await processRouteApi.uploadDrawing(draft.value, file)
      pendingDrawings.value.shift()
    }
    draft.value = requiresReview.value
      ? await processRouteApi.publish(draft.value, importsConfirmed.value)
      : await processRouteApi.publish(draft.value)
    importsConfirmed.value = !!draft.value.source_data.material_confirmation
    visible.value = false
    emit('saved')
  } catch (e) {
    error.value = e instanceof Error ? e.message : '工艺保存失败'
    if (e instanceof ProcessRouteSerialConflictError) {
      serialConflict.value = e.message
      validate()
    }
  } finally {
    busy.value = false
  }
}
async function revise() {
  if (!canMaintain.value) return
  busy.value = true
  error.value = ''
  try {
    editingSaved.value = true
    modifier.value = null
    prepareStepTeams()
  } catch (e) {
    error.value = e instanceof Error ? e.message : '工艺读取失败'
  } finally {
    busy.value = false
  }
}
function prepareStepTeams() {
  const stockTeam = directory.items.find(
    (team) =>
      team.active &&
      ['warehouse', 'production'].includes(team.kind || '') &&
      team.code === 'FACTORY-WAREHOUSE',
  )
  draft.value.steps.forEach((step) => {
    if (!step.team_id && stockTeam && ['中转库', '库房'].includes(step.name.trim()))
      step.team_id = Number(stockTeam.id)
    if (!step.name.trim() && !step.source_row)
      step.name = directory.items.find((team) => Number(team.id) === step.team_id)?.name || ''
  })
}
onMounted(async () => {
  await directory.refreshTeamDirectory()
  if (!readonly.value) prepareStepTeams()
})
</script>
<template>
  <AppDialog
    v-model="visible"
    :title="dialogTitle"
    width="min(1680px, 96vw)"
    class="process-route-dialog"
    :class="{ 'process-route-dialog--rework': draft.route_kind === 'rework' }"
    append-to-body
    :close-on-click-modal="false"
    :show-close="!busy"
    :close-on-press-escape="!busy"
    @closed="emit('close')"
    @opened="emit('opened')"
  >
    <template #header="{ titleId, titleClass }">
      <div class="route-dialog-heading">
        <span class="route-dialog-symbol"
          ><ElIcon><Document /></ElIcon
        ></span>
        <span :id="titleId" :class="[titleClass, 'route-dialog-title']">{{ dialogTitle }}</span>
        <span class="route-heading-count">{{ draft.steps.length }} 道工序</span>
      </div>
    </template>
    <ElAlert
      v-if="error"
      class="route-operation-alert"
      :title="error"
      type="error"
      show-icon
      :closable="false"
    />
    <ElForm
      ref="formRef"
      label-position="top"
      :show-message="false"
      :disabled="busy"
      @submit.prevent
    >
      <FormWorkspace class="route-comparison">
        <template #documents>
          <div class="route-documents">
            <div v-if="!readonly" class="route-file-actions">
              <ElButton
                v-if="draft.route_kind !== 'rework'"
                :icon="Document"
                :disabled="busy"
                :aria-invalid="!!fieldErrors.attachments && missingAttachments.includes('工艺原件')"
                title="必填：导入工艺原件"
                @click="wordInput?.click()"
                >导入工艺单</ElButton
              >
              <ElButton
                :icon="Upload"
                :disabled="busy"
                :aria-invalid="!!fieldErrors.attachments && missingAttachments.includes('图纸')"
                :title="draft.route_kind !== 'rework' ? '必填：上传图纸' : '补充图纸'"
                @click="drawingInput?.click()"
                >{{ draft.route_kind === 'rework' ? '补充图纸' : '上传图纸' }}</ElButton
              >
              <input
                v-if="draft.route_kind !== 'rework'"
                ref="wordInput"
                type="file"
                accept=".docx"
                hidden
                aria-label="导入工艺单文件"
                @change="importWord"
              />
              <input
                ref="drawingInput"
                type="file"
                accept=".pdf,application/pdf"
                multiple
                hidden
                aria-label="上传图纸文件"
                @change="addDrawings"
              />
            </div>
            <AsyncStatus v-if="sourceLoading" label="加载原工艺…" />
            <AsyncStatus v-if="busy" label="正在处理工艺资料…" />
            <div v-if="sourceError" class="route-source-error" role="alert">
              <span>{{ sourceError }}</span
              ><ElButton link @click="loadSourceRoute">重新读取</ElButton>
            </div>
            <ProcessRouteAttachments
              ref="attachments"
              :route="draft"
              :source-route="sourceRoute"
              :documents="['word', 'drawing']"
              :source-file="pendingWord"
              :pending-drawings="pendingDrawings"
              :editable="!readonly"
              :disabled="busy"
              :source-row="activeSource"
              @remove-drawing="removeDrawing"
              @remove-pending-drawing="removePending"
            />
          </div>
        </template>
        <CompactFormSection title="工艺信息" aria-label="工艺基本信息">
          <ElFormItem
            label="流水号"
            class="route-serials form-field--medium"
            :required="!readonly"
            :error="
              fieldErrors.serials || (sourceFilename && !primarySerial.trim() ? '流水号未识别' : '')
            "
          >
            <template #label
              >流水号
              <AutofillBadge
                v-if="
                  draft.source_data.receipt_fields?.serial_no &&
                  draft.source_data.receipt_fields.serial_no.source_kind !== 'manual'
                "
                kind="document"
                :source="
                  draft.source_data.receipt_fields.serial_no.source_kind === 'excel'
                    ? '订单表'
                    : '工艺单'
                "
                :modified="
                  primarySerial !==
                  String(
                    draft.source_data.receipt_fields.serial_no.parsed_value ??
                      draft.source_data.receipt_fields.serial_no.value,
                  )
                "
            /></template>
            <strong v-if="readonly" class="route-serial-value">{{
              primarySerial || '未填写'
            }}</strong>
            <ElInput
              v-else
              v-model="primarySerial"
              :disabled="busy || draft.route_kind === 'rework'"
              placeholder="填写流水号"
              maxlength="80"
              aria-label="流水号"
            />
            <span v-if="serialConflict" class="route-serial-conflict" role="alert">{{
              serialConflict
            }}</span>
          </ElFormItem>
          <ElFormItem label="材质" class="route-material-field form-field--medium">
            <template #label>
              材质
              <AutofillBadge
                v-if="
                  draft.source_data.receipt_fields?.material_name &&
                  draft.source_data.receipt_fields.material_name.source_kind !== 'manual'
                "
                kind="document"
                :source="
                  draft.source_data.receipt_fields.material_name.source_kind === 'excel'
                    ? '订单表'
                    : '工艺单'
                "
                :modified="
                  draft.source_data.receipt_fields.material_name.parsed_value != null &&
                  String(draft.source_data.receipt_fields.material_name.parsed_value) !==
                    String(draft.source_data.receipt_fields.material_name.value)
                "
              />
              <ElTooltip
                v-if="draft.source_data.receipt_fields?.material_name?.alternative"
                :content="`订单表：${draft.source_data.receipt_fields.material_name.alternative.value}；工艺单：${draft.source_data.receipt_fields.material_name.parsed_value ?? draft.source_data.receipt_fields.material_name.value}`"
              >
                <ElIcon
                  class="route-material-difference"
                  tabindex="0"
                  role="img"
                  aria-label="材质来源不一致"
                  ><WarningFilled
                /></ElIcon>
              </ElTooltip>
            </template>
            <strong v-if="readonly" class="route-person-value">{{
              draft.source_data.receipt_fields?.material_name?.value || '—'
            }}</strong>
            <ElInput
              v-else
              :model-value="String(draft.source_data.receipt_fields?.material_name?.value || '')"
              aria-label="材质"
              placeholder="填写材质"
              maxlength="160"
              :disabled="busy"
              @update:model-value="changeMaterial('material_name', $event)"
            />
          </ElFormItem>
          <ElFormItem
            label="工艺人员"
            class="route-person-field form-field--medium"
            :required="!readonly && !modifying"
            :error="fieldErrors.person"
          >
            <strong
              v-if="readonly || modifying"
              class="route-person-value"
              :class="{ 'route-value-missing': !draft.engineering_employee_name }"
              ><PersonName :name="draft.engineering_employee_name || '未记录'"
            /></strong>
            <TeamEmployeeInput
              v-else-if="engineeringTeam"
              v-model="person"
              :team-id="Number(engineeringTeam.id)"
              label="工艺人员"
              :invalid="!!fieldErrors.person"
              :disabled="busy"
            />
            <span v-else>请先配置工艺班组</span>
          </ElFormItem>
          <ElFormItem
            v-if="showModifier"
            label="修改人员"
            class="route-person-field form-field--medium"
            :required="!readonly && modifying"
            :error="fieldErrors.modifier"
          >
            <strong
              v-if="readonly"
              class="route-person-value"
              :class="{ 'route-value-missing': !draft.modified_employee_name }"
              ><PersonName :name="draft.modified_employee_name || '未记录'"
            /></strong>
            <TeamEmployeeInput
              v-else-if="engineeringTeam"
              v-model="modifier"
              :team-id="Number(engineeringTeam.id)"
              label="修改人员"
              :invalid="!!fieldErrors.modifier"
              :disabled="busy"
            />
          </ElFormItem>
          <ElFormItem
            v-if="readonly && (draft.updated_at || draft.created_at)"
            label="更新时间"
            class="route-time-field"
          >
            <span class="route-time-value">{{
              formatDateTime(draft.updated_at || draft.created_at)
            }}</span>
          </ElFormItem>
        </CompactFormSection>
        <div v-if="draft.rework_request" class="route-rework-context">
          <AppDetailTable columns-key="ProcessRouteEditor-1" fields aria-label="返工问题信息">
            <colgroup>
              <col class="rework-label-column" />
              <col />
              <col class="rework-label-column" />
              <col />
              <col class="rework-label-column" />
              <col />
            </colgroup>
            <tbody>
              <tr>
                <th scope="row">返工问题</th>
                <td colspan="5" class="rework-problem-title">
                  {{
                    draft.rework_request.problem_names?.join('、') || draft.rework_request.reason
                  }}
                </td>
              </tr>
              <tr v-if="draft.rework_request.problem_names?.length">
                <th scope="row">问题说明</th>
                <td colspan="5">
                  {{ draft.rework_request.problem_notes || draft.rework_request.reason }}
                </td>
              </tr>
              <tr
                v-if="
                  draft.rework_request.problem_notes &&
                  draft.rework_request.problem_notes !== draft.rework_request.reason
                "
              >
                <th scope="row">返工原因</th>
                <td colspan="5">{{ draft.rework_request.reason }}</td>
              </tr>
              <tr>
                <th scope="row">涉及班组</th>
                <td colspan="5" class="rework-team-cells">
                  <div class="rework-team-grid" role="list" aria-label="涉及班组">
                    <span
                      v-for="team in draft.rework_request.problem_teams"
                      :key="team.id"
                      role="listitem"
                      >{{ team.name }}</span
                    >
                    <span v-if="!draft.rework_request.problem_teams?.length">未指定</span>
                  </div>
                </td>
              </tr>
              <tr>
                <th scope="row">提交班组</th>
                <td>{{ draft.rework_request.requesting_team_name || '未记录' }}</td>
                <th scope="row">提交人</th>
                <td><PersonName :name="draft.rework_request.requested_by || '未记录'" /></td>
                <th scope="row">返工轮次</th>
                <td>{{ draft.rework_request.round }}</td>
              </tr>
              <tr>
                <th scope="row">问题来源</th>
                <td>
                  {{
                    draft.rework_request.inspection_id
                      ? draft.rework_request.inspection_kind === 'patrol'
                        ? '巡检'
                        : '检验'
                      : draft.rework_request.requesting_team_id
                        ? '班组反馈'
                        : '来源未记录'
                  }}<template v-if="draft.rework_request.inspection_id">
                    #{{ draft.rework_request.inspection_id }}</template
                  >
                </td>
                <th scope="row">物料所在班组</th>
                <td>{{ draft.rework_request.team_name }}</td>
                <th scope="row">原加工记录</th>
                <td>#{{ draft.rework_request.rework_of_id }}</td>
              </tr>
              <tr>
                <th scope="row">返工批次</th>
                <td>{{ draft.rework_request.batch_no }}</td>
                <th scope="row">返工数量</th>
                <td>
                  {{ draft.rework_request.quantity }} 件 · {{ draft.rework_request.weight }} kg
                </td>
                <th scope="row">接回正常工序</th>
                <td>
                  {{ draft.rework_request.resume_step_name || draft.rework_request.team_name }}
                </td>
              </tr>
              <tr v-if="draft.rework_request.dimension_result">
                <th scope="row">尺寸检查</th>
                <td colspan="5">{{ draft.rework_request.dimension_result }}</td>
              </tr>
              <tr v-if="draft.rework_request.weight_result">
                <th scope="row">重量检查</th>
                <td colspan="5">{{ draft.rework_request.weight_result }}</td>
              </tr>
            </tbody>
          </AppDetailTable>
        </div>
        <ReworkRoundsTable
          v-if="draft.rework_request && draft.id"
          :route-id="draft.id"
          :version="draft.version"
        />
        <section ref="editorMain" class="route-editor-main" aria-label="工艺内容">
          <div
            v-if="!readonly && fieldErrors.attachments"
            class="route-attachment-warning"
            role="alert"
          >
            {{ fieldErrors.attachments }}
          </div>
          <CompactFormSection title="工序明细">
            <template #actions>
              <AppPopover
                v-if="issueCount"
                v-model:visible="issuesOpen"
                trigger="click"
                placement="bottom-start"
                :width="280"
              >
                <template #reference>
                  <ElButton
                    text
                    native-type="button"
                    class="route-issue-summary"
                    :aria-expanded="issuesOpen"
                  >
                    <ElIcon><WarningFilled /></ElIcon>{{ issueCount }} 处待核对
                    <ElIcon class="route-issue-chevron"><ArrowDown /></ElIcon>
                  </ElButton>
                </template>
                <div class="route-issue-list" aria-label="工艺待核对项">
                  <ElButton
                    text
                    v-for="issue in stepIssues"
                    :key="`${issue.index}.${issue.field}`"
                    native-type="button"
                    class="route-issue-choice"
                    @click="locateIssue(issue)"
                  >
                    <ElIcon><WarningFilled /></ElIcon>
                    <span
                      >{{ issue.label
                      }}<small
                        >第 {{ issue.index + 1 }} 道 ·
                        {{ draft.steps[issue.index]?.name || '未命名工序' }}</small
                      ></span
                    >
                    <span class="route-issue-locate">定位</span>
                  </ElButton>
                  <span
                    v-if="unrecognizedRows"
                    class="route-issue-unrecognized"
                    role="img"
                    aria-label="原稿含未识别行"
                    :title="`${unrecognizedRows}未识别`"
                    ><ElIcon><WarningFilled /></ElIcon>{{ unrecognizedRows }}未识别</span
                  >
                </div>
              </AppPopover>
            </template>
            <div class="form-field--full">
              <div class="route-step-table-wrap">
                <AppDetailTable
                  columns-key="ProcessRouteEditor-2"
                  :required-columns="['序号', '执行班组', '工艺要求', '计划加工数量']"
                  class="route-step-table"
                  :class="{ 'route-step-table--readonly': readonly }"
                  aria-label="工艺工序"
                >
                  <colgroup>
                    <col class="route-col-sequence" />
                    <col class="route-col-name" />
                    <col />
                    <col class="route-col-quantity" />
                    <col v-if="!readonly" class="route-col-actions" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>序号</th>
                      <th>执行班组</th>
                      <th>工艺要求</th>
                      <th>计划加工数量</th>
                      <th v-if="!readonly">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    <template v-for="(step, index) in draft.steps" :key="index">
                      <tr
                        class="route-edit-step"
                        :data-notice-route-step="index"
                        tabindex="-1"
                        @focusin="focusOriginal(step.source_row)"
                      >
                        <td
                          class="route-sequence-cell"
                          :class="{ 'route-cell--issue': sequenceProblem(index) }"
                          :title="sequenceProblem(index)"
                        >
                          <div class="route-sequence-field">
                            <ElTooltip
                              v-if="step.source_row"
                              :content="`工艺单 · 自动填入 · 原文行 ${step.source_row}`"
                              placement="top"
                            >
                              <span
                                class="route-import-marker route-step-import"
                                role="img"
                                aria-label="自动填入"
                                tabindex="0"
                                >导</span
                              >
                            </ElTooltip>
                            <span v-if="readonly" class="route-cell-value">{{
                              step.sequence_no >= 0 ? step.sequence_no : '—'
                            }}</span>
                            <ElFormItem
                              v-else
                              :error="sequenceProblem(index) || fieldErrors[`${index}.sequence`]"
                              ><ElInputNumber
                                v-model="step.sequence_no"
                                :min="0"
                                :max="999"
                                :controls="false"
                                :disabled="readonly || busy"
                                :aria-label="`工序 ${index + 1} 序号`"
                            /></ElFormItem>
                            <ElButton
                              text
                              v-if="sequenceProblem(index)"
                              native-type="button"
                              class="route-cell-marker"
                              :aria-label="sequenceProblem(index)"
                              :title="`${sequenceProblem(index)} · 点击定位原稿`"
                              @click="
                                locateIssue({
                                  index,
                                  field: 'sequence',
                                  label: sequenceProblem(index),
                                  source: step.source_row,
                                })
                              "
                            >
                              <ElIcon><WarningFilled /></ElIcon>
                            </ElButton>
                          </div>
                        </td>
                        <td
                          :class="{ 'route-cell--issue': textProblem(index, 'name') }"
                          :title="textProblem(index, 'name')"
                        >
                          <span
                            v-if="readonly"
                            class="route-cell-value"
                            :title="`工序：${step.name}`"
                            >{{
                              step.team_name ||
                              directory.items.find((team) => Number(team.id) === step.team_id)
                                ?.name ||
                              '未关联班组'
                            }}</span
                          >
                          <ElFormItem v-else :error="fieldErrors[`${index}.team`]">
                            <ElSelect
                              v-model="step.team_id"
                              :disabled="readonly || busy"
                              placeholder="选择班组"
                              :aria-label="`工序 ${index + 1} 执行班组`"
                              @change="teamChanged(index)"
                              ><ElOption
                                v-for="team in directory.items.filter(
                                  (team) =>
                                    team.active &&
                                    ['warehouse', 'production'].includes(team.kind || ''),
                                )"
                                :key="team.id"
                                :value="Number(team.id)"
                                :label="team.name" /></ElSelect
                          ></ElFormItem>
                        </td>
                        <td
                          class="route-instructions-cell"
                          :class="{ 'route-cell--issue': textProblem(index, 'instructions') }"
                          :title="textProblem(index, 'instructions')"
                        >
                          <span v-if="readonly" class="route-cell-value">{{
                            step.instructions || '—'
                          }}</span>
                          <ElFormItem
                            v-else
                            :error="
                              textProblem(index, 'instructions') ||
                              fieldErrors[`${index}.instructions`]
                            "
                            ><ElInput
                              ref="instructionInputs"
                              v-model="step.instructions"
                              type="textarea"
                              :autosize="{ minRows: 1, maxRows: 5 }"
                              :readonly="readonly"
                              :disabled="busy"
                              maxlength="10000"
                              :aria-label="`工序 ${index + 1} 工艺要求`"
                          /></ElFormItem>
                        </td>
                        <td>
                          <span v-if="readonly" class="route-cell-value">{{
                            step.planned_quantity || '—'
                          }}</span>
                          <ElInput
                            v-else
                            v-model="step.planned_quantity"
                            :readonly="readonly"
                            :disabled="busy"
                            maxlength="80"
                            :aria-label="`工序 ${index + 1} 计划加工数量`"
                          />
                        </td>
                        <td v-if="!readonly">
                          <ElButton
                            type="danger"
                            link
                            :disabled="busy || draft.steps.length < 2"
                            :aria-label="`删除工序 ${index + 1}`"
                            @click="removeStep(index)"
                            >删除</ElButton
                          >
                        </td>
                      </tr>
                    </template>
                  </tbody>
                </AppDetailTable>
              </div>
              <ElButton
                v-if="!readonly"
                class="route-add-step"
                :disabled="busy || draft.steps.length >= 100"
                @click="addStep"
                >＋ 增加工序</ElButton
              >
              <ImportedDataConfirmation
                v-if="!readonly && requiresReview"
                v-model="importsConfirmed"
                class="route-import-confirmation"
                label="已核对自动填入的资料和工序"
                :error="fieldErrors.imports"
                :disabled="busy"
              />
            </div>
          </CompactFormSection>
          <CompactFormSection v-if="!readonly || draft.review_note">
            <ElFormItem
              label="备注"
              class="route-review form-field--full"
              :error="fieldErrors.review"
              ><p v-if="readonly" class="route-review-text">{{ draft.review_note }}</p>
              <ElInput
                v-else
                v-model="draft.review_note"
                type="textarea"
                :autosize="{ minRows: 1, maxRows: 3 }"
                :readonly="readonly"
                :disabled="busy"
                placeholder="选填"
                maxlength="2000"
            /></ElFormItem>
          </CompactFormSection>
          <AppDisclosure
            v-if="
              Object.keys(draft.source_data.receipt_fields || {}).some(
                (key) => !['serial_no', 'material_name'].includes(key),
              )
            "
            class="route-extra-info"
          >
            <template #summary>物料与订单资料</template>
            <ProcessRouteMaterials
              :exclude="['material_name']"
              :data="draft.source_data"
              :readonly="readonly"
              :disabled="busy"
              @change="changeMaterial"
              @source="showMaterialSource"
            />
          </AppDisclosure>
          <AppDisclosure class="route-extra-info">
            <template #summary>其他信息</template>
            <CompactFormSection>
              <ElFormItem label="工艺名称" class="form-field--long"
                ><span v-if="readonly" class="route-readonly-value">{{ draft.title || '—' }}</span
                ><ElInput
                  v-else
                  v-model="draft.title"
                  :readonly="readonly"
                  :disabled="busy"
                  maxlength="160"
                  placeholder="未填写时使用流水号"
              /></ElFormItem>
              <p v-if="draft.created_at" class="route-document-times form-field--full">
                创建时间：{{ formatDateTime(draft.created_at)
                }}<span v-if="draft.updated_at"
                  >更新时间：{{ formatDateTime(draft.updated_at) }}</span
                >
              </p>
            </CompactFormSection>
          </AppDisclosure>
        </section>
      </FormWorkspace>
    </ElForm>
    <template #footer>
      <span class="route-footer-summary"
        >{{ draft.steps.length }} 道工序<span v-if="serials.length">
          · {{ serials.length }} 个流水号</span
        ></span
      >
      <ElButton :disabled="busy" @click="visible = false">关闭</ElButton>
      <RouterLink
        v-if="
          readonly &&
          draft.route_kind === 'rework' &&
          (draft.rework_request?.original_task_id || auth.isDispatch)
        "
        :to="{
          path: '/production-schedules',
          query: draft.rework_request?.original_task_id
            ? { task_id: draft.rework_request.original_task_id }
            : { serial_no: draft.serial_nos[0] },
        }"
        class="route-schedule-link"
        @click="visible = false"
        >{{ draft.rework_request?.original_task_id ? '查看交货排期' : '关联交货排期' }}</RouterLink
      >
      <template v-if="readonly && canMaintain && draft.route_kind !== 'rework'">
        <ElButton type="primary" :disabled="busy" @click="revise">修改工艺</ElButton>
      </template>
      <ElButton
        v-else-if="readonly && canMaintain && draft.rework_request?.can_modify"
        type="primary"
        :disabled="busy"
        @click="revise"
        >修改返工工艺</ElButton
      >
      <template v-else-if="!readonly"
        ><ElButton type="primary" :loading="busy" @click="save()">{{
          draft.route_kind === 'rework' ? '提交工艺' : '保存工艺'
        }}</ElButton></template
      >
    </template>
  </AppDialog>
</template>
<style scoped>
.route-import-marker {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 16px;
  width: 16px;
  height: 16px;
  border: 1px solid var(--wm-border, #cddbed);
  border-radius: 4px;
  background: var(--wm-info-bg, #eff5fc);
  font-size: 10px;
  font-weight: 500;
  line-height: 1;
  color: var(--wm-muted, #52749a);
  margin-left: 5px;
  cursor: help;
}
.route-import-marker:focus-visible {
  outline: 2px solid var(--accent-blue);
  outline-offset: 2px;
}
.route-step-import {
  grid-column: 1;
  grid-row: 1;
  margin: 0;
}
.route-schedule-link {
  color: var(--brand-primary, var(--wm-text, #215b49));
  font-size: 14px;
  text-decoration: none;
  padding: 8px 12px;
}
.route-schedule-link:hover {
  text-decoration: underline;
}
:global(.process-route-dialog) {
  --el-color-danger: var(--accent-red);
  --el-color-error: var(--accent-red);
}
.process-route-dialog--rework .route-dialog-symbol {
  color: var(--accent-violet);
  background: linear-gradient(
    160deg,
    var(--wm-bg, #ffffff),
    var(--wm-info-bg, #eee5ff) 60%,
    var(--wm-info-bg, #dfceff)
  );
  box-shadow:
    inset 0 1px 0 #fff,
    inset 0 -1px 0 #7c3aed1c,
    0 2px 5px #7c3aed1a;
}
.route-rework-context {
  border: 1px solid var(--line);
  border-radius: 12px;
  margin-bottom: 16px;
  overflow: hidden;
  font-size: 13px;
}
.route-rework-context table {
  width: 100%;
  table-layout: fixed;
  border-spacing: 0;
}
.rework-label-column {
  width: 104px;
}
.route-rework-context :is(th, td) {
  padding: 7px 10px;
  border-right: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  text-align: left;
  vertical-align: top;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.route-rework-context tr > :last-child {
  border-right: 0;
}
.route-rework-context tr:last-child > * {
  border-bottom: 0;
}
.route-rework-context th {
  background: var(--table-header-bg);
  color: var(--muted);
  font-weight: 500;
}
.route-rework-context td {
  background: var(--wm-muted-surface, #ffffffa8);
}
.route-rework-context .rework-problem-title {
  background: linear-gradient(
    100deg,
    var(--wm-danger-bg, #fff2ef),
    var(--wm-muted-surface, #ffffffcf) 65%
  );
  box-shadow: inset 3px 0 var(--accent-red);
  color: var(--text);
  font-weight: 600;
}
.route-serial-conflict {
  width: 100%;
  margin-top: 4px;
  color: var(--el-color-danger);
  font-size: 12px;
  line-height: 18px;
}
.route-rework-context .rework-team-cells {
  padding: 0;
}
.rework-team-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(104px, 1fr));
  gap: 1px;
  background: var(--line);
}
.rework-team-grid > span {
  padding: 7px 10px;
  background: var(--surface);
}
:global(.el-dialog.process-route-dialog > .el-dialog__header) {
  position: relative;
  display: flex;
  align-items: center;
  min-height: 48px;
  padding: 0 44px 14px 0;
  background: transparent;
}
:global(.el-dialog.process-route-dialog > .el-dialog__header .el-dialog__headerbtn) {
  top: 1px;
  right: 0;
}
.route-dialog-heading {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.route-dialog-symbol {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border: 1px solid var(--wm-muted-surface, #ffffffef);
  border-radius: 10px;
  background: linear-gradient(
    160deg,
    var(--wm-bg, #ffffff),
    var(--wm-info-bg, #e8f0ff) 60%,
    var(--wm-info-bg, #d0e1ff)
  );
  box-shadow:
    inset 0 1px 0 #fff,
    inset 0 -1px 0 #2563eb1c,
    0 2px 5px #2563eb1a;
  color: var(--accent-blue);
  font-size: 19px;
}
.route-dialog-title {
  line-height: 34px;
}
.route-heading-count {
  padding: 3px 8px;
  border: 1px solid var(--wm-border, #dce6e1);
  border-radius: 7px;
  color: var(--wm-muted, #5f746a);
  background: var(--wm-muted-surface, #ffffffb3);
  font-size: 11px;
  line-height: 18px;
  white-space: nowrap;
}
.route-operation-alert {
  margin-bottom: 14px;
  border: 1px solid var(--el-color-danger-light-7);
  border-radius: 12px;
}
.route-serial-value {
  color: var(--primary);
  font-size: 18px;
  font-weight: 650;
  letter-spacing: 0.3px;
  overflow-wrap: anywhere;
}
.route-person-value {
  color: var(--wm-text, #2c3e36);
  font-size: 14px;
  font-weight: 500;
  overflow-wrap: anywhere;
}
.route-value-missing {
  padding: 0 7px;
  border: 1px solid var(--wm-border, #e6e1d4);
  border-radius: 6px;
  background: var(--wm-warning-bg, #fbf8ef);
  color: var(--wm-warning-text, #78623c);
  font-size: 12px;
  line-height: 24px;
}
.route-time-value {
  color: var(--wm-text, #2c3e36);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.route-documents {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.route-source-status,
.route-source-error {
  font-size: 12px;
  color: var(--muted);
}
.route-source-error {
  color: var(--el-color-danger);
}
.route-editor-main {
  min-width: 0;
}
.route-attachment-warning {
  margin: 0 0 12px;
  color: var(--el-color-danger);
  font-size: 12px;
}
.route-file-actions .el-button[aria-invalid='true'] {
  border-color: var(--el-color-danger);
  color: var(--el-color-danger);
}
.route-issue-summary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border: 1px solid #e9d3a9;
  border-radius: 8px;
  background: linear-gradient(135deg, var(--wm-warning-bg, #fffcf4), var(--wm-warning-bg, #faf0dd));
  color: var(--wm-warning-text, #8c6120);
  font: inherit;
  font-size: 12px;
  white-space: nowrap;
  cursor: pointer;
  transition:
    background-color 160ms,
    box-shadow 160ms;
}
.route-issue-summary:hover,
.route-issue-summary[aria-expanded='true'] {
  background: var(--wm-warning-bg, #f8ebd1);
  box-shadow: 0 2px 8px #9b742016;
}
.route-issue-chevron {
  font-size: 10px;
  transition: transform 160ms;
}
.route-issue-summary[aria-expanded='true'] .route-issue-chevron {
  transform: rotate(180deg);
}
.route-issue-list {
  max-height: 260px;
  overflow: auto;
}
.route-issue-choice {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 10px 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--wm-warning-text, #796039);
  text-align: left;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.route-issue-choice :deep(> span) {
  display: flex;
  width: 100%;
  gap: 9px;
  white-space: normal;
}
.route-issue-choice:hover {
  background: var(--wm-warning-bg, #faf4e7);
}
.route-issue-choice small {
  display: block;
  margin-top: 4px;
  color: var(--muted);
  font-size: 11px;
}
.route-issue-locate {
  margin-left: auto;
  color: var(--accent-blue);
  font-size: 11px;
}
.route-issue-unrecognized {
  display: flex;
  gap: 8px;
  padding: 10px 8px;
  color: var(--wm-warning-text, #8c6120);
  font-size: 12px;
}
.route-issue-summary:focus-visible,
.route-issue-choice:focus-visible,
.route-cell-marker:focus-visible {
  outline: 2px solid var(--wm-warning-text, #bb8b3c);
  outline-offset: 2px;
}
.route-file-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.route-file-actions .el-button {
  flex: 1 1 100%;
  margin-left: 0;
}
.route-material-difference {
  margin-left: 5px;
  color: var(--wm-warning-text, #9b702e);
}
.route-readonly-value {
  min-height: 32px;
  display: flex;
  align-items: center;
}
.route-step-table-wrap {
  border: 1px solid var(--el-border-color);
  border-radius: 12px;
  overflow: clip;
}
.route-step-table {
  width: 100%;
  table-layout: fixed;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text);
}
.route-col-sequence {
  width: 128px;
}
.route-col-name {
  width: 130px;
}
.route-col-quantity {
  width: 114px;
}
.route-col-actions {
  width: 74px;
}
.route-step-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 8px 10px;
  background: var(--wm-muted-surface, #edf3ef);
  border-bottom: 1px solid var(--el-border-color);
  color: var(--wm-muted, #52665b);
  font-size: 12px;
  font-weight: 600;
  text-align: center;
}
.route-step-table td {
  position: relative;
  padding: 7px 8px;
  border-top: 1px solid var(--el-border-color);
  vertical-align: middle;
  text-align: center;
  background: var(--wm-muted-surface, #ffffffed);
  transition: background-color 160ms;
}
.route-edit-step:hover > td,
.route-edit-step:focus > td,
.route-edit-step:focus-within > td {
  background-color: var(--wm-muted-surface, #f4f8fa);
}
.route-edit-step:focus {
  outline: 2px solid var(--wm-muted, #8fa9bd);
  outline-offset: -2px;
}
.route-edit-step > td[data-column-index='2'] .route-cell-value {
  font-weight: 600;
  color: var(--wm-text, #365246);
}
.route-edit-step > td[data-column-index='4'] {
  font-variant-numeric: tabular-nums;
  color: var(--wm-text, #374e61);
}
.route-step-table :is(th, td):not(:last-child) {
  border-right: 1px solid var(--el-border-color);
}
.route-step-table tbody > tr:first-child > td {
  border-top: 0;
}
.route-step-table .route-instructions-cell {
  text-align: left;
}
.route-cell-value {
  display: block;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.route-cell-marker {
  display: inline-flex;
  align-items: center;
  padding: 0;
  width: 18px;
  height: 18px;
  border: 0;
  border-radius: 5px;
  background: var(--wm-danger-bg, #fce9e6);
  box-shadow:
    inset 0 1px 0 #fff,
    inset 0 -1px 0 #d13b3b26;
  color: var(--el-color-danger);
  font-size: 13px;
  vertical-align: middle;
  cursor: pointer;
  justify-content: center;
  transition:
    background-color 160ms,
    transform 160ms;
}
.route-cell-marker:hover {
  background: var(--wm-danger-bg, #f8d6d1);
  transform: translateY(-1px);
}
.route-sequence-field {
  display: grid;
  grid-template-columns: 16px minmax(56px, 1fr) 18px;
  gap: 4px;
  align-items: center;
}
.route-sequence-field > .route-cell-value,
.route-sequence-field > :deep(.el-form-item) {
  grid-column: 2;
  grid-row: 1;
  min-width: 0;
}
.route-sequence-field > .route-cell-marker {
  grid-column: 3;
  grid-row: 1;
  margin: 0;
}
.route-step-table td.route-cell--issue {
  background: var(--wm-danger-bg, #fff8f7);
  box-shadow: inset 0 0 0 1px var(--el-color-danger-light-5);
}
.route-cell--issue .route-cell-value {
  color: var(--accent-red);
}
.route-step-table :deep(.el-form-item) {
  margin: 0;
}
.route-step-table :deep(.el-input-number) {
  width: 100%;
}
.route-step-table :deep(.el-textarea__inner) {
  min-height: 32px !important;
  resize: none;
  padding: 5px 9px;
}
.route-step-table :deep(.el-input__wrapper) {
  padding: 1px 9px;
}
.route-step-table :deep(.el-input__inner) {
  text-align: center;
}
.process-route-dialog .route-file-actions .el-button:not(:disabled):active {
  box-shadow: inset 0 1px 3px #2563eb2b;
  transform: translateY(0);
}
.route-add-step {
  margin: 12px 0 0;
}
.route-review-text {
  margin: 0;
  white-space: pre-wrap;
  color: var(--wm-muted, #51655a);
  font-size: 13px;
  line-height: 1.7;
}
.route-extra-info {
  margin-top: 12px;
  font-size: 12px;
  color: var(--muted);
}
.route-extra-info :deep(.el-form-item) {
  margin-bottom: 12px;
}
.route-document-times {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  margin: 8px 0;
  font-size: 12px;
  color: var(--muted);
}
.route-footer-summary {
  margin-right: auto;
  color: var(--muted);
  font-size: 12px;
}
@media (max-width: 1150px) {
  .route-col-name {
    width: 104px;
  }
  .route-col-quantity {
    width: 108px;
  }
  .route-col-actions {
    width: 74px;
  }
  .route-step-table td {
    padding: 8px 6px;
  }
}
@media (max-width: 900px) {
  .route-rework-context {
    overflow-x: auto;
  }
  .route-rework-context table {
    min-width: 720px;
  }
  .route-step-table-wrap {
    overflow-x: auto;
  }
  .route-step-table {
    min-width: 560px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .route-issue-summary,
  .route-issue-chevron,
  .route-edit-step > td,
  .route-cell-marker,
  .route-file-actions .el-button {
    transition: none;
    transform: none;
  }
}
</style>
