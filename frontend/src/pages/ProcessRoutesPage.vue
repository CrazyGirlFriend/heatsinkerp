<script setup lang="ts">
import PersonName from '@/components/PersonName.vue'
import WorkspaceDataPanel from '@/components/WorkspaceDataPanel.vue'
import WorkspaceTable from '@/components/WorkspaceTable.vue'
import WorkspacePagination from '@/components/WorkspacePagination.vue'
import WorkspaceDataToolbar from '@/components/WorkspaceDataToolbar.vue'
import { computed, onBeforeUnmount, onMounted, ref, watch, nextTick } from 'vue'
import { ArrowDown, Plus } from '@element-plus/icons-vue'
import { ElAlert, ElButton, ElIcon, ElLoading, ElPopover, ElTag, ElTableColumn } from 'element-plus'
import { useRoute, useRouter } from 'vue-router'
import { businessNoticeApi, parseNotice } from '@/services/businessNoticeApi'
import { focusNoticeTarget, noticeOpened, noticeFailed } from '@/utils/noticeFocus'
import { useLiveRefresh } from '@/composables/useLiveRefresh'
import TeamWorkspaceShell from '@/components/TeamWorkspaceShell.vue'
import TeamBusinessDialog from '@/components/TeamBusinessDialog.vue'
import ProcessRouteEditor from '@/components/ProcessRouteEditor.vue'
import DocumentViewer from '@/components/DocumentViewer.vue'
import FactoryNavIcon from '@/components/FactoryNavIcon.vue'
import { useAuthStore } from '@/stores/auth'
import { useTeamDirectoryStore } from '@/stores/teamDirectory'
import { processRouteApi } from '@/services/processRouteApi'
import type { ProcessRoute, ProcessRouteDrawing, ProcessRouteStep } from '@/types/processRoute'
import { formatDateTime } from '@/utils/format'
const location = useRoute()
const router = useRouter()
const noticeSection = ref('')
const noticeStep = ref(0)
let stopNoticeFocus: (() => void) | undefined
const vLoading = ElLoading.directive
const auth = useAuthStore(),
  directory = useTeamDirectoryStore()
const team = computed(() =>
  directory.items.find(
    (item) => item.active && item.code === 'FACTORY-PROCESS' && item.kind === 'engineering',
  ),
)
const canEdit = computed(
  () =>
    !auth.currentUserError &&
    auth.currentUser?.active !== false &&
    (auth.isAdmin ||
      (auth.isTeamAccount && String(auth.currentUser?.team_id) === String(team.value?.id))),
)
const routeKind = ref<'normal' | 'rework'>(location.query.kind === 'rework' ? 'rework' : 'normal')
const newMenuOpen = ref(false),
  pendingOnly = ref(false)
function clearPending() {
  pendingOnly.value = false
  void load()
}
function createRework() {
  newMenuOpen.value = false
  routeKind.value = 'rework'
  void router.replace({ query: { ...location.query, kind: 'rework' } })
  pendingOnly.value = true
  page.value = 1
  query.value = appliedQuery.value = ''
  void load()
}
function changeKind(kind: 'normal' | 'rework') {
  if (kind === routeKind.value) return
  pendingOnly.value = false
  routeKind.value = kind
  if ((location.query.kind === 'rework' ? 'rework' : 'normal') !== kind)
    void router.replace({
      query: { ...location.query, kind: kind === 'rework' ? kind : undefined },
    })
  query.value = ''
  appliedQuery.value = ''
  items.value = []
  total.value = 0
  page.value = 1
  void load()
}
const items = ref<ProcessRoute[]>([]),
  total = ref(0),
  pendingRework = ref(0),
  page = ref(1),
  pageSize = ref(20),
  sortOrder = ref<'asc' | 'desc'>('desc'),
  query = ref(''),
  appliedQuery = ref(''),
  loading = ref(false),
  error = ref(''),
  selected = ref<ProcessRoute | null>(null),
  editing = ref(false),
  creating = ref(false),
  settingsOpen = ref(false)
