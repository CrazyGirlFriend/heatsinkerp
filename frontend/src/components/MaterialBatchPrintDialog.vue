<script setup lang="ts">
import ElAlert from '@/components/AppAlert.vue'
import AppDialog from '@/components/AppDialog.vue'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

import ElButton from '@/components/AppButton.vue'
import MaterialBatchPrintSheet from './MaterialBatchPrintSheet.vue'
import { materialTransferApi } from '@/services/materialTransferApi'
import type { MaterialTransfer } from '@/types/materialTransfer'
import { groupTransferPrintItems, selectedWarehouseDocuments } from '@/utils/materialTransferPrint'
import { canPrintMaterialTransfer } from '@/types/materialTransfer'
const props = defineProps<{ modelValue: boolean; items: MaterialTransfer[] }>()
const emit = defineEmits<{ 'update:modelValue': [boolean] }>()
const rows = ref<MaterialTransfer[]>([]),
  error = ref(''),
  busy = ref(false),
  printing = ref(false)
const printSheet = ref<InstanceType<typeof MaterialBatchPrintSheet> | null>(null)
const warehouseOnly = computed(
  () => props.items.length > 0 && props.items.every((item) => item.warehouse_dispatch_id),
)
const documentCount = computed(() => groupTransferPrintItems(rows.value).length)
async function loadRows(refresh: boolean) {
  const seen = new Set<number>()
  const requests: Promise<MaterialTransfer[]>[] = []
  for (const item of props.items.filter(canPrintMaterialTransfer)) {
    if (item.warehouse_dispatch_id) {
      if (seen.has(item.warehouse_dispatch_id)) continue
      seen.add(item.warehouse_dispatch_id)
      requests.push(
        materialTransferApi.warehouseDocument(item.warehouse_dispatch_id).then((result) =>
          selectedWarehouseDocuments(
            result,
            props.items.filter((row) => row.warehouse_dispatch_id === item.warehouse_dispatch_id),
          ),
        ),
      )
    } else {
      requests.push(
        refresh
          ? materialTransferApi.get(item.batch_no).then((row) => [row])
          : Promise.resolve([item]),
      )
    }
  }
  return (await Promise.all(requests)).flat().filter(canPrintMaterialTransfer)
}
let generation = 0
watch(
  () => [props.modelValue, props.items] as const,
  async () => {
    const current = ++generation
    error.value = ''
    busy.value = false
    rows.value = []
    if (!props.modelValue) return
    if (!props.items.some((item) => item.warehouse_dispatch_id)) {
      rows.value = props.items.filter(canPrintMaterialTransfer)
      return
    }
    busy.value = true
    try {
      const latest = await loadRows(false)
      if (current === generation) rows.value = latest
    } catch (reason) {
      if (current === generation)
        error.value = reason instanceof Error ? reason.message : '转料单读取失败'
    } finally {
      if (current === generation) busy.value = false
    }
  },
  { immediate: true },
)
function cleanup() {
  document.body.classList.remove('material-batches-printing')
  printing.value = false
}
onBeforeUnmount(() => {
  ++generation
  cleanup()
})
async function print() {
  if (busy.value || !rows.value.length) return
  const current = generation
  busy.value = true
  error.value = ''
  try {
    const latest = await loadRows(true)
    if (current !== generation || !props.modelValue) return
    rows.value = latest.filter(canPrintMaterialTransfer)
    if (!rows.value.length) return
    printing.value = true
    await nextTick()
    await nextTick()
    await printSheet.value?.prepare?.()
    if (current !== generation || !props.modelValue) return
    document.body.classList.add('material-batches-printing')
    window.print()
  } catch (reason) {
    if (current === generation)
      error.value = reason instanceof Error ? reason.message : '无法核对最新批次，未打印，请重试'
  } finally {
    cleanup()
    if (current === generation) busy.value = false
  }
}
</script>
<template>
  <AppDialog
    :model-value="modelValue"
    :title="warehouseOnly ? '打印转料单' : '合并打印'"
    width="min(1000px, 95vw)"
    :close-on-click-modal="!busy"
    :close-on-press-escape="!busy"
    :show-close="!busy"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <p v-if="!warehouseOnly">每个批次独立扫码、独立接收。合并打印不合并批次。</p>
    <ElAlert v-if="error" :title="error" type="error" :closable="false" />
    <div class="batch-print-preview"><MaterialBatchPrintSheet :items="rows" /></div>
    <template #footer
      ><ElButton :disabled="busy" @click="emit('update:modelValue', false)">关闭</ElButton
      ><ElButton type="primary" :loading="busy" :disabled="!rows.length" @click="print"
        >打印 {{ warehouseOnly ? `${documentCount} 张转料单` : `${rows.length} 个批次` }}</ElButton
      ></template
    >
  </AppDialog>
  <Teleport to="body"
    ><MaterialBatchPrintSheet v-if="printing" ref="printSheet" :items="rows"
  /></Teleport>
</template>
<style scoped>
.batch-print-preview {
  overflow-x: auto;
}
.batch-print-preview :deep(article) {
  min-width: 680px;
}
</style>
