<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { ElAlert, ElButton, ElInput, ElPagination, ElTable, ElTableColumn } from 'element-plus'
import AppDialog from './AppDialog.vue'
import ReworkRouteRequest from './ReworkRouteRequest.vue'
import { processRouteApi, type ReworkSource } from '@/services/processRouteApi'
import type { QuantityAdjustmentContext } from '@/types/teamMaterials'
const emit = defineEmits<{ close: []; submitted: [] }>()
const visible = ref(true),
  query = ref(''),
  appliedQuery = ref(''),
  page = ref(1),
  total = ref(0),
  loading = ref(false),
  busy = ref(false),
  error = ref('')
const items = ref<ReworkSource[]>([]),
  context = ref<QuantityAdjustmentContext>()
let generation = 0
async function load() {
  const token = ++generation
  loading.value = true
  error.value = ''
  context.value = undefined
  try {
    const result = await processRouteApi.reworkSources(appliedQuery.value, page.value)
    if (token === generation) {
      items.value = result.items
      total.value = result.total
    }
  } catch (e) {
    if (token === generation) error.value = e instanceof Error ? e.message : '库存读取失败'
  } finally {
    if (token === generation) loading.value = false
  }
}
async function select(id: number) {
  const token = ++generation
  loading.value = true
  context.value = undefined
  error.value = ''
  try {
    const result = await processRouteApi.reworkSourceContext(id)
    if (token === generation) context.value = result
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
function submitted() {
  emit('submitted')
  visible.value = false
}
function close(done: () => void) {
  if (!busy.value) done()
}
onMounted(load)
onBeforeUnmount(() => {
  ++generation
})
</script>
<template>
  <AppDialog
    v-model="visible"
    title="提交返工问题"
    width="min(900px, 94vw)"
    append-to-body
    :before-close="close"
    :close-on-click-modal="false"
    @closed="emit('close')"
  >
    <ElAlert v-if="error" :title="error" type="error" :closable="false" />
    <template v-if="!context">
      <form class="batch-search" @submit.prevent="search">
        <ElInput v-model="query" placeholder="流水号、批次号" aria-label="返工批次搜索" /><ElButton
          native-type="submit"
          :disabled="loading"
          >查询</ElButton
        >
      </form>
      <ElTable
        :data="items"
        border
        class="business-table"
        :empty-text="loading ? '读取中' : '暂无可提交的在库批次'"
      >
        <ElTableColumn prop="serial_no" label="流水号" min-width="170" />
        <ElTableColumn prop="batch_no" label="批次号" min-width="190" />
        <ElTableColumn prop="quantity" label="在库件数" width="100" align="right" />
        <ElTableColumn prop="weight" label="重量（kg）" width="120" align="right" />
        <ElTableColumn label="操作" width="90"
          ><template #default="{ row }"
            ><ElButton size="small" :disabled="loading" @click="select(row.id)"
              >选择</ElButton
            ></template
          ></ElTableColumn
        >
      </ElTable>
      <ElPagination
        v-model:current-page="page"
        :total="total"
        :page-size="10"
        :disabled="loading"
        layout="total, prev, pager, next"
        @current-change="load"
      />
    </template>
    <template v-else>
      <div class="batch-heading">
        <span>{{ context.serial_no }} · {{ context.batch_no }}</span
        ><ElButton size="small" :disabled="busy" @click="context = undefined">重新选择</ElButton>
      </div>
      <ElAlert
        v-if="!context.rework_task_records?.length"
        title="该批次没有可关联的加工记录"
        type="warning"
        :closable="false"
      />
      <ReworkRouteRequest
        v-else
        :key="context.source_transfer_id"
        :context="context"
        @busy="busy = $event"
        @changed="submitted"
      />
    </template>
  </AppDialog>
</template>
<style scoped>
.batch-search,
.batch-heading {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}
.batch-heading {
  justify-content: space-between;
}
.el-pagination {
  justify-content: flex-end;
  margin-top: 12px;
}
</style>
