<script setup lang="ts">
import { CircleCheck, Delete, EditPen, Plus, Search, SwitchButton } from '@element-plus/icons-vue'
import {
  ElAlert,
  ElButton,
  ElCard,
  ElDialog,
  ElEmpty,
  ElForm,
  ElFormItem,
  ElIcon,
  ElInput,
  ElInputNumber,
  ElMessageBox,
  ElOption,
  ElPagination,
  ElResult,
  ElSelect,
  ElSkeleton,
  ElSwitch,
  ElTable,
  ElTableColumn,
  ElTag,
  type InputInstance,
} from 'element-plus'
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import LiveRefreshNotice from '@/components/LiveRefreshNotice.vue'
import { useLiveRefresh } from '@/composables/useLiveRefresh'
import { adminApi, type EntityId, type Team, type TeamKind } from '@/services/adminApi'
import { isAdmin, refreshCurrentUser } from '@/stores/auth'
import { showToast } from '@/stores/toast'
import { refreshTeamDirectory } from '@/stores/teamDirectory'

type StatusFilter = 'all' | 'active' | 'inactive'

interface TeamForm {
  code: string
  name: string
  active: boolean
  sort_order: number
  kind: TeamKind
}

const teams = ref<Team[]>([])
const loading = ref(true)
const saving = ref(false)
const deletingId = ref<EntityId | null>(null)
const errorMessage = ref('')
const query = ref('')
const status = ref<StatusFilter>('all')
const editorOpen = ref(false)
const editingId = ref<EntityId | null>(null)
const formError = ref('')
const codeInput = ref<InputInstance | null>(null)
const nameInput = ref<InputInstance | null>(null)
const form = reactive<TeamForm>({ code: '', name: '', active: true, sort_order: 0, kind: 'production' })

const filteredTeams = computed(() => {
  const needle = query.value.trim().toLowerCase()
  return teams.value.filter((team) => {
    const matchesQuery = !needle || `${team.code} ${team.name}`.toLowerCase().includes(needle)
    const matchesStatus = status.value === 'all' || (status.value === 'active' ? team.active : !team.active)
    return matchesQuery && matchesStatus
  }).sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0) || String(left.id).localeCompare(String(right.id), undefined, { numeric: true }))
})

const page = ref(1)
const pageSize = ref(10)
const pageRows = computed(() => filteredTeams.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))
watch([query, status, pageSize], () => { page.value = 1 })
watch(() => filteredTeams.value.length, total => { page.value = Math.min(page.value, Math.max(1, Math.ceil(total / pageSize.value))) })

function isWarehouse(team: Team): boolean {
  return team.kind === 'warehouse' || team.code === 'FACTORY-WAREHOUSE'
}

let requestVersion = 0
let disposed = false
onBeforeUnmount(() => { disposed = true; ++requestVersion })
async function loadTeams(background = false): Promise<void> {
  if (disposed) return
  if (background && (loading.value || saving.value || deletingId.value !== null)) { liveRefresh.request(); return }
  const version = ++requestVersion
  if (!isAdmin.value) {
    loading.value = false
    errorMessage.value = '仅系统管理员可维护班组'
    return
  }
  if (!background) loading.value = true
  errorMessage.value = ''
  try {
    const result = await adminApi.listTeams()
    if (version === requestVersion) teams.value = result
  } catch (error) {
    if (version !== requestVersion) return
    if (background) throw error
    errorMessage.value = error instanceof Error ? error.message : '班组数据加载失败'
  } finally {
    if (version === requestVersion) loading.value = false
  }
}
const liveRefresh = useLiveRefresh(async () => { await refreshCurrentUser(); await loadTeams(true) }, {
  enabled: () => isAdmin.value,
  busy: () => loading.value || saving.value || deletingId.value !== null,
})
watch(isAdmin, value => { if (!value) { ++requestVersion; teams.value = []; editorOpen.value = false } })

function resetForm(): void {
  form.code = ''
  form.name = ''
  form.active = true
  form.sort_order = teams.value.length ? Math.min(1000000, Math.max(...teams.value.map((team) => team.sort_order ?? 0)) + 10) : 10
  form.kind = 'production'
  formError.value = ''
}

function openCreate(): void {
  editingId.value = null
  resetForm()
  editorOpen.value = true
}

function openEdit(team: Team): void {
  editingId.value = team.id
  form.code = team.code
  form.name = team.name
  form.active = team.active
  form.sort_order = team.sort_order ?? 0
  form.kind = team.kind ?? 'production'
  formError.value = ''
  editorOpen.value = true
}

function focusEditor(): void {
  if (editingId.value === null) codeInput.value?.focus()
  else nameInput.value?.focus()
}

function validateForm(): boolean {
  if (!form.code.trim()) formError.value = '请输入班组编码'
  else if (!form.name.trim()) formError.value = '请输入班组名称'
  else if (form.code.trim().length > 32) formError.value = '班组编码不能超过 32 个字符'
  else if (form.name.trim().length > 80) formError.value = '班组名称不能超过 80 个字符'
  else if (!Number.isInteger(form.sort_order) || form.sort_order < 0 || form.sort_order > 1000000) formError.value = '显示顺序必须为 0 至 1000000 的整数'
  else formError.value = ''
  return !formError.value
}

