<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  Bell,
  Refresh,
  ArrowRight,
  Calendar,
  RefreshLeft,
  Warning,
  Loading,
} from '@element-plus/icons-vue'
import { ElAlert, ElButton, ElIcon, ElCheckbox, ElPagination } from 'element-plus'
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
    size="min(760px, 96vw)"
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
    <div class="inbox-content" :aria-busy="loading">
      <ul v-if="items.length" class="inbox-list" aria-label="业务消息">
        <li v-for="item in items" :key="`${item.source}:${item.id}`">
          <button
            type="button"
            class="inbox-serial inbox-item"
            :class="{ 'is-unread': !item.read_at }"
            :data-kind="item.kind"
            :disabled="opening || loading"
            :aria-label="`打开 ${item.serial_no} ${labels[item.kind]}，${item.team_name}，${item.message}${item.read_at ? '' : '，未读'}`"
            @click="openNotice(item.id, item.source)"
          >
            <span class="inbox-symbol" aria-hidden="true">
              <ElIcon>
                <RefreshLeft v-if="item.source === 'rework'" />
                <Warning v-else-if="item.kind === 'overdue'" />
                <Calendar v-else />
              </ElIcon>
              <i v-if="!item.read_at" class="inbox-unread-dot" />
            </span>
            <span class="inbox-summary">
              <span class="inbox-heading">
                <strong :title="item.serial_no">{{ item.serial_no }}</strong>
                <span class="inbox-team">{{ item.team_name }}</span>
                <time :datetime="item.created_at" :title="formatDateTime(item.created_at)">
                  {{ formatDateTime(item.created_at).slice(5) }}
                </time>
              </span>
              <span class="inbox-message">
                <span class="inbox-kind">{{ labels[item.kind] }}</span>
                <span>{{ item.message }}</span>
              </span>
              <span v-if="category === 'rework' && item.batch_no" class="inbox-batch">
                {{ item.batch_no }}
              </span>
            </span>
            <ElIcon class="inbox-arrow" aria-hidden="true"><ArrowRight /></ElIcon>
          </button>
        </li>
      </ul>
      <div v-else class="inbox-empty" role="status">
        <ElIcon :class="{ 'is-loading': loading }"
          ><Loading v-if="loading" /><Bell v-else
        /></ElIcon>
        <span>{{ loading ? '读取中' : unreadOnly ? '暂无未读消息' : '暂无消息' }}</span>
      </div>
    </div>
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
  border: 1px solid var(--line);
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
.inbox-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: #fff;
}
.inbox-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.inbox-list li + li {
  border-top: 1px solid var(--line);
}
.inbox-item {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) 18px;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 82px;
  padding: 14px 16px;
  border: 0;
  background: #fff;
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background var(--motion-fast);
}
.inbox-item:hover:not(:disabled),
.inbox-item:focus-visible {
  background: #f0f6f3;
}
.inbox-item:focus-visible {
  outline-offset: -3px;
}
.inbox-item:disabled {
  cursor: progress;
}
.inbox-symbol {
  position: relative;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 9px;
  background: #edf2f8;
  color: #3b648f;
  font-size: 18px;
}
.inbox-item[data-kind='requested'] .inbox-symbol,
.inbox-item[data-kind='ready'] .inbox-symbol {
  background: #f2edf8;
  color: #775499;
}
.inbox-item[data-kind='overdue'] .inbox-symbol {
  background: #fcefed;
  color: #ae3935;
}
.inbox-unread-dot {
  position: absolute;
  top: -2px;
  right: -2px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--primary);
  box-shadow: 0 0 0 2px white;
}
.inbox-summary {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.inbox-heading {
  display: flex;
  align-items: baseline;
  gap: 12px;
  min-width: 0;
}
.inbox-heading strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 500;
}
.is-unread .inbox-heading strong {
  font-weight: 650;
}
.inbox-team {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--muted);
}
.inbox-heading time {
  flex-shrink: 0;
  margin-left: auto;
  color: var(--muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.inbox-message {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 14px;
  line-height: 22px;
  overflow-wrap: anywhere;
}
.inbox-kind {
  flex-shrink: 0;
  color: #516579;
  font-size: 12px;
}
[data-kind='overdue'] .inbox-kind {
  color: #ae3935;
}
[data-kind='requested'] .inbox-kind,
[data-kind='due_soon'] .inbox-kind,
[data-kind='upstream'] .inbox-kind {
  color: #8c5b17;
}
.inbox-batch {
  font-size: 12px;
  color: var(--muted);
}
.inbox-arrow {
  color: #84928a;
  transition:
    transform var(--motion-fast),
    color var(--motion-fast);
}
.inbox-item:hover .inbox-arrow,
.inbox-item:focus-visible .inbox-arrow {
  color: var(--primary);
  transform: translateX(3px);
}
.inbox-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  min-height: 240px;
  height: 100%;
  color: var(--muted);
}
.inbox-empty .el-icon {
  font-size: 28px;
}
@media (max-width: 600px) {
  .inbox-toolbar {
    flex-wrap: wrap;
  }
  .inbox-tabs {
    flex: 1 0 100%;
  }
  .inbox-toolbar :deep(.el-checkbox) {
    margin-right: auto;
  }
  .inbox-item {
    gap: 8px;
    padding: 12px 10px;
  }
  .inbox-heading {
    flex-wrap: wrap;
    gap: 4px 8px;
  }
  .inbox-heading time {
    font-size: 11px;
  }
  .inbox-heading strong {
    flex: 1 0 calc(100% - 48px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .inbox-item,
  .inbox-arrow {
    transition: none;
  }
  .inbox-item .inbox-arrow {
    transform: none;
  }
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
