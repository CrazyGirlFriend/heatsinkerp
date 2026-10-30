<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, nextTick } from 'vue'
import { Refresh, Search, Setting, Plus } from '@element-plus/icons-vue'
import {
  ElAlert,
  ElButton,
  ElInput,
  ElLoading,
  ElPagination,
  ElPopover,
  ElTag,
  ElTable,
  ElTableColumn,
} from 'element-plus'
import { useRoute } from 'vue-router'
import { businessNoticeApi, parseNotice } from '@/services/businessNoticeApi'
import { focusNoticeTarget, noticeOpened, noticeFailed } from '@/utils/noticeFocus'
import { useLiveRefresh } from '@/composables/useLiveRefresh'
import TeamWorkspaceShell from '@/components/TeamWorkspaceShell.vue'
import TeamBusinessDialog from '@/components/TeamBusinessDialog.vue'
import ProcessRouteEditor from '@/components/ProcessRouteEditor.vue'
import { useAuthStore } from '@/stores/auth'
import { useTeamDirectoryStore } from '@/stores/teamDirectory'
import { processRouteApi } from '@/services/processRouteApi'
import type { ProcessRoute } from '@/types/processRoute'
import { formatDateTime } from '@/utils/format'
const location = useRoute()
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
const routeKind = ref<'normal' | 'rework'>('normal')
const newMenuOpen = ref(false),
  pendingOnly = ref(false)