async function submitForm(): Promise<void> {
  if (!validateForm() || saving.value) return
  saving.value = true
  ++requestVersion
  formError.value = ''
  const payload = {
    code: form.code.trim().toUpperCase(),
    name: form.name.trim(),
    active: form.active,
    sort_order: form.sort_order,
    kind: form.kind,
  }
  try {
    if (editingId.value === null) {
      const created = await adminApi.createTeam(payload)
      ++requestVersion
      teams.value = [...teams.value, created]
      showToast(`班组“${created.name}”已创建`, 'success')
    } else {
      const updated = await adminApi.updateTeam(editingId.value, payload)
      ++requestVersion
      const index = teams.value.findIndex((team) => String(team.id) === String(editingId.value))
      if (index >= 0) teams.value.splice(index, 1, updated)
      showToast(`班组“${updated.name}”已更新`, 'success')
    }
    editorOpen.value = false
    await refreshTeamDirectory()
    await refreshCurrentUser().catch(() => showToast('班组已保存，当前账号信息刷新失败，请刷新页面重试', 'error'))
  } catch (error) {
    formError.value = error instanceof Error ? error.message : '班组保存失败'
  } finally {
    saving.value = false
  }
}

async function toggleTeam(team: Team): Promise<void> {
  if (isWarehouse(team)) {
    showToast('系统库房不能停用', 'error')
    return
  }
  try {
    if (team.active) {
      await ElMessageBox.confirm(`停用班组“${team.name}”？`, '停用班组', {
        confirmButtonText: '停用',
        cancelButtonText: '取消',
        type: 'warning',
      })
    }
  } catch {
    return
  }
  try {
    ++requestVersion
    const updated = await adminApi.updateTeam(team.id, { active: !team.active })
    ++requestVersion
    const index = teams.value.findIndex((item) => String(item.id) === String(team.id))
    if (index >= 0) teams.value.splice(index, 1, updated)
    showToast(`${updated.name}已${updated.active ? '启用' : '停用'}`, 'success')
    await refreshTeamDirectory()
    await refreshCurrentUser().catch(() => showToast('班组已保存，当前账号信息刷新失败，请刷新页面重试', 'error'))
  } catch (error) {
    showToast(error instanceof Error ? error.message : '班组状态更新失败', 'error')
  }
}

async function deleteTeam(team: Team): Promise<void> {
  if (isWarehouse(team)) {
    showToast('系统库房不能删除', 'error')
    return
  }
  try {
    await ElMessageBox.confirm(`删除班组“${team.name}”？已被账号或流转记录引用的班组不能删除。`, '删除班组', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
      confirmButtonClass: 'el-button--danger',
    })
  } catch {
    return
  }
  deletingId.value = team.id
  ++requestVersion
  try {
    await adminApi.deleteTeam(team.id)
    ++requestVersion
    teams.value = teams.value.filter((item) => String(item.id) !== String(team.id))
    showToast(`班组“${team.name}”已删除`, 'success')
    await refreshTeamDirectory()
    await refreshCurrentUser().catch(() => showToast('班组已保存，当前账号信息刷新失败，请刷新页面重试', 'error'))
  } catch (error) {
    showToast(error instanceof Error ? error.message : '班组删除失败', 'error')
  } finally {
    deletingId.value = null
  }
}

function teamRowClass({ row }: { row: Team }): string {
  return row.active ? '' : 'row-inactive'
}

function kindLabel(team: Team): string {
  if (isWarehouse(team)) return '库房'
  return team.kind === 'scrap' ? '转废班组' : '普通班组'
}

function kindTagType(team: Team): 'success' | 'danger' | 'info' {
  if (isWarehouse(team)) return 'success'
  return team.kind === 'scrap' ? 'danger' : 'info'
}

function asTeam(row: Record<PropertyKey, unknown>): Team {
  return row as unknown as Team
}

onMounted(() => void loadTeams())
</script>

