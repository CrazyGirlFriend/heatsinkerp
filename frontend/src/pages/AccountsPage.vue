<script setup lang="ts">
import {
  CircleCheck,
  Delete,
  EditPen,
  Key,
  Plus,
  Search,
  SwitchButton,
  User,
} from '@element-plus/icons-vue'
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
import {
  adminApi,
  type Account,
  type CreateAccountPayload,
  type EntityId,
  type Team,
} from '@/services/adminApi'
import { isAdmin, refreshCurrentUser } from '@/stores/auth'
import { refreshTeamDirectory } from '@/stores/teamDirectory'
import { showToast } from '@/stores/toast'

type StatusFilter = 'all' | 'active' | 'inactive'

interface LeaderForm {
  username: string
  display_name: string
  password: string
  team_id: EntityId | null
  active: boolean
}

const accounts = ref<Account[]>([])
const teams = ref<Team[]>([])
const loading = ref(true)
const saving = ref(false)
const deletingId = ref<EntityId | null>(null)
const errorMessage = ref('')
const query = ref('')
const statusFilter = ref<StatusFilter>('all')
const teamFilter = ref<string>('all')
const editorOpen = ref(false)
const editingId = ref<EntityId | null>(null)
const formError = ref('')
const usernameInput = ref<InputInstance | null>(null)
const displayNameInput = ref<InputInstance | null>(null)
const form = reactive<LeaderForm>({
  username: '',
  display_name: '',
  password: '',
  team_id: null,
  active: true,
})

const teamLeaders = computed(() => accounts.value.filter((account) => account.role === 'TEAM'))
const systemAdminCount = computed(() => accounts.value.filter((account) => account.role === 'ADMIN').length)
const filteredLeaders = computed(() => {
  const needle = query.value.trim().toLowerCase()
  return teamLeaders.value.filter((account) => {
    const matchesQuery = !needle || `${account.username} ${account.display_name} ${account.team?.name || ''}`.toLowerCase().includes(needle)
    const matchesStatus = statusFilter.value === 'all' || (statusFilter.value === 'active' ? account.active : !account.active)
    const matchesTeam = teamFilter.value === 'all' || String(account.team_id) === teamFilter.value
    return matchesQuery && matchesStatus && matchesTeam
  })
})
const page = ref(1)
const pageSize = ref(10)
const pageRows = computed(() => filteredLeaders.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))
watch([query, statusFilter, teamFilter, pageSize], () => { page.value = 1 })
watch(() => filteredLeaders.value.length, total => { page.value = Math.min(page.value, Math.max(1, Math.ceil(total / pageSize.value))) })

const selectableTeams = computed(() => teams.value.filter((team) => team.active))

async function refreshDirectoryAndAccount(): Promise<void> {
  await refreshTeamDirectory()
  await refreshCurrentUser().catch(() => showToast('账号已保存，当前账号信息刷新失败，请刷新页面重试', 'error'))
}

let requestVersion = 0
let disposed = false
onBeforeUnmount(() => { disposed = true; ++requestVersion })
async function loadData(background = false): Promise<void> {
  if (disposed) return
  if (background && (loading.value || saving.value || deletingId.value !== null)) { liveRefresh.request(); return }
  const version = ++requestVersion
  if (!isAdmin.value) {
    loading.value = false
    errorMessage.value = '仅系统管理员可维护班组长'
    return
  }
  if (!background) loading.value = true
  errorMessage.value = ''
  try {
    const [accountRows, teamRows] = await Promise.all([adminApi.listAccounts(), adminApi.listTeams()])
    if (version !== requestVersion) return
    accounts.value = accountRows
    teams.value = teamRows
  } catch (error) {
    if (version !== requestVersion) return
    if (background) throw error
    errorMessage.value = error instanceof Error ? error.message : '班组长数据加载失败'
  } finally {
    if (version === requestVersion) loading.value = false
  }
}
const liveRefresh = useLiveRefresh(async () => { await refreshCurrentUser(); await loadData(true) }, {
  enabled: () => isAdmin.value,
  busy: () => loading.value || saving.value || deletingId.value !== null,
})
watch(isAdmin, value => { if (!value) { ++requestVersion; accounts.value = []; teams.value = []; editorOpen.value = false } })

