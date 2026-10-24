<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import {
  ElAlert,
  ElButton,
  ElInput,
  ElLoading,
  ElPagination,
  ElTable,
  ElTableColumn,
} from 'element-plus'
import AppDialog from './AppDialog.vue'
import { processRouteApi } from '@/services/processRouteApi'
import type { ProcessRoute } from '@/types/processRoute'

const emit = defineEmits<{ selected: [route: ProcessRoute]; close: [] }>()
const vLoading = ElLoading.directive
const visible = ref(true),
  query = ref(''),
  appliedQuery = ref(''),
  page = ref(1),
  total = ref(0)
const items = ref<ProcessRoute[]>([]),
  loading = ref(false),
  busy = ref(false),
  error = ref('')
let generation = 0
async function load() {
  const current = ++generation
  loading.value = true
  error.value = ''
  try {
    const result = await processRouteApi.list(
      appliedQuery.value,
      page.value,
      'draft',
      'desc',
      20,
      'rework',
    )
    if (current !== generation) return
    items.value = result.items
    total.value = result.total
  } catch (reason) {
    if (current === generation)
      error.value = reason instanceof Error ? reason.message : '返工批次读取失败'
  } finally {
    if (current === generation) loading.value = false
  }
}
function search() {
  appliedQuery.value = query.value.trim()
  page.value = 1
  void load()
}
async function choose(id: number) {
  if (busy.value || loading.value) return
  const current = ++generation
  busy.value = true
  error.value = ''
  try {
    const route = await processRouteApi.detail(id)
    if (current !== generation) return
    if (route.route_kind !== 'rework' || route.state !== 'draft' || !route.rework_request)
      throw new Error('本批返工工艺已制定，请刷新后查看')
    emit('selected', route)
  } catch (reason) {
    if (current === generation)
      error.value = reason instanceof Error ? reason.message : '返工工艺读取失败'
  } finally {
    if (current === generation) busy.value = false
  }
}
onMounted(load)
onBeforeUnmount(() => ++generation)
</script>
<template>
  <AppDialog
    v-model="visible"
    title="选择返工批次"
    width="min(1000px, 94vw)"
    append-to-body
    :close-on-click-modal="!busy"
    :close-on-press-escape="!busy"
    :show-close="!busy"
    @closed="emit('close')"
  >
    <ElAlert v-if="error" :title="error" type="error" :closable="false" />
    <div class="rework-picker-search">
      <ElInput
        v-model="query"
        placeholder="流水号、批次号"
        aria-label="返工批次搜索"
        clearable
        :disabled="busy"
        @keyup.enter="search"
        @clear="search"
      />
      <ElButton :disabled="loading || busy" @click="search">查询</ElButton>
    </div>
    <ElTable
      v-loading="loading"
      :data="items"
      border
      class="business-table"
      max-height="440"
      row-key="id"
      empty-text="暂无待制定工艺的返工批次"
    >
      <ElTableColumn label="流水号" min-width="200"
        ><template #default="{ row }">{{ row.serial_nos.join('、') }}</template></ElTableColumn
      >
      <ElTableColumn prop="rework_batch_no" label="返工批次" min-width="200" />
      <ElTableColumn label="返工范围" min-width="150"
        ><template #default="{ row }"
          >{{ row.rework_quantity }} 件 · {{ row.rework_weight }} kg</template
        ></ElTableColumn
      >
      <ElTableColumn label="操作" width="100" align="center"
        ><template #default="{ row }"
          ><ElButton type="primary" link :disabled="busy || loading" @click="choose(row.id)"
            >选择</ElButton
          ></template
        ></ElTableColumn
      >
    </ElTable>
    <ElPagination
      v-model:current-page="page"
      :page-size="20"
      :total="total"
      :disabled="busy || loading"
      layout="total, prev, pager, next"
      @current-change="load"
    />
    <template #footer><ElButton :disabled="busy" @click="visible = false">取消</ElButton></template>
  </AppDialog>
</template>
<style scoped>
.rework-picker-search {
  display: flex;
  gap: 10px;
  margin-block: 12px 16px;
}
.el-pagination {
  justify-content: flex-end;
  margin-top: 16px;
}
</style>
