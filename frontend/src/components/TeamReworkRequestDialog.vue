<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { ElTableColumn } from 'element-plus'
import AppDialog from './AppDialog.vue'
import AppButton from './AppButton.vue'
import AppAlert from './AppAlert.vue'
import AppInput from './AppInput.vue'
import WorkspacePagination from './WorkspacePagination.vue'
import DataTable from './watermelon/WatermelonDataTable.vue'
import ReworkRouteRequest from './ReworkRouteRequest.vue'
import { processRouteApi } from '@/services/processRouteApi'
import type { ReworkSource } from '@/types/processRoute'
import type { QuantityAdjustmentContext } from '@/types/teamMaterials'

const emit = defineEmits<{ close: []; saved: [] }>()
const visible = ref(true),
  busy = ref(false),
  loading = ref(false),
  error = ref('')
const query = ref(''),
  appliedQuery = ref(''),
  page = ref(1),
  total = ref(0)
const rows = ref<ReworkSource[]>([]),
  context = ref<QuantityAdjustmentContext>()
let generation = 0
async function load() {
  if (busy.value) return
  const token = ++generation
  loading.value = true
  error.value = ''
  context.value = undefined
  rows.value = []
  try {
    const data = await processRouteApi.reworkSources(appliedQuery.value, page.value)
    if (token !== generation) return
    rows.value = data.items
    total.value = data.total
  } catch (e) {
    if (token === generation) error.value = e instanceof Error ? e.message : '批次读取失败'
  } finally {
    if (token === generation) loading.value = false
  }
}
function search() {
  appliedQuery.value = query.value.trim()
  page.value = 1
  void load()
}
async function select(id: number) {
  if (busy.value || loading.value) return
  const token = ++generation
  loading.value = true
  error.value = ''
  context.value = undefined
  try {
    const result = await processRouteApi.reworkSourceContext(id)
    if (token === generation) context.value = result
  } catch (e) {
    if (token === generation) error.value = e instanceof Error ? e.message : '批次读取失败'
  } finally {
    if (token === generation) loading.value = false
  }
}
function saved() {
  visible.value = false
  emit('saved')
}
onMounted(load)
onBeforeUnmount(() => ++generation)
</script>

<template>
  <AppDialog
    v-model="visible"
    title="提交返工问题"
    width="min(960px, calc(100vw - 24px))"
    append-to-body
    align-center
    :close-on-click-modal="!busy"
    :close-on-press-escape="!busy"
    :show-close="!busy"
    @closed="emit('close')"
  >
    <AppAlert v-if="error" :title="error" type="error" :closable="false" />
    <form class="rework-search" role="search" @submit.prevent="search">
      <AppInput
        v-model="query"
        placeholder="流水号、批次号"
        aria-label="返工批次搜索"
        :disabled="busy"
        clearable
      />
      <AppButton native-type="submit" class="action-warm" :disabled="loading || busy"
        >查询</AppButton
      >
      <AppButton :disabled="loading || busy" @click="load">刷新</AppButton>
    </form>
    <DataTable
      columns-key="TeamReworkRequestDialog-1"
      :data="rows"
      border
      class="business-table"
      aria-label="本班组返工批次"
      :empty-text="loading ? '读取中' : '暂无可提交的在库批次'"
    >
      <ElTableColumn prop="serial_no" label="流水号" min-width="150" />
      <ElTableColumn prop="batch_no" label="批次号" min-width="190" />
      <ElTableColumn prop="quantity" label="在库件数" width="100" align="right" />
      <ElTableColumn label="在库重量（kg）" width="145" align="right"
        ><template #default="{ row }">{{ row.weight.toFixed(3) }}</template></ElTableColumn
      >
      <ElTableColumn label="操作" width="110" align="center"
        ><template #default="{ row }"
          ><AppButton :disabled="loading || busy" @click="select(row.id)">{{
            context?.source_transfer_id === row.id ? '已选择' : '选择'
          }}</AppButton></template
        ></ElTableColumn
      >
    </DataTable>
    <WorkspacePagination
      v-if="total > 10"
      v-model:current-page="page"
      :total="total"
      :page-size="10"
      :disabled="loading || busy"
      layout="total, prev, pager, next"
      @current-change="load"
    />
    <template v-if="context">
      <p>{{ context.batch_no }}</p>
      <AppAlert
        v-if="!context.rework_task_records?.length"
        title="本批次暂无可关联的加工记录"
        type="warning"
        :closable="false"
      />
      <ReworkRouteRequest
        v-else
        :key="context.source_transfer_id"
        :context="context"
        @busy="busy = $event"
        @changed="saved"
      />
    </template>
  </AppDialog>
</template>

<style scoped>
.rework-search {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.rework-search :deep(.el-input) {
  flex: 1;
  min-width: 0;
}
</style>