function create() {
  if (!canEdit.value) return
  newMenuOpen.value = false
  creating.value = true
}
function closeEditor() {
  stopNoticeFocus?.()
  noticeSection.value = ''
  ++detailGeneration
  selected.value = null
  editing.value = false
  creating.value = false
}
let generation = 0
let detailGeneration = 0
watch(
  [page, pageSize],
  () => {
    ++generation
    items.value = []
  },
  { flush: 'sync' },
)
async function load() {
  const request = ++generation
  loading.value = true
  error.value = ''
  try {
    const result = await processRouteApi.list(
      appliedQuery.value,
      page.value,
      pendingOnly.value ? 'draft' : undefined,
      sortOrder.value,
      pageSize.value,
      routeKind.value,
    )
    if (request !== generation) return
    items.value = result.items
    stepDetails.value = {}
    total.value = result.total
    pendingRework.value = result.pending_rework_count ?? 0
  } catch (e) {
    if (request === generation) error.value = e instanceof Error ? e.message : '工艺读取失败'
  } finally {
    if (request === generation) loading.value = false
  }
}
function search() {
  appliedQuery.value = query.value.trim()
  page.value = 1
  void load()
}
function sortChanged(sort: { prop: string | null; order: 'ascending' | 'descending' | null }) {
  if (sort.prop !== 'updated_at') return
  sortOrder.value = sort.order === 'ascending' ? 'asc' : 'desc'
  page.value = 1
  void load()
}
function pageChanged(current: number) {
  if (current === page.value) return
  page.value = current
  void load()
}
function pageSizeChanged(size: number) {
  if (size === pageSize.value) return
  page.value = 1
  pageSize.value = size
  void load()
}
function routeSteps(value: unknown) {
  const row = value as ProcessRoute
  return row.step_summary ?? row.steps ?? []
}
function routePath(row: unknown) {
  return routeSteps(row)
    .map((step) => step.name)
    .join(' → ')
}
const teamIcons = {
  'FACTORY-WAREHOUSE': 'warehouse',
  'FACTORY-ROLL': 'rolling',
  'FACTORY-ANNEAL': 'annealing',
  'FACTORY-GRIND': 'grinding',
  'FACTORY-WIRE': 'cutting',
  'FACTORY-ENGRAVE': 'engraving',
  'FACTORY-PLATE': 'plating',
  'FACTORY-QC': 'inspection',
} as const
function stepIcon(step: Pick<ProcessRouteStep, 'name' | 'team_id'>) {
  const aliases: Record<string, string> = { 中转库: '库房', 轧板: '轧制', 质检: '检验' }
  const team = step.team_id
    ? directory.items.find((item) => Number(item.id) === step.team_id)
    : directory.items.find((item) => item.name === (aliases[step.name] || step.name))
  const code = team?.code
  return code && code in teamIcons ? teamIcons[code as keyof typeof teamIcons] : 'flow'
}
const routeMedia = window.matchMedia?.('(max-width: 1100px)')
const visibleStepCount = ref(routeMedia?.matches ? 4 : 6)
function resizeRouteSummary() {
  visibleStepCount.value = routeMedia?.matches ? 4 : 6
}
const stepDetails = ref<
  Record<number, { steps?: ProcessRouteStep[]; loading: boolean; error?: string }>
>({})
async function loadStepDetails(id: number) {
  if (stepDetails.value[id]?.loading || stepDetails.value[id]?.steps) return
  stepDetails.value[id] = { loading: true }
  const entry = stepDetails.value[id]!
  try {
    entry.steps = (await processRouteApi.detail(id)).steps
  } catch {
    entry.error = '工序信息读取失败'
  } finally {
    entry.loading = false
  }
}
const drawingMenu = ref<number | null>(null),
  drawingUrl = ref(''),
  drawingTitle = ref(''),
  drawingLoading = ref('')
