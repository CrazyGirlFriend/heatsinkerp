<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { ElButton, ElDialog, ElPagination, ElTable, ElTableColumn } from 'element-plus'
import MaterialTransferDrawer from './MaterialTransferDrawer.vue'
import LiveRefreshNotice from './LiveRefreshNotice.vue'
import StatePanel from './StatePanel.vue'
import { useLiveRefresh } from '@/composables/useLiveRefresh'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import { isExternalEntryKind, materialTransferStatusLabel, type MaterialTransfer } from '@/types/materialTransfer'
import { inventoryAmount, type TeamInventoryRow } from '@/types/teamInventory'
import { formatDateTime } from '@/utils/format'

const props = defineProps<{ teamId: number; group: TeamInventoryRow | null }>()
const emit = defineEmits<{ close: []; changed: [] }>()
const rows = ref<MaterialTransfer[]>([]), total = ref(0), page = ref(1), asOf = ref('')
const loading = ref(false), error = ref(''), batchOpen = ref(false), selected = ref<MaterialTransfer | null>(null)
let version = 0
const live = useLiveRefresh(() => load(true), { teamId: () => props.teamId, enabled: () => !!props.group, busy: () => loading.value || batchOpen.value })
async function load(background = false) {
  const current = ++version
  if (!props.group) { loading.value = false; return }
  if (!background) { loading.value = true; rows.value = [] }
  error.value = ''
  try {
    const result = await teamMaterialApi.inventoryPending(props.teamId, props.group.group_id, { page: page.value, page_size: 10 })
    if (current !== version) return
    if (page.value > 1 && !result.items.length) { page.value = Math.max(1, Math.ceil(result.total / 10)); await load(background); return }
    rows.value = result.items; total.value = result.total; asOf.value = result.as_of || ''
  } catch (e) {
    if (current === version) { if (background) throw e; error.value = e instanceof Error ? e.message : '待签收批次加载失败' }
  } finally { if (current === version) loading.value = false }
}
function changed() { void load(); emit('changed') }
function open(value: unknown) { selected.value = value as MaterialTransfer; batchOpen.value = true }
watch(() => [props.teamId, props.group?.group_id], () => { page.value = 1; rows.value = []; total.value = 0; asOf.value = ''; batchOpen.value = false; selected.value = null; void load() }, { immediate: true })
onBeforeUnmount(() => { ++version })
</script>

<template>
  <ElDialog :model-value="!!group" title="转出待确认" width="min(1040px, calc(100vw - 32px))" align-center append-to-body class="material-detail-dialog" @update:model-value="!$event && emit('close')">
    <p v-if="group" class="pending-context">{{ group.serial_no }} · {{ group.material_name || '材质未填写' }}<span>确认前仍计入本班组库存，不可重复出库。</span></p>
    <LiveRefreshNotice :message="live.message.value" @retry="live.request" />
    <StatePanel v-if="error" state="error" :description="error" @retry="load()" />
    <StatePanel v-else-if="loading" state="loading" title="正在读取待签收批次" />
    <ElTable v-else :data="rows" row-key="id" class="business-table" empty-text="暂无转出待确认批次">
      <ElTableColumn label="批次号" min-width="210" align="center"><template #default="{ row }"><ElButton link type="primary" @click="open(row)">{{ row.batch_no }}</ElButton></template></ElTableColumn>
      <ElTableColumn label="下序 / 去向" min-width="130" align="center"><template #default="{ row }">{{ row.next_team?.name || row.external_destination || '—' }}</template></ElTableColumn>
      <ElTableColumn label="件数" min-width="100" align="center"><template #default="{ row }">{{ inventoryAmount(row.quantity) }}</template></ElTableColumn>
      <ElTableColumn label="重量 (kg)" min-width="125" align="center"><template #default="{ row }">{{ inventoryAmount(row.weight) }}</template></ElTableColumn>
      <ElTableColumn label="状态" min-width="130" align="center"><template #default="{ row }">{{ isExternalEntryKind(row.entry_kind) ? materialTransferStatusLabel(row.status, row.entry_kind) : '转出待签收' }}</template></ElTableColumn>
      <ElTableColumn label="转出时间" min-width="175" align="center"><template #default="{ row }">{{ formatDateTime(row.transferred_at) }}</template></ElTableColumn>
    </ElTable>
    <template #footer><div class="pending-footer"><span>共 {{ total }} 批<span v-if="asOf"> · 统计于 {{ formatDateTime(asOf) }}</span></span><ElPagination :current-page="page" :page-size="10" :total="total" layout="prev, pager, next" @current-change="page = $event; load()" /></div></template>
  </ElDialog>
  <MaterialTransferDrawer v-model="batchOpen" :transfer="selected" :trace-scope="{ team_id: teamId, direction: 'outgoing' }" @changed="changed" />
</template>

<style scoped>
.pending-context { display: flex; flex-wrap: wrap; gap: 8px 20px; margin: 0 0 20px; color: var(--text); }
.pending-context span, .pending-footer > span { color: var(--muted); font-size: 14px; }
.pending-footer { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 12px; }
</style>
