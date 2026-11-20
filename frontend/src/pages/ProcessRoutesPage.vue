<script setup lang="ts">
import { useTableQuery } from '@/composables/useTableQuery'
import { queryColumns } from '@/utils/tableQueryColumns'
import FilterDialog from '@/components/FilterDialog.vue'
import TableFilterFields from '@/components/TableFilterFields.vue'
import type { TableColumnCondition } from '@/types/tableQuery'
import AppButton from '@/components/AppButton.vue'
import ElAlert from '@/components/AppAlert.vue'
import AppPopover from '@/components/AppPopover.vue'
import AsyncStatus from '@/components/AsyncStatus.vue'
import PersonName from '@/components/PersonName.vue'
import WorkspaceDataPanel from '@/components/WorkspaceDataPanel.vue'
import WorkspaceTable from '@/components/WorkspaceTable.vue'
import WorkspacePagination from '@/components/WorkspacePagination.vue'
import WatermelonBadge from '@/components/watermelon/WatermelonBadge.vue'
import WorkspaceDataToolbar from '@/components/WorkspaceDataToolbar.vue'
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ArrowDown, Plus, Setting } from '@element-plus/icons-vue'
import { ElIcon, ElTableColumn } from 'element-plus'
import ElButton from '@/components/AppButton.vue'
import { useRoute, useRouter } from 'vue-router'
import { useLiveRefresh } from '@/composables/useLiveRefresh'
import TeamWorkspaceShell from '@/components/TeamWorkspaceShell.vue'
import TeamBusinessDialog from '@/components/TeamBusinessDialog.vue'
import DocumentViewer from '@/components/DocumentViewer.vue'
import { boardTeamColor } from '@/utils/scheduleBoard'
import { useAuthStore } from '@/stores/auth'
import { useTeamDirectoryStore } from '@/stores/teamDirectory'
import { processRouteApi } from '@/services/processRouteApi'
import type { ProcessRoute, ProcessRouteDrawing, ProcessRouteStep } from '@/types/processRoute'
import { formatDateTime } from '@/utils/format'
import { canMaintainProcessRoute } from '@/utils/processRoutePermissions'
const loadEditor = () => import('@/components/ProcessRouteEditor.vue')
const ProcessRouteEditor = defineAsyncComponent(loadEditor)
const location = useRoute()
const router = useRouter()
const auth = useAuthStore(),
  directory = useTeamDirectoryStore()
const team = computed(() =>
  directory.items.find(
    (item) => item.active && item.code === 'FACTORY-PROCESS' && item.kind === 'engineering',
  ),
)
const canEdit = computed(() => !auth.currentUserError && canMaintainProcessRoute(auth.currentUser))
const canManageTeam = computed(
  () => !auth.currentUserError && auth.currentUser?.active && (auth.isAdmin || canEdit.value),
)
const managingTeam = computed(
  () => location.query.tab === 'settings' && canManageTeam.value && !!team.value,
)
const filtersOpen = ref(false)
const draftColumns = ref<TableColumnCondition[]>([])
const columnSettingsTarget = ref<HTMLElement | null>(null)
const openingId = ref<number | null>(null)
const preparingEditor = ref(false)
const items = ref<ProcessRoute[]>([]),
  total = ref(0),
  page = ref(1),
  pageSize = ref(20),
  query = ref(''),
  appliedQuery = ref(''),
  loading = ref(false),
  error = ref(''),
  selected = ref<ProcessRoute | null>(null),
  editing = ref(false),
  creating = ref(false)