let drawingController: AbortController | undefined
let drawingGeneration = 0
function closeDrawing() {
  ++drawingGeneration
  drawingController?.abort()
  if (drawingUrl.value) URL.revokeObjectURL(drawingUrl.value)
  drawingUrl.value = ''
  drawingLoading.value = ''
}
async function openDrawing(routeId: number, drawing: ProcessRouteDrawing) {
  closeDrawing()
  drawingMenu.value = null
  const request = drawingGeneration
  drawingController = new AbortController()
  drawingLoading.value = `${routeId}:${drawing.id}`
  error.value = ''
  try {
    const blob = await processRouteApi.drawing(routeId, drawing.id, drawingController.signal, true)
    if (request !== drawingGeneration) return
    drawingTitle.value = drawing.filename
    drawingUrl.value = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }))
  } catch {
    if (request === drawingGeneration) error.value = '图纸读取失败，请重试'
  } finally {
    if (request === drawingGeneration) drawingLoading.value = ''
  }
}
async function open(id: number, startEditing = false) {
  noticeSection.value = ''
  stopNoticeFocus?.()
  const request = ++detailGeneration
  error.value = ''
  try {
    const result = await processRouteApi.detail(id)
    if (request === detailGeneration) {
      editing.value = startEditing && canEdit.value
      selected.value = result
    }
  } catch (e) {
    if (request === detailGeneration) error.value = e instanceof Error ? e.message : '工艺读取失败'
  }
}
async function openReworkNotice() {
  const notice = parseNotice(location.query.business_notice)
  if (notice?.source !== 'rework') return
  const request = ++detailGeneration
  const key = String(location.query.notice || '')
  try {
    const target = await businessNoticeApi.target('rework', notice.id)
    if (request !== detailGeneration || key !== location.query.notice) return
    await directory.refreshTeamDirectory()
    if (request !== detailGeneration) return
    stopNoticeFocus?.()
    selected.value = null
    await nextTick()
    changeKind('rework')
    noticeSection.value = target.section || 'problem'
    noticeStep.value = target.step_index || 0
    editing.value = canEdit.value && target.route?.state === 'draft'
    selected.value = target.route || null
  } catch (e) {
    if (request === detailGeneration) noticeFailed(key, e)
  }
}
async function focusReworkNotice() {
  if (!noticeSection.value) return
  await nextTick()
  const selector =
    noticeSection.value === 'problem'
      ? '.route-rework-context'
      : `[data-notice-route-step="${noticeStep.value}"]`
  const element = document.querySelector<HTMLElement>(`.process-route-dialog ${selector}`)
  if (!element) return
  stopNoticeFocus?.()
  stopNoticeFocus = focusNoticeTarget(element)
  noticeOpened(String(location.query.notice || ''))
}
watch(() => [location.query.business_notice, location.query.notice], openReworkNotice, {
  immediate: true,
})
watch(
  () => location.query.kind,
  (kind) => changeKind(kind === 'rework' ? 'rework' : 'normal'),
)
useLiveRefresh(load, {
  teamId: () => (team.value ? Number(team.value.id) : undefined),
  busy: () => loading.value || !!selected.value || creating.value,
})
onMounted(() => {
  routeMedia?.addEventListener('change', resizeRouteSummary)
  void directory.refreshTeamDirectory()
  void load()
})
onBeforeUnmount(() => {
  routeMedia?.removeEventListener('change', resizeRouteSummary)
  stopNoticeFocus?.()
  closeDrawing()
  ++generation
  ++detailGeneration
})
</script>
<template>
  <TeamWorkspaceShell
    class="process-workspace"
    title="工艺"
    model-value="process-routes"
    engineering
    :settings="canEdit && !!team"
    @settings="settingsOpen = true"
  >
    <ElAlert v-if="error" :title="error" type="error" :closable="false" />
    <WorkspaceDataPanel class="workspace-data-panel">
      <WorkspaceDataToolbar
        v-model="query"
        :loading="loading"
        search-label="工艺记录搜索"
        :placeholder="
          routeKind === 'rework'
            ? '搜索流水号、批次号、问题、班组或工艺人员'
            : '搜索流水号、工艺人员'
        "
        refresh-label="刷新工艺记录"
        @search="search"
        @refresh="load"
      >
        <template #leading>
          <div class="route-kind-switch" role="group" aria-label="工艺类型">
            <button
              type="button"
              :aria-pressed="routeKind === 'normal'"
              @click="changeKind('normal')"
            >
              正常工艺
            </button>
            <button
              type="button"
              :aria-pressed="routeKind === 'rework'"
              @click="changeKind('rework')"
            >
              返工工艺
              <span
                v-if="canEdit && pendingRework"
                class="route-pending-count"
                :aria-label="`${pendingRework} 项待制定`"
                :title="`${pendingRework} 项待制定`"
                >{{ pendingRework }}</span
              >
            </button>
          </div>
        </template>
        <template #status>
          <ElTag v-if="pendingOnly" closable type="warning" @close="clearPending">待制定</ElTag>
          <ElButton
            v-else-if="routeKind === 'rework' && canEdit && pendingRework"
            class="route-pending-filter"
            @click="createRework"
            >仅看待制定</ElButton
          >
        </template>
        <template #primary-actions>
          <div v-if="canEdit" class="workspace-toolbar-actions">
            <ElPopover
              v-model:visible="newMenuOpen"
              trigger="click"
              width="170"
              placement="bottom-end"
            >
              <template #reference
                ><ElButton type="primary" :icon="Plus" :disabled="loading"
                  >新建工艺</ElButton
                ></template
              >
              <div class="new-route-options">
                <ElButton @click="create">正常工艺</ElButton
                ><ElButton @click="createRework">返工工艺</ElButton>
              </div>
            </ElPopover>
          </div></template
        >
      </WorkspaceDataToolbar>
      <WorkspaceTable
        :key="routeKind"
        v-loading="loading"
        :data="items"
        border
        row-key="id"
        class="team-table route-list"
        aria-label="工艺记录"
        :default-sort="{
          prop: 'updated_at',
          order: sortOrder === 'asc' ? 'ascending' : 'descending',
        }"
        @sort-change="sortChanged"
      >
        <ElTableColumn
          class-name="table-identity"
          label="流水号"
          :min-width="routeKind === 'rework' ? 205 : 190"
          :fixed="routeKind === 'rework' ? 'left' : false"
          align="left"
          ><template #default="{ row }"
            ><ElButton
              v-if="row.serial_nos[0]"
              class="route-serial"
              type="primary"
              link
              @click="open(row.id)"
              >{{ row.serial_nos[0] }}</ElButton
            ><span v-else class="route-empty">—</span>
            <ElTag
              v-if="row.missing_documents?.length"
              type="warning"
              size="small"
              class="route-document-warning"
              :title="`缺少：${row.missing_documents.join('、')}`"
              >待补资料</ElTag
            >
          </template></ElTableColumn
        >
        <template v-if="routeKind === 'normal'">
          <ElTableColumn label="材质" width="120">
            <template #default="{ row }">
              <span :class="{ 'route-empty': !row.material_name }">{{
                row.material_name || '—'
              }}</span>
            </template>
          </ElTableColumn>
          <ElTableColumn label="工序概要" min-width="300" :show-overflow-tooltip="false">
            <template #default="{ row }">
              <div
                v-if="routeSteps(row).length"
                class="route-step-summary"
                role="group"
                :aria-label="`${row.serial_nos[0]} 的 ${routeSteps(row).length} 道工序`"
                :aria-description="routePath(row)"
              >
                <template
                  v-for="(step, index) in routeSteps(row).slice(0, visibleStepCount)"
                  :key="index"
                >
                  <span v-if="index" class="route-path-connector" aria-hidden="true" />
                  <ElPopover
                    :trigger="['hover', 'focus']"
                    :show-after="180"
                    :hide-after="120"
                    placement="bottom-start"
                    :width="320"
                    @before-enter="loadStepDetails(row.id)"
                  >
                    <template #reference>
                      <button
                        type="button"
                        class="route-step-node"
                        :aria-label="`工序 ${step.sequence_no} · ${step.name || '未命名工序'}`"
                      >
                        <FactoryNavIcon :name="stepIcon(step)" />
                      </button>
                    </template>
                    <div class="route-path-heading">
                      <span>{{ step.name || '未命名工序' }}</span>
                      <span class="route-path-total">工序 {{ step.sequence_no }}</span>
                    </div>
                    <div class="route-step-detail" :aria-busy="stepDetails[row.id]?.loading">
                      <span
                        v-if="!stepDetails[row.id] || stepDetails[row.id]?.loading"
                        class="route-path-total"
                      >
                        加载中…
                      </span>
                      <div v-else-if="stepDetails[row.id]?.error" role="alert">
                        {{ stepDetails[row.id]?.error }}
                        <ElButton link @click="loadStepDetails(row.id)">重试</ElButton>
                      </div>
                      <template v-else>
                        <p>
                          {{
                            stepDetails[row.id]?.steps?.[index]?.instructions || '未填写工艺要求'
                          }}
                        </p>
                        <div class="route-step-quantity">
                          <span>计划加工数量</span>
                          <span>{{
                            stepDetails[row.id]?.steps?.[index]?.planned_quantity || '—'
                          }}</span>
                        </div>
                      </template>
                    </div>
                  </ElPopover>
                </template>
                <template v-if="routeSteps(row).length > visibleStepCount">
                  <span class="route-path-connector" aria-hidden="true" />
                  <ElPopover
                    :trigger="['hover', 'focus']"
                    :show-after="180"
                    :hide-after="120"
                    placement="bottom-start"
                    :width="360"
                  >
                    <template #reference>
                      <button
                        type="button"
                        class="route-path-more"
                        :aria-label="`另有 ${routeSteps(row).length - visibleStepCount} 道工序，查看完整路线`"
                      >
                        +{{ routeSteps(row).length - visibleStepCount }}
                      </button>
                    </template>
                    <div class="route-path-heading">
                      <span>{{ row.serial_nos[0] }}</span>
                      <span class="route-path-total">{{ routeSteps(row).length }} 道工序</span>
                    </div>
                    <ol class="route-path-list" aria-label="完整工序顺序" tabindex="0">
                      <li v-for="(step, index) in routeSteps(row)" :key="index">
                        <span class="route-path-sequence">{{ step.sequence_no }}</span>
                        <span class="route-step-symbol"
                          ><FactoryNavIcon :name="stepIcon(step)"
                        /></span>
                        <span>{{ step.name || '未命名工序' }}</span>
                      </li>
                    </ol>
                  </ElPopover>
                </template>
              </div>
              <span v-else class="route-empty">—</span>
            </template>
          </ElTableColumn>
          <ElTableColumn label="图纸" width="88" align="center" :show-overflow-tooltip="false">
            <template #default="{ row }">
              <ElButton
                v-if="row.drawings?.length === 1"
                link
                class="route-drawing-count"
                :aria-label="`查看 ${row.serial_nos[0]} 的图纸`"
                :loading="drawingLoading === `${row.id}:${row.drawings[0].id}`"
                @click="openDrawing(row.id, row.drawings[0])"
                >1 份</ElButton
              >
              <ElPopover
                v-else-if="row.drawings?.length"
                :visible="drawingMenu === row.id"
                trigger="click"
                placement="bottom-end"
                :width="280"
                @update:visible="drawingMenu = $event ? row.id : null"
              >
                <template #reference>
                  <ElButton
                    link
                    class="route-drawing-count"
                    :aria-label="`选择 ${row.serial_nos[0]} 的图纸`"
                    :loading="drawingLoading.startsWith(`${row.id}:`)"
                    >{{ row.drawings.length }} 份<ElIcon><ArrowDown /></ElIcon
                  ></ElButton>
                </template>
                <div class="route-path-heading">{{ row.serial_nos[0] }} · 图纸</div>
                <div class="route-drawing-files">
                  <ElButton
                    v-for="drawing in row.drawings"
                    :key="drawing.id"
                    text
                    @click="openDrawing(row.id, drawing)"
                    >{{ drawing.filename }}</ElButton
                  >
                </div>
              </ElPopover>
              <span v-else class="route-empty">—</span>
            </template>
          </ElTableColumn>
        </template>
        <ElTableColumn v-if="routeKind === 'rework'" label="问题" min-width="210">
          <template #default="{ row }">
            <div
              class="rework-problem"
              :title="row.rework_request?.problem_notes || row.rework_request?.reason"
            >
              <template v-if="row.rework_request?.problem_names?.length">
                <span
                  v-for="name in row.rework_request.problem_names"
                  :key="name"
                  class="rework-problem-name"
                  >{{ name }}</span
                >
              </template>
              <span v-else class="rework-problem-description">{{
                row.rework_request?.reason || '未记录'
              }}</span>
            </div>
          </template>
        </ElTableColumn>
        <ElTableColumn v-if="routeKind === 'rework'" label="提交班组" width="100" align="center"
          ><template #default="{ row }"
            ><span :class="{ 'route-empty': !row.rework_request?.requesting_team_name }">{{
              row.rework_request?.requesting_team_name || '未记录'
            }}</span></template
          ></ElTableColumn
        >
        <ElTableColumn v-if="routeKind === 'rework'" label="问题来源" width="80" align="center">
          <template #default="{ row }"
            ><span
              class="rework-source"
              :class="{
                'rework-source-inspection': row.rework_request?.inspection_id,
                'route-empty':
                  !row.rework_request?.inspection_id && !row.rework_request?.requesting_team_id,
              }"
              >{{
                row.rework_request?.inspection_id
                  ? row.rework_request.inspection_kind === 'patrol'
                    ? '巡检'
                    : '检验'
                  : row.rework_request?.requesting_team_id
                    ? '班组反馈'
                    : '未记录'
              }}</span
            ></template
          >
        </ElTableColumn>
        <ElTableColumn v-if="routeKind === 'rework'" label="涉及班组" width="110" align="center">
          <template #default="{ row }">
            <div
              v-if="row.rework_request?.problem_teams?.length"
              class="rework-team-list"
              role="list"
              aria-label="涉及班组"
            >
              <span
                v-for="team in row.rework_request.problem_teams"
                :key="team.id"
                role="listitem"
                >{{ team.name }}</span
              >
            </div>
            <span v-else class="route-empty">未记录</span>
          </template>
        </ElTableColumn>
        <ElTableColumn v-if="routeKind === 'rework'" label="执行班组" width="110" align="center">
          <template #default="{ row }">
            <div
              v-if="row.rework_request?.execution_team_names?.length"
              class="rework-team-list"
              role="list"
              aria-label="执行班组"
            >
              <span
                v-for="name in row.rework_request.execution_team_names"
                :key="name"
                role="listitem"
                >{{ name }}</span
              >
            </div>
            <span v-else class="route-empty">待指定</span>
          </template>
        </ElTableColumn>
        <ElTableColumn v-if="routeKind === 'rework'" label="工艺状态" width="82" align="center">
          <template #default="{ row }"
            ><ElTag
              :type="row.state === 'published' ? 'success' : 'warning'"
              class="route-rework-status"
              :class="{ 'route-rework-ready': row.state === 'published' }"
              >{{ row.state === 'published' ? '已制定' : '待制定' }}</ElTag
            ></template
          >
        </ElTableColumn>
        <ElTableColumn
          label="工艺人员"
          :width="routeKind === 'rework' ? 110 : undefined"
          :min-width="routeKind === 'normal' ? 110 : undefined"
          align="center"
          ><template #default="{ row }"
            ><span :class="{ 'route-empty': !row.engineering_employee_name }"
              ><PersonName :name="row.engineering_employee_name || '—'" /></span></template
        ></ElTableColumn>
        <ElTableColumn v-if="routeKind === 'normal'" label="修改人员" min-width="110" align="center"
          ><template #default="{ row }"
            ><span
              class="route-modifier"
              v-if="
                row.modified_employee_name &&
                row.modified_employee_id &&
                row.modified_employee_id !== row.engineering_employee_id
              "
              ><PersonName :name="row.modified_employee_name" /></span
            ><span v-else class="route-empty">—</span></template
          ></ElTableColumn
        >
        <ElTableColumn
          prop="updated_at"
          label="更新时间"
          :width="routeKind === 'rework' ? 154 : undefined"
          :min-width="routeKind === 'normal' ? 180 : undefined"
          align="center"
          sortable="custom"
          :sort-orders="['descending', 'ascending']"
          ><template #default="{ row }"
            ><span class="route-updated-at">{{
              formatDateTime(row.updated_at || row.created_at)
            }}</span></template
          ></ElTableColumn
        >
        <ElTableColumn
          v-if="canEdit"
          label="操作"
          :width="routeKind === 'rework' ? 122 : undefined"
          :min-width="routeKind === 'normal' ? 120 : undefined"
          align="center"
          fixed="right"
          ><template #default="{ row }"
            ><ElButton
              size="small"
              class="route-record-action"
              @click="open(row.id, row.route_kind !== 'rework' || row.state !== 'published')"
              >{{
                row.route_kind === 'rework'
                  ? row.state === 'published'
                    ? '查看返工工艺'
                    : '制定工艺'
                  : '修改工艺'
              }}</ElButton
            ></template
          ></ElTableColumn
        >
      </WorkspaceTable>
      <WorkspacePagination
        :current-page="page"
        :page-size="pageSize"
        :disabled="loading"
        :total="total"
        @current-change="pageChanged"
        @size-change="pageSizeChanged"
        >共 {{ total }} 条记录 ·
        {{ Math.max(1, Math.ceil(total / pageSize)) }} 页</WorkspacePagination
      >
    </WorkspaceDataPanel>
    <template #dialogs>
      <DocumentViewer
        v-if="drawingUrl"
        :title="drawingTitle"
        :pdf="drawingUrl"
        @close="closeDrawing"
      />
      <ProcessRouteEditor
        v-if="selected || creating"
        :key="selected?.id || 'new'"
        :route="selected || undefined"
        :start-editing="editing"
        :view-only="!canEdit"
        @opened="focusReworkNotice"
        @close="closeEditor"
        @saved="load"
      />
      <TeamBusinessDialog
        v-if="team && canEdit"
        v-model="settingsOpen"
        :team-id="Number(team.id)"
        :team-name="team.name"
        business-only
        employees-only
        :processing-tasks="false"
      />
    </template>
  </TeamWorkspaceShell>
