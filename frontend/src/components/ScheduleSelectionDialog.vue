<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ElAlert, ElButton, ElIcon, ElInput, ElPagination } from 'element-plus'
import { Check, Search } from '@element-plus/icons-vue'
import AppDialog from './AppDialog.vue'
import { useAuthStore } from '@/stores/auth'
import { productionScheduleApi } from '@/services/productionScheduleApi'
import type { BusinessPerson, ScheduleSelection } from '@/types/productionSchedule'

const props = defineProps<{
  kind: 'serial' | 'people'
  selected: ScheduleSelection[]
  single?: boolean
  manage?: boolean
  activeOnly?: boolean
}>()
const emit = defineEmits<{ close: []; apply: [items: ScheduleSelection[]] }>()
const visible = ref(true)
const auth = useAuthStore()
const canManage = computed(
  () =>
    props.kind === 'people' &&
    auth.isAdmin &&
    !auth.currentUserError &&
    auth.currentUser?.active !== false,
)
const title = computed(() =>
  props.kind === 'serial' ? '选择显示的流水号' : props.manage ? '业务人员名单' : '选择业务人员',
)
type Option = ScheduleSelection & { description: string; person?: BusinessPerson }
const rows = ref<Option[]>([]),
  chosen = ref<ScheduleSelection[]>([...props.selected]),
  query = ref(''),
  page = ref(1),
  total = ref(0),
  loading = ref(false),
  error = ref('')
const personName = ref(''),
  editing = ref<BusinessPerson | null>(null),
  saving = ref(false)
let generation = 0
async function load(reset = false) {
  if (reset) page.value = 1
  const token = ++generation
  loading.value = true
  error.value = ''
  try {
    const params = { query: query.value.trim() || undefined, page: page.value, page_size: 20 }
    if (props.kind === 'people') {
      const data = await productionScheduleApi.people(params)
      if (token !== generation) return
      rows.value = data.items.map((person) => ({
        value: person.id,
        label: person.name,
        description: person.active ? '启用' : '已停用',
        person,
      }))
      total.value = data.total
    } else {
      const data = await productionScheduleApi.serialOptions(params)
      if (token !== generation) return
      rows.value = data.items.map((item) => ({
        value: item.serial_no,
        label: item.serial_no,
        description: `${item.task_count} 项交货任务`,
      }))
      total.value = data.total
    }
  } catch (reason) {
    if (token === generation)
      error.value = reason instanceof Error ? reason.message : '名单加载失败'
  } finally {
    if (token === generation) loading.value = false
  }
}
function select(option: Option) {
  if (props.manage || (props.activeOnly && option.person?.active === false)) return
  if (props.single) {
    emit('apply', [{ value: option.value, label: option.label }])
    return
  }
  const index = chosen.value.findIndex((item) => item.value === option.value)
  if (index >= 0) chosen.value.splice(index, 1)
  else if (chosen.value.length < 100)
    chosen.value.push({ value: option.value, label: option.label })
  else error.value = '一次最多选择 100 项'
}
async function savePerson(person?: BusinessPerson) {
  if (!canManage.value || saving.value) return
  const name = person ? person.name : personName.value.trim()
  if (!name) {
    error.value = '请填写业务人员姓名'
    return
  }
  saving.value = true
  error.value = ''
  try {
    await productionScheduleApi.savePerson(
      {
        name,
        active: person ? !person.active : (editing.value?.active ?? true),
        expected_version: person?.version ?? editing.value?.version,
      },
      person?.id ?? editing.value?.id,
    )
    editing.value = null
    personName.value = ''
    await load()
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '业务人员保存失败'
  } finally {
    saving.value = false
  }
}
function cancelEdit() {
  editing.value = null
  personName.value = ''
}
function startEdit(person: BusinessPerson) {
  editing.value = person
  personName.value = person.name
}
function changePage(value: number) {
  page.value = value
  void load()
}
onMounted(() => void load())
onBeforeUnmount(() => {
  ++generation
})
</script>

