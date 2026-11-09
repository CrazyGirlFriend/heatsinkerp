<script setup lang="ts">
import AppButton from '@/components/AppButton.vue'
import ElAlert from '@/components/AppAlert.vue'
import WorkspacePagination from '@/components/WorkspacePagination.vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  Bell,
  Refresh,
  ArrowRight,
  Calendar,
  RefreshLeft,
  Warning,
  Loading,
  DocumentChecked,
  Back,
} from '@element-plus/icons-vue'
import { ElIcon } from 'element-plus'
import WatermelonSegmented from './watermelon/WatermelonSegmented.vue'
import ElButton from '@/components/AppButton.vue'
import AppDrawer from './AppDrawer.vue'
import TransferAmendmentReview from './TransferAmendmentReview.vue'
import { scheduleNoticeApi } from '@/services/scheduleNoticeApi'
import { businessNoticeApi, parseNotice, type BusinessNotice } from '@/services/businessNoticeApi'
import { useLiveRefresh } from '@/composables/useLiveRefresh'
import { formatDateTime } from '@/utils/format'

const props = defineProps<{ compact?: boolean; teamId?: number }>()
const router = useRouter()
const route = useRoute()
const view = ref('all')
const source = ref('all')
const category = computed(() => (view.value === 'pending' ? 'pending' : source.value))
const unreadOnly = computed(() => view.value === 'unread')
const visible = ref(false),
  loading = ref(false),
  opening = ref(false)
const page = ref(1),
  total = ref(0),
  unread = ref(0),
  latestId = ref({ schedule: 0, rework: 0, transfer: 0, quality: 0 }),
  error = ref('')
