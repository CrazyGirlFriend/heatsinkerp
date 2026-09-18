<script setup lang="ts">
// Historical CK lookup only. All business actions belong to an individual batch.
import { defineAsyncComponent, onBeforeUnmount, ref, watch } from 'vue'
import { ElAlert, ElButton } from 'element-plus'
import MaterialTransferDetailFrame from './MaterialTransferDetailFrame.vue'
import MaterialBatchPrintDialog from './MaterialBatchPrintDialog.vue'
import MaterialTransferStatus from './MaterialTransferStatus.vue'
import LiveRefreshNotice from './LiveRefreshNotice.vue'
import StatePanel from './StatePanel.vue'
import { useLiveRefresh } from '@/composables/useLiveRefresh'
import { useAuthStore } from '@/stores/auth'
import { materialDispatchApi } from '@/services/materialDispatchApi'
import { materialTypeLabel, type MaterialTransfer } from '@/types/materialTransfer'
import type { MaterialDispatchDocument } from '@/types/teamMaterials'
const MaterialTransferDrawer = defineAsyncComponent(() => import('./MaterialTransferDrawer.vue'))
const props = withDefaults(defineProps<{ modelValue: boolean; dispatchNo?: string; docked?: boolean }>(), { dispatchNo: '', docked: false })
const emit = defineEmits<{ 'update:modelValue': [boolean]; changed: [MaterialDispatchDocument]; busyChange: [boolean] }>()
const auth = useAuthStore()
const current = ref<MaterialDispatchDocument | null>(null), loading = ref(false), error = ref('')
const selected = ref<MaterialTransfer | null>(null), batchOpen = ref(false), printOpen = ref(false), batchBusy = ref(false)
let version = 0
const live = useLiveRefresh(() => load(true), { enabled: () => props.modelValue && !!props.dispatchNo, busy: () => loading.value || batchOpen.value || printOpen.value })
async function load(background = false) {
  const request = ++version
  if (!props.modelValue || !props.dispatchNo) return
  if (!background) loading.value = true
  error.value = ''
  try {
    const result = await materialDispatchApi.get(props.dispatchNo)
    if (request === version) current.value = result
  } catch (reason) {
    if (request === version) {
      if (background) throw reason
      error.value = reason instanceof Error ? reason.message : '历史记录读取失败'
    }
  } finally { if (request === version) loading.value = false }
}
function openBatch(item: MaterialTransfer) { selected.value = item; batchOpen.value = true }
function setBusy(value: boolean) { batchBusy.value = value; emit('busyChange', value) }
function close() { if (!batchBusy.value) emit('update:modelValue', false) }
async function changed() { await load(); if (current.value) emit('changed', current.value) }
function reset() { ++version; current.value = null; selected.value = null; batchOpen.value = printOpen.value = loading.value = false; setBusy(false); error.value = '' }
watch(() => [props.modelValue, props.dispatchNo], () => { reset(); if (props.modelValue) void load() }, { immediate: true })
watch(() => `${auth.currentUser?.id}:${auth.currentUser?.team_id}:${auth.currentUser?.active}`, () => { reset(); emit('update:modelValue', false) })
onBeforeUnmount(reset)
</script>

<template>
  <MaterialTransferDetailFrame :model-value="modelValue" :docked="docked" :busy="batchBusy" title="历史合并记录" @close="close">
    <template #header><h2>历史合并记录</h2></template>
    <StatePanel v-if="loading && !current" state="loading" title="正在读取历史记录" />
    <StatePanel v-else-if="!current" state="error" :description="error" @retry="load()" />
    <template v-else>
      <p>历史编号：{{ dispatchNo }}。以下批次分别核对、分别接收；合并打印不合并批次。</p>
      <LiveRefreshNotice :message="live.message.value" @retry="live.request" />
      <ElAlert v-if="error" :title="error" type="error" :closable="false" />
      <div class="historical-table"><table class="business-document-table" aria-label="历史记录中的独立批次">
        <thead><tr><th>批次号 / 流水号</th><th>材质 / 类型</th><th>件数</th><th>重量 kg</th><th>状态</th><th>操作</th></tr></thead>
        <tbody><tr v-for="item in current.items" :key="item.batch_no"><td>{{ item.batch_no }}<small>{{ item.serial_no }}</small></td><td>{{ item.material_name || '—' }}<small>{{ materialTypeLabel(item.material_type) }}</small></td><td>{{ item.quantity }}</td><td>{{ item.weight }}</td><td><MaterialTransferStatus :status="item.status" :entry-kind="item.entry_kind" /></td><td><ElButton link type="primary" :disabled="loading || !!error" :aria-label="'查看批次 ' + item.batch_no" @click="openBatch(item)">查看批次</ElButton></td></tr></tbody>
      </table></div>
    </template>
    <template #footer><ElButton :disabled="!current || loading || !!error" @click="printOpen = true">合并打印</ElButton></template>
  </MaterialTransferDetailFrame>
  <MaterialTransferDrawer v-if="selected" v-model="batchOpen" :transfer="selected" :batch-no="selected.batch_no" :show-history-group="false" @changed="changed" @busy-change="setBusy" />
  <MaterialBatchPrintDialog v-model="printOpen" :items="current?.items || []" />
</template>
<style scoped>
h2 { margin: 0; font-size: 22px; } p { color: var(--el-text-color-secondary); line-height: 1.7; }
.historical-table { overflow-x: auto; margin-top: 16px; } table { width: 100%; min-width: 580px; } small { display: block; margin-top: 4px; }
</style>