function resetForm(): void {
  form.username = ''
  form.display_name = ''
  form.password = ''
  form.team_id = null
  form.active = true
  formError.value = ''
}

function openCreate(): void {
  editingId.value = null
  resetForm()
  editorOpen.value = true
}

function openEdit(account: Account): void {
  if (account.role !== 'TEAM') return
  editingId.value = account.id
  form.username = account.username
  form.display_name = account.display_name
  form.password = ''
  form.team_id = account.team_id
  form.active = account.active
  formError.value = ''
  editorOpen.value = true
}

function focusEditor(): void {
  if (editingId.value === null) usernameInput.value?.focus()
  else displayNameInput.value?.focus()
}

function validateForm(): boolean {
  const usernamePattern = /^[A-Za-z0-9._-]+$/
  if (!form.username.trim()) formError.value = '请输入登录账号'
  else if (!usernamePattern.test(form.username.trim())) formError.value = '登录账号仅支持字母、数字、点、下划线和连字符'
  else if (!form.display_name.trim()) formError.value = '请输入班组长姓名'
  else if (editingId.value === null && form.password.length < 8) formError.value = '初始密码至少为 8 位'
  else if (editingId.value !== null && form.password && form.password.length < 8) formError.value = '新密码至少为 8 位'
  else if (!teams.value.some((team) => team.active && String(team.id) === String(form.team_id))) formError.value = '请选择有效班组'
  else formError.value = ''
  return !formError.value
}

async function submitForm(): Promise<void> {
  if (!validateForm() || saving.value) return
  saving.value = true
  ++requestVersion
  formError.value = ''
  try {
    if (editingId.value === null) {
      const payload: CreateAccountPayload = {
        username: form.username.trim(),
        display_name: form.display_name.trim(),
        password: form.password,
        role: 'TEAM',
        team_id: form.team_id,
        active: form.active,
      }
      const created = await adminApi.createAccount(payload)
      ++requestVersion
      accounts.value = [...accounts.value, created]
      showToast(`班组长“${created.display_name}”已创建`, 'success')
    } else {
      const updated = await adminApi.updateAccount(editingId.value, {
        display_name: form.display_name.trim(),
        role: 'TEAM',
        team_id: form.team_id,
        active: form.active,
        ...(form.password ? { password: form.password } : {}),
      })
      ++requestVersion
      const index = accounts.value.findIndex((account) => String(account.id) === String(editingId.value))
      if (index >= 0) accounts.value.splice(index, 1, updated)
      showToast(`班组长“${updated.display_name}”已更新`, 'success')
    }
    editorOpen.value = false
    await refreshDirectoryAndAccount()
  } catch (error) {
    formError.value = error instanceof Error ? error.message : '班组长保存失败'
  } finally {
    saving.value = false
  }
}

async function toggleLeader(account: Account): Promise<void> {
  if (account.role !== 'TEAM') return
  try {
    if (account.active) {
      await ElMessageBox.confirm(`停用班组长“${account.display_name}”？`, '停用班组长', {
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
    const updated = await adminApi.updateAccount(account.id, { active: !account.active })
    ++requestVersion
    const index = accounts.value.findIndex((item) => String(item.id) === String(account.id))
    if (index >= 0) accounts.value.splice(index, 1, updated)
    showToast(`${updated.display_name}已${updated.active ? '启用' : '停用'}`, 'success')
    await refreshDirectoryAndAccount()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '班组长状态更新失败', 'error')
  }
}

async function deleteLeader(account: Account): Promise<void> {
  if (account.role !== 'TEAM') return
  try {
    await ElMessageBox.confirm(`删除班组长“${account.display_name}”？历史流转记录不受影响。`, '删除班组长', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
      confirmButtonClass: 'el-button--danger',
    })
  } catch {
    return
  }
  deletingId.value = account.id
  ++requestVersion
  try {
    await adminApi.deleteAccount(account.id)
    ++requestVersion
    accounts.value = accounts.value.filter((item) => String(item.id) !== String(account.id))
    showToast(`班组长“${account.display_name}”已删除`, 'success')
    await refreshDirectoryAndAccount()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '班组长删除失败', 'error')
  } finally {
    deletingId.value = null
  }
}

