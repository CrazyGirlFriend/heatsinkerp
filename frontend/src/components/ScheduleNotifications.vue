<script setup lang="ts">
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
import { ElAlert, ElButton, ElIcon, ElCheckbox, ElPagination } from 'element-plus'
import AppDrawer from './AppDrawer.vue'
import TransferAmendmentReview from './TransferAmendmentReview.vue'
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
  latestId = ref({ schedule: 0, rework: 0, transfer: 0 }),
  error = ref('')
const items = ref<BusinessNotice[]>([])
const selected = ref<BusinessNotice | null>(null)
const detailPanel = ref<HTMLElement>()
const selectedKey = computed(() =>
  selected.value ? `${selected.value.source}:${selected.value.id}` : '',
)
const markingRead = new Set<string>()
const reviewBusy = ref(false)
const labels: Record<BusinessNotice['kind'], string> = {
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
  selected.value = item
  error.value = ''
  await nextTick()
  detailPanel.value?.focus({ preventScroll: true })
  if (item.source !== 'transfer') void markRead(item)
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
function filter(value: string) {
  if (category.value === value) return
  items.value = []
  selected.value = null
  category.value = value
  page.value = 1
}
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
    size="min(1080px, 96vw)"
    class="schedule-inbox"
    append-to-body
    :show-close="!reviewBusy"
    :close-on-click-modal="!reviewBusy"
    :close-on-press-escape="!reviewBusy"
  >
    <div class="inbox-toolbar">
      <div class="inbox-tabs" role="group" aria-label="消息筛选">
        <button
          v-for="tab in [
            { value: 'all', label: '全部' },
            { value: 'pending', label: '待确认' },
            { value: 'transfer', label: '转料' },
            { value: 'rework', label: '返工' },
            { value: 'schedule', label: '排期' },
          ]"
          :key="tab.value"
          type="button"
          :aria-pressed="category === tab.value"
          :disabled="reviewBusy"
          @click="filter(tab.value)"
        >
          {{ tab.label }}
        </button>
      </div>
      <ElCheckbox v-model="unreadOnly" :disabled="reviewBusy" @change="page = 1"
        >仅未读 {{ unread || '' }}</ElCheckbox
      >
      <ElButton :disabled="!unread || loading || reviewBusy" @click="readAll">全部已读</ElButton>
      <ElButton
        :icon="Refresh"
        :disabled="reviewBusy"
        aria-label="刷新消息"
        :loading="loading"
        @click="load"
      />
    </div>
    <ElAlert v-if="error" :title="error" type="error" :closable="false" />
    <div class="inbox-workspace" :class="{ 'has-selection': selected }">
      <div class="inbox-content" :aria-busy="loading">
        <ul v-if="items.length" class="inbox-list" aria-label="业务消息">
          <li v-for="item in items" :key="`${item.source}:${item.id}`">
            <button
              type="button"
              class="inbox-serial inbox-item"
              :class="{
                'is-unread': !item.read_at,
                'is-selected': selectedKey === `${item.source}:${item.id}`,
              }"
              :aria-current="selectedKey === `${item.source}:${item.id}` ? 'true' : undefined"
              :data-kind="item.kind"
              :disabled="opening || loading || reviewBusy"
              :aria-label="`打开 ${item.serial_no} ${labels[item.kind]}，${item.team_name}，${item.message}${item.read_at ? '' : '，未读'}`"
              @click="selectNotice(item)"
            >
              <span class="inbox-symbol" aria-hidden="true">
                <ElIcon>
                  <RefreshLeft v-if="item.source === 'rework'" />
                  <Warning v-else-if="item.kind === 'overdue'" />
                  <DocumentChecked v-else-if="item.source === 'transfer'" />
                  <Calendar v-else />
                </ElIcon>
                <i v-if="!item.read_at" class="inbox-unread-dot" />
              </span>
              <span class="inbox-summary">
                <span class="inbox-heading">
                  <strong :title="item.serial_no">{{ item.serial_no }}</strong>

                  <time :datetime="item.created_at" :title="formatDateTime(item.created_at)">
                    {{ formatDateTime(item.created_at).slice(5) }}
                  </time>
                </span>
                <span class="inbox-message">
                  <span
                    class="inbox-kind"
                    :class="{ 'is-action-required': item.action_required }"
                    >{{ item.action_required ? '待确认' : labels[item.kind] }}</span
                  >
                  <span>{{ item.message }}</span>
                </span>
                <span class="inbox-batch">
                  {{ item.team_name
                  }}<template v-if="item.batch_no"> · {{ item.batch_no }}</template>
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
      <section ref="detailPanel" class="inbox-detail" tabindex="-1" aria-label="消息详情">
        <template v-if="selected">
          <button type="button" class="inbox-back" :disabled="reviewBusy" @click="selected = null">
            <ElIcon><Back /></ElIcon>返回消息
          </button>
          <div class="inbox-detail-heading">
            <span>{{ labels[selected.kind] }}</span>
            <time :datetime="selected.created_at">{{ formatDateTime(selected.created_at) }}</time>
          </div>
          <TransferAmendmentReview
            v-if="selected.source === 'transfer' && selected.amendment_id"
            :key="`${selectedKey}:${selected.amendment_status}`"
            :amendment-id="selected.amendment_id"
            show-transfer-link
            @loaded="amendmentLoaded"
            @busy="reviewBusy = $event"
            @resolved="amendmentResolved"
            @view-transfer="openNotice(selected.id, selected.source)"
          />
          <div v-else class="inbox-business-detail">
            <h2>{{ selected.serial_no }}</h2>
            <p class="inbox-detail-team">
              {{ selected.team_name
              }}<template v-if="selected.batch_no"> · {{ selected.batch_no }}</template>
            </p>
            <p class="inbox-detail-message">{{ selected.message }}</p>
            <ElButton
              type="primary"
              :loading="opening"
              class="inbox-open-business"
              @click="openNotice(selected.id, selected.source)"
              >查看{{ selected.source === 'rework' ? '返工' : '排期'
              }}<ElIcon><ArrowRight /></ElIcon
            ></ElButton>
          </div>
        </template>
        <div v-else class="inbox-empty">
          <ElIcon><Bell /></ElIcon><span>选择消息，查看详情</span>
        </div>
      </section>
    </div>
    <template #footer
      ><ElPagination
        v-model:current-page="page"
        :total="total"
        :page-size="20"
        :disabled="loading || reviewBusy"
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
  margin-bottom: 12px;
  flex-wrap: wrap;
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
.inbox-workspace {
  display: grid;
  grid-template-columns: minmax(300px, 38%) minmax(0, 1fr);
  flex: 1;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: #fff;
}
.inbox-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  border-right: 1px solid var(--line);
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
  grid-template-columns: 30px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 94px;
  padding: 14px 12px;
  border: 0;
  background: #fff;
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background var(--motion-fast);
}
.inbox-item.is-selected,
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
  width: 30px;
  height: 30px;
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
  overflow: hidden;
}
.inbox-message > span:last-child {
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
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
  display: none;
  color: #84928a;
  transition:
    transform var(--motion-fast),
    color var(--motion-fast);
}
.inbox-item:hover .inbox-arrow,
.inbox-item:focus-visible .inbox-arrow {
  display: none;
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
.inbox-detail {
  min-width: 0;
  overflow-y: auto;
  padding: 24px;
  outline: none;
  background: linear-gradient(135deg, #fff, #f9fbfa);
}
.inbox-detail-heading {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
  padding-bottom: 16px;
  margin-bottom: 20px;
  border-bottom: 1px solid var(--line);
  color: var(--muted);
  font-size: 12px;
}
.inbox-business-detail h2 {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
}
.inbox-detail-team {
  color: var(--muted);
  font-size: 12px;
}
.inbox-detail-message {
  margin: 24px 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.7;
}
.inbox-open-business {
  gap: 8px;
}
.inbox-kind.is-action-required {
  color: #8c5b17;
  background: #fbf2df;
  padding: 0 6px;
  border-radius: 4px;
}
.inbox-back {
  display: none;
}
@media (max-width: 760px) {
  .inbox-workspace {
    grid-template-columns: minmax(0, 1fr);
  }
  .inbox-detail {
    display: none;
    padding: 16px;
  }
  .has-selection .inbox-content {
    display: none;
  }
  .has-selection .inbox-detail {
    display: block;
  }
  .inbox-content {
    border-right: 0;
  }
  .inbox-back {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 0;
    background: transparent;
    color: var(--primary);
    font: inherit;
    padding: 0;
    margin-bottom: 20px;
    cursor: pointer;
  }
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
    display: none;
    transition: none;
  }
  .inbox-item .inbox-arrow {
    display: none;
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
