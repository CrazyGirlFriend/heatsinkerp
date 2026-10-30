<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElAlert, ElButton, ElInput, ElPagination, ElTag } from 'element-plus'
import { RefreshRight, Search } from '@element-plus/icons-vue'
import AppDialog from '@/components/AppDialog.vue'
import PageBackButton from '@/components/PageBackButton.vue'
import MaterialTransferDrawer from '@/components/MaterialTransferDrawer.vue'
import LiveRefreshNotice from '@/components/LiveRefreshNotice.vue'
import StatePanel from '@/components/StatePanel.vue'
import { useLiveRefresh } from '@/composables/useLiveRefresh'
import {
  serialInventoryApi as api,
  type InventoryLocation,
  type SerialInventory,
  type SerialInventoryBatches,
  type SerialInventoryRow,
} from '@/services/serialInventoryApi'
import { materialTypeLabel } from '@/types/materialTransfer'
import { formatAmount, formatDateTime } from '@/utils/format'

const route = useRoute(),
  router = useRouter()
const draft = ref(''),
  serial = ref(''),
  result = ref<SerialInventory | null>(null)
const loading = ref(false),
  error = ref(''),
  detailError = ref(''),
  detailLoading = ref(false)
const selected = ref<SerialInventoryRow | null>(null),
  detailOpen = ref(false)
const location = ref<InventoryLocation>('stock'),
  page = ref(1),
  pageSize = ref(20)
const batches = ref<SerialInventoryBatches | null>(null)
const batchNo = ref(''),
  batchOpen = ref(false)
let generation = 0,
  detailGeneration = 0
const sections = computed(() => [
  {
    title: '各班组库存',
    shared: false,
    rows: result.value?.items.filter((r) => !r.shared_unallocated) || [],
  },
  {
    title: '共投待分料',
    shared: true,
    rows: result.value?.items.filter((r) => r.shared_unallocated) || [],
  },
])
const detailTitle = computed(() =>
  selected.value
    ? `${selected.value.team_name} · ${serial.value} · ${selected.value.shared_unallocated ? '共投待分料' : '批次明细'}`
    : '批次明细',
)

async function load(background = false) {
  if (!serial.value) return
  const current = ++generation
  loading.value = true
  error.value = ''
  if (!background) result.value = null
  try {
    const data = await api.get(serial.value)
    if (current === generation) result.value = data
  } catch (e) {
    if (current !== generation) return
    error.value = background
      ? '库存更新失败，当前为上次查询结果'
      : e instanceof Error
        ? e.message
        : '查询失败，请重试'
  } finally {
    if (current === generation) loading.value = false
  }
}
async function search() {
  const value = draft.value.trim()
  if (!value) {
    error.value = '请输入流水号'
    return
  }
  if (value === serial.value) await refresh()
  else await router.replace({ path: '/material-trace', query: { serial_no: value } })
}
async function refresh() {
  await load(true)
  if (detailOpen.value) await loadBatches()
}
async function loadBatches() {
  if (!selected.value || !detailOpen.value) return
  const current = ++detailGeneration
  detailLoading.value = true
  detailError.value = ''
  batches.value = null
  try {
    const data = await api.batches(
      serial.value,
      selected.value,
      location.value,
      page.value,
      pageSize.value,
    )
    if (current === detailGeneration) batches.value = data
  } catch (e) {
    if (current === detailGeneration)
      detailError.value = e instanceof Error ? e.message : '批次读取失败'
  } finally {
    if (current === detailGeneration) detailLoading.value = false
  }
}
function openBatches(row: SerialInventoryRow) {
  selected.value = row
  location.value = row.stock_quantity || row.stock_weight ? 'stock' : 'incoming'
  page.value = 1
  detailOpen.value = true
  void loadBatches()
}
function changeLocation(value: InventoryLocation) {
  if (value === location.value) return
  location.value = value
  page.value = 1
  void loadBatches()
}
function openBatch(value: string) {
  batchNo.value = value
  batchOpen.value = true
}
watch(detailOpen, (open) => {
  if (!open) {
    ++detailGeneration
    detailLoading.value = false
  }
})
watch(
  () => route.query.serial_no,
  (value) => {
    ++generation
    ++detailGeneration
    serial.value = typeof value === 'string' ? value.trim() : ''
    draft.value = serial.value
    result.value = null
    detailOpen.value = false
    batchOpen.value = false
    error.value = ''
    loading.value = false
    if (serial.value) void load()
  },
  { immediate: true },
)
const live = useLiveRefresh(refresh, {
  enabled: () => Boolean(serial.value),
  busy: () => loading.value || detailLoading.value,
})
onBeforeUnmount(() => {
  ++generation
  ++detailGeneration
})
</script>

