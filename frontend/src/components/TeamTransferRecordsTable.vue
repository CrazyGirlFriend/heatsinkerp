<script setup lang="ts">
import { ElTableColumn as TableColumn } from 'element-plus'
import WorkspaceTable from './WorkspaceTable.vue'
import AppButton from './AppButton.vue'
import AppPopover from './AppPopover.vue'
import BarcodeCard from './BarcodeCard.vue'
import MaterialTransferStatus from './MaterialTransferStatus.vue'
import PersonName from './PersonName.vue'
import { teamWorkspaceProfile } from '@/config/teamWorkspaces'
import { sharedSerialLabel } from '@/types/sharedMaterial'
import { inventoryAmount } from '@/types/teamInventory'
import { formatDateTime } from '@/utils/format'
import { formatScheduleBatch } from '@/utils/scheduleBatch'
import {
  isExternalEntryKind,
  materialEntryLabel,
  materialSenderName,
  materialSourceLabel,
  materialTypeLabel,
  receiptSourceLabel,
  type MaterialTransfer,
} from '@/types/materialTransfer'

const ElTableColumn = TableColumn<MaterialTransfer>
defineOptions({ inheritAttrs: false })
defineProps<{
  kind: 'pending' | 'receipts' | 'outgoing'
  rows: MaterialTransfer[]
  warehouse?: boolean
  canWrite?: boolean
  receiverSelected?: boolean
  emptyTitle: string
}>()
const emit = defineEmits<{
  detail: [MaterialTransfer]
  editReceipt: [MaterialTransfer]
  selectionChange: [MaterialTransfer[]]
}>()
// Retain each list's existing saved column preferences.
const columnKeys = {
  pending: 'TeamWorkspacePage-1',
  receipts: 'TeamWorkspacePage-2',
  outgoing: 'TeamWorkspacePage-3',
}
</script>

