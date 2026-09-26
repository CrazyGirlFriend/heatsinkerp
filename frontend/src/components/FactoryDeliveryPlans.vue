<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import {
  ElButton,
  ElDialog,
  ElInput,
  ElMessage,
  ElPagination,
  ElSelect,
  ElOption,
  ElTable,
  ElTableColumn,
} from 'element-plus'
import { factoryDashboardApi as api } from '@/services/factoryDashboardApi'
import { isAdmin } from '@/stores/auth'
import type { Delivery, DeliveryPlan, SerialChoice } from '@/types/factoryDashboard'
import { dashboardNumber as number, deliveryStatus } from '@/utils/factoryDashboard'
const emit = defineEmits<{ close: []; saved: [] }>()
const query = ref(''),
  page = ref(1),
  total = ref(0),
  rows = ref<Delivery[]>([]),
  loading = ref(false),
  error = ref('')
const editing = ref(false),
  serial = ref(''),
  choices = ref<SerialChoice[]>([]),
  plan = ref<DeliveryPlan>(),
  saving = ref(false),
  editError = ref('')
let generation = 0,
  searchGeneration = 0,
  planGeneration = 0
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
    if (version === generation) {
      rows.value = data.items
      total.value = data.total
    }
  } catch {
    if (version === generation) error.value = '交付计划读取失败，请重试'
  } finally {
    if (version === generation) loading.value = false
  }
}
async function searchSerials(value: string) {
  const version = ++searchGeneration
  try {
    const data = await api.serials(value)
    if (version === searchGeneration) choices.value = data.items
  } catch {
    editError.value = '流水号读取失败，请重试'
  }
}
async function openEditor(value = '') {
  editing.value = true
  serial.value = value
  plan.value = undefined
  editError.value = ''
  await searchSerials(value)
  if (value) await loadPlan()
}
async function loadPlan() {
  const version = ++planGeneration
  plan.value = undefined
  editError.value = ''
  if (!serial.value) return
  try {
    const data = await api.plan(serial.value)
    if (version === planGeneration) plan.value = data
  } catch {
    if (version === planGeneration) editError.value = '计划读取失败，请重试'
  }
}
async function save() {
  if (!plan.value) return
  if (
    plan.value.installments.some(
      (r) => !r.label.trim() || !r.due_date || !Number.isSafeInteger(r.quantity) || r.quantity <= 0,
    )
  ) {
    editError.value = '请填写批次、交期和正整数件数'
    return
  }
  saving.value = true
  editError.value = ''
  try {
    plan.value = await api.savePlan(plan.value)
    editing.value = false
    ElMessage.success('交付计划已保存')
    emit('saved')
    await load()
  } catch (e) {
    editError.value = e instanceof Error ? e.message : '保存失败，请重试'
  } finally {
    saving.value = false
  }
}
onMounted(load)
onBeforeUnmount(() => {
  ++generation
  ++searchGeneration
  ++planGeneration
})
</script>
<template>
  <ElDialog
    :model-value="true"
    title="交付计划"
    width="1000px"
    class="factory-detail-dialog"
    @close="emit('close')"
  >
    <div class="delivery-toolbar">
      <ElInput
        v-model="query"
        placeholder="搜索流水号"
        clearable
        aria-label="搜索交付计划"
        @keyup.enter="searchPlans"
        @clear="searchPlans"
      /><ElButton @click="searchPlans">查询</ElButton
      ><ElButton v-if="isAdmin" type="primary" @click="openEditor()">设置交付计划</ElButton>
    </div>
    <p v-if="error" role="alert">{{ error }}<ElButton link @click="load">重试</ElButton></p>
    <ElTable v-loading="loading" :data="rows" empty-text="尚未设置交付计划" max-height="470"
      ><ElTableColumn prop="serial_no" label="流水号" min-width="140" /><ElTableColumn
        prop="label"
        label="批次"
        min-width="95"
      /><ElTableColumn prop="due_date" label="交期" width="110" /><ElTableColumn
        prop="quantity"
        label="应发件数"
        width="100"
        align="right"
      /><ElTableColumn prop="shipped" label="已发件数" width="100" align="right" /><ElTableColumn
        label="还差"
        width="90"
        align="right"
        ><template #default="{ row }">{{ number(row.remaining, 0) }}</template></ElTableColumn
      ><ElTableColumn label="状态" min-width="115"
        ><template #default="{ row }"
          >{{ deliveryStatus(row.status)
          }}<small v-if="row.overdue_days"> · {{ row.overdue_days }}天</small></template
        ></ElTableColumn
      ><ElTableColumn v-if="isAdmin" width="70"
        ><template #default="{ row }"
          ><ElButton link type="primary" @click="openEditor(row.serial_no)"
            >修改</ElButton
          ></template
        ></ElTableColumn
      ></ElTable
    >
    <ElPagination
      v-model:current-page="page"
      :page-size="30"
      :total="total"
      layout="total, prev, pager, next"
      @current-change="load"
    />
    <ElDialog
      v-model="editing"
      title="设置分批交期"
      width="700px"
      append-to-body
      :close-on-click-modal="false"
      class="factory-detail-dialog"
    >
      <ElSelect
        v-model="serial"
        remote
        filterable
        :remote-method="searchSerials"
        placeholder="搜索并选择流水号"
        aria-label="交付计划流水号"
        style="width: 100%"
        :disabled="saving"
        @change="loadPlan"
        ><ElOption
          v-for="row in choices"
          :key="row.serial_no"
          :label="row.serial_no"
          :value="row.serial_no"
      /></ElSelect>
      <p v-if="editError" role="alert" class="plan-error">{{ editError }}</p>
      <div v-if="plan" class="plan-editor">
        <div class="plan-head">
          <span>交付批次</span><span>交期</span><span>应发件数</span><span />
        </div>
        <div v-for="(part, i) in plan.installments" :key="i" class="plan-row">
          <input
            v-model="part.label"
            :aria-label="'批次名称 ' + (i + 1)"
            maxlength="60"
            :disabled="saving"
          /><input
            v-model="part.due_date"
            type="date"
            min="2000-01-01"
            max="2100-12-31"
            :aria-label="'批次交期 ' + (i + 1)"
            :disabled="saving"
          /><input
            v-model.number="part.quantity"
            type="number"
            min="1"
            step="1"
            :aria-label="'计划件数 ' + (i + 1)"
            :disabled="saving"
          /><ElButton link type="danger" :disabled="saving" @click="plan.installments.splice(i, 1)"
            >删除</ElButton
          >
        </div>
        <ElButton
          :disabled="saving || plan.installments.length >= 100"
          @click="
            plan.installments.push({
              label: '第 ' + (plan.installments.length + 1) + ' 批',
              due_date: '',
              quantity: 1,
            })
          "
          >添加一批</ElButton
        >
      </div>
      <template #footer
        ><ElButton :disabled="saving" @click="editing = false">取消</ElButton
        ><ElButton type="primary" :disabled="!plan" :loading="saving" @click="save"
          >保存计划</ElButton
        ></template
      >
    </ElDialog>
  </ElDialog>
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
.plan-editor {
  margin-top: 20px;
}
.plan-row,
.plan-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 160px 110px 40px;
  gap: 10px;
  align-items: center;
  margin-bottom: 12px;
}
.plan-head {
  font-size: 12px;
  color: var(--muted);
}
.plan-row input {
  width: 100%;
  min-width: 0;
  border: 1px solid var(--line);
  padding: 8px;
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
}
.plan-error {
  color: #ad6544;
}
@media (max-width: 650px) {
  .plan-row,
  .plan-head {
    grid-template-columns: minmax(0, 1fr) 120px 75px 32px;
    gap: 5px;
  }
  .plan-row input {
    font-size: 12px;
    padding: 5px;
  }
  .delivery-toolbar {
    flex-wrap: wrap;
  }
}
</style>
