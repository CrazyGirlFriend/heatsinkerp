<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Bell, Refresh, ArrowRight } from '@element-plus/icons-vue'
import {
  ElAlert,
  ElButton,
  ElIcon,
  ElCheckbox,
  ElPagination,
  ElTable,
  ElTableColumn,
  ElTag,
} from 'element-plus'
import AppDrawer from './AppDrawer.vue'
import { scheduleNoticeApi } from '@/services/scheduleNoticeApi'
import { businessNoticeApi, parseNotice, type BusinessNotice } from '@/services/businessNoticeApi'
import { useLiveRefresh } from '@/composables/useLiveRefresh'
import { formatDateTime } from '@/utils/format'

const props = defineProps<{ compact?: boolean; teamId?: number }>()
const router = useRouter()
const route = useRoute()
const category = ref('all')
const visible = ref(false),
  unreadOnly = ref(false),
  loading = ref(false),
  opening = ref(false)
const page = ref(1),
  total = ref(0),
  unread = ref(0),
  latestId = ref({ schedule: 0, rework: 0 }),
  error = ref('')
const items = ref<BusinessNotice[]>([])
const labels: Record<BusinessNotice['kind'], string> = {
  requested: '返工申请',
  ready: '返工工艺已定',
  new: '新增排期',
  changed: '计划调整',
  cancelled: '已取消',
  upstream: '上游调整',
  final_due: '最终交期',
  due_soon: '临近交期',
  overdue: '已逾期',
}
let disposed = false
let generation = 0,
  lastDeadlineRefresh = 0,
  timer: ReturnType<typeof setInterval> | undefined
async function load() {
  const token = ++generation
  loading.value = true
  try {
    if (Date.now() - lastDeadlineRefresh >= 60_000) {
      await scheduleNoticeApi.refresh()
      if (token !== generation) return
      lastDeadlineRefresh = Date.now()
    }
    const result = await businessNoticeApi.list(page.value, unreadOnly.value, category.value)
    if (token !== generation) return
    items.value = result.items
    total.value = result.total
    unread.value = result.unread
    latestId.value = result.latest
    error.value = ''
    const lastPage = Math.max(1, Math.ceil(result.total / 20))
    if (page.value > lastPage) page.value = lastPage
  } catch (e) {
    if (token === generation) error.value = e instanceof Error ? e.message : '消息读取失败'
  } finally {
    if (token === generation) loading.value = false
  }
}
async function openNotice(id: number, source: string) {
  const item = items.value.find((n) => n.id === id && n.source === source)
  if (!item || opening.value || loading.value) return
  opening.value = true
  try {
    const target = await businessNoticeApi.target(item.source, item.id)
    if (disposed) return
    // Close the inbox before the destination dialog opens, so the cue is unobscured.
    visible.value = false
    const failed = await router.push(
      `${target.href}&business_notice=${item.source}:${item.id}&notice=${Date.now()}`,
    )
    if (failed) visible.value = true
  } catch (e) {
    error.value = e instanceof Error ? e.message : '消息打开失败'
    visible.value = true
  } finally {
    opening.value = false
  }
}
async function opened(event: Event) {
  const key = (event as CustomEvent<string>).detail
  if (key !== route.query.notice) return
  const notice = parseNotice(route.query.business_notice)
  if (!notice) return
  try {
    await businessNoticeApi.read(notice.source, notice.id)
    if (!disposed) await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : '已打开，已读状态保存失败'
  }
}
function failed(event: Event) {
  const detail = (event as CustomEvent<{ key: string; message: string }>).detail
  if (detail.key !== route.query.notice) return
  error.value = detail.message
  visible.value = true
}
async function readAll() {
  try {
    await businessNoticeApi.readAll(latestId.value)
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : '标记失败'
  }
}
function rowClass({ row }: { row: BusinessNotice }) {
  return row.read_at ? '' : 'is-unread'
}
function show() {
  visible.value = true
  void load()
}
function filter(value: string) {
  if (category.value === value) return
  items.value = []
  category.value = value
  page.value = 1
}
const live = useLiveRefresh(load, {
  teamId: () => props.teamId,
  busy: () => loading.value || opening.value,
})
watch([page, unreadOnly, category], () => void load())
onMounted(() => {
  window.addEventListener('business-notice-opened', opened)
  window.addEventListener('business-notice-failed', failed)
  void load()
  timer = setInterval(() => {
    if (!document.hidden) live.request()
  }, 60_000)
})
onBeforeUnmount(() => {
  disposed = true
  window.removeEventListener('business-notice-opened', opened)
  window.removeEventListener('business-notice-failed', failed)
  ++generation
  clearInterval(timer)
})
</script>