<template>
  <WorkspaceTable
    :key="kind"
    :columns-key="columnKeys[kind]"
    :data="rows"
    :row-key="kind === 'outgoing' ? 'batch_no' : 'id'"
    class="team-table single-line-table"
    :class="{ 'dispatch-table': kind === 'outgoing' }"
    v-bind="$attrs"
    @selection-change="emit('selectionChange', $event)"
  >
    <template #empty>{{ emptyTitle }}</template>
    <ElTableColumn v-if="kind === 'outgoing'" type="selection" width="48" />
    <ElTableColumn
      v-if="kind === 'receipts' && warehouse"
      prop="warehouse_location"
      label="仓位"
      min-width="120"
      show-overflow-tooltip
    >
      <template #default="{ row }">{{ row.warehouse_location || '未填写' }}</template>
    </ElTableColumn>
    <ElTableColumn label="批次号" min-width="190" :show-overflow-tooltip="kind !== 'outgoing'">
      <template #default="{ row }">
        <AppPopover
          v-if="kind === 'outgoing'"
          :trigger="['hover', 'focus']"
          placement="top"
          :width="320"
          :show-after="180"
        >
          <template #reference>
            <AppButton
              link
              class="batch-link"
              :title="row.batch_no"
              :aria-label="`${row.batch_no}，悬停查看条码，点击查看详情`"
              @click="emit('detail', row)"
              >{{ row.batch_no }}</AppButton
            >
          </template>
          <BarcodeCard :value="row.batch_no" entity-label="批次号" compact />
        </AppPopover>
        <AppButton
          v-else
          link
          class="batch-link"
          :title="row.batch_no"
          @click="emit('detail', row)"
        >
          {{ row.batch_no }}
        </AppButton>
      </template>
    </ElTableColumn>
    <ElTableColumn class-name="table-identity" label="流水号" min-width="220" show-overflow-tooltip>
      <template #default="{ row }">
        <span class="record-serial"
          ><span :title="sharedSerialLabel(row)">{{ sharedSerialLabel(row) }}</span></span
        >
      </template>
    </ElTableColumn>
    <ElTableColumn
      v-if="kind === 'outgoing'"
      prop="task_batch_number"
      label="排期批次"
      min-width="120"
      align="center"
    >
      <template #default="{ row }">{{ formatScheduleBatch(row) }}</template>
    </ElTableColumn>
    <template v-if="kind === 'receipts'">
      <ElTableColumn label="入库时间" min-width="170" show-overflow-tooltip>
        <template #default="{ row }">{{ formatDateTime(row.received_at) }}</template>
      </ElTableColumn>
      <ElTableColumn v-if="warehouse" label="来源类别" min-width="110" show-overflow-tooltip>
        <template #default="{ row }">{{ receiptSourceLabel(row) }}</template>
      </ElTableColumn>
      <ElTableColumn label="来源" min-width="140" show-overflow-tooltip>
        <template #default="{ row }">{{ materialSourceLabel(row) }}</template>
      </ElTableColumn>
    </template>
    <ElTableColumn label="材质" min-width="130" show-overflow-tooltip>
      <template #default="{ row }">{{ row.material_name || '—' }}</template>
    </ElTableColumn>
    <ElTableColumn label="物料类型" min-width="110" show-overflow-tooltip>
      <template #default="{ row }">{{ materialTypeLabel(row.material_type) }}</template>
    </ElTableColumn>
    <template v-if="kind === 'outgoing'">
      <ElTableColumn label="出库方式" min-width="110" show-overflow-tooltip>
        <template #default="{ row }">{{ materialEntryLabel(row.entry_kind) }}</template>
      </ElTableColumn>
      <ElTableColumn label="下序 / 去向" min-width="140" show-overflow-tooltip>
        <template #default="{ row }">{{
          isExternalEntryKind(row.entry_kind)
            ? row.external_destination || row.next_team.name
            : teamWorkspaceProfile(row.next_team.code)?.name || row.next_team.name
        }}</template>
      </ElTableColumn>
    </template>
    <ElTableColumn label="件数" min-width="100" align="center" show-overflow-tooltip>
      <template #default="{ row }">{{ inventoryAmount(row.quantity) }}</template>
    </ElTableColumn>
    <ElTableColumn label="重量 (kg)" min-width="125" align="center" show-overflow-tooltip>
      <template #default="{ row }">{{ inventoryAmount(row.weight) }}</template>
    </ElTableColumn>
    <ElTableColumn v-if="kind === 'pending'" label="上序" min-width="100" show-overflow-tooltip>
      <template #default="{ row }">{{ row.source_team.name }}</template>
    </ElTableColumn>
    <ElTableColumn v-else label="状态" width="120">
      <template #default="{ row }">
        <MaterialTransferStatus
          :status="row.status"
          :entry-kind="row.entry_kind"
          :outgoing="kind === 'outgoing'"
        />
      </template>
    </ElTableColumn>
    <ElTableColumn
      :label="
        kind === 'pending' ? '转出人' : kind === 'receipts' ? '接收 / 登记人' : '转料 / 登记人'
      "
      :min-width="kind === 'pending' ? 100 : 120"
      align="center"
      show-overflow-tooltip
    >
      <template #default="{ row }">
        <PersonName
          :name="
            kind === 'receipts'
              ? row.entry_kind === 'transfer'
                ? row.received_employee_name || '未登记'
                : row.received_by || '—'
              : materialSenderName(row)
          "
        />
      </template>
    </ElTableColumn>
    <ElTableColumn
      v-if="kind !== 'receipts'"
      :label="kind === 'pending' ? '转出时间' : '登记时间'"
      min-width="170"
      show-overflow-tooltip
    >
      <template #default="{ row }">{{ formatDateTime(row.transferred_at) }}</template>
    </ElTableColumn>
    <ElTableColumn
      label="操作"
      :width="kind === 'receipts' && warehouse && canWrite ? 180 : 110"
      fixed="right"
    >
      <template #default="{ row }">
        <AppButton
          link
          type="primary"
          :disabled="kind === 'pending' && canWrite && !receiverSelected"
          :title="
            kind === 'pending' && canWrite && !receiverSelected ? '请先选择接收人' : undefined
          "
          @click="emit('detail', row)"
          >{{
            kind === 'receipts'
              ? '查看入库单'
              : kind === 'pending' && canWrite
                ? '核对接收'
                : '查看详情'
          }}</AppButton
        >
        <AppButton
          v-if="
            kind === 'receipts' &&
            warehouse &&
            canWrite &&
            row.allowed_actions.includes('edit_receipt')
          "
          link
          type="primary"
          @click="emit('editReceipt', row)"
          >修改入库</AppButton
        >
      </template>
    </ElTableColumn>
  </WorkspaceTable>
</template>
