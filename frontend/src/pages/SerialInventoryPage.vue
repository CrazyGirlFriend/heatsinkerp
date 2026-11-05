<script setup lang="ts">
import ElAlert from '@/components/AppAlert.vue'
import ElInput from '@/components/AppInput.vue'
import WorkspacePagination from '@/components/WorkspacePagination.vue'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElTag, ElTableColumn } from 'element-plus'
import WorkspaceTable from '@/components/WorkspaceTable.vue'
import WatermelonSegmented from '@/components/watermelon/WatermelonSegmented.vue'
import ElButton from '@/components/AppButton.vue'
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
            <WorkspaceTable
              :height="undefined"
              :fill="false"
              :data="section.rows"
              :aria-label="section.title"
              empty-text="该流水号暂无在库或待签收物料"
            >
              <ElTableColumn prop="team_name" label="班组" min-width="100" />
              <ElTableColumn label="材质" min-width="100"
                ><template #default="{ row }">{{
                  row.material_name || '—'
                }}</template></ElTableColumn
              >
              <ElTableColumn label="物料类型" min-width="110"
                ><template #default="{ row }">{{
                  materialTypeLabel(row.material_type)
                }}</template></ElTableColumn
              >
              <ElTableColumn label="库存（件）" min-width="110" align="right"
                ><template #default="{ row }"
                  ><span :class="{ shortage: row.stock_quantity < 0 }">{{
                    formatAmount(row.stock_quantity)
                  }}</span></template
                ></ElTableColumn
              >
              <ElTableColumn label="库存（kg）" min-width="110" align="right"
                ><template #default="{ row }"
                  ><span :class="{ shortage: row.stock_weight < 0 }">{{
                    formatAmount(row.stock_weight)
                  }}</span></template
                ></ElTableColumn
              >
              <ElTableColumn label="待签收（件）" min-width="120" align="right"
                ><template #default="{ row }">{{
                  formatAmount(row.incoming_quantity)
                }}</template></ElTableColumn
              >
              <ElTableColumn label="待签收（kg）" min-width="120" align="right"
                ><template #default="{ row }">{{
                  formatAmount(row.incoming_weight)
                }}</template></ElTableColumn
              >
              <ElTableColumn label="操作" width="100" fixed="right"
                ><template #default="{ row }"
                  ><ElButton link @click="openBatches(row as SerialInventoryRow)"
                    >批次明细</ElButton
                  ></template
                ></ElTableColumn
              >
            </WorkspaceTable>
          </div>
        </section>
      </template>
    </template>
    <AppDialog v-model="detailOpen" :title="detailTitle" width="1000px" destroy-on-close>
      <div class="batch-toolbar">
        <WatermelonSegmented
          :model-value="location"
          label="库存位置"
          :options="[
            { value: 'stock', label: '在库' },
            { value: 'incoming', label: '待签收' },
          ]"
          @change="changeLocation($event as InventoryLocation)"
        />
        <span v-if="selected"
          >{{ selected.material_name || '—' }} ·
          {{ materialTypeLabel(selected.material_type) }}</span
        >
      </div>
      <ElAlert v-if="detailError" :title="detailError" type="error" :closable="false" />
      <StatePanel v-if="detailLoading" state="loading" compact />
      <template v-else-if="batches">
        <div class="inventory-table-scroll">
          <WorkspaceTable
            :height="undefined"
            :fill="false"
            :data="batches.items"
            aria-label="批次库存"
            empty-text="暂无批次"
          >
            <ElTableColumn label="批次号" min-width="180"
              ><template #default="{ row }"
                ><ElButton link @click="openBatch(row.batch_no)">{{
                  row.batch_no
                }}</ElButton></template
              ></ElTableColumn
            >
            <ElTableColumn label="规格" min-width="140"
              ><template #default="{ row }">{{
                row.transfer_specification || '—'
              }}</template></ElTableColumn
            >
            <ElTableColumn label="数量（件）" min-width="110" align="right"
              ><template #default="{ row }">{{
                formatAmount(row.quantity)
              }}</template></ElTableColumn
            >
            <ElTableColumn label="重量（kg）" min-width="110" align="right"
              ><template #default="{ row }">{{ formatAmount(row.weight) }}</template></ElTableColumn
            >
            <ElTableColumn label="返工" min-width="130"
              ><template #default="{ row }"
                ><ElTag v-if="row.rework_pending" type="warning" size="small">待返工</ElTag
                ><span v-else>{{
                  row.rework_count ? `已返工 ${row.rework_count} 次` : '—'
                }}</span></template
              ></ElTableColumn
            >
            <ElTableColumn label="质量冻结" min-width="100"
              ><template #default="{ row }"
                ><ElTag v-if="row.inspection_hold_id" type="danger" size="small">冻结</ElTag
                ><span v-else>—</span></template
              ></ElTableColumn
            >
          </WorkspaceTable>
        </div>
        <WorkspacePagination
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
  background: var(--wm-bg, #fff);
}
.shortage {
  color: var(--wm-danger-text, var(--danger));
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