<template>
  <section class="page workspace-page serial-inventory-page">
    <header class="inventory-header">
      <PageBackButton />
      <h1>流水号查询</h1>
    </header>
    <form class="inventory-search" @submit.prevent="search">
      <ElInput
        v-model="draft"
        aria-label="流水号"
        placeholder="输入完整流水号"
        maxlength="80"
        clearable
        :prefix-icon="Search"
      />
      <ElButton native-type="submit" type="primary" :loading="loading">查询</ElButton>
      <ElButton
        :icon="RefreshRight"
        aria-label="刷新库存"
        :disabled="!serial || loading"
        @click="refresh"
      />
    </form>
    <LiveRefreshNotice :message="live.message.value" />
    <ElAlert v-if="error" :title="error" type="error" :closable="false" show-icon />
    <StatePanel v-if="!serial" state="empty" title="输入流水号查询库存" />
    <StatePanel v-else-if="loading && !result" state="loading" title="查询库存中" />
    <template v-if="result">
      <div class="inventory-result-heading">
        <strong>{{ result.serial_no }}</strong
        ><span>更新于 {{ formatDateTime(result.as_of) }}</span>
      </div>
      <ElAlert
        v-if="result.untracked_count"
        :title="`${result.untracked_count} 条历史记录未登记库存`"
        type="warning"
        :closable="false"
        show-icon
      />
      <template v-for="section in sections" :key="section.title">
        <section v-if="section.rows.length || !section.shared" class="inventory-section">
          <h2>
            {{ section.title
            }}<ElTag v-if="section.shared" size="small" type="warning">未分摊</ElTag>
          </h2>
          <div class="inventory-table-scroll">
            <table class="inventory-table" :aria-label="section.title">
              <thead>
                <tr>
                  <th>班组</th>
                  <th>材质</th>
                  <th>物料类型</th>
                  <th class="number">库存（件）</th>
                  <th class="number">库存（kg）</th>
                  <th class="number">待签收（件）</th>
                  <th class="number">待签收（kg）</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in section.rows"
                  :key="`${row.team_id}:${row.material_name}:${row.material_type}`"
                >
                  <td class="team-name">{{ row.team_name }}</td>
                  <td>{{ row.material_name || '—' }}</td>
                  <td>{{ materialTypeLabel(row.material_type) }}</td>
                  <td class="number" :class="{ shortage: row.stock_quantity < 0 }">
                    {{ formatAmount(row.stock_quantity) }}
                  </td>
                  <td class="number" :class="{ shortage: row.stock_weight < 0 }">
                    {{ formatAmount(row.stock_weight) }}
                  </td>
                  <td class="number incoming">{{ formatAmount(row.incoming_quantity) }}</td>
                  <td class="number incoming">{{ formatAmount(row.incoming_weight) }}</td>
                  <td>
                    <button class="inventory-link" @click="openBatches(row)">批次明细</button>
                  </td>
                </tr>
                <tr v-if="!section.rows.length">
                  <td colspan="8" class="empty-cell">该流水号暂无在库或待签收物料</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </template>
    </template>
    <AppDialog v-model="detailOpen" :title="detailTitle" width="1000px" destroy-on-close>
      <div class="batch-toolbar">
        <div class="inventory-tabs" aria-label="库存位置">
          <button :aria-pressed="location === 'stock'" @click="changeLocation('stock')">
            在库
          </button>
          <button :aria-pressed="location === 'incoming'" @click="changeLocation('incoming')">
            待签收
          </button>
        </div>
        <span v-if="selected"
          >{{ selected.material_name || '—' }} ·
          {{ materialTypeLabel(selected.material_type) }}</span
        >
      </div>
      <ElAlert v-if="detailError" :title="detailError" type="error" :closable="false" />
      <StatePanel v-if="detailLoading" state="loading" compact />
      <template v-else-if="batches">
        <div class="inventory-table-scroll">
          <table class="inventory-table" aria-label="批次库存">
            <thead>
              <tr>
                <th>批次号</th>
                <th>规格</th>
                <th class="number">数量（件）</th>
                <th class="number">重量（kg）</th>
                <th>返工</th>
                <th>质量冻结</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="batch in batches.items" :key="batch.id">
                <td>
                  <button class="inventory-link" @click="openBatch(batch.batch_no)">
                    {{ batch.batch_no }}
                  </button>
                </td>
                <td>{{ batch.transfer_specification || '—' }}</td>
                <td class="number">{{ formatAmount(batch.quantity) }}</td>
                <td class="number">{{ formatAmount(batch.weight) }}</td>
                <td>
                  <ElTag v-if="batch.rework_pending" type="warning" size="small">待返工</ElTag
                  ><span v-else>{{
                    batch.rework_count ? `已返工 ${batch.rework_count} 次` : '—'
                  }}</span>
                </td>
                <td>
                  <ElTag v-if="batch.inspection_hold_id" type="danger" size="small">冻结</ElTag
                  ><span v-else>—</span>
                </td>
              </tr>
              <tr v-if="!batches.items.length">
                <td colspan="6" class="empty-cell">暂无批次</td>
              </tr>
            </tbody>
          </table>
        </div>
        <ElPagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          class="batch-pagination"
          :total="batches.total"
          :page-sizes="[20, 50, 100]"
          layout="total, sizes, prev, pager, next"
          @change="loadBatches"
        />
      </template>
    </AppDialog>
    <MaterialTransferDrawer v-model="batchOpen" :batch-no="batchNo" @changed="refresh" />
  </section>