<template>
  <section class="page admin-workspace teams-page reading-workspace">
    <LiveRefreshNotice :message="liveRefresh.message.value" @retry="liveRefresh.request" />
    <header class="workspace-heading">
      <div>
        <h1>班组管理</h1>
      </div>
      <ElButton type="primary" :icon="Plus" :disabled="!isAdmin" @click="openCreate">新增班组</ElButton>
    </header>

    <ElCard shadow="never" class="workspace-card">
      <div class="filter-bar">
        <ElInput v-model="query" clearable placeholder="班组编码或名称" aria-label="搜索班组">
          <template #prefix><ElIcon><Search /></ElIcon></template>
        </ElInput>
        <ElSelect v-model="status" aria-label="使用状态">
          <ElOption value="all" label="全部状态" />
          <ElOption value="active" label="启用" />
          <ElOption value="inactive" label="停用" />
        </ElSelect>
      </div>

      <div v-if="loading" class="state-region" aria-live="polite"><ElSkeleton :rows="6" animated /></div>
      <ElResult v-else-if="errorMessage" icon="error" title="加载失败" :sub-title="errorMessage">
        <template #extra><ElButton v-if="isAdmin" @click="loadTeams()">重新加载</ElButton></template>
      </ElResult>
      <ElEmpty v-else-if="!filteredTeams.length" description="暂无班组">
        <ElButton v-if="isAdmin" type="primary" plain :icon="Plus" @click="openCreate">新增班组</ElButton>
      </ElEmpty>

      <div v-else class="table-region">
        <span class="mobile-table-hint">左右滑动查看完整记录和操作</span>
        <ElTable class="business-table" :data="pageRows" row-key="id" :row-class-name="teamRowClass" table-layout="fixed">
          <ElTableColumn label="班组编码" min-width="150">
            <template #default="{ row }"><span class="code-cell">{{ row.code }}</span></template>
          </ElTableColumn>
          <ElTableColumn prop="name" label="班组名称" min-width="180" show-overflow-tooltip />
          <ElTableColumn label="班组属性" min-width="140">
            <template #default="{ row }">
              <ElTag :type="kindTagType(asTeam(row))" effect="plain">{{ kindLabel(asTeam(row)) }}</ElTag>
            </template>
          </ElTableColumn>
          <ElTableColumn prop="sort_order" label="显示顺序" width="120" align="center" />
          <ElTableColumn label="状态" width="100">
            <template #default="{ row }"><ElTag :type="row.active ? 'success' : 'info'" effect="plain">{{ row.active ? '启用' : '停用' }}</ElTag></template>
          </ElTableColumn>
          <ElTableColumn label="操作" width="260" align="center">
            <template #default="{ row }">
              <template v-if="isWarehouse(asTeam(row))"><ElTag type="info" effect="plain">系统项</ElTag></template>
              <template v-else>
                <ElButton link type="primary" :icon="EditPen" @click="openEdit(asTeam(row))">编辑</ElButton>
                <ElButton link :type="row.active ? 'warning' : 'success'" :icon="row.active ? SwitchButton : CircleCheck" @click="toggleTeam(asTeam(row))">{{ row.active ? '停用' : '启用' }}</ElButton>
                <ElButton link type="danger" :icon="Delete" :loading="String(deletingId) === String(row.id)" @click="deleteTeam(asTeam(row))">删除</ElButton>
              </template>
            </template>
          </ElTableColumn>
        </ElTable>
      </div>
      <footer v-if="!loading && !errorMessage" class="admin-pagination"><ElPagination v-model:current-page="page" v-model:page-size="pageSize" :page-sizes="[10, 20, 50, 100]" :total="filteredTeams.length" layout="total, sizes, prev, pager, next" /></footer>
    </ElCard>

    <ElDialog
      v-model="editorOpen"
      class="editor-modal"
      :title="editingId === null ? '新增班组' : '编辑班组'"
      width="min(600px, 94vw)"
      destroy-on-close
      :close-on-click-modal="!saving"
      :close-on-press-escape="!saving"
      :show-close="!saving"
      @opened="focusEditor"
    >
      <ElForm :model="form" label-position="top" @submit.prevent="submitForm">
        <div class="form-grid">
          <ElFormItem label="班组编码" required>
            <ElInput ref="codeInput" v-model="form.code" maxlength="32" autocomplete="off" placeholder="例如 ZB" aria-label="班组编码" />
          </ElFormItem>
          <ElFormItem label="班组名称" required>
            <ElInput ref="nameInput" v-model="form.name" maxlength="80" autocomplete="off" placeholder="例如 扎板" aria-label="班组名称" />
          </ElFormItem>
          <ElFormItem label="显示顺序">
            <ElInputNumber v-model="form.sort_order" class="full-width" :min="0" :max="1000000" :step="10" controls-position="right" aria-label="显示顺序" />
          </ElFormItem>
          <ElFormItem class="field-wide" label="班组状态">
            <div class="switch-row">
              <ElSwitch v-model="form.active" inline-prompt active-text="启" inactive-text="停" aria-label="启用班组" />
              <span>{{ form.active ? '可参与转料并绑定班组长' : '停止新业务分配' }}</span>
            </div>
          </ElFormItem>
        </div>
        <ElAlert v-if="formError" :title="formError" type="error" show-icon :closable="false" />
        <button class="dialog-submit-proxy" type="submit" tabindex="-1" aria-hidden="true" />
      </ElForm>
      <template #footer>
        <ElButton :disabled="saving" @click="editorOpen = false">取消</ElButton>
        <ElButton type="primary" :loading="saving" @click="submitForm">保存班组</ElButton>
      </template>
    </ElDialog>
  </section>
</template>

<style scoped>
.admin-pagination { display: flex; flex-shrink: 0; justify-content: flex-end; padding: 10px 0; overflow-x: auto; }

.code-cell { color: var(--text); font-size: 14px; font-variant-numeric: tabular-nums; }
</style>