<template>
  <AppDialog
    v-model="visible"
    :title="title"
    width="min(680px, 94vw)"
    append-to-body
    :close-on-click-modal="!saving"
    :close-on-press-escape="!saving"
    :show-close="!saving"
    @closed="emit('close')"
  >
    <section class="schedule-selection" :aria-busy="loading || saving">
      <form class="selection-search" @submit.prevent="load(true)">
        <ElInput
          v-model="query"
          :prefix-icon="Search"
          :aria-label="kind === 'serial' ? '搜索排期流水号' : '搜索业务人员'"
          :placeholder="kind === 'serial' ? '搜索流水号' : '搜索姓名'"
          clearable
          @clear="load(true)"
        /><ElButton native-type="submit">查询</ElButton>
      </form>
      <ElAlert v-if="error" :title="error" type="error" :closable="false" />
      <div v-if="canManage && manage" class="selection-person-form">
        <ElInput
          v-model="personName"
          aria-label="业务人员姓名"
          placeholder="业务人员姓名"
          maxlength="80"
          @keyup.enter="savePerson()"
        /><ElButton type="primary" :loading="saving" @click="savePerson()">{{
          editing ? '保存姓名' : '添加人员'
        }}</ElButton
        ><ElButton v-if="editing" @click="cancelEdit">取消修改</ElButton>
      </div>
      <div v-if="!manage && !single" class="selection-summary">
        <span>已选 {{ chosen.length }} 项，跨页保留</span
        ><ElButton link type="primary" @click="chosen = []">清空选择</ElButton>
      </div>
      <div class="selection-options" :class="{ 'is-loading': loading }">
        <div v-for="option in rows" :key="option.value" class="selection-row">
          <button
            v-if="!manage"
            type="button"
            class="selection-choice"
            :disabled="loading || (activeOnly && option.person?.active === false)"
            :aria-pressed="chosen.some((item) => item.value === option.value)"
            @click="select(option)"
          >
            <span v-if="!single" class="selection-check" aria-hidden="true"
              ><ElIcon v-if="chosen.some((item) => item.value === option.value)"
                ><Check /></ElIcon></span
            ><strong>{{ option.label }}</strong
            ><small>{{ option.description }}</small>
          </button>
          <span v-else class="selection-person"
            ><strong>{{ option.label }}</strong
            ><small>{{ option.description }}</small></span
          >
          <template v-if="manage && option.person"
            ><ElButton link type="primary" :disabled="saving" @click="startEdit(option.person)"
              >修改</ElButton
            ><ElButton link :disabled="saving" @click="savePerson(option.person)">{{
              option.person.active ? '停用' : '启用'
            }}</ElButton></template
          >
        </div>
        <p v-if="!rows.length" role="status">{{ loading ? '正在读取…' : '暂无匹配记录' }}</p>
      </div>
      <ElPagination
        :current-page="page"
        :page-size="20"
        :total="total"
        layout="total, prev, pager, next"
        @current-change="changePage"
      />
    </section>
    <template #footer
      ><ElButton :disabled="saving" @click="visible = false">{{
        manage ? '关闭' : '取消'
      }}</ElButton
      ><ElButton
        v-if="!manage"
        type="primary"
        :disabled="loading || saving"
        @click="emit('apply', single ? [] : chosen)"
        >{{ single ? '清除业务人员' : '应用选择' }}</ElButton
      ></template
    >
  </AppDialog>
</template>

<style scoped>
.schedule-selection {
  display: grid;
  gap: 14px;
}
.selection-search,
.selection-person-form,
.selection-summary {
  display: flex;
  align-items: center;
  gap: 8px;
}
.selection-summary {
  justify-content: space-between;
  color: var(--muted);
  font-size: 12px;
}
.selection-options {
  max-height: min(420px, 55vh);
  overflow: auto;
  border: 1px solid var(--line);
  border-radius: 12px;
}
.selection-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
  border-bottom: 1px solid var(--line);
}
.selection-row:last-child {
  border-bottom: 0;
}
.selection-choice,
.selection-person {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 14px 4px;
}
.selection-choice {
  border: 0;
  color: var(--text);
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.selection-choice[aria-pressed='true'] {
  color: var(--primary);
}
.selection-choice:hover {
  background: var(--glass-hover-fill);
}
.selection-choice strong,
.selection-person strong {
  font-weight: 500;
  overflow-wrap: anywhere;
}
.selection-choice small,
.selection-person small {
  color: var(--muted);
  margin-left: auto;
  white-space: nowrap;
}
.selection-choice:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: -2px;
  border-radius: 8px;
}
.selection-choice:disabled {
  opacity: 0.5;
  cursor: default;
}
.selection-options > p {
  padding: 30px;
  text-align: center;
  color: var(--muted);
}
.selection-check {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  border: 1px solid var(--line);
  border-radius: 4px;
  color: var(--primary);
}
</style>