function clearPending() {
  pendingOnly.value = false
  void load()
}
function createRework() {
  newMenuOpen.value = false
  routeKind.value = 'rework'
  pendingOnly.value = true
  page.value = 1
  query.value = appliedQuery.value = ''
  void load()
}
function changeKind(kind: 'normal' | 'rework') {
  if (kind === routeKind.value) return
  pendingOnly.value = false
  routeKind.value = kind
  query.value = ''
  appliedQuery.value = ''
  items.value = []
  total.value = 0
  page.value = 1
  void load()
}
const items = ref<ProcessRoute[]>([]),
  total = ref(0),
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
    total.value = result.total
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
useLiveRefresh(load, {
  teamId: () => (team.value ? Number(team.value.id) : undefined),
  busy: () => loading.value || !!selected.value || creating.value,
})
onMounted(() => {
  void directory.refreshTeamDirectory()
  void load()
})
onBeforeUnmount(() => {
  stopNoticeFocus?.()
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
  >
    <template v-if="canEdit && team" #settings>
      <ElButton :icon="Setting" @click="settingsOpen = true">班组设置</ElButton>
    </template>
    <ElAlert v-if="error" :title="error" type="error" :closable="false" />
    <section class="workspace-data-panel">
      <div class="workspace-data-toolbar">
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
          </button>
        </div>
        <ElInput
          v-model="query"
          :prefix-icon="Search"
          clearable
          :placeholder="
            routeKind === 'rework'
              ? '搜索流水号、批次号、问题、班组或工艺人员'
              : '搜索流水号、工艺人员'
          "
          aria-label="工艺记录搜索"
          @keyup.enter="search"
          @clear="search"
        />
        <ElButton class="action-warm" :disabled="loading" @click="search">查询</ElButton>
        <ElButton :icon="Refresh" aria-label="刷新工艺记录" :disabled="loading" @click="load" />
        <ElTag v-if="pendingOnly" closable type="warning" @close="clearPending">待制定</ElTag>
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
        </div>
      </div>
      <ElTable
        :key="routeKind"
        v-loading="loading"
        :data="items"
        border
        row-key="id"
        class="business-table team-table route-list"
        height="100%"
        aria-label="工艺记录"
        :default-sort="{
          prop: 'updated_at',
          order: sortOrder === 'asc' ? 'ascending' : 'descending',
        }"
        @sort-change="sortChanged"
      >
        <ElTableColumn
          label="流水号"
          :min-width="routeKind === 'rework' ? 205 : 260"
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
          </template></ElTableColumn
        >
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
          :width="routeKind === 'rework' ? 84 : undefined"
          :min-width="routeKind === 'normal' ? 110 : undefined"
          align="center"
          ><template #default="{ row }"
            ><span :class="{ 'route-empty': !row.engineering_employee_name }">{{
              row.engineering_employee_name || '—'
            }}</span></template
          ></ElTableColumn
        >
        <ElTableColumn v-if="routeKind === 'normal'" label="修改人员" min-width="110" align="center"
          ><template #default="{ row }"
            ><span
              class="route-modifier"
              v-if="
                row.modified_employee_name &&
                row.modified_employee_id &&
                row.modified_employee_id !== row.engineering_employee_id
              "
              >{{ row.modified_employee_name }}</span
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
      </ElTable>
      <footer class="workspace-list-footer">
        <span>共 {{ total }} 条记录 · {{ Math.max(1, Math.ceil(total / pageSize)) }} 页</span
        ><ElPagination
          :current-page="page"
          :page-size="pageSize"
          :page-sizes="[10, 20, 50, 100]"
          :disabled="loading"
          :total="total"
          layout="sizes, prev, pager, next, jumper"
          @current-change="pageChanged"
          @size-change="pageSizeChanged"
        />
      </footer>
    </section>
    <template #dialogs>
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
.new-route-options {
  display: grid;
  gap: 6px;
}
.new-route-options .el-button {
  margin: 0;
}
.process-workspace {
  --route-ink: #171918;
  --route-secondary: #606764;
  --route-placeholder: #707772;
}
.process-workspace :deep(.team-workspace__title) {
  color: var(--route-ink);
  font-size: 20px;
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
  width: 86px;
  height: 32px;
  padding: 0;
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
.workspace-data-toolbar > .el-input {
  max-width: 640px;
}
.process-workspace :deep(.workspace-data-panel .workspace-data-toolbar) {
  padding-bottom: 14px;
}
.process-workspace :deep(.workspace-data-toolbar .el-button:not(.is-link)) {
  height: 32px;
  min-height: 32px;
  padding: 0 12px;
  border-radius: 8px;
  font-size: 14px;
  line-height: 20px;
}
.process-workspace :deep(.workspace-data-toolbar .el-input__wrapper) {
  min-height: 32px;
  height: 32px;
  border-radius: 8px;
  background: #fff;
}
.process-workspace :deep(.workspace-data-toolbar .el-input__inner) {
  color: var(--route-ink);
}
.process-workspace :deep(.workspace-toolbar-actions .el-button--primary) {
  font-weight: 600;
}
.process-workspace
  :deep(.workspace-data-toolbar .el-button.el-button--primary:not(.is-disabled):not(.is-loading)) {
  border-color: color-mix(in srgb, var(--primary) 88%, black);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--primary) 76%, white),
    var(--primary) 55%,
    color-mix(in srgb, var(--primary) 86%, black)
  );
  box-shadow:
    inset 0 1px 0 #ffffff75,
    inset 0 -1px 0 #0000001a,
    0 2px 4px #1e293b24;
}
.process-workspace :deep(.workspace-data-toolbar .el-button[aria-label='刷新工艺记录']) {
  width: 32px;
  padding: 0;
}
.workspace-toolbar-actions {
  margin-left: auto;
}
.route-list {
  flex: 1;
  min-height: 200px;
}
.process-workspace :deep(.workspace-data-panel .el-table.business-table.route-list) {
  --el-table-header-bg-color: #edf2ef;
  --el-table-header-text-color: #424b46;
  --el-table-text-color: var(--route-ink);
  --el-table-border-color: #e3e8e5;
  --el-table-row-hover-bg-color: #edf5f0;
  --table-hover-bg: #edf5f0;
  --table-header-line: #d3ded7;
  --table-glass-header: none;
  --table-glass-hover: none;
  --table-glass-selected-fill: none;
  --table-glass-edge: 0 0 0 transparent;
  --table-glass-hover-edge: 0 0 0 transparent;
  --table-glass-selected-edge: 0 0 0 transparent;
  border-color: #d8e0db;
  border-radius: 6px;
  box-shadow: none;
}
.process-workspace
  :deep(.workspace-data-panel .el-table.business-table.route-list th.el-table__cell) {
  height: 40px;
  font-size: 13px;
  font-weight: 600;
  background: var(--el-table-header-bg-color);
  color: var(--el-table-header-text-color);
  border-color: #d8e0db;
  border-bottom-color: var(--table-header-line);
  box-shadow: none;
}
.process-workspace
  :deep(.workspace-data-panel .el-table.business-table.route-list td.el-table__cell) {
  height: 44px;
  padding-block: 8px;
  color: var(--route-ink);
  background-image: none;
  box-shadow: none;
}
.route-empty {
  color: var(--route-placeholder);
  font-size: 13px;
  font-weight: 400;
  white-space: nowrap;
}
.route-modifier {
  color: var(--route-secondary);
  font-size: 13px;
}
.route-updated-at {
  color: var(--route-secondary);
  font-size: 13px;
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
  font-size: 13px;
  line-height: 20px;
  font-weight: 400;
}
.process-workspace .route-list .route-record-action:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
.process-workspace :deep(.workspace-data-panel .el-table.business-table.route-list .route-serial) {
  color: var(--route-ink);
  font-size: 14px;
  font-weight: 500;
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
.workspace-list-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
  padding-top: 18px;
  color: var(--route-secondary);
  font-size: 13px;
}
@media (prefers-reduced-motion: reduce) {
  .route-kind-switch button,
  .process-workspace .route-list .route-record-action {
    transition: none;
    transform: none;
  }
}
</style>