<template>
  <button
    type="button"
    class="notice-trigger"
    :class="{ 'is-compact': compact }"
    :aria-label="`消息通知，${unread} 条未读${error ? '，同步失败' : ''}`"
    :aria-expanded="visible"
    @click="show"
  >
    <ElIcon><Bell /></ElIcon><span v-if="!compact">消息通知</span>
    <span v-if="unread" class="notice-count">{{ unread > 99 ? '99+' : unread }}</span>
    <span v-else-if="error" class="notice-error" aria-hidden="true">!</span>
  </button>
  <AppDrawer
    v-model="visible"
    title="消息通知"
    size="min(1120px, 96vw)"
    class="schedule-inbox"
    append-to-body
  >
    <div class="inbox-toolbar">
      <div class="inbox-tabs" role="group" aria-label="消息筛选">
        <button
          v-for="tab in [
            { value: 'all', label: '全部' },
            { value: 'rework', label: '返工' },
            { value: 'schedule', label: '排期' },
          ]"
          :key="tab.value"
          type="button"
          :aria-pressed="category === tab.value"
          @click="filter(tab.value)"
        >
          {{ tab.label }}
        </button>
      </div>
      <ElCheckbox v-model="unreadOnly" @change="page = 1">仅未读 {{ unread || '' }}</ElCheckbox>
      <ElButton :disabled="!unread || loading" @click="readAll">全部已读</ElButton>
      <ElButton :icon="Refresh" aria-label="刷新消息" :loading="loading" @click="load" />
    </div>
    <ElAlert v-if="error" :title="error" type="error" :closable="false" />
    <ElTable
      :data="items"
      border
      class="business-table inbox-table"
      :row-class-name="rowClass"
      :empty-text="loading ? '读取中' : unreadOnly ? '暂无未读消息' : '暂无消息'"
      height="100%"
    >
      <ElTableColumn label="类型" width="122"
        ><template #default="{ row }"
          ><ElTag
            :type="
              row.kind === 'overdue'
                ? 'danger'
                : ['due_soon', 'upstream', 'requested'].includes(row.kind)
                  ? 'warning'
                  : row.kind === 'cancelled'
                    ? 'info'
                    : 'success'
            "
            size="small"
            effect="plain"
            >{{ labels[row.kind as BusinessNotice['kind']] }}</ElTag
          ></template
        ></ElTableColumn
      >
      <ElTableColumn label="流水号" min-width="156"
        ><template #default="{ row }"
          ><button
            type="button"
            class="inbox-serial"
            :disabled="opening || loading"
            @click="openNotice(row.id, row.source)"
          >
            {{ row.serial_no }}
          </button></template
        ></ElTableColumn
      >
      <ElTableColumn prop="team_name" label="班组" width="82" />
      <ElTableColumn prop="message" label="内容" min-width="250" align="left" />
      <ElTableColumn v-if="category === 'rework'" prop="batch_no" label="批次号" width="172" />
      <ElTableColumn label="时间" width="146"
        ><template #default="{ row }">{{ formatDateTime(row.created_at) }}</template></ElTableColumn
      >
      <ElTableColumn label="打开" width="64" align="center" fixed="right"
        ><template #default="{ row }"
          ><ElButton
            :icon="ArrowRight"
            size="small"
            :aria-label="`打开 ${row.serial_no} ${labels[row.kind as BusinessNotice['kind']]}`"
            :disabled="opening || loading"
            @click="openNotice(row.id, row.source)" /></template
      ></ElTableColumn>
    </ElTable>
    <template #footer
      ><ElPagination
        v-model:current-page="page"
        :total="total"
        :page-size="20"
        :disabled="loading"
        layout="total, prev, pager, next"
    /></template>
  </AppDrawer>
</template>

<style scoped>
.notice-trigger {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 40px;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.6);
  color: var(--text);
  font: inherit;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.16s;
}
.notice-trigger:hover {
  background: var(--primary-soft);
}
.notice-trigger:focus-visible,
.inbox-serial:focus-visible,
.inbox-tabs button:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
.notice-trigger .el-icon {
  font-size: 18px;
}
.notice-count,
.notice-error {
  margin-left: auto;
  background: #b9473c;
  color: white;
  border-radius: 10px;
  padding: 1px 6px;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.notice-trigger.is-compact {
  position: relative;
  justify-content: center;
  padding: 8px;
}
.is-compact .notice-count,
.is-compact .notice-error {
  position: absolute;
  right: -4px;
  top: -5px;
}
.inbox-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
}
.inbox-toolbar :deep(.el-checkbox) {
  margin-right: 8px;
}
.inbox-tabs {
  display: flex;
  gap: 4px;
  margin-right: auto;
}
.inbox-tabs button {
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 7px 12px;
  border: 0;
  border-radius: 6px;
  color: var(--muted);
  background: transparent;
  font: inherit;
  cursor: pointer;
}
.inbox-tabs button[aria-pressed='true'] {
  color: var(--primary);
  background: var(--primary-soft);
  font-weight: 600;
}
.inbox-tabs span {
  font-size: 12px;
}
.inbox-toolbar .el-button {
  margin: 0;
}
.inbox-serial {
  border: 0;
  background: none;
  padding: 0;
  color: var(--primary);
  font: inherit;
  text-align: left;
  cursor: pointer;
  overflow-wrap: anywhere;
}
.inbox-table :deep(.is-unread) {
  --el-table-tr-bg-color: rgba(232, 244, 238, 0.65);
}
.inbox-table :deep(.is-unread .inbox-serial) {
  font-weight: 600;
}
.inbox-table :deep(.cell) {
  line-height: 1.5;
  font-size: 13px;
}
.el-pagination {
  justify-content: flex-end;
}
</style>
<style>
.schedule-inbox .el-drawer__body {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 16px 20px;
}
.schedule-inbox .inbox-table {
  flex: 1;
  min-height: 0;
}
.schedule-inbox .el-drawer__header {
  margin-bottom: 0;
  padding: 20px;
}
.schedule-inbox .el-drawer__title {
  font-size: 18px;
  font-weight: 600;
}
.schedule-inbox .el-drawer__footer {
  padding: 14px 20px;
}
</style>