</template>
<style scoped>
.route-document-warning {
  margin-left: 8px;
}

.new-route-options {
  display: grid;
  gap: 6px;
}
.new-route-options .el-button {
  margin: 0;
}
.process-workspace {
  --route-ink: var(--text);
  --route-secondary: var(--muted);
  --route-placeholder: var(--subtle);
}
.process-workspace .workspace-data-panel {
  display: grid;
  grid-template-rows: auto minmax(0, max-content) auto;
  align-content: start;
}
.process-workspace :deep(.workspace-pagination) {
  margin-top: 0;
}
.route-pending-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 19px;
  height: 19px;
  padding: 0 4px;
  border: 1px solid #dcc294;
  border-radius: 5px;
  background: #fbefd7;
  color: #72501e;
  font-size: var(--font-size-meta);
  line-height: var(--line-height-meta);
  font-variant-numeric: tabular-nums;
}
.route-step-summary {
  display: flex;
  align-items: center;
  min-width: 0;
  padding: 3px;
}
.route-path-total {
  flex-shrink: 0;
  color: var(--muted);
  font-size: var(--font-size-meta);
  line-height: var(--line-height-meta);
  font-weight: var(--font-weight-regular);
  white-space: nowrap;
}
.process-workspace .route-list .route-drawing-count {
  flex-shrink: 0;
  gap: 4px;
  color: var(--route-ink);
  font-weight: var(--font-weight-regular);
}
.route-step-node,
.route-path-more {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 28px;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid color-mix(in srgb, var(--primary) 22%, var(--surface));
  border-radius: 50%;
  background: color-mix(in srgb, var(--primary) 6%, var(--surface));
  cursor: pointer;
  transition:
    border-color var(--motion-fast),
    background-color var(--motion-fast);
}
.route-step-node :deep(.tabler-icon),
.route-step-symbol :deep(.tabler-icon) {
  width: 16px;
  height: 16px;
  color: var(--primary);
}
.route-step-node:hover,
.route-step-node:focus-visible,
.route-path-more:hover,
.route-path-more:focus-visible {
  border-color: var(--primary);
  background: color-mix(in srgb, var(--primary) 11%, var(--surface));
}
.route-step-node:focus-visible,
.route-path-more:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
.route-path-connector {
  flex: 0 0 8px;
  height: 1px;
  background: color-mix(in srgb, var(--primary) 24%, var(--surface));
}
.route-path-more {
  flex-basis: auto;
  min-width: 28px;
  width: auto;
  padding-inline: 4px;
  border-color: var(--line);
  background: var(--surface-soft);
  color: var(--muted);
  font-family: inherit;
  font-size: var(--font-size-meta);
  line-height: var(--line-height-meta);
  font-weight: var(--font-weight-regular);
  font-variant-numeric: tabular-nums;
}
.route-step-detail {
  padding-top: 10px;
  color: var(--text);
  font-size: var(--font-size-body);
  line-height: var(--line-height-body);
  font-weight: var(--font-weight-regular);
  white-space: normal;
  overflow-wrap: anywhere;
}
.route-step-detail p {
  margin: 0;
  max-height: min(240px, calc(100dvh - 260px));
  overflow: auto;
  white-space: pre-wrap;
}
.route-step-quantity {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-top: 10px;
  color: var(--muted);
  font-size: var(--font-size-meta);
  line-height: var(--line-height-meta);
}
.route-step-quantity > :last-child {
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.route-path-heading {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--line);
  color: var(--text);
  font-size: var(--font-size-body);
  line-height: var(--line-height-body);
  font-weight: var(--font-weight-medium);
}
.route-path-list {
  display: grid;
  gap: 0;
  max-height: min(360px, calc(100dvh - 220px));
  overflow: auto;
  padding: 6px 0 0;
  margin: 0;
  list-style: none;
}
.route-path-list li {
  display: grid;
  grid-template-columns: 24px 24px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  min-height: 34px;
  padding: 5px 0;
  border-bottom: 1px solid var(--line-light);
  color: var(--text);
  font-size: var(--font-size-body);
  line-height: var(--line-height-body);
  font-weight: var(--font-weight-regular);
  overflow-wrap: anywhere;
}
.route-path-list li:last-child {
  border-bottom: 0;
}
.route-path-sequence {
  color: var(--subtle);
  font-size: var(--font-size-meta);
  line-height: var(--line-height-meta);
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.route-step-symbol {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 1px solid var(--line);
  border-radius: 50%;
  background: var(--surface-soft);
}
.route-drawing-files {
  display: grid;
  gap: 3px;
  padding-top: 6px;
}
.route-drawing-files .el-button {
  justify-content: flex-start;
  height: auto;
  min-height: 32px;
  padding: 6px 4px;
  margin: 0;
  color: var(--text);
  white-space: normal;
  overflow-wrap: anywhere;
  text-align: left;
  font-size: var(--font-size-body);
  line-height: var(--line-height-body);
}
.process-workspace :deep(.team-workspace__title) {
  color: var(--route-ink);
  line-height: 28px;
  font-weight: 600;
  letter-spacing: 0;
}
.route-kind-switch {
  display: flex;
  flex-shrink: 0;
  gap: 2px;
  padding: 3px;
  border: 1px solid #dbe4e0;
  border-radius: 12px;
  background: linear-gradient(180deg, #e9efecb3, #ffffffeb);
  box-shadow:
    inset 0 1px 2px #2845360c,
    0 1px 0 #fff;
}
.route-kind-switch button {
  --route-kind-accent: var(--primary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 86px;
  height: 32px;
  padding: 0 10px;
  gap: 6px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font: inherit;
  font-size: 14px;
  line-height: 20px;
  transition:
    box-shadow 160ms,
    transform 160ms,
    color 160ms;
}
.route-kind-switch button[aria-pressed='true'] {
  font-weight: 600;
  border-color: color-mix(in srgb, var(--route-kind-accent) 88%, black);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--route-kind-accent) 76%, white),
    var(--route-kind-accent) 55%,
    color-mix(in srgb, var(--route-kind-accent) 86%, black)
  );
  box-shadow:
    inset 0 1px 0 #ffffff75,
    inset 0 -1px 0 #0000001a,
    0 2px 4px #1e293b24;
  color: white;
}
.route-kind-switch button:hover:not([aria-pressed='true']) {
  background: linear-gradient(180deg, #fff, #ffffff99);
  box-shadow:
    inset 0 1px 0 #fff,
    0 1px 3px #253d3212;
}
.route-kind-switch button:active {
  transform: translateY(1px);
  box-shadow: inset 0 1px 3px #172b402b;
}
.route-kind-switch button:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
.process-workspace .route-list .route-rework-status {
  --el-tag-text-color: var(--route-ink);
  --el-tag-bg-color: #fff6e5;
  --el-tag-border-color: #e6c691;
  height: 24px;
  padding-inline: 8px;
  border-radius: 5px;
  background: linear-gradient(180deg, #fffcf5, var(--el-tag-bg-color));
  box-shadow:
    inset 0 1px 0 #fff,
    inset 0 -1px 0 #8a571518;
  font-size: 12px;
  font-weight: 500;
}
.process-workspace .route-list .route-rework-ready {
  --el-tag-bg-color: #f1e9ff;
  --el-tag-border-color: #cfb8ec;
  background: linear-gradient(180deg, #fcfaff, var(--el-tag-bg-color));
  box-shadow:
    inset 0 1px 0 #fff,
    inset 0 -1px 0 #7036b518;
}
.route-kind-switch button:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
.rework-problem {
  display: grid;
  gap: 4px;
  line-height: 22px;
  min-width: 0;
  text-align: left;
}
.rework-problem-name {
  overflow-wrap: anywhere;
}
.rework-problem-description {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  overflow-wrap: anywhere;
}
.rework-source {
  color: var(--route-secondary);
  font-size: 12px;
}
.rework-source-inspection {
  display: inline-flex;
  align-items: center;
  padding: 0 7px;
  border: 1px solid #dce3df;
  border-radius: 4px;
  background: #f5f7f6;
}
.rework-team-list {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 4px;
}
.rework-team-list > span {
  padding: 1px 7px;
  border: 1px solid #dce1e7;
  border-radius: 4px;
  background: #f7f8fa;
  color: var(--route-ink);
  font-size: 12px;
  white-space: nowrap;
}
.workspace-toolbar-actions {
  margin-left: auto;
}

.route-empty {
  color: var(--route-placeholder);
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-regular);
  white-space: nowrap;
}
.route-modifier {
  color: var(--route-secondary);
  font-size: var(--font-size-meta);
}
.route-updated-at {
  color: var(--route-secondary);
  font-size: var(--font-size-meta);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.process-workspace :deep(.route-list .el-table__cell:first-child .cell) {
  padding-left: 16px;
  text-align: left;
}
.route-serial {
  --el-button-text-color: var(--route-ink);
  --el-button-hover-text-color: var(--route-ink);
  --el-button-hover-link-text-color: var(--route-ink);
  --el-button-active-color: var(--route-ink);
}
.process-workspace .route-list .route-record-action {
  --el-button-text-color: var(--route-ink);
  --el-button-hover-text-color: var(--route-ink);
  --el-button-active-text-color: var(--route-ink);
  height: 28px;
  min-height: 28px;
  padding: 0 8px;
  border-radius: 8px;
  font-size: var(--font-size-meta);
  line-height: 20px;
  font-weight: 400;
}
.process-workspace .route-list .route-record-action:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
.process-workspace :deep(.workspace-data-panel .el-table.business-table.route-list .route-serial) {
  color: var(--route-ink);
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-medium);
  letter-spacing: 0;
  overflow-wrap: anywhere;
  max-width: 100%;
  height: auto;
  white-space: normal;
}
.route-serial:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 3px;
  border-radius: 2px;
}
.route-serial:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}

@media (max-width: 1100px) {
  .process-workspace :deep(form.workspace-data-toolbar.workspace-toolbar) {
    flex-wrap: wrap;
  }
  .process-workspace :deep(.workspace-toolbar > .workspace-tools) {
    order: 1;
  }
  .workspace-toolbar-actions {
    order: 2;
    margin-left: 0;
  }
  .process-workspace :deep(.workspace-toolbar__search) {
    order: 3;
    flex: 1 1 calc(100% - 108px);
    max-width: none;
  }
  .process-workspace :deep(.workspace-toolbar__query-actions) {
    order: 4;
  }
}

@media (prefers-reduced-motion: reduce) {
  .route-kind-switch button,
  .route-step-node,
  .route-path-more,
  .process-workspace .route-list .route-record-action {
    transition: none;
    transform: none;
  }
}
</style>
