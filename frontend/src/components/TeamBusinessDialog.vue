<script setup lang="ts">
import StatePanel from './StatePanel.vue'
import { equipmentTeamCodes } from '@/config/processingParameters'
import { AppMessageBox as ElMessageBox } from '@/utils/messageBox'
import ElAlert from '@/components/AppAlert.vue'
import ElInput from '@/components/AppInput.vue'
import ElSelect from '@/components/AppSelect.vue'
import ElSwitch from '@/components/AppSwitch.vue'
import ElTabs from '@/components/AppTabs.vue'
import WorkspaceDataToolbar from './WorkspaceDataToolbar.vue'
import WorkspacePagination from './WorkspacePagination.vue'
import WorkspaceTable from './WorkspaceTable.vue'
import FormWorkspace from './FormWorkspace.vue'
import CompactFormSection from './CompactFormSection.vue'
import AccountAvatar from './AccountAvatar.vue'
import AppDialog from '@/components/AppDialog.vue'
import WeightInput from './WeightInput.vue'
import { focusFirstInvalidField, useDialogValidation } from '@/composables/useDialogValidation'
import OpeningMaterialFields from './OpeningMaterialFields.vue'
import SludgeWeightFields from './SludgeWeightFields.vue'
import { sludgePayload, sludgeWeight } from '@/utils/sludgeWeight'
import { computed, defineComponent, h, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { ElForm, ElOption, ElTableColumn, ElTabPane, ElTag } from 'element-plus'
import { IconPlus } from '@tabler/icons-vue'
import { RouterLink } from 'vue-router'
import ElInputNumber from '@/components/AppNumberInput.vue'
import ElButton from '@/components/AppButton.vue'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import { useAuthStore } from '@/stores/auth'
import {
  isWeightOnlyType,
  isScrapType,
  materialTypeOptions,
  type MaterialTransfer,
} from '@/types/materialTransfer'
import type {
  OpeningLine,
  OpeningState,
  TeamDirectoryItem,
  TeamEmployee,
  TeamPurpose,
  TeamProcessingTask,
} from '@/types/teamBusiness'
import { createMaterialSubmissionKey } from '@/utils/materialStock'
import { showToast } from '@/stores/toast'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    inline?: boolean
    teamId: number
    initialTab?: string
    businessOnly?: boolean
    employeesOnly?: boolean
    teamName?: string
    teamCode?: string
    processingTasks?: boolean
    inspectionProblems?: boolean
  }>(),
  { processingTasks: true },
)
const emit = defineEmits<{
  'update:modelValue': [boolean]
  changed: []
  stocked: [MaterialTransfer[]]
}>()
// Reuse the same settings form in the team page and existing business-picker dialogs.
const SettingsPage = defineComponent({
  inheritAttrs: false,
  setup(_, { slots }) {
    return () =>
      h('section', { class: 'team-settings-page' }, [
        h('div', { class: 'team-settings-page__content' }, slots.default?.()),
        h('footer', { class: 'team-settings-page__footer' }, slots.footer?.()),
      ])
  },
})
const auth = useAuthStore()
const tab = ref('purposes'),
  loading = ref(false),
  saving = ref(false),
  error = ref('')