function accountRowClass({ row }: { row: Account }): string {
  return row.active ? '' : 'row-inactive'
}

function asAccount(row: Record<PropertyKey, unknown>): Account {
  return row as unknown as Account
}

onMounted(() => void loadData())
</script>

<template>
  <section class="page admin-workspace accounts-page reading-workspace">
    <LiveRefreshNotice :message="liveRefresh.message.value" @retry="liveRefresh.request" />
    <header class="workspace-heading">
      <div>
        <h1>班组长管理</h1>
      </div>
      <ElButton type="primary" :icon="Plus" :disabled="!isAdmin" @click="openCreate">新增班组长</ElButton>
    </header>

    <p v-if="systemAdminCount" class="system-admin-notice">系统管理员 {{ systemAdminCount }} 个，由系统保留，不在此页面维护</p>

    <ElCard shadow="never" class="workspace-card">
      <div class="filter-bar">
        <ElInput v-model="query" clearable class="search-input" placeholder="账号、姓名或班组" aria-label="搜索班组长">
          <template #prefix><ElIcon><Search /></ElIcon></template>
        </ElInput>
        <ElSelect v-model="teamFilter" filterable aria-label="班组筛选">
          <ElOption value="all" label="全部班组" />
          <ElOption v-for="team in teams" :key="team.id" :value="String(team.id)" :label="team.name" />
        </ElSelect>
        <ElSelect v-model="statusFilter" aria-label="状态筛选">
          <ElOption value="all" label="全部状态" />
          <ElOption value="active" label="启用" />
          <ElOption value="inactive" label="停用" />
        </ElSelect>
      </div>

      <div v-if="loading" class="state-region" aria-live="polite"><ElSkeleton :rows="6" animated /></div>
      <ElResult v-else-if="errorMessage" icon="error" title="加载失败" :sub-title="errorMessage">
        <template #extra><ElButton v-if="isAdmin" @click="loadData()">重新加载</ElButton></template>
      </ElResult>
      <ElEmpty v-else-if="!filteredLeaders.length" description="暂无班组长">
        <ElButton v-if="isAdmin" type="primary" plain :icon="Plus" @click="openCreate">新增班组长</ElButton>
      </ElEmpty>

      <div v-else class="table-region">
        <span class="mobile-table-hint">左右滑动查看完整记录和操作</span>
        <ElTable
          class="business-table"
          :data="pageRows"
          row-key="id"
          :row-class-name="accountRowClass"
          table-layout="fixed"
        >
          <ElTableColumn label="登录账号" min-width="190" fixed="left">
            <template #default="{ row }">
              <div class="account-cell">
                <strong>{{ row.username }}</strong>
              </div>
            </template>
          </ElTableColumn>
          <ElTableColumn prop="display_name" label="班组长" min-width="150" show-overflow-tooltip />
          <ElTableColumn label="所属班组" min-width="170" show-overflow-tooltip>
            <template #default="{ row }">{{ row.team?.name || '未绑定' }}</template>
          </ElTableColumn>
          <ElTableColumn label="状态" width="100">
            <template #default="{ row }">
              <ElTag :type="row.active ? 'success' : 'info'" effect="plain">{{ row.active ? '启用' : '停用' }}</ElTag>
            </template>
          </ElTableColumn>
          <ElTableColumn label="操作" width="260" fixed="right" align="center">
            <template #default="{ row }">
              <ElButton link type="primary" :icon="EditPen" @click="openEdit(asAccount(row))">编辑</ElButton>
              <ElButton link :type="row.active ? 'warning' : 'success'" :icon="row.active ? SwitchButton : CircleCheck" @click="toggleLeader(asAccount(row))">{{ row.active ? '停用' : '启用' }}</ElButton>
              <ElButton link type="danger" :icon="Delete" :loading="String(deletingId) === String(row.id)" @click="deleteLeader(asAccount(row))">删除</ElButton>
            </template>
          </ElTableColumn>
        </ElTable>
      </div>
      <footer v-if="!loading && !errorMessage" class="admin-pagination"><ElPagination v-model:current-page="page" v-model:page-size="pageSize" :page-sizes="[10, 20, 50, 100]" :total="filteredLeaders.length" layout="total, sizes, prev, pager, next" /></footer>
    </ElCard>

    <ElDialog
      v-model="editorOpen"
      class="account-editor"
      :title="editingId === null ? '新增班组长' : '编辑班组长'"
      width="min(600px, 94vw)"
      destroy-on-close
      :close-on-click-modal="!saving"
      :close-on-press-escape="!saving"
      :show-close="!saving"
      @opened="focusEditor"
    >
      <ElForm :model="form" label-position="top" @submit.prevent="submitForm">
        <div class="form-grid">
          <ElFormItem label="登录账号" required>
            <ElInput ref="usernameInput" v-model="form.username" maxlength="64" autocomplete="off" placeholder="例如 roll_leader" :disabled="editingId !== null">
              <template #prefix><ElIcon><User /></ElIcon></template>
            </ElInput>
          </ElFormItem>
          <ElFormItem label="班组长姓名" required>
            <ElInput ref="displayNameInput" v-model="form.display_name" maxlength="80" autocomplete="off" placeholder="请输入姓名" />
          </ElFormItem>
          <ElFormItem class="field-wide" label="所属班组" required>
            <ElSelect v-model="form.team_id" class="full-width" filterable aria-label="所属班组" placeholder="请选择班组">
              <ElOption v-for="team in selectableTeams" :key="team.id" :value="team.id" :label="team.name" />
            </ElSelect>
          </ElFormItem>
          <ElFormItem class="field-wide" :label="editingId === null ? '初始密码' : '重置密码（留空则不修改）'" :required="editingId === null">
            <ElInput v-model="form.password" type="password" show-password minlength="8" maxlength="128" autocomplete="new-password" placeholder="至少 8 位">
              <template #prefix><ElIcon><Key /></ElIcon></template>
            </ElInput>
          </ElFormItem>
          <ElFormItem class="field-wide" label="账号状态">
            <div class="switch-row">
              <ElSwitch v-model="form.active" inline-prompt active-text="启" inactive-text="停" aria-label="启用班组长账号" />
              <span>{{ form.active ? '允许登录' : '禁止登录' }}</span>
            </div>
          </ElFormItem>
        </div>
        <ElAlert v-if="formError" :title="formError" type="error" show-icon :closable="false" />
        <button class="dialog-submit-proxy" type="submit" tabindex="-1" aria-hidden="true" />
      </ElForm>
      <template #footer>
        <ElButton :disabled="saving" @click="editorOpen = false">取消</ElButton>
        <ElButton type="primary" :loading="saving" :icon="CircleCheck" @click="submitForm">{{ editingId !== null ? '保存修改' : '创建账号' }}</ElButton>
      </template>
    </ElDialog>
  </section>
</template>

<style scoped>
.admin-pagination { display: flex; flex-shrink: 0; justify-content: flex-end; padding: 10px 0; overflow-x: auto; }

.account-cell { display: flex; align-items: center; justify-content: center; gap: 12px; }
.account-cell strong { overflow: hidden; color: var(--text); font-weight: 500; text-overflow: ellipsis; }
</style>