</template>

<style scoped>
.serial-inventory-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.inventory-header {
  display: flex;
  align-items: center;
  gap: 16px;
}
.inventory-header h1 {
  margin: 0;
  font-size: 20px;
}
.inventory-search {
  display: flex;
  gap: 10px;
  max-width: 620px;
}
.inventory-search :deep(.el-button + .el-button) {
  margin-left: 0;
}
.inventory-result-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.inventory-result-heading strong {
  color: var(--primary);
  font-size: 18px;
}
.inventory-result-heading > span {
  color: var(--muted);
  font-size: 12px;
}
.inventory-section h2 {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 0 10px;
  font-size: 14px;
}
.inventory-table-scroll {
  overflow: auto;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: #fff;
}
.inventory-table {
  width: 100%;
  min-width: 820px;
  border-collapse: collapse;
  font-size: 14px;
}
.inventory-table th,
.inventory-table td {
  padding: 11px 14px;
  border-right: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  text-align: left;
}
.inventory-table th:last-child,
.inventory-table td:last-child {
  border-right: 0;
}
.inventory-table tbody tr:last-child td {
  border-bottom: 0;
}
.inventory-table th {
  background: #edf3f0;
  color: var(--text);
  font-weight: 600;
  white-space: nowrap;
}
.inventory-table tbody tr:nth-child(even) {
  background: #f8faf9;
}
.inventory-table tbody tr:hover {
  background: #eff6f2;
}
.inventory-table .number {
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.team-name {
  font-weight: 600;
}
.inventory-table .shortage {
  color: #b43b3b;
}
.inventory-table .incoming {
  color: #516b80;
}
.inventory-link {
  border: 0;
  padding: 2px 0;
  background: none;
  color: var(--primary);
  font: inherit;
  cursor: pointer;
  white-space: nowrap;
}
.inventory-link:hover {
  text-decoration: underline;
}
.inventory-link:focus-visible,
.inventory-tabs button:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 3px;
}
.inventory-table .empty-cell {
  padding: 32px 16px;
  color: var(--muted);
  text-align: center;
}
.batch-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}
.batch-toolbar > span {
  color: var(--muted);
  font-size: 13px;
}
.inventory-tabs {
  display: flex;
  padding: 3px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #f3f6f4;
}
.inventory-tabs button {
  border: 0;
  border-radius: 5px;
  padding: 7px 18px;
  background: transparent;
  color: var(--text);
  cursor: pointer;
  font: inherit;
}
.inventory-tabs button[aria-pressed='true'] {
  background: var(--primary);
  color: white;
}
.batch-pagination {
  margin-top: 16px;
  justify-content: flex-end;
  overflow: auto;
}
@media (max-width: 700px) {
  .inventory-result-heading {
    flex-wrap: wrap;
  }
  .inventory-table {
    font-size: 13px;
  }
}
</style>
