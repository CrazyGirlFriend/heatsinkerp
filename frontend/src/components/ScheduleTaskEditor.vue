<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import {
  ElAlert,
  ElButton,
  ElDatePicker,
  ElForm,
  ElFormItem,
  ElInput,
  ElInputNumber,
  ElOption,
  ElSelect,
  ElRadioGroup,
  ElRadioButton,
} from 'element-plus'
import { Plus, Delete } from '@element-plus/icons-vue'
import AppDialog from './AppDialog.vue'
import MaterialInput from './MaterialInput.vue'
import ScheduleSourceAllocation from './ScheduleSourceAllocation.vue'
import ScheduleSelectionDialog from './ScheduleSelectionDialog.vue'
import { useDialogValidation } from '@/composables/useDialogValidation'
import { useAuthStore } from '@/stores/auth'
import { useTeamDirectoryStore } from '@/stores/teamDirectory'
import { productionScheduleApi } from '@/services/productionScheduleApi'
import {
  completionBasisLabels,
  type CompletionBasis,
  type ScheduleSource,
  type ScheduleTask,
  type ScheduleTaskWrite,
  type ScheduleSelection,
} from '@/types/productionSchedule'
import { externalDestinationOptions } from '@/types/materialTransfer'
import { materialRequestKey } from '@/utils/materialStock'
import { scheduleAmountErrors } from '@/utils/schedulePlan'

const props = defineProps<{
  task?: ScheduleTask | null
  processRoute?: import('@/types/processRoute').ProcessRoute
  routeSerial?: string
}>()
const emit = defineEmits<{ close: []; saved: [task: ScheduleTask] }>()
const visible = ref(true)
const auth = useAuthStore(),
  directory = useTeamDirectoryStore()
const teams = computed(() =>
  directory.items.filter((team) => team.active && team.kind !== 'engineering'),
)
const writable = computed(
  () => auth.isAdmin && !auth.currentUserError && auth.currentUser?.active !== false,
)
interface NodeDraft {
  key: string
  routeIndex?: number
  team?: number
  date: string
  hour: string
  quantity?: number
  weight?: number
  basis: CompletionBasis
  sources: ScheduleSource[]
  notes: string
}
function newNode(team?: number): NodeDraft {
  return {
    key: materialRequestKey(),
    team,
    date: '',
    hour: '',
    basis: 'quantity',
    sources: [],
    notes: '',
  }
}
function routeNodes() {
  const nodes: NodeDraft[] = []
  props.processRoute?.steps.forEach((step, index) => {
    if (step.serial_nos.length && !step.serial_nos.includes(props.routeSerial || '')) return
    const last = nodes.at(-1)
    if (last?.team === step.team_id) {
      last.routeIndex = index
      last.notes += `；${step.sequence_no} · ${step.name}`
      return
    }
    const node = newNode(step.team_id || undefined)
    node.routeIndex = index
    node.notes = `${step.sequence_no} · ${step.name}（工艺参考 ${step.planned_days || '—'} 天）`
    nodes.push(node)
  })
  return nodes
}
const form = reactive({
  title: props.task?.title || props.processRoute?.title || '',
  serial: props.task?.serial_no || props.routeSerial || '',
  notes: props.task?.notes || '',
  businessPerson: props.task?.business_person_id || null,
  businessName: props.task?.business_person_name || '',
  nodes: props.processRoute ? routeNodes() : [newNode()],
  destinationKind: props.processRoute ? 'external' : 'team',
  nextTeam: undefined as number | undefined,
  destination: '',
})
const saving = ref(false),
  error = ref('')
const personOpen = ref(false)
function personSelected(items: ScheduleSelection[]) {
  form.businessPerson = items[0] ? Number(items[0].value) : null
  form.businessName = items[0]?.label || ''
  personOpen.value = false
}
let key = '',
  fingerprint = ''
