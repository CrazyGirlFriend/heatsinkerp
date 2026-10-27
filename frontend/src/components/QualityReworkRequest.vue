<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { ElAlert, ElButton, ElPagination, ElTable, ElTableColumn } from 'element-plus'
import ReworkRouteRequest from './ReworkRouteRequest.vue'
import {
  qualityFeedbackApi,
  type QualityFeedbackDetail,
  type QualityReworkStock,
} from '@/services/qualityFeedbackApi'
import type { QuantityAdjustmentContext } from '@/types/teamMaterials'
const props = defineProps<{ issue: QualityFeedbackDetail }>()
const emit = defineEmits<{ changed: []; busy: [boolean] }>()
const items = ref<QualityReworkStock[]>([]),
  total = ref(0),
  page = ref(1)
const context = ref<QuantityAdjustmentContext>(),
  loading = ref(false),
  busy = ref(false),
  error = ref(''),
  submitted = ref(false)
let generation = 0
async function load() {
  const token = ++generation
  loading.value = true
  error.value = ''
  context.value = undefined
  try {
    const result = await qualityFeedbackApi.reworkStock(props.issue.id, page.value)
    if (token === generation) {
      items.value = result.items
      total.value = result.total
    }
  } catch (e) {
    if (token === generation) error.value = e instanceof Error ? e.message : '返工库存读取失败'
  } finally {
    if (token === generation) loading.value = false
  }
}
async function select(lotId: number) {
  if (loading.value || busy.value) return
  const token = ++generation
  loading.value = true
  error.value = ''
  context.value = undefined
  try {
    const result = await qualityFeedbackApi.reworkContext(props.issue.id, lotId)
    if (token === generation) context.value = result
  } catch (e) {
    if (token === generation) error.value = e instanceof Error ? e.message : '批次读取失败'
  } finally {
    if (token === generation) loading.value = false
  }
}
function pageChanged(value: number) {
  page.value = value
  void load()
}
function saved() {
  submitted.value = true
  page.value = 1
  void load()
  emit('changed')
}
function busyChanged(value: boolean) {
  busy.value = value
  emit('busy', value)
}
watch(
  () => props.issue.id,
  () => {
    page.value = 1
    void load()
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  ++generation
})
</script>
<template>
  <section class="quality-rework-request" aria-label="提交返工工艺">
    <ElAlert v-if="error" :title="error" type="error" :closable="false" />
    <ElAlert v-if="submitted" title="已提交工艺" type="success" :closable="false" />
    <div class="rework-batch-heading">
      <h3>选择返工批次</h3>
      <ElButton :disabled="loading || busy" @click="load">刷新</ElButton>
    </div>
    <ElTable
      :data="items"
      border
      class="business-table"
      :empty-text="loading ? '读取中' : '暂无可提交的在库批次'"
    >
      <ElTableColumn prop="batch_no" label="批次号" min-width="190" />
      <ElTableColumn prop="team_name" label="所在班组" width="110" align="center" />
      <ElTableColumn prop="quantity" label="在库件数" width="110" align="right" />
      <ElTableColumn prop="weight" label="在库重量（kg）" width="140" align="right" />
      <ElTableColumn label="操作" width="90" align="center"
        ><template #default="{ row }"
          ><ElButton link type="primary" :disabled="loading || busy" @click="select(row.id)">{{
            context?.source_transfer_id === row.id ? '已选择' : '选择'
          }}</ElButton></template
        ></ElTableColumn
      >
    </ElTable>
    <ElPagination
      v-if="total > 10"
      :current-page="page"
      :page-size="10"
      :total="total"
      :disabled="loading || busy"
      layout="total, prev, pager, next"
      @current-change="pageChanged"
    />
    <template v-if="context">
      <p class="rework-selected-batch">{{ context.batch_no }}</p>
      <ReworkRouteRequest
        :key="context.source_transfer_id"
        :context="context"
        :inspection-id="issue.id"
        :initial-reason="
          issue.decision_notes ||
          issue.notes ||
          issue.problems?.map((item) => item.name).join('、') ||
          ''
        "
        @busy="busyChanged"
        @changed="saved"
      />
    </template>
  </section>
</template>
<style scoped>
.quality-rework-request {
  margin-top: 16px;
}
.rework-batch-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.rework-batch-heading h3 {
  margin: 0;
  font-size: 15px;
}
.rework-selected-batch {
  margin-bottom: 0;
  font-weight: 600;
}
.el-pagination {
  justify-content: flex-end;
  margin-top: 12px;
}
</style>
