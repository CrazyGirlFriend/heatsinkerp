<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import {
  ElButton,
  ElInput,
  ElInputNumber,
  ElPagination,
  ElTable,
  ElTableColumn,
} from 'element-plus'
import { Search } from '@element-plus/icons-vue'
import AppDialog from './AppDialog.vue'
import StatePanel from './StatePanel.vue'
import { productionScheduleApi } from '@/services/productionScheduleApi'
import type { ScheduleSource, ScheduleSourceOption } from '@/types/productionSchedule'
import { materialTypeLabel, type MaterialType } from '@/types/materialTransfer'
import { formatAmount } from '@/utils/format'
const props = defineProps<{
  modelValue: ScheduleSource[]
  serialNo: string
  teamId?: number
  targetQuantity?: number | null
  targetWeight?: number | null
  disabled?: boolean
  error?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [sources: ScheduleSource[]] }>()
const pickerOpen = ref(false),
  sourceQuery = ref(''),
  sourceSearch = ref(''),
  sourcePage = ref(1)
const candidates = ref<ScheduleSourceOption[]>([]),
  candidateTotal = ref(0),
  candidatesLoading = ref(false),
  candidateError = ref('')
let generation = 0
async function loadSources() {
  if (!props.teamId || !props.serialNo.trim()) return
  const token = ++generation
  candidatesLoading.value = true
  candidateError.value = ''
  try {
    const result = await productionScheduleApi.sources({
      team_id: props.teamId,
      serial_no: props.serialNo.trim(),
      query: sourceSearch.value,
      page: sourcePage.value,
      page_size: 10,
    })
    if (token !== generation) return
    candidates.value = result.items
    candidateTotal.value = result.total
  } catch (e) {
    if (token === generation) candidateError.value = e instanceof Error ? e.message : '批次读取失败'
  } finally {
    if (token === generation) candidatesLoading.value = false
  }
}
function openSources() {
  pickerOpen.value = true
  sourcePage.value = 1
  sourceQuery.value = sourceSearch.value = ''
  void loadSources()
}
function searchSources() {
  sourceSearch.value = sourceQuery.value.trim()
  sourcePage.value = 1
  void loadSources()
}
function paginateSources(value: number) {
  sourcePage.value = value
  void loadSources()
}
function addSource(source: ScheduleSourceOption) {
  if (props.modelValue.some((item) => item.source_transfer_id === source.source_transfer_id)) return
  const first = props.modelValue.length === 0
  emit('update:modelValue', [
    ...props.modelValue,
    {
      source_transfer_id: source.source_transfer_id,
      batch_no: source.batch_no,
      quantity: first ? props.targetQuantity || null : null,
      weight: first ? props.targetWeight || null : null,
    },
  ])
}
watch(
  () => [props.teamId, props.serialNo],
  () => {
    ++generation
    pickerOpen.value = false
    candidates.value = []
    candidatesLoading.value = false
  },
)
watch(pickerOpen, (open) => {
  if (!open) {
    ++generation
    candidatesLoading.value = false
  }
})
onBeforeUnmount(() => {
  ++generation
})
</script>
<template>
  <section class="schedule-sources" :class="{ 'is-error': error }" :aria-invalid="!!error">
    <header>
      <div>
        <strong>关联物料批次</strong
        ><span>可以先排期，来料后再关联；此处填写本节点计划交出量。</span>
      </div>
      <ElButton :disabled="disabled || !teamId || !serialNo.trim()" @click="openSources"
        >关联批次</ElButton
      >
    </header>
    <ElTable
      v-if="modelValue.length"
      :data="modelValue"
      class="business-table"
      row-key="source_transfer_id"
    >
      <ElTableColumn label="来源批次" prop="batch_no" min-width="200" align="center" />
      <ElTableColumn label="分配计划件数" min-width="180" align="center"
        ><template #default="{ row }"
          ><ElInputNumber
            v-model="row.quantity"
            :min="0"
            :precision="0"
            controls-position="right"
            :aria-label="`${row.batch_no}计划件数`" /></template
      ></ElTableColumn>
      <ElTableColumn label="分配计划重量（kg）" min-width="190" align="center"
        ><template #default="{ row }"
          ><ElInputNumber
            v-model="row.weight"
            :min="0"
            :precision="6"
            controls-position="right"
            :aria-label="`${row.batch_no}计划重量`" /></template
      ></ElTableColumn>
      <ElTableColumn label="操作" width="76" align="center"
        ><template #default="{ $index }"
          ><ElButton
            link
            type="danger"
            @click="
              emit(
                'update:modelValue',
                modelValue.filter((_, index) => index !== $index),
              )
            "
            >移除</ElButton
          ></template
        ></ElTableColumn
      >
    </ElTable>
    <p v-else class="schedule-form__note">
      尚未关联批次，计划不会产生库存。废料、废渣等不纳入交货排期。
    </p>
    <p v-if="error" class="schedule-form__error" role="alert">
      {{ error }}
    </p>
  </section>
  <AppDialog
    v-model="pickerOpen"
    title="关联本班组物料批次"
    width="min(900px, 94vw)"
    append-to-body
  >
    <div class="schedule-source-search">
      <ElInput
        v-model="sourceQuery"
        :prefix-icon="Search"
        placeholder="搜索批次号或材质"
        aria-label="关联批次搜索"
        clearable
        @keyup.enter="searchSources"
        @clear="searchSources"
      /><ElButton @click="searchSources">查询</ElButton>
    </div>
    <StatePanel
      v-if="candidateError"
      state="error"
      :description="candidateError"
      @retry="loadSources"
    />
    <ElTable
      v-else
      :data="candidates"
      class="business-table"
      max-height="380"
      empty-text="暂无可关联批次，可先保存计划，来料后再关联"
      v-loading="candidatesLoading"
    >
      <ElTableColumn label="批次号" prop="batch_no" min-width="200" align="center" />
      <ElTableColumn label="材质" prop="material_name" min-width="100" align="center" />
      <ElTableColumn label="物料类型" min-width="120" align="center"
        ><template #default="{ row }">{{
          materialTypeLabel(row.material_type as MaterialType)
        }}</template></ElTableColumn
      >
      <ElTableColumn label="当前库存件数" min-width="120" align="center"
        ><template #default="{ row }">{{
          formatAmount(row.on_hand_quantity)
        }}</template></ElTableColumn
      >
      <ElTableColumn label="当前库存重量（kg）" min-width="150" align="center"
        ><template #default="{ row }">{{
          formatAmount(row.on_hand_weight)
        }}</template></ElTableColumn
      >
      <ElTableColumn label="操作" width="90" fixed="right" align="center"
        ><template #default="{ row }"
          ><ElButton
            link
            type="primary"
            :disabled="
              modelValue.some((source) => source.source_transfer_id === row.source_transfer_id)
            "
            @click="addSource(row as ScheduleSourceOption)"
            >{{
              modelValue.some((source) => source.source_transfer_id === row.source_transfer_id)
                ? '已关联'
                : '关联'
            }}</ElButton
          ></template
        ></ElTableColumn
      >
    </ElTable>
    <template #footer
      ><span class="schedule-source-count">共 {{ candidateTotal }} 个批次</span
      ><ElPagination
        :current-page="sourcePage"
        :total="candidateTotal"
        :page-size="10"
        layout="prev, pager, next"
        @current-change="paginateSources"
      /><ElButton type="primary" @click="pickerOpen = false">完成</ElButton></template
    >
  </AppDialog>
</template>
<style scoped>
.schedule-form__note {
  color: var(--muted);
  font-size: 13px;
  margin: 10px 0 16px;
  line-height: 1.6;
}
.schedule-sources {
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 14px;
  margin: 4px 0 18px;
}
.schedule-sources.is-error {
  border-color: var(--el-color-danger);
}
.schedule-sources header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: center;
  margin-bottom: 12px;
}
.schedule-sources header strong {
  color: var(--text);
  font-size: 14px;
}
.schedule-sources header span {
  display: block;
  color: var(--muted);
  font-size: 12px;
  margin-top: 4px;
}
.schedule-sources :deep(.el-input-number) {
  max-width: 180px;
}
.schedule-form__error {
  color: var(--el-color-danger);
  font-size: 12px;
  margin: 8px 0 0;
}
.schedule-source-search {
  display: flex;
  gap: 10px;
  margin-bottom: 14px;
}
.schedule-source-count {
  margin-right: auto;
  color: var(--muted);
  font-size: 13px;
}
</style>
