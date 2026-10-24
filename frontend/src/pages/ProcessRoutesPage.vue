<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Refresh, Search, Setting, Plus, ArrowDown } from '@element-plus/icons-vue'
import {
  ElAlert,
  ElButton,
  ElInput,
  ElLoading,
  ElPagination,
  ElSelect,
  ElOption,
  ElDropdown,
  ElDropdownMenu,
  ElDropdownItem,
  ElIcon,
  ElTag,
  ElTable,
  ElTableColumn,
} from 'element-plus'
import TeamWorkspaceShell from '@/components/TeamWorkspaceShell.vue'
import TeamBusinessDialog from '@/components/TeamBusinessDialog.vue'
import ProcessRouteEditor from '@/components/ProcessRouteEditor.vue'
import ReworkRoutePicker from '@/components/ReworkRoutePicker.vue'
import { useAuthStore } from '@/stores/auth'
import { useTeamDirectoryStore } from '@/stores/teamDirectory'
import { processRouteApi } from '@/services/processRouteApi'
import type { ProcessRoute } from '@/types/processRoute'
import { formatDateTime } from '@/utils/format'
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
const routeKind = ref<'normal' | 'rework' | 'all'>('all')
function changeKind() {
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
  settingsOpen = ref(false),
  reworkPickerOpen = ref(false)
function create(kind: string) {
  if (!canEdit.value) return
  if (kind === 'rework') reworkPickerOpen.value = true
  else creating.value = true
}
function selectRework(route: ProcessRoute) {
  reworkPickerOpen.value = false
  selected.value = route
  editing.value = true
}
function closeEditor() {
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
      undefined,
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
onMounted(() => {
  void directory.refreshTeamDirectory()
  void load()
})
onBeforeUnmount(() => {
  ++generation
  ++detailGeneration
})
</script>
<template>
  <TeamWorkspaceShell title="工艺" model-value="process-routes" engineering>
    <template v-if="canEdit && team" #settings>
      <ElButton :icon="Setting" @click="settingsOpen = true">班组设置</ElButton>
    </template>
    <ElAlert v-if="error" :title="error" type="error" :closable="false" />
    <section class="workspace-data-panel">
      <div class="workspace-data-toolbar">
        <ElInput
          v-model="query"
          :prefix-icon="Search"
          clearable
          placeholder="搜索流水号、批次号、工艺人员"
          aria-label="工艺记录搜索"
          @keyup.enter="search"
          @clear="search"
        />
        <ElSelect
          v-model="routeKind"
          aria-label="工艺类型筛选"
          class="route-kind-filter"
          :disabled="loading"
          @change="changeKind"
        >
          <ElOption label="全部工艺" value="all" />
          <ElOption label="正常工艺" value="normal" />
          <ElOption label="返工工艺" value="rework" />
        </ElSelect>
        <ElButton class="action-warm" :disabled="loading" @click="search">查询</ElButton>
        <ElButton :icon="Refresh" aria-label="刷新工艺记录" :disabled="loading" @click="load" />
        <div v-if="canEdit" class="workspace-toolbar-actions">
          <ElDropdown trigger="click" :disabled="loading" @command="create">
            <ElButton type="primary" :icon="Plus" :disabled="loading"
              >新建工艺<ElIcon><ArrowDown /></ElIcon
            ></ElButton>
            <template #dropdown
              ><ElDropdownMenu>
                <ElDropdownItem command="normal">正常工艺</ElDropdownItem>
                <ElDropdownItem command="rework">返工工艺</ElDropdownItem>
              </ElDropdownMenu></template
            >
          </ElDropdown>
        </div>
      </div>
      <ElTable
        v-loading="loading"
        :data="items"
        border
        row-key="id"
        class="business-table team-table route-list"
        height="100%"
        aria-label="工艺记录"
        :default-sort="{ prop: 'updated_at', order: 'descending' }"
        @sort-change="sortChanged"
      >
        <ElTableColumn label="流水号" min-width="300" align="center"
          ><template #default="{ row }"
            ><ElButton
              v-if="row.serial_nos[0]"
              class="route-serial"
              type="primary"
              link
              @click="open(row.id)"
              >{{ row.serial_nos[0] }}</ElButton
            ><span v-else>—</span>
            <small v-if="row.route_kind === 'rework'" class="rework-scope"
              >{{ row.rework_batch_no }} · {{ row.rework_quantity }} 件 ·
              {{ row.rework_weight }} kg</small
            >
          </template></ElTableColumn
        >
        <ElTableColumn label="工艺类型" width="125" align="center">
          <template #default="{ row }"
            ><ElTag :type="row.route_kind === 'rework' ? 'warning' : 'primary'">{{
              row.route_kind === 'rework' ? '返工工艺' : '正常工艺'
            }}</ElTag></template
          >
        </ElTableColumn>
        <ElTableColumn label="工艺人员" width="160" align="center"
          ><template #default="{ row }">{{
            row.engineering_employee_name || '—'
          }}</template></ElTableColumn
        >
        <ElTableColumn label="修改人员" width="150" align="center"
          ><template #default="{ row }">{{
            row.modified_employee_id && row.modified_employee_id !== row.engineering_employee_id
              ? row.modified_employee_name
              : '—'
          }}</template></ElTableColumn
        >
        <ElTableColumn
          prop="updated_at"
          label="更新时间"
          width="200"
          align="center"
          sortable="custom"
          :sort-orders="['descending', 'ascending']"
          ><template #default="{ row }">{{
            formatDateTime(row.updated_at || row.created_at)
          }}</template></ElTableColumn
        >
        <ElTableColumn v-if="canEdit" label="操作" width="140" align="center" fixed="right"
          ><template #default="{ row }"
            ><ElButton
              type="primary"
              link
              @click="open(row.id, row.route_kind !== 'rework' || row.state !== 'published')"
              >{{
                row.route_kind === 'rework'
                  ? row.state === 'published'
                    ? '查看返工工艺'
                    : '制定返工工艺'
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
      <ReworkRoutePicker
        v-if="reworkPickerOpen && canEdit"
        @close="reworkPickerOpen = false"
        @selected="selectRework"
      />
      <ProcessRouteEditor
        v-if="selected || creating"
        :key="selected?.id || 'new'"
        :route="selected || undefined"
        :start-editing="editing"
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
.rework-scope {
  display: block;
  color: var(--muted);
  font-size: 12px;
}
.route-kind-filter {
  flex: 0 0 145px;
}
.workspace-data-toolbar > .el-input {
  max-width: 640px;
}
.workspace-toolbar-actions {
  margin-left: auto;
}
.route-list {
  flex: 1;
  min-height: 200px;
}
.route-serial {
  color: var(--primary);
  font-weight: 600;
  overflow-wrap: anywhere;
  max-width: 100%;
  height: auto;
  white-space: normal;
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
  color: var(--muted);
  font-size: 13px;
}
</style>