const employees = ref<TeamEmployee[]>([])
const editingEmployees = computed(() => tab.value === 'employees')
const tasks = ref<TeamProcessingTask[]>([])
const editingTasks = computed(() => tab.value === 'tasks')
const equipment = ref<TeamDirectoryItem[]>([])
const editingEquipment = computed(() => tab.value === 'equipment')
const hasEquipment = computed(
  () => equipmentTeamCodes.includes(props.teamCode || '') && !props.employeesOnly,
)
const problems = ref<TeamDirectoryItem[]>([])
const editingProblems = computed(() => tab.value === 'problems')
const canManage = computed(
  () =>
    auth.currentUser?.active !== false &&
    (auth.isAdmin || Number(auth.currentUser?.team_id) === props.teamId),
)
const canManageProblems = computed(() => props.inspectionProblems && canManage.value)
const canManageDirectory = computed(
  () => canManage.value && (!editingProblems.value || canManageProblems.value),
)
const purposes = ref<TeamPurpose[]>([])
const warehouse = computed(() => props.teamCode === 'FACTORY-WAREHOUSE')
const directory = computed(() =>
  editingEquipment.value
    ? equipment
    : editingProblems.value
      ? problems
      : editingTasks.value
        ? tasks
        : editingEmployees.value
          ? employees
          : purposes,
)
const itemLabel = computed(() =>
  editingEquipment.value
    ? '设备'
    : editingProblems.value
      ? '问题'
      : editingTasks.value
        ? '任务'
        : editingEmployees.value
          ? '员工'
          : '任务',
)
const directoryTabs = computed(() =>
  [
    { name: 'employees', label: '人员管理', visible: true },
    {
      name: 'tasks',
      label: '加工任务设置',
      visible: props.processingTasks && canManage.value && !props.employeesOnly,
    },
    { name: 'equipment', label: '设备管理', visible: hasEquipment.value && canManage.value },
    { name: 'problems', label: '检验问题', visible: canManageProblems.value },
    { name: 'purposes', label: '接收任务', visible: tab.value === 'purposes' },
  ].filter((pane) => pane.visible),
)
const directoryQuery = ref('')
const directoryStatus = ref('')
const directoryPage = ref(1)
const directoryPageSize = ref(10)
const paginateDirectory = computed(() => tab.value !== 'opening' && !editingProblems.value)
const fillDirectory = computed(() => props.inline && paginateDirectory.value)
const adding = ref(false)
const newName = ref('')
const opening = ref<OpeningState | null>(null)
const drafts = reactive(new Map<string, Pick<TeamDirectoryItem, 'name' | 'active' | 'version'>>())
const draftKey = (id: number) => `${tab.value}:${id}`
const filteredDirectoryItems = computed(() => {
  const query = directoryQuery.value.trim().toLowerCase()
  return directory.value.value.filter(
    (item) =>
      item.name.toLowerCase().includes(query) &&
      (!directoryStatus.value || item.active === (directoryStatus.value === 'active')),
  )
})
const directoryRows = computed(() => {
  const items = filteredDirectoryItems.value
  const start = (directoryPage.value - 1) * directoryPageSize.value
  const rows = paginateDirectory.value ? items.slice(start, start + directoryPageSize.value) : items
  return rows.map((item) => ({ ...item, draft: drafts.get(draftKey(item.id)) }))
})
const lines = ref<OpeningLine[]>([])
const invalidSpecifications = reactive(new Set<OpeningLine>())
const invalidPurpose = ref<number | 'new' | null>(null)
const directoryPanel = ref<HTMLElement | null>(null)
const validation = useDialogValidation(() => {
  const issues: Record<string, string> = {}
  lines.value.forEach((line, index) => {
    const add = (field: string, message: string) => {
      issues[`${index}.${field}`] = message
    }
    if (line.stock_type === 'order') {
      if (!line.serial_no.trim() || line.serial_no.trim().length > 80)
        add('serial_no', '请输入有效流水号')
      if (!line.production_schedule_id) add('production_schedule_id', '请选择排期批次')
      if (line.process_step_index == null) add('process_step_index', '请选择当前工序')
    }
    if (!line.material_name.trim()) add('material_name', '请输入材质')
    if (!line.material_type) add('material_type', '请选择物料类型')
    if (invalidSpecifications.has(line)) add('transfer_specification', '请填完整规格尺寸')
    if (!Number.isInteger(enteredQuantity(line)) || Number(enteredQuantity(line)) < 0)
      add('quantity', '请填写有效非负整数')
    if (
      line.material_type === 'sludge' &&
      !sludgeWeight(line.sludge_gross_weight, line.sludge_content_percent)
    ) {
      if (!sludgeWeight(line.sludge_gross_weight, 100)) add('gross', '请填写有效废泥实重')
      if (!sludgeWeight(1, line.sludge_content_percent)) add('percent', '请填写有效材料占比')
      if (!issues[`${index}.gross`] && !issues[`${index}.percent`])
        add('gross', '折算重量须达到 0.000001 kg')
    } else if (line.weight == null || !Number.isFinite(line.weight) || line.weight < 0)
      add('weight', '请填写有效非负重量')
    else if (!enteredQuantity(line) && !line.weight) {
      add('quantity', '件数和重量至少一项大于 0')
      add('weight', '件数和重量至少一项大于 0')
    }
  })
  return issues
})
const { formRef, fieldErrors } = validation
function lineError(index: number, field: string) {
  return fieldErrors.value[`${index}.${field}`]
}
let epoch = 0
const submission = createMaterialSubmissionKey()
const key = () => `heatsink.opening-draft.v1:${auth.currentUser?.id}:${props.teamId}`
function enteredQuantity(line: OpeningLine) {
  return isWeightOnlyType(line.material_type) ? 0 : line.quantity
}
function blank(): OpeningLine {
  return {
    stock_type: 'order',
    serial_no: '',
    material_name: '',
    material_type: '',
    transfer_specification: '',
    quantity: undefined,
    weight: undefined,
    notes: '',
  }
}
function close() {
  if (!saving.value) emit('update:modelValue', false)
}
async function load() {
  const current = ++epoch
  loading.value = true
  error.value = ''
  try {
    const [options, state, staff, taskOptions, problemOptions, equipmentOptions] =
      await Promise.all([
        props.employeesOnly || !props.processingTasks
          ? Promise.resolve([])
          : teamMaterialApi.purposes(props.teamId),
        props.businessOnly ? Promise.resolve(null) : teamMaterialApi.openingState(props.teamId),
        teamMaterialApi.employees(props.teamId),
        !props.processingTasks || !canManage.value
          ? Promise.resolve([])
          : teamMaterialApi.processingTasks(props.teamId),
        canManageProblems.value
          ? teamMaterialApi.inspectionProblems(props.teamId)
          : Promise.resolve([]),
        hasEquipment.value && canManage.value
          ? teamMaterialApi.equipment(props.teamId)
          : Promise.resolve([]),
      ])
    if (current !== epoch) return
    purposes.value = options
    employees.value = staff
    tasks.value = taskOptions
    problems.value = problemOptions
    equipment.value = equipmentOptions
    opening.value = state
  } catch (e) {
    if (current === epoch) error.value = e instanceof Error ? e.message : '班组管理加载失败'
  } finally {
    if (current === epoch) loading.value = false
  }
}
watch(
  () => [props.modelValue, props.teamId, props.teamCode],
  () => {
    ++epoch
    if (!props.modelValue) return
    validation.reset()
    invalidPurpose.value = null
    tab.value =
      props.businessOnly && props.initialTab === 'opening'
        ? 'purposes'
        : props.initialTab || 'purposes'
    if (tab.value === 'purposes' && props.processingTasks && canManage.value) tab.value = 'tasks'
    if (tab.value === 'problems' && !canManageProblems.value) tab.value = 'purposes'
    if (!props.processingTasks && ['purposes', 'tasks'].includes(tab.value)) tab.value = 'employees'
    if (props.employeesOnly || (tab.value === 'equipment' && !hasEquipment.value))
      tab.value = 'employees'
    drafts.clear()
    directoryPage.value = 1
    directoryPageSize.value = 10
    adding.value = false
    newName.value = ''
    submission.reset()
    opening.value = null
    invalidSpecifications.clear()
    lines.value = [blank()]
    try {
      const draft = JSON.parse(localStorage.getItem(key()) || 'null')
      if (
        Array.isArray(draft) &&
        draft.length &&
        draft.length <= 100 &&
        draft.every(
          (line) =>
            line && typeof line.serial_no === 'string' && typeof line.material_name === 'string',
        )
      )
        lines.value = draft.map((line) => ({
          ...blank(),
          ...line,
          stock_type: line.stock_type ?? (isScrapType(line.material_type) ? 'non_order' : 'order'),
        }))
    } catch {
      /* A missing/unreadable optional draft never changes server stock. */
    }
    void load()
  },
  { immediate: true },
)
watch(
  () => `${auth.currentUser?.id}:${auth.currentUser?.team_id}`,
  () => {
    ++epoch
    emit('update:modelValue', false)
  },
)
onBeforeUnmount(() => {
  ++epoch
})
watch([tab, directoryQuery, directoryStatus, directoryPageSize], () => {
  directoryPage.value = 1
})
watch(
  () => filteredDirectoryItems.value.length,
  (total) => {
    directoryPage.value = Math.min(
      directoryPage.value,
      Math.max(1, Math.ceil(total / directoryPageSize.value)),
    )
  },
)
watch(tab, () => {
  directoryQuery.value = ''
  directoryStatus.value = ''
  adding.value = false
  newName.value = ''
  invalidPurpose.value = null
})
function saveDraft() {
  try {
    localStorage.setItem(key(), JSON.stringify(lines.value))
    showToast('草稿已保存在本机，尚未计入库存', 'success')
  } catch {
    error.value = '无法保存本机草稿，请检查浏览器存储权限'
  }
}
function editDirectoryItem(id: number) {
  const item = directory.value.value.find((row) => row.id === id)
  if (item)
    drafts.set(draftKey(id), { name: item.name, active: item.active, version: item.version })
}
function cancelDirectoryEdit(id: number) {
  drafts.delete(draftKey(id))
  if (invalidPurpose.value === id) invalidPurpose.value = null
}
async function startAdding() {
  adding.value = true
  await nextTick()
  directoryPanel.value?.querySelector<HTMLInputElement>('.directory-add input')?.focus()
}
function cancelAdding() {
  adding.value = false
  newName.value = ''
  if (invalidPurpose.value === 'new') invalidPurpose.value = null
}
async function saveDirectoryItem(id?: number) {
  if (saving.value || loading.value || !canManageDirectory.value) return
  const edit = id === undefined ? undefined : drafts.get(draftKey(id))
  if (id !== undefined && !edit) return
  const name = (edit?.name ?? newName.value).trim()
  if (!name) {
    invalidPurpose.value = id ?? 'new'
    await nextTick()
    focusFirstInvalidField(directoryPanel.value ?? undefined)
    return
  }
  const current = epoch
  saving.value = true
  error.value = ''
  try {
    const saved = await (
      editingEquipment.value
        ? teamMaterialApi.saveEquipment
        : editingProblems.value
          ? teamMaterialApi.saveInspectionProblem
          : editingTasks.value
            ? teamMaterialApi.saveProcessingTask
            : editingEmployees.value
              ? teamMaterialApi.saveEmployee
              : teamMaterialApi.savePurpose
    )(
      props.teamId,
      { name, active: edit?.active ?? true, ...(edit ? { expected_version: edit.version } : {}) },
      id,
    )
    if (current !== epoch) return
    const items = directory.value
    if (id !== undefined) {
      items.value = items.value.map((row) => (row.id === id ? saved : row))
      cancelDirectoryEdit(id)
    } else {
      items.value = [saved, ...items.value]
      cancelAdding()
      directoryQuery.value = ''
      directoryStatus.value = ''
      directoryPage.value = 1
    }
    emit('changed')
    showToast(id !== undefined ? '修改已保存' : `已新增${itemLabel.value}`, 'success')
  } catch (e) {
    if (current === epoch) error.value = e instanceof Error ? e.message : '保存失败'
  } finally {
    saving.value = false
  }
}
async function submitOpening() {
  if (saving.value || loading.value || !opening.value?.can_submit) return
  error.value = ''
  if (!validation.validate()) return
  const body = lines.value.map((line) => ({
    ...line,
    quantity: enteredQuantity(line),
    ...sludgePayload(line.material_type, line.sludge_gross_weight, line.sludge_content_percent),
    purpose_id: null,
    serial_no: line.stock_type === 'non_order' ? '' : line.serial_no.trim(),
    material_name: line.material_name.trim(),
  }))
  const current = epoch
  try {
    await ElMessageBox.confirm(
      `将这 ${body.length} 行物料累加到本班组库存，每行生成独立批次。`,
      '确认初始库存登记',
      { confirmButtonText: '确认登记', cancelButtonText: '返回核对', type: 'warning' },
    )
  } catch {
    return
  }
  if (current !== epoch || !props.modelValue || saving.value) return
  const requestKey = submission.get(body)
  saving.value = true
  try {
    const rows = await teamMaterialApi.createOpening(props.teamId, body, requestKey)
    if (current !== epoch) return
    try {
      localStorage.removeItem(key())
    } catch {
      /* The committed receipt remains authoritative. */
    }
    submission.reset()
    lines.value = [blank()]
    emit('update:modelValue', false)
    emit('stocked', rows)
    showToast('库存已登记', 'success')
  } catch (e) {
    if (current === epoch) error.value = e instanceof Error ? e.message : '登记失败，草稿已保留'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <component
    :is="inline ? SettingsPage : AppDialog"
    :model-value="modelValue"
    :title="teamName ? `${teamName} · 班组管理` : '班组管理'"
    top="16px"
    :width="businessOnly ? 'min(760px, 94vw)' : 'min(1180px, 96vw)'"
    :close-on-click-modal="!saving"
    :close-on-press-escape="!saving"
    :show-close="!saving"
    @close="close"
  >
    <div
      ref="directoryPanel"
      class="team-settings-tabs"
      :class="{ 'team-settings-tabs--paginated': fillDirectory }"
    >
      <ElTabs v-model="tab">
        <ElTabPane
          v-for="pane in directoryTabs"
          :key="pane.name"
          :name="pane.name"
          :label="pane.label"
          :disabled="saving"
        >
          <section v-if="tab === pane.name" class="directory-settings">
            <WorkspaceDataToolbar
              v-model="directoryQuery"
              :search-label="'搜索' + itemLabel"
              :placeholder="editingEmployees ? '搜索姓名' : '搜索' + itemLabel + '名称'"
              :loading="loading"
              :refresh="false"
            >
              <template #filters>
                <ElSelect
                  v-model="directoryStatus"
                  class="directory-status-filter"
                  aria-label="状态筛选"
                  placeholder="全部状态"
                >
                  <ElOption value="" label="全部状态" />
                  <ElOption value="active" label="启用" />
                  <ElOption value="inactive" label="停用" />
                </ElSelect>
              </template>
              <template #primary-actions>
                <ElButton
                  v-if="canManageDirectory"
                  :disabled="loading || saving || adding"
                  @click="startAdding"
                >
                  <IconPlus :size="17" />新增{{ itemLabel }}
                </ElButton>
              </template>
            </WorkspaceDataToolbar>
            <p v-if="editingEquipment" class="settings-note">
              加工时选择本班组启用的设备；改名、停用不改变历史记录。
            </p>
            <p v-else-if="editingProblems" class="settings-note">
              检验及复检发现不合格时，从这份清单选择问题，可多选。停用后不可再选；改名不改变历史记录。
            </p>
            <p v-else-if="editingTasks" class="settings-note">
              转料和加工使用同一份任务清单。改名、停用不改变历史记录。
            </p>
            <p v-else-if="!editingEmployees" class="settings-note">设置本班组接收物料时的任务。</p>
            <ElAlert v-if="error" :title="error" type="error" :closable="false" />
            <form v-if="adding" class="directory-add" @submit.prevent="saveDirectoryItem()">
              <ElInput
                v-model="newName"
                :class="{ 'is-error': invalidPurpose === 'new' && !newName.trim() }"
                :aria-label="'新增' + itemLabel + '名称'"
                :placeholder="editingEmployees ? '请输入员工姓名' : '请输入' + itemLabel + '名称'"
                maxlength="80"
                :disabled="saving"
              />
              <ElButton :disabled="saving" @click="cancelAdding">取消</ElButton>
              <ElButton type="primary" native-type="submit" :disabled="saving">保存新增</ElButton>
            </form>
            <WorkspaceTable
              :key="directoryPage"
              :data="directoryRows"
              :loading="loading"
              row-key="id"
              :height="fillDirectory ? '100%' : undefined"
              :fill="fillDirectory"
              :embedded="false"
              :column-settings="false"
              :aria-label="pane.label"
            >
              <ElTableColumn
                :label="editingEmployees ? '姓名' : itemLabel + '名称'"
                min-width="190"
                align="center"
              >
                <template #default="{ row }">
                  <ElInput
                    v-if="row.draft"
                    v-model="row.draft.name"
                    class="directory-name-input"
                    :class="{ 'is-error': invalidPurpose === row.id && !row.draft.name.trim() }"
                    :aria-label="itemLabel + '名称 ' + row.id"
                    maxlength="80"
                    :disabled="saving"
                    @keyup.enter="saveDirectoryItem(row.id)"
                  />
                  <span v-else class="directory-name">
                    <AccountAvatar v-if="editingEmployees" :name="row.name" :size="24" />
                    {{ row.name }}
                  </span>
                </template>
              </ElTableColumn>
              <ElTableColumn label="状态" min-width="112" align="center">
                <template #default="{ row }">
                  <span v-if="row.draft" class="directory-status-control">
                    <ElSwitch
                      v-model="row.draft.active"
                      :aria-label="row.name + '启用状态'"
                      :disabled="saving"
                    />
                    {{ row.draft.active ? '启用' : '停用' }}
                  </span>
                  <ElTag v-else :type="row.active ? 'success' : 'info'" effect="plain">
                    {{ row.active ? '启用' : '停用' }}
                  </ElTag>
                </template>
              </ElTableColumn>
              <ElTableColumn v-if="canManageDirectory" label="操作" min-width="136" align="center">
                <template #default="{ row }">
                  <template v-if="row.draft">
                    <ElButton link :disabled="saving" @click="cancelDirectoryEdit(row.id)">
                      取消
                    </ElButton>
                    <ElButton
                      link
                      type="primary"
                      :aria-label="'保存 ' + row.name"
                      :disabled="saving"
                      @click="saveDirectoryItem(row.id)"
                      >保存</ElButton
                    >
                  </template>
                  <ElButton
                    v-else
                    link
                    type="primary"
                    :aria-label="'编辑 ' + row.name"
                    :disabled="saving"
                    @click="editDirectoryItem(row.id)"
                    >编辑</ElButton
                  >
                </template>
              </ElTableColumn>
              <template #empty>
                <StatePanel v-if="loading" state="loading" title="正在读取班组管理" compact />
                <template v-else>
                  {{ directoryQuery || directoryStatus ? '没有匹配记录' : '暂无' + itemLabel }}
                </template>
              </template>
            </WorkspaceTable>
            <WorkspacePagination
              v-if="paginateDirectory && !loading"
              v-model:current-page="directoryPage"
              v-model:page-size="directoryPageSize"
              :total="filteredDirectoryItems.length"
              :disabled="saving"
            />
            <ElAlert
              v-if="tab === 'purposes' && purposes.length && !purposes.some((item) => item.active)"
              title="任务全部停用后，上序无法新建转给本班组的转料单。"
              type="info"
              :closable="false"
            />
            <p v-if="tab === 'purposes' && !purposes.length" class="settings-note">
              尚未配置时，新单暂归“未分类”；配置后，上序新开单必须选择启用的任务。
            </p>
          </section>
        </ElTabPane>
        <ElTabPane v-if="!businessOnly" name="opening" label="初始库存" :disabled="saving">
          <FormWorkspace v-if="tab === 'opening'">
            <ElAlert v-if="error" :title="error" type="error" :closable="false" />
            <StatePanel v-if="loading" state="loading" title="正在读取初始库存" compact />
            <section v-else class="opening-settings">
              <ElAlert
                v-if="!opening?.enabled && !auth.isAdmin"
                title="请联系系统管理员，在「系统设置 → 班组管理」找到本班组，再点击「初始库存录入」授权。"
                type="info"
                :closable="false"
              />
              <p v-else-if="opening && !opening.enabled && auth.isAdmin" class="settings-note">
                给班组授权时，请前往
                <RouterLink to="/settings/teams">系统设置 → 班组管理</RouterLink>
                ，在本班组所在行点击「初始库存录入」。
              </p>
              <template v-if="opening?.can_submit">
                <ElForm
                  ref="formRef"
                  label-position="top"
                  :show-message="false"
                  class="opening-lines dialog-form-compact"
                  @submit.prevent="submitOpening"
                >
                  <CompactFormSection
                    v-for="(line, index) in lines"
                    :key="index"
                    class="opening-line opening-fields"
                    :title="`物料 ${index + 1}`"
                  >
                    <template #actions
                      ><ElButton
                        v-if="lines.length > 1"
                        text
                        type="danger"
                        :disabled="saving"
                        @click="lines.splice(index, 1)"
                        >移除</ElButton
                      >
                    </template>
                    <OpeningMaterialFields
                      :line="line"
                      :team-id="teamId"
                      :warehouse="warehouse"
                      :index="index"
                      :errors="fieldErrors"
                      :disabled="saving || !modelValue"
                      @update="Object.assign(line, $event)"
                      @validity-change="
                        $event
                          ? invalidSpecifications.delete(line)
                          : invalidSpecifications.add(line)
                      "
                    >
                      <div
                        class="dialog-field"
                        :class="{ 'is-error': lineError(index, 'material_type') }"
                      >
                        <span class="dialog-field-label is-required">物料类型</span
                        ><ElSelect
                          v-model="line.material_type"
                          placeholder="选择物料类型"
                          :aria-label="`第${index + 1}行物料类型`"
                          :disabled="saving"
                          ><ElOption
                            v-for="option in materialTypeOptions.filter(({ value }) =>
                              line.stock_type === 'order'
                                ? !isScrapType(value)
                                : isScrapType(value) || (warehouse && value === 'raw_material'),
                            )"
                            :key="option.value"
                            :value="option.value"
                            :label="option.label"
                        /></ElSelect>
                      </div>
                      <div
                        v-if="!isWeightOnlyType(line.material_type)"
                        class="dialog-field"
                        :class="{ 'is-error': lineError(index, 'quantity') }"
                      >
                        <span class="dialog-field-label is-required">件数</span
                        ><ElInputNumber
                          v-model="line.quantity"
                          :aria-label="`第${index + 1}行件数`"
                          :min="0"
                          :precision="0"
                          :disabled="saving"
                          controls-position="right"
                          ><template #suffix
                            ><span class="dialog-input-unit">件</span></template
                          ></ElInputNumber
                        >
                      </div>
                      <div
                        class="dialog-field"
                        v-if="line.material_type !== 'sludge'"
                        :class="{ 'is-error': lineError(index, 'weight') }"
                      >
                        <span class="dialog-field-label is-required">重量</span
                        ><WeightInput
                          v-model="line.weight"
                          :ariaLabel="`第${index + 1}行重量`"
                          :disabled="saving"
                        />
                      </div>
                      <SludgeWeightFields
                        class="form-field--full"
                        v-else
                        v-model:gross="line.sludge_gross_weight"
                        v-model:percent="line.sludge_content_percent"
                        :label="`第${index + 1}行`"
                        :gross-error="lineError(index, 'gross')"
                        :percent-error="lineError(index, 'percent')"
                        :disabled="saving"
                        @update:weight="line.weight = $event"
                      />
                    </OpeningMaterialFields>
                    <div class="dialog-field form-field--full">
                      <span class="dialog-field-label">备注</span
                      ><ElInput
                        v-model="line.notes"
                        aria-label="初始库存备注"
                        maxlength="2000"
                        type="textarea"
                        :rows="2"
                        :disabled="saving"
                        placeholder="选填"
                      />
                    </div>
                  </CompactFormSection>
                </ElForm>
              </template>
              <p v-if="opening?.completed" class="settings-note">
                共 {{ opening.items.length }} 个初始库存批次，可在库存明细和收发历史中查看。
              </p>
            </section>
          </FormWorkspace>
        </ElTabPane>
      </ElTabs>
    </div>
    <template #footer>
      <ElButton v-if="!inline" :disabled="saving" @click="close">关闭</ElButton>
      <template v-if="!businessOnly && tab === 'opening' && opening?.can_submit && !loading">
        <ElButton :disabled="saving || lines.length >= 100" @click="lines.push(blank())"
          >增加物料</ElButton
        >
        <ElButton :disabled="saving" @click="saveDraft">保存本机草稿</ElButton>
        <ElButton type="primary" :loading="saving" @click="submitOpening"
          >确认初始库存登记</ElButton
        >
      </template>
    </template>
  </component>
</template>

<style scoped>
.team-settings-page {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  padding: 0 20px;
}
:deep(.team-settings-page__content) {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
:deep(.team-settings-page__footer) {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
:deep(.team-settings-page__footer:has(button)) {
  padding-block: 12px;
  border-top: 1px solid var(--line);
}

.settings-note {
  color: var(--muted);
  font-size: 13px;
  line-height: 1.6;
}
.settings-note a {
  color: var(--primary);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.team-settings-tabs {
  padding-block: 12px;
}
.directory-settings {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
}
.team-settings-tabs--paginated {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.team-settings-tabs--paginated > :deep(.el-tabs),
.team-settings-tabs--paginated :deep(.el-tabs__content),
.team-settings-tabs--paginated :deep(.el-tab-pane:not([aria-hidden='true'])),
.team-settings-tabs--paginated .directory-settings {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}
.team-settings-tabs--paginated :deep(.el-tabs__header),
.team-settings-tabs--paginated .directory-settings > :not(.el-table) {
  flex-shrink: 0;
}
.directory-status-filter {
  width: 128px;
}
.directory-add {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.directory-add :deep(.el-input) {
  flex: 0 1 280px;
}
.directory-name,
.directory-status-control {
  display: inline-flex;
  align-items: center;
  vertical-align: middle;
  gap: 8px;
}
.directory-name-input {
  max-width: 280px;
}
.opening-lines {
  display: grid;
  gap: 12px;
}
.opening-line {
  min-width: 0;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 10px 12px;
}
.opening-fields :deep(.opening-specification-field) {
  grid-column: 1 / -1;
}
</style>
