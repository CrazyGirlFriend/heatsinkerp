<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  ElAlert,
  ElButton,
  ElInput,
  ElPagination,
  ElTable,
  ElTableColumn,
  ElTag,
} from 'element-plus'
import PageBackButton from '@/components/PageBackButton.vue'
import AppDialog from '@/components/AppDialog.vue'
import { useAuthStore } from '@/stores/auth'
import { productionScheduleApi } from '@/services/productionScheduleApi'
import type { BusinessPerson } from '@/types/productionSchedule'
const asPerson = (row: unknown) => row as BusinessPerson
const auth = useAuthStore(),
  canManage = computed(() => auth.isAdmin && !auth.currentUserError && auth.currentUser?.active)
const rows = ref<BusinessPerson[]>([]),
  total = ref(0),
  page = ref(1),
  query = ref(''),
  loading = ref(false),
  saving = ref(false),
  error = ref('')
const open = ref(false),
  editing = ref<BusinessPerson | null>(null),
  name = ref(''),
  removeTarget = ref<BusinessPerson | null>(null)
let generation = 0
async function load() {
  const token = ++generation
  loading.value = true
  error.value = ''
  try {
    const result = await productionScheduleApi.people({
      query: query.value.trim() || undefined,
      page: page.value,
      page_size: 20,
    })
    if (token === generation) {
      rows.value = result.items
      total.value = result.total
    }
  } catch (e) {
    if (token === generation) error.value = e instanceof Error ? e.message : '名单读取失败'
  } finally {
    if (token === generation) loading.value = false
  }
}
function search() {
  page.value = 1
  void load()
}
function changePage(value: number) {
  page.value = value
  void load()
}
function edit(person?: BusinessPerson) {
  editing.value = person || null
  name.value = person?.name || ''
  error.value = ''
  open.value = true
}
async function save(person?: BusinessPerson, active?: boolean) {
  if (!canManage.value || saving.value) return
  saving.value = true
  error.value = ''
  const target = person || editing.value
  try {
    await productionScheduleApi.savePerson(
      {
        name: person?.name || name.value.trim(),
        active: active ?? target?.active ?? true,
        ...(target ? { expected_version: target.version } : {}),
      },
      target?.id,
    )
    open.value = false
    removeTarget.value = null
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : '保存失败'
  } finally {
    saving.value = false
  }
}
onMounted(load)
</script>
<template>
  <section class="page reading-workspace business-people-page">
    <header class="page-heading-start">
      <PageBackButton />
      <h1>业务班组</h1>
    </header>
    <div class="workspace-data-toolbar">
      <ElInput
        v-model="query"
        placeholder="搜索业务人员"
        clearable
        @keyup.enter="search"
        @clear="search"
      /><ElButton :loading="loading" @click="search">查询</ElButton
      ><ElButton v-if="canManage" type="primary" @click="edit()">添加人员</ElButton>
    </div>
    <ElAlert v-if="error" :title="error" type="error" :closable="false" />
    <ElTable :data="rows" border class="business-table" height="100%" aria-label="业务人员名单"
      ><ElTableColumn prop="name" label="业务人员" /><ElTableColumn label="状态" width="120"
        ><template #default="{ row }"
          ><ElTag :type="row.active ? 'success' : 'info'">{{
            row.active ? '在册' : '已移除'
          }}</ElTag></template
        ></ElTableColumn
      ><ElTableColumn v-if="canManage" label="操作" width="180"
        ><template #default="{ row }"
          ><ElButton link type="primary" @click="edit(asPerson(row))">修改</ElButton
          ><ElButton v-if="row.active" link type="danger" @click="removeTarget = asPerson(row)"
            >删除</ElButton
          ><ElButton v-else link @click="save(asPerson(row), true)">恢复</ElButton></template
        ></ElTableColumn
      ></ElTable
    >
    <ElPagination
      :current-page="page"
      :page-size="20"
      :total="total"
      layout="total,prev,pager,next"
      @current-change="changePage"
    />
    <AppDialog
      v-model="open"
      :title="editing ? '修改业务人员' : '添加业务人员'"
      width="420px"
      append-to-body
      :close-on-click-modal="!saving"
      ><ElAlert v-if="error" :title="error" type="error" :closable="false" /><ElInput
        v-model="name"
        maxlength="80"
        aria-label="业务人员姓名"
        placeholder="姓名"
        @keyup.enter="save()"
      /><template #footer
        ><ElButton :disabled="saving" @click="open = false">取消</ElButton
        ><ElButton type="primary" :loading="saving" :disabled="!name.trim()" @click="save()"
          >保存</ElButton
        ></template
      ></AppDialog
    >
    <AppDialog
      :model-value="!!removeTarget"
      title="删除业务人员"
      width="420px"
      append-to-body
      :close-on-click-modal="!saving"
      @close="!saving && (removeTarget = null)"
      ><p>将 {{ removeTarget?.name }} 移出业务名单？历史订单的人员记录会保留。</p>
      <ElAlert v-if="error" :title="error" type="error" :closable="false" /><template #footer
        ><ElButton :disabled="saving" @click="removeTarget = null">取消</ElButton
        ><ElButton
          type="danger"
          :loading="saving"
          @click="removeTarget && save(removeTarget, false)"
          >删除</ElButton
        ></template
      ></AppDialog
    >
  </section>
</template>
<style scoped>
.business-people-page {
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: 100%;
  min-height: 0;
}
.business-people-page h1 {
  margin: 0;
  font-size: 18px;
}
.workspace-data-toolbar {
  display: flex;
  gap: 8px;
}
.workspace-data-toolbar .el-input {
  max-width: 360px;
}
.business-table {
  flex: 1;
  min-height: 0;
}
</style>
