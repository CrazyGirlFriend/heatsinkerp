<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import {
  ElButton,
  ElDialog,
  ElInput,
  ElLoading,
  ElPagination,
  ElTable,
  ElTableColumn,
} from 'element-plus'
import MaterialTransferDrawer from './MaterialTransferDrawer.vue'
import { factoryDashboardApi as api } from '@/services/factoryDashboardApi'
import type { Delivery } from '@/types/factoryDashboard'
import { dashboardNumber as number, deliveryStatus } from '@/utils/factoryDashboard'
const vLoading = ElLoading.directive
const emit = defineEmits<{ close: []; saved: [] }>()
const query = ref(''),
  page = ref(1),
  total = ref(0),
  rows = ref<Delivery[]>([]),
  loading = ref(false),
  error = ref('')
const sourceOpen = ref(false),
  sourceBatch = ref('')
let generation = 0
function searchPlans() {
  page.value = 1
  void load()
}
async function load() {
  const version = ++generation
  loading.value = true
  error.value = ''
  try {
    const data = await api.deliveries(query.value, page.value)
    if (version !== generation) return
    rows.value = data.items
    total.value = data.total
  } catch {
    if (version === generation) error.value = '交期明细读取失败，请重试'
  } finally {
    if (version === generation) loading.value = false
  }
}
function openSource(batch: string) {
  sourceBatch.value = batch
  sourceOpen.value = true
}
function changed() {
  emit('saved')
  void load()
}
onMounted(load)
onBeforeUnmount(() => {
  ++generation
})
</script>

<template>
  <ElDialog
    :model-value="true"
    title="批次交期与完成情况"
    width="1000px"
    class="factory-detail-dialog"
    @close="emit('close')"
  >
    <div class="delivery-toolbar">
      <ElInput
        v-model="query"
        placeholder="搜索流水号"
        clearable
        aria-label="搜索交期明细"
        @keyup.enter="searchPlans"
        @clear="searchPlans"
      /><ElButton @click="searchPlans">查询</ElButton>
    </div>
    <p v-if="error" role="alert">{{ error }}<ElButton link @click="load">重试</ElButton></p>
    <ElTable
      v-loading="loading"
      :data="rows"
      empty-text="暂无批次交期，请在源头单据填写"
      max-height="470"
    >
      <ElTableColumn prop="serial_no" label="流水号" min-width="130" />
      <ElTableColumn label="源头批次" min-width="170"
        ><template #default="{ row }"
          ><ElButton
            v-if="row.source_batch_no"
            link
            type="primary"
            @click="openSource(row.source_batch_no)"
            >{{ row.source_batch_no }}</ElButton
          ><span v-else>{{ row.label }} · 历史计划</span></template
        ></ElTableColumn
      >
      <ElTableColumn prop="due_date" label="要求发货日期" width="125" />
      <ElTableColumn prop="quantity" label="应发件数" width="100" align="right" />
      <ElTableColumn prop="shipped" label="已发件数" width="100" align="right" />
      <ElTableColumn label="还差" width="90" align="right"
        ><template #default="{ row }">{{ number(row.remaining, 0) }}</template></ElTableColumn
      >
      <ElTableColumn label="状态" min-width="115"
        ><template #default="{ row }"
          >{{ deliveryStatus(row.status)
          }}<small v-if="row.overdue_days"> · {{ row.overdue_days }}天</small></template
        ></ElTableColumn
      >
    </ElTable>
    <p v-if="rows.some((row) => row.legacy)" class="legacy-notice">
      历史独立计划保留原记录，尚未关联源头批次。
    </p>
    <ElPagination
      v-model:current-page="page"
      :page-size="30"
      :total="total"
      layout="total, prev, pager, next"
      @current-change="load"
    />
  </ElDialog>
  <MaterialTransferDrawer v-model="sourceOpen" :batch-no="sourceBatch" @changed="changed" />
</template>

<style scoped>
.delivery-toolbar {
  display: flex;
  gap: 10px;
  margin-bottom: 16px;
}
.delivery-toolbar .el-input {
  max-width: 260px;
}
.el-pagination {
  margin-top: 16px;
  justify-content: flex-end;
}
.legacy-notice {
  color: var(--subtle);
  font-size: 13px;
}
</style>