const items = ref<BusinessNotice[]>([])
const selected = ref<BusinessNotice | null>(null)
const detailPanel = ref<HTMLElement>()
const selectedKey = computed(() =>
  selected.value ? `${selected.value.source}:${selected.value.id}` : '',
)
const markingRead = new Set<string>()
const reviewBusy = ref(false)
const views = computed(() => [
  { value: 'all', label: '全部', disabled: opening.value },
  { value: 'unread', label: '未读', count: unread.value, disabled: opening.value },
  { value: 'pending', label: '待处理', disabled: opening.value },
])
const sources = computed(() => [
  { value: 'all', label: '全部', disabled: opening.value },
  { value: 'quality', label: '质量', disabled: opening.value },
  { value: 'rework', label: '返工', disabled: opening.value },
  { value: 'schedule', label: '交期', disabled: opening.value },
  { value: 'transfer', label: '转料', disabled: opening.value },
])
const labels: Record<BusinessNotice['kind'], string> = {
  quality_reported: '质量问题',
  amendment_requested: '转料修改申请',
  amendment_approved: '修改已生效',
  amendment_rejected: '修改已拒绝',
  amendment_cancelled: '申请已撤回',
  requested: '返工申请',
  ready: '返工工艺已定',
  review: '待确认交期',
  returned: '交期退回',
  locked: '订单已锁定',
  unlocked: '订单已解锁',
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
    const refreshed = result.items.find((item) => `${item.source}:${item.id}` === selectedKey.value)
    if (refreshed) selected.value = refreshed
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
async function markRead(item: BusinessNotice) {
  const key = `${item.source}:${item.id}`
  if (item.read_at || markingRead.has(key)) return
  markingRead.add(key)
  try {
    await businessNoticeApi.read(item.source, item.id)
    if (disposed) return
    const readAt = new Date().toISOString()
    items.value = items.value.map((row) =>
      `${row.source}:${row.id}` === key ? { ...row, read_at: readAt } : row,
    )
    if (selectedKey.value === key && selected.value)
      selected.value = { ...selected.value, read_at: readAt }
    unread.value = Math.max(0, unread.value - 1)
  } catch (e) {
    if (!disposed) error.value = e instanceof Error ? e.message : '已读状态保存失败'
  } finally {
    markingRead.delete(key)
  }
}
async function selectNotice(item: BusinessNotice) {
  if (opening.value || loading.value || reviewBusy.value) return
  if (item.source !== 'transfer' || !item.amendment_id) {
    await openNotice(item.id, item.source)
    return
  }
  selected.value = item
  error.value = ''
  await nextTick()
  detailPanel.value?.focus({ preventScroll: true })
}
function amendmentLoaded(amendment: { id: number }) {
  if (selected.value?.source === 'transfer' && selected.value.amendment_id === amendment.id) {
    void markRead(selected.value)
  }
}
async function amendmentResolved() {
  await load()
}
async function openNotice(id: number, source: string) {
  const item =
    selected.value?.id === id && selected.value.source === source
      ? selected.value
      : items.value.find((n) => n.id === id && n.source === source)
  if (!item || opening.value || loading.value) return
  opening.value = true
  try {
    const target = await businessNoticeApi.target(item.source, item.id)
    if (disposed) return
    // Close the inbox before the destination dialog opens, so the cue is unobscured.
    visible.value = false
    const failed = await router.push(
      `${target.href}${target.href.includes('?') ? '&' : '?'}business_notice=${item.source}:${item.id}&notice=${Date.now()}`,
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
function backToList() {
  if (reviewBusy.value) return
  const key = selectedKey.value
  selected.value = null
  void nextTick(() => {
    document.getElementById(`business-notice-${key}`)?.focus({ preventScroll: true })
  })
}
watch([view, source], () => {
  items.value = []
  selected.value = null
  page.value = 1
})
const live = useLiveRefresh(load, {
  teamId: () => props.teamId,
  busy: () => loading.value || opening.value || reviewBusy.value,
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
  <AppButton
    unstyled
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
  </AppButton>
  <AppDrawer
    v-model="visible"
    title="消息通知"
    size="min(460px, 100vw)"
    class="schedule-inbox"
    append-to-body
    :show-close="!reviewBusy"
    :close-on-click-modal="!reviewBusy"
    :close-on-press-escape="!reviewBusy"
  >
    <div v-show="!selected" class="inbox-controls">
      <div class="inbox-state-row">
        <WatermelonSegmented v-model="view" class="inbox-tabs" label="消息筛选" :options="views" />
        <ElButton
          :icon="Refresh"
          :disabled="opening"
          aria-label="刷新消息"
          title="刷新消息"
          :loading="loading"
          @click="load"
        />
      </div>
      <div class="inbox-toolbar">
        <WatermelonSegmented
          v-if="view !== 'pending'"
          v-model="source"
          class="inbox-sources"
          label="通知类型"
          :options="sources"
        />
        <span v-else class="inbox-pending-label">需要你处理</span>
        <span class="inbox-total">{{ total }} 条</span>
      </div>
    </div>
    <ElAlert v-if="error" :title="error" type="error" :closable="false" />
    <div v-show="!selected" class="inbox-content" :aria-busy="loading || opening">
      <TransitionGroup
        v-if="items.length"
        name="inbox-row"
        tag="ul"
        class="inbox-list"
        aria-label="业务消息"
      >
        <li v-for="item in items" :key="`${item.source}:${item.id}`">
          <AppButton
            unstyled
            :id="`business-notice-${item.source}:${item.id}`"
            type="button"
            class="inbox-item"
            :class="{ 'is-unread': !item.read_at }"
            :data-kind="item.kind"
            :data-source="item.source"
            :disabled="opening || loading || reviewBusy"
            :aria-label="`打开 ${item.serial_no} ${labels[item.kind]}，${item.team_name}，${item.message}${item.read_at ? '' : '，未读'}`"
            @click="selectNotice(item)"
          >
            <span class="inbox-symbol" aria-hidden="true">
              <ElIcon>
                <RefreshLeft v-if="item.source === 'rework'" />
                <Warning v-else-if="item.source === 'quality' || item.kind === 'overdue'" />
                <DocumentChecked v-else-if="item.source === 'transfer'" />
                <Calendar v-else />
              </ElIcon>
              <Transition name="inbox-dot"
                ><i v-if="!item.read_at" class="inbox-unread-dot"
              /></Transition>
            </span>
            <span class="inbox-summary">
              <span class="inbox-heading">
                <strong :title="item.serial_no">{{ item.serial_no }}</strong>
                <time :datetime="item.created_at" :title="formatDateTime(item.created_at)">
                  {{ formatDateTime(item.created_at).slice(5) }}
                </time>
              </span>
              <span class="inbox-context">
                <span class="inbox-kind">{{ labels[item.kind] }}</span>
                <span v-if="item.team_name">{{ item.team_name }}</span>
                <span v-if="item.action_required" class="inbox-pending">待处理</span>
              </span>
              <span class="inbox-message">{{ item.message }}</span>
              <span v-if="item.batch_no" class="inbox-batch">{{ item.batch_no }}</span>
            </span>
            <ElIcon class="inbox-arrow" aria-hidden="true"><ArrowRight /></ElIcon>
          </AppButton>
        </li>
      </TransitionGroup>
      <div v-else class="inbox-empty" role="status">
        <span class="inbox-empty-icon"
          ><ElIcon :class="{ 'is-loading': loading }"
            ><Loading v-if="loading" /><Bell v-else /></ElIcon
        ></span>
        <strong>{{
          loading
            ? '正在读取消息'
            : view === 'unread'
              ? '未读消息已看完'
              : view === 'pending'
                ? '暂无待处理事项'
                : '暂无消息'
        }}</strong>
      </div>
    </div>
    <section
      v-if="selected"
      ref="detailPanel"
      class="inbox-detail"
      tabindex="-1"
      aria-label="消息详情"
    >
      <ElButton class="inbox-back" :icon="Back" :disabled="reviewBusy" @click="backToList"
        >返回消息</ElButton
      >
      <TransferAmendmentReview
        v-if="selected.amendment_id"
        :key="`${selectedKey}:${selected.amendment_status}`"
        :amendment-id="selected.amendment_id"
        show-transfer-link
        @loaded="amendmentLoaded"
        @busy="reviewBusy = $event"
        @resolved="amendmentResolved"
        @view-transfer="openNotice(selected.id, selected.source)"
      />
    </section>
    <template v-if="!selected" #footer>
      <WorkspacePagination
        v-if="total > 20"
        v-model:current-page="page"
        class="inbox-pagination"
        :total="total"
        :page-size="20"
        :disabled="loading || opening"
        layout="prev, pager, next"
      />
      <ElButton
        class="inbox-read-all"
        :disabled="!unread || loading || opening"
        :icon="DocumentChecked"
        @click="readAll"
        >全部标为已读</ElButton
      >
    </template>
  </AppDrawer>
</template>

<style scoped>
/* Notification 1's single-column activity feed, adapted to our business messages.
   Reference and upstream license: ./watermelon/NOTICE.md. */
.notice-trigger {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 40px;
  padding: 8px 12px;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: var(--wm-surface, rgba(255, 255, 255, 0.6));
  color: var(--text);
  font: inherit;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.16s;
}
.notice-trigger:hover {
  background: var(--wm-muted-surface, #f4f4f5);
}
.notice-trigger:focus-visible,
.inbox-item:focus-visible {
  outline: 2px solid var(--wm-focus-ring, #71717a);
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
.inbox-controls {
  flex-shrink: 0;
  padding: 4px 0 12px;
}
.inbox-tabs {
  display: flex;
  flex-wrap: nowrap;
}
.inbox-tabs :deep(button) {
  flex: 1;
  min-width: 0;
}
.inbox-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 14px;
}
.inbox-state-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.inbox-state-row .inbox-tabs {
  flex: 1;
  width: auto;
}
.inbox-sources {
  flex: 1;
}
.inbox-sources :deep(button) {
  flex: 1;
  padding: 0 8px;
  font-size: 12px;
  min-height: 30px;
}
.inbox-total {
  margin-left: auto;
  font-size: 12px;
  color: var(--wm-muted, #71717a);
  white-space: nowrap;
}
.inbox-pending-label {
  font-size: 13px;
  color: var(--wm-muted, #71717a);
}
.inbox-state-row .el-button {
  margin: 0;
  width: 36px;
  min-height: 36px;
  padding: 0;
}
.inbox-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.inbox-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.inbox-list li + li {
  border-top: 1px solid var(--wm-border, #e4e4e7);
}
.inbox-item {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) 14px;
  align-items: start;
  gap: 12px;
  width: 100%;
  padding: 18px 8px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--wm-text, #18181b);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 160ms ease;
}
.inbox-item:hover:not(:disabled),
.inbox-item:focus-visible {
  background: var(--wm-muted-surface, #f4f4f5);
}
.inbox-item:focus-visible {
  outline-offset: -2px;
}
.inbox-item:disabled {
  cursor: progress;
}
.inbox-symbol {
  position: relative;
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border: 1px solid var(--wm-border, #e4e4e7);
  border-radius: 50%;
  background: var(--wm-muted-surface, #f4f4f5);
  color: var(--wm-text-muted, #52525b);
  font-size: 19px;
}
.inbox-item[data-kind='overdue'] .inbox-symbol {
  border-color: transparent;
  background: var(--wm-danger-bg, #fcefed);
  color: var(--wm-danger-text, #ae3935);
}
.inbox-item[data-source='quality'] .inbox-symbol {
  background: var(--wm-warning-bg, #fff7e6);
  color: var(--wm-warning-text, #a16413);
  border-color: transparent;
}
.inbox-unread-dot {
  position: absolute;
  top: 0;
  right: 0;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--wm-text, #18181b);
  box-shadow: 0 0 0 3px var(--wm-bg, white);
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
  gap: 8px;
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
.inbox-heading time {
  flex-shrink: 0;
  margin-left: auto;
  color: var(--wm-muted, #71717a);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.inbox-context {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 8px;
  color: var(--wm-muted, #71717a);
  font-size: 12px;
}
.inbox-kind {
  color: var(--wm-text-muted, #52525b);
}
.inbox-pending {
  color: var(--wm-warning-text, #8c5b17);
  background: var(--wm-warning-bg, #fbf2df);
  border-radius: 20px;
  padding: 2px 7px;
  font-size: 11px;
}
.inbox-message {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
  color: var(--wm-text-muted, #52525b);
  font-size: 13px;
  line-height: 1.6;
}
.inbox-batch {
  font-size: 11px;
  color: var(--wm-muted, #71717a);
  overflow-wrap: anywhere;
}
.inbox-arrow {
  align-self: center;
  font-size: 14px;
  opacity: 0;
  color: var(--wm-muted, #71717a);
  transform: translateX(-3px);
  transition:
    opacity 160ms ease,
    transform 160ms ease;
}
.inbox-item:hover .inbox-arrow,
.inbox-item:focus-visible .inbox-arrow {
  opacity: 1;
  transform: none;
}
.inbox-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 18px;
  min-height: 240px;
  height: 100%;
  color: var(--wm-muted, #71717a);
}
.inbox-empty strong {
  font-size: 14px;
  font-weight: 500;
}
.inbox-empty-icon {
  display: grid;
  place-items: center;
  width: 64px;
  height: 64px;
  background: var(--wm-muted-surface, #f4f4f5);
  border: 1px solid var(--wm-border, #e4e4e7);
  border-radius: 20px;
  font-size: 24px;
}
.inbox-detail {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  outline: none;
  animation: inbox-detail-in 180ms ease-out;
}
.inbox-back {
  margin-bottom: 20px;
}
.inbox-read-all {
  width: 100%;
  margin: 0;
}
.inbox-pagination {
  margin-bottom: 16px;
  padding: 0;
  border: 0;
  gap: 8px;
}
.inbox-pagination :deep(.wm-pagination-summary) {
  flex-basis: 100%;
  font-size: 12px;
}
.inbox-pagination :deep(nav) {
  margin: 0 auto;
  gap: 2px;
}
.inbox-pagination :deep(nav button) {
  width: 30px;
  height: 32px;
}
.inbox-pagination :deep(.wm-page-ellipsis) {
  width: 16px;
}
.inbox-row-enter-active,
.inbox-dot-leave-active {
  transition:
    opacity 180ms ease,
    transform 180ms ease;
}
.inbox-row-enter-from {
  opacity: 0;
  transform: translateY(6px);
}
.inbox-dot-leave-to {
  opacity: 0;
  transform: scale(0.5);
}
@keyframes inbox-detail-in {
  from {
    opacity: 0;
    transform: translateX(8px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
@media (max-width: 380px) {
  .inbox-item {
    grid-template-columns: 36px minmax(0, 1fr);
    gap: 10px;
    padding-inline: 4px;
  }
  .inbox-symbol {
    width: 36px;
    height: 36px;
  }
  .inbox-arrow {
    display: none;
  }
  .inbox-heading {
    flex-wrap: wrap;
    gap: 3px;
  }
  .inbox-heading time {
    margin-left: 0;
    flex-basis: 100%;
  }
}
@media (prefers-reduced-motion: reduce) {
  .inbox-item,
  .inbox-arrow,
  .inbox-row-enter-active,
  .inbox-dot-leave-active {
    transition: none;
  }
  .inbox-detail {
    animation: none;
  }
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