const lastTeam = computed(() => form.nodes.at(-1)?.team)
const externalAllowed = computed(() =>
  teams.value.some(
    (team) =>
      Number(team.id) === lastTeam.value && ['FACTORY-WAREHOUSE', 'FACTORY-QC'].includes(team.code),
  ),
)
function teamName(id?: number) {
  return teams.value.find((team) => Number(team.id) === id)?.name || '待选班组'
}
function changeSerial() {
  form.nodes.forEach((node) => {
    node.sources = []
  })
}
function changeTeam(node: NodeDraft) {
  node.sources = []
  if (!externalAllowed.value) form.destinationKind = 'team'
}
function addNode() {
  if (form.nodes.length >= 50) return
  form.nodes.push(newNode(form.nextTeam))
  form.nextTeam = undefined
  form.destinationKind = 'team'
}
function removeNode(index: number) {
  form.nodes.splice(index, 1)
  if (!externalAllowed.value) form.destinationKind = 'team'
}
const { formRef, fieldErrors, validate } = useDialogValidation(() => {
  const issues: Record<string, string> = {}
  if (!form.title.trim()) issues.title = '请填写任务名称'
  if (props.task) return issues
  if (!form.serial.trim()) issues.serial = '请填写流水号'
  form.nodes.forEach((node, index) => {
    if (!node.team) issues[`${node.key}.team`] = '请选择交货班组'
    if (node.team && index && node.team === form.nodes[index - 1]?.team)
      issues[`${node.key}.team`] = '相邻节点不能是同一班组'
    if (!node.date || !node.hour) issues[`${node.key}.due`] = '请选择交货日期和小时'
    const previous = form.nodes[index - 1]
    if (
      previous?.date &&
      previous.hour &&
      node.date &&
      node.hour &&
      `${node.date} ${node.hour}` < `${previous.date} ${previous.hour}`
    )
      issues[`${node.key}.due`] = '不能早于上一个节点的交货时间'
    Object.entries(scheduleAmountErrors(node)).forEach(([field, message]) => {
      issues[`${node.key}.${field}`] = message
    })
  })
  if (form.destinationKind === 'team' ? !form.nextTeam : !form.destination)
    issues.destination = '请选择最后一个节点的接收去向'
  else if (form.destinationKind === 'team' && form.nextTeam === lastTeam.value)
    issues.destination = '接收班组不能与交货班组相同'
  return issues
})
async function save() {
  if (saving.value || !writable.value || !validate()) return
  saving.value = true
  error.value = ''
  try {
    if (props.task) {
      emit(
        'saved',
        await productionScheduleApi.updateTask(props.task.id, {
          expected_version: props.task.version,
          title: form.title.trim(),
          notes: form.notes.trim() || null,
          business_person_id: form.businessPerson,
        }),
      )
    } else {
      const body: Omit<ScheduleTaskWrite, 'idempotency_key'> = {
        title: form.title.trim(),
        serial_no: form.serial.trim(),
        notes: form.notes.trim() || null,
        business_person_id: form.businessPerson,
        nodes: form.nodes.map((node, index) => ({
          process_route_id: props.processRoute?.id || null,
          process_step_index: node.routeIndex ?? null,
          team_id: node.team!,
          next_team_id:
            index < form.nodes.length - 1
              ? form.nodes[index + 1]!.team!
              : form.destinationKind === 'team'
                ? form.nextTeam!
                : null,
          external_destination:
            index === form.nodes.length - 1 && form.destinationKind === 'external'
              ? form.destination
              : null,
          due_at: `${node.date}T${node.hour}:00:00+08:00`,
          target_quantity: node.quantity || null,
          target_weight: node.weight || null,
          completion_basis: node.basis,
          sources: node.sources.map(({ source_transfer_id, quantity, weight }) => ({
            source_transfer_id,
            quantity: quantity || null,
            weight: weight || null,
          })),
          notes: node.notes.trim() || null,
        })),
      }
      const nextFingerprint = JSON.stringify(body)
      if (!key || fingerprint !== nextFingerprint) {
        key = materialRequestKey()
        fingerprint = nextFingerprint
      }
      emit('saved', await productionScheduleApi.createTask({ ...body, idempotency_key: key }))
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : '任务保存失败，请重试'
  } finally {
    saving.value = false
  }
}
</script>
<template>
  <AppDialog
    v-model="visible"
    :title="task ? '修改任务信息' : '新建生产排期'"
    width="min(1260px, 96vw)"
    append-to-body
    :close-on-click-modal="!saving"
    :close-on-press-escape="!saving"
    :show-close="!saving"
    @closed="emit('close')"
  >
    <ElAlert v-if="error" :title="error" type="error" :closable="false" />
    <ElForm
      ref="formRef"
      label-position="top"
      :disabled="saving || !writable"
      class="task-form"
      @submit.prevent="save"
    >
      <div class="task-form__identity">
        <ElFormItem label="流水号" required :error="fieldErrors.serial"
          ><MaterialInput
            v-model="form.serial"
            field="serial_no"
            label="任务流水号"
            :maxlength="80"
            :disabled="!!task || !!processRoute"
            @update:model-value="changeSerial"
        /></ElFormItem>
        <ElFormItem label="业务人员"
          ><ElButton
            class="task-form__person"
            aria-label="选择订单业务人员"
            @click="personOpen = true"
            >{{ form.businessName || '选择业务人员（选填）' }}</ElButton
          ></ElFormItem
        >
        <ElFormItem label="任务名称" required :error="fieldErrors.title"
          ><ElInput
            v-model="form.title"
            maxlength="120"
            placeholder="如：首批 100 件交货"
            aria-label="任务名称"
        /></ElFormItem>
      </div>
      <template v-if="!task">
        <div class="task-form__route-heading">
          <strong>班组交货路线</strong
          ><span>按实际流转顺序排列；每站独立填写交出目标，北京时间精确到小时。</span>
        </div>
        <article v-for="(node, index) in form.nodes" :key="node.key" class="route-node">
          <header class="route-node__heading">
            <strong
              ><span>{{ String(index + 1).padStart(2, '0') }}</span
              >{{ teamName(node.team) }}</strong
            ><span v-if="index < form.nodes.length - 1" class="route-node__destination"
              >交给 {{ teamName(form.nodes[index + 1]?.team) }}</span
            >
            <ElFormItem
              v-else
              label="最后交给"
              required
              :error="fieldErrors.destination"
              class="route-node__final"
            >
              <ElRadioGroup v-if="externalAllowed" v-model="form.destinationKind" size="small"
                ><ElRadioButton value="team">接收班组</ElRadioButton
                ><ElRadioButton value="external">外部去向</ElRadioButton></ElRadioGroup
              >
              <ElSelect
                v-if="form.destinationKind === 'team'"
                v-model="form.nextTeam"
                aria-label="最终接收班组"
                placeholder="选择接收班组"
                ><ElOption
                  v-for="team in teams.filter((item) => Number(item.id) !== lastTeam)"
                  :key="team.id"
                  :value="Number(team.id)"
                  :label="team.name"
              /></ElSelect>
              <ElSelect
                v-else
                v-model="form.destination"
                aria-label="最终外部去向"
                placeholder="选择去向"
                ><ElOption
                  v-for="item in externalDestinationOptions"
                  :key="item"
                  :value="item"
                  :label="item"
              /></ElSelect>
            </ElFormItem>
            <ElButton
              v-if="!processRoute && form.nodes.length > 1"
              link
              type="danger"
              :icon="Delete"
              :aria-label="`移除第${index + 1}个节点`"
              @click="removeNode(index)"
              >移除</ElButton
            >
          </header>
          <div class="route-node__fields">
            <ElFormItem
              class="route-node__team"
              label="交货班组"
              required
              :error="fieldErrors[`${node.key}.team`]"
              ><ElSelect
                v-model="node.team"
                :disabled="!!processRoute"
                :aria-label="`第${index + 1}站班组`"
                placeholder="选择班组"
                @change="changeTeam(node)"
                ><ElOption
                  v-for="team in teams"
                  :key="team.id"
                  :label="team.name"
                  :value="Number(team.id)" /></ElSelect
            ></ElFormItem>
            <ElFormItem
              class="route-node__date"
              label="要求交货时间"
              required
              :error="fieldErrors[`${node.key}.due`]"
              ><div class="route-node__deadline">
                <ElDatePicker
                  v-model="node.date"
                  type="date"
                  value-format="YYYY-MM-DD"
                  placeholder="日期"
                  :aria-label="`第${index + 1}站日期`"
                /><ElSelect
                  v-model="node.hour"
                  placeholder="小时"
                  :aria-label="`第${index + 1}站小时`"
                  ><ElOption
                    v-for="hour in 24"
                    :key="hour"
                    :value="String(hour - 1).padStart(2, '0')"
                    :label="`${String(hour - 1).padStart(2, '0')}:00`"
                /></ElSelect></div
            ></ElFormItem>
            <ElFormItem
              class="route-node__quantity"
              :label="node.basis === 'weight' ? '参考件数' : '计划件数'"
              :required="node.basis !== 'weight'"
              :error="fieldErrors[`${node.key}.quantity`]"
              ><ElInputNumber
                v-model="node.quantity"
                :min="1"
                :precision="0"
                :controls="false"
                placeholder="件"
                :aria-label="`第${index + 1}站件数`"
            /></ElFormItem>
            <ElFormItem
              class="route-node__weight"
              :label="node.basis === 'quantity' ? '参考重量（kg）' : '计划重量（kg）'"
              :required="node.basis !== 'quantity'"
              :error="fieldErrors[`${node.key}.weight`]"
              ><ElInputNumber
                v-model="node.weight"
                :min="0.000001"
                :precision="6"
                :controls="false"
                placeholder="kg"
                :aria-label="`第${index + 1}站重量`"
            /></ElFormItem>
            <ElFormItem class="route-node__basis" label="完成依据" required
              ><ElSelect v-model="node.basis" :aria-label="`第${index + 1}站完成依据`"
                ><ElOption
                  v-for="(label, value) in completionBasisLabels"
                  :key="value"
                  :label="label"
                  :value="value" /></ElSelect
            ></ElFormItem>
          </div>
          <details class="route-node__extra" :open="!!fieldErrors[`${node.key}.sources`]">
            <summary>
              关联批次与节点说明
              <span>{{
                node.sources.length
                  ? `${node.sources.length} 个批次`
                  : index
                    ? '自动承接上序实际来料'
                    : '可先排期，后来料'
              }}</span>
            </summary>
            <ScheduleSourceAllocation
              v-model="node.sources"
              :serial-no="form.serial"
              :team-id="node.team"
              :target-quantity="node.quantity"
              :target-weight="node.weight"
              :disabled="saving"
              :error="fieldErrors[`${node.key}.sources`]"
            />
            <ElFormItem label="节点说明"
              ><ElInput v-model="node.notes" maxlength="2000" placeholder="选填"
            /></ElFormItem>
          </details>
        </article>
        <ElButton
          v-if="!processRoute"
          :icon="Plus"
          :disabled="form.nodes.length >= 50"
          @click="addNode"
          >添加下一班组</ElButton
        >
      </template>
      <ElFormItem label="任务说明" class="task-form__notes"
        ><ElInput
          v-model="form.notes"
          type="textarea"
          :rows="2"
          maxlength="2000"
          placeholder="选填"
          show-word-limit
      /></ElFormItem>
    </ElForm>
    <template #footer
      ><ElButton :disabled="saving" @click="visible = false">取消</ElButton
      ><ElButton type="primary" :loading="saving" :disabled="!writable" @click="save">{{
        task ? '保存任务信息' : '保存整条排期'
      }}</ElButton></template
    >
  </AppDialog>
  <ScheduleSelectionDialog
    v-if="personOpen"
    kind="people"
    single
    active-only
    :selected="
      form.businessPerson ? [{ value: form.businessPerson, label: form.businessName }] : []
    "
    @close="personOpen = false"
    @apply="personSelected"
  />
</template>
<style scoped>
.task-form {
  padding-top: 12px;
}
.task-form__identity {
  display: grid;
  grid-template-columns: minmax(160px, 1fr) minmax(160px, 0.8fr) minmax(220px, 1.5fr);
  gap: 20px;
}
.task-form__person {
  width: 100%;
  justify-content: flex-start;
}
.task-form__route-heading {
  display: flex;
  gap: 16px;
  align-items: baseline;
  margin: 6px 0 12px;
}
.task-form__route-heading span,
.route-node__destination,
.route-node__extra summary span {
  color: var(--muted);
  font-size: 12px;
}
.route-node {
  padding: 14px 16px 4px;
  margin-bottom: 12px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.7);
}
.route-node__heading {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 14px;
  margin-bottom: 14px;
}
.route-node__heading strong {
  color: var(--text);
}
.route-node__heading strong span {
  margin-right: 12px;
  font-size: 12px;
  color: var(--primary);
}
.route-node__destination + .el-button {
  margin-left: auto;
}
.route-node__fields {
  display: grid;
  grid-template-columns: minmax(120px, 1fr) minmax(230px, 1.65fr) 110px 138px 144px;
  gap: 0 14px;
}
.route-node__fields :deep(.el-form-item) {
  min-width: 0;
  margin-bottom: 14px;
}
.route-node__fields :deep(.el-input-number),
.route-node__fields :deep(.el-select) {
  width: 100%;
}
.route-node__deadline {
  display: flex;
  gap: 6px;
  width: 100%;
}
.route-node__deadline :deep(.el-date-editor) {
  flex: 1;
  min-width: 0;
  width: 0;
}
.route-node__deadline :deep(.el-select) {
  width: 82px;
  flex-shrink: 0;
}
.route-node__heading .route-node__final {
  display: flex;
  align-items: center;
  flex-direction: row;
  gap: 10px;
  margin: 0 0 0 auto;
}
.route-node__final :deep(.el-form-item__label) {
  display: inline-flex;
  align-items: center;
  margin: 0;
  padding: 0;
  height: auto;
  line-height: 20px;
  white-space: nowrap;
}
.route-node__final :deep(.el-form-item__content) {
  flex-wrap: nowrap;
  gap: 8px;
}
.route-node__final :deep(.el-radio-group) {
  flex-wrap: nowrap;
}
.route-node__final :deep(.el-select) {
  width: 180px;
}
.route-node__extra {
  border-top: 1px solid var(--line);
  margin: 0 -16px;
  padding: 10px 16px;
}
.route-node__extra summary {
  cursor: pointer;
  color: var(--primary);
  font-size: 13px;
}
.route-node__extra summary span {
  margin-left: 12px;
}
.route-node__extra :deep(.schedule-sources) {
  margin-top: 12px;
}
.task-form__notes {
  margin-top: 18px;
}
@media (max-width: 940px) {
  .route-node__fields {
    grid-template-columns: minmax(140px, 1fr) minmax(230px, 1.5fr) minmax(144px, 1fr);
    grid-template-areas: 'team date basis' 'quantity weight .';
  }
  .route-node__team {
    grid-area: team;
  }
  .route-node__date {
    grid-area: date;
  }
  .route-node__basis {
    grid-area: basis;
  }
  .route-node__quantity {
    grid-area: quantity;
    max-width: 110px;
  }
  .route-node__weight {
    grid-area: weight;
    max-width: 138px;
  }
}
</style>