type RoutePage = Awaited<ReturnType<typeof processRouteApi.list>>
let cachedPage: { key: string; result: RoutePage } | undefined
const hasLoadedView = ref(false)
const initialLoading = computed(() => loading.value && !hasLoadedView.value)
async function create() {
  if (!canEdit.value) return
  const request = ++detailGeneration
  preparingEditor.value = true
  error.value = ''
  try {
    await loadEditor()
    if (request === detailGeneration) creating.value = true
  } catch {
    if (request === detailGeneration) error.value = '表单加载失败，请重试'
  } finally {
    if (request === detailGeneration) preparingEditor.value = false
  }
}
function closeEditor() {
  ++detailGeneration
  selected.value = null
  openingId.value = null
  preparingEditor.value = false
  editing.value = false
  creating.value = false
}
const filterColumns = queryColumns([
  ['流水号', 'serial_nos'],
  ['工艺人员', 'engineering_employee_name'],
  ['修改人员', 'modified_employee_name'],
  ['更新时间', 'updated_at', 'date'],
  ['材质', 'material_name'],
])
const tableQuery = useTableQuery(
  filterColumns,
  () => {
    page.value = 1
    void load()
  },
  (table_query) =>
    processRouteApi.list(
      appliedQuery.value,
      1,
      undefined,
      'desc',
      pageSize.value,
      'normal',
      'all',
      table_query,
    ),
)
function openFilters() {
  draftColumns.value = tableQuery.state.value.filters.map((item) => ({ ...item }))
}
function resetFilters() {
  draftColumns.value = []
}
function applyFilters() {
  tableQuery.state.value.filters = draftColumns.value.map((item) => ({ ...item }))
  filtersOpen.value = false
  search()
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
  if (managingTeam.value) return
  const request = ++generation
  const params = [
    appliedQuery.value,
    page.value,
    undefined,
    'desc',
    pageSize.value,
    'normal',
    'all',
    tableQuery.params.value.table_query,
  ] as const
  const key = JSON.stringify(params)
  const cached = cachedPage?.key === key ? cachedPage.result : undefined
  hasLoadedView.value = !!cached
  items.value = cached?.items ?? []
  total.value = cached?.total ?? 0
  loading.value = true
  error.value = ''
  try {
    const result = await processRouteApi.list(...params)
    if (request !== generation) return
    cachedPage = { key, result }
    items.value = result.items
    hasLoadedView.value = true
    stepDetails.value = {}
    total.value = result.total
  } catch (e) {
    if (request === generation) error.value = e instanceof Error ? e.message : '工艺读取失败'
  } finally {
    if (request === generation) loading.value = false
  }
}
function saved() {
  cachedPage = undefined
  void load()
}
function search() {
  appliedQuery.value = query.value.trim()
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
function stepTeamName(step: Pick<ProcessRouteStep, 'name' | 'team_id'>) {
  const aliases: Record<string, string> = { 中转库: '库房', 轧板: '轧制', 质检: '检验' }
  const team = step.team_id
    ? directory.items.find((item) => Number(item.id) === step.team_id)
    : directory.items.find((item) => item.name === (aliases[step.name] || step.name))
  return team?.name || aliases[step.name] || step.name || '—'
}
function stepInitial(step: Pick<ProcessRouteStep, 'name' | 'team_id'>) {
  return Array.from(stepTeamName(step).trim())[0] || '—'
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
  const request = ++detailGeneration
  error.value = ''
  openingId.value = id
  try {
    const [result] = await Promise.all([processRouteApi.detail(id), loadEditor()])
    if (request === detailGeneration) {
      editing.value = startEditing && canEdit.value
      selected.value = result
    }
  } catch (e) {
    if (request === detailGeneration) error.value = e instanceof Error ? e.message : '工艺读取失败'
  } finally {
    if (request === detailGeneration) openingId.value = null
  }
}
watch(managingTeam, (managing) => {
  closeEditor()
  closeDrawing()
  if (managing) {
    ++generation
    loading.value = false
    error.value = ''
  } else void load()
})
useLiveRefresh(load, {
  teamId: () => (team.value ? Number(team.value.id) : undefined),
  busy: () =>
    managingTeam.value ||
    loading.value ||
    openingId.value !== null ||
    preparingEditor.value ||
    !!selected.value ||
    creating.value,
})
onMounted(() => {
  routeMedia?.addEventListener('change', resizeRouteSummary)
  void directory.refreshTeamDirectory()
  void load()
})
onBeforeUnmount(() => {
  routeMedia?.removeEventListener('change', resizeRouteSummary)
  closeDrawing()
  ++generation
  ++detailGeneration
})
</script>
<template>
  <TeamWorkspaceShell
    class="process-workspace"
    :title="managingTeam ? '工艺' : '工艺记录'"
    :model-value="managingTeam ? 'settings' : 'process-routes'"
    engineering
  >
    <TeamBusinessDialog
      v-if="managingTeam && team"
      :model-value="true"
      inline
      :team-id="Number(team.id)"
      :team-name="team.name"
      business-only
      employees-only
      :processing-tasks="false"
    />
    <ElAlert v-if="error" :title="error" type="error" :closable="false" />
    <WorkspaceDataPanel v-if="!managingTeam" class="workspace-data-panel">
      <WorkspaceDataToolbar
        v-model="query"
        :loading="loading"
        search-label="工艺记录搜索"
        placeholder="搜索流水号、批次号、工艺人员"
        refresh-label="刷新工艺记录"
        @search="search"
        @refresh="load"
      >
        <template #filters>
          <FilterDialog
            v-model="filtersOpen"
            v-slot="{ appendTo }"
            :count="tableQuery.state.value.filters.length"
            @open="openFilters"
            @apply="applyFilters"
            @reset="resetFilters"
          >
            <TableFilterFields
              v-model="draftColumns"
              :columns="filterColumns"
              :append-to="appendTo"
            />
          </FilterDialog>
        </template>
        <template #tools><div ref="columnSettingsTarget" /></template>
        <template #status>
          <AsyncStatus v-if="openingId !== null" label="正在打开工艺…">
            <ElButton link @click="closeEditor">取消</ElButton>
          </AsyncStatus>
        </template>
        <template #actions>
          <ElButton
            v-if="canManageTeam && team"
            :icon="Setting"
            @click="router.push({ query: { ...location.query, tab: 'settings' } })"
            >班组管理</ElButton
          >
        </template>
        <template #primary-actions>
          <ElButton
            v-if="canEdit"
            :icon="Plus"
            :loading="preparingEditor"
            :disabled="initialLoading"
            @click="create"
            >新建工艺</ElButton
          >
        </template>
      </WorkspaceDataToolbar>
      <WorkspaceTable
        columns-key="ProcessRoutesPage-1"
        :column-query="tableQuery.controller.value"
        :column-settings-target="columnSettingsTarget"
        :loading="loading && (!hasLoadedView || items.length > 0)"
        :data="items"
        border
        row-key="id"
        class="team-table route-list"
        aria-label="工艺记录"
      >
        <ElTableColumn class-name="table-identity" label="流水号" min-width="175" align="left"
          ><template #default="{ row }"
            ><div class="route-identity">
              <ElButton
                v-if="row.serial_nos[0]"
                class="route-serial"
                :loading="openingId === row.id"
                type="primary"
                link
                @click="open(row.id)"
                >{{ row.serial_nos[0] }}</ElButton
              ><span v-else class="route-empty">—</span>
              <WatermelonBadge
                v-if="row.missing_documents?.length"
                tone="warning"
                class="route-document-warning"
                :title="`缺少：${row.missing_documents.join('、')}`"
                >待补资料</WatermelonBadge
              >
            </div></template
          ></ElTableColumn
        >
        <ElTableColumn label="材质" width="103">
          <template #default="{ row }">
            <span :class="{ 'route-empty': !row.material_name }">{{
              row.material_name || '—'
            }}</span>
          </template>
        </ElTableColumn>
        <ElTableColumn label="工序概要" min-width="260" :show-overflow-tooltip="false">
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
                <AppPopover
                  :trigger="['hover', 'focus']"
                  :show-after="180"
                  :hide-after="120"
                  placement="bottom-start"
                  :width="320"
                  @before-enter="loadStepDetails(row.id)"
                >
                  <template #reference>
                    <AppButton
                      unstyled
                      type="button"
                      class="route-step-node"
                      :style="{ '--route-team-color': boardTeamColor(stepTeamName(step)) }"
                      :aria-label="`工序 ${step.sequence_no} · ${step.name || '未命名工序'}`"
                    >
                      <span aria-hidden="true">{{ stepInitial(step) }}</span>
                    </AppButton>
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
                        {{ stepDetails[row.id]?.steps?.[index]?.instructions || '未填写工艺要求' }}
                      </p>
                      <div class="route-step-quantity">
                        <span>计划加工数量</span>
                        <span>{{
                          stepDetails[row.id]?.steps?.[index]?.planned_quantity || '—'
                        }}</span>
                      </div>
                    </template>
                  </div>
                </AppPopover>
              </template>
              <template v-if="routeSteps(row).length > visibleStepCount">
                <span class="route-path-connector" aria-hidden="true" />
                <AppPopover
                  :trigger="['hover', 'focus']"
                  :show-after="180"
                  :hide-after="120"
                  placement="bottom-start"
                  :width="360"
                >
                  <template #reference>
                    <AppButton
                      unstyled
                      type="button"
                      class="route-path-more"
                      :aria-label="`另有 ${routeSteps(row).length - visibleStepCount} 道工序，查看完整路线`"
                    >
                      +{{ routeSteps(row).length - visibleStepCount }}
                    </AppButton>
                  </template>
                  <div class="route-path-heading">
                    <span>{{ row.serial_nos[0] }}</span>
                    <span class="route-path-total">{{ routeSteps(row).length }} 道工序</span>
                  </div>
                  <ol class="route-path-list" aria-label="完整工序顺序" tabindex="0">
                    <li v-for="(step, index) in routeSteps(row)" :key="index">
                      <span class="route-path-sequence">{{ step.sequence_no }}</span>
                      <span
                        class="route-step-symbol"
                        :style="{ '--route-team-color': boardTeamColor(stepTeamName(step)) }"
                        aria-hidden="true"
                        >{{ stepInitial(step) }}</span
                      >
                      <span>{{ step.name || '未命名工序' }}</span>
                    </li>
                  </ol>
                </AppPopover>
              </template>
            </div>
            <span v-else class="route-empty">—</span>
          </template>
        </ElTableColumn>
        <ElTableColumn label="图纸" width="76" align="center" :show-overflow-tooltip="false">
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
            <AppPopover
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
            </AppPopover>
            <span v-else class="route-empty">—</span>
          </template>
        </ElTableColumn>
        <ElTableColumn label="工艺人员" min-width="100" align="center"
          ><template #default="{ row }"
            ><span :class="{ 'route-empty': !row.engineering_employee_name }"
              ><PersonName :name="row.engineering_employee_name || '—'" /></span></template
        ></ElTableColumn>
        <ElTableColumn label="修改人员" min-width="96" align="center"
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
        <ElTableColumn prop="updated_at" label="更新时间" min-width="155" align="center"
          ><template #default="{ row }"
            ><span class="route-updated-at">{{
              formatDateTime(row.updated_at || row.created_at)
            }}</span></template
          ></ElTableColumn
        >
        <ElTableColumn v-if="canEdit" label="操作" width="96" align="center" fixed="right"
          ><template #default="{ row }"
            ><ElButton link :loading="openingId === row.id" @click="open(row.id, true)"
              >修改工艺</ElButton
            ></template
          ></ElTableColumn
        >
      </WorkspaceTable>
      <WorkspacePagination
        :current-page="page"
        :page-size="pageSize"
        :disabled="initialLoading"
        :total="total"
        @current-change="pageChanged"
        @size-change="pageSizeChanged"
        >共 {{ total }} 条记录</WorkspacePagination
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
        @close="closeEditor"
        @saved="saved"
      />
    </template>
  </TeamWorkspaceShell>
</template>
<style scoped>
.route-identity {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 8px;
}

.process-workspace {
  --route-ink: var(--text);
  --route-secondary: var(--muted);
  --route-placeholder: var(--subtle);
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
.route-step-node,
.route-step-symbol {
  color: var(--route-team-color);
  font-size: var(--font-size-label);
  font-weight: var(--font-weight-semibold);
  line-height: 1;
}
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
.route-step-node,
.route-step-symbol {
  border-color: color-mix(in srgb, var(--route-team-color) 36%, transparent);
  background: color-mix(in srgb, var(--route-team-color) 14%, var(--surface));
}
.route-step-node:hover,
.route-step-node:focus-visible {
  border-color: var(--route-team-color);
  background: color-mix(in srgb, var(--route-team-color) 22%, var(--surface));
}
@media (prefers-color-scheme: dark) {
  .route-step-node,
  .route-step-symbol {
    color: color-mix(in srgb, var(--route-team-color) 70%, white);
  }
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
  font-weight: var(--font-weight-semibold);
  letter-spacing: 0;
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
}
</style>
