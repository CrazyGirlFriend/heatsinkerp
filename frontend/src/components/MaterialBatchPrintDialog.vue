<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { ElAlert, ElButton, ElDialog } from 'element-plus'
import MaterialBatchPrintSheet from './MaterialBatchPrintSheet.vue'
import { materialTransferApi } from '@/services/materialTransferApi'
import type { MaterialTransfer } from '@/types/materialTransfer'
const props = defineProps<{ modelValue: boolean; items: MaterialTransfer[] }>()
const emit = defineEmits<{ 'update:modelValue': [boolean] }>()
const rows = ref<MaterialTransfer[]>([]), error = ref(''), busy = ref(false), printing = ref(false)
let generation = 0
watch(() => [props.modelValue, props.items] as const, () => { ++generation; rows.value = [...props.items]; error.value = ''; busy.value = false }, { immediate: true })
function cleanup() { document.body.classList.remove('material-batches-printing'); printing.value = false }
onBeforeUnmount(() => { ++generation; cleanup() })
async function print() {
  if (busy.value || !rows.value.length) return
  const current = generation
  busy.value = true; error.value = ''
  try {
    const latest = await Promise.all(rows.value.map(item => materialTransferApi.get(item.batch_no)))
    if (current !== generation || !props.modelValue) return
    rows.value = latest; printing.value = true
    await nextTick(); await nextTick()
    document.body.classList.add('material-batches-printing')
    window.print()
  } catch (reason) { if (current === generation) error.value = reason instanceof Error ? reason.message : '无法核对最新批次，未打印，请重试' }
  finally { cleanup(); if (current === generation) busy.value = false }
}
</script>
<template>
  <ElDialog :model-value="modelValue" title="合并打印" width="min(1000px, 95vw)" :close-on-click-modal="!busy" :close-on-press-escape="!busy" :show-close="!busy" @update:model-value="emit('update:modelValue', $event)">
    <p>每个批次独立扫码、独立接收。合并打印不合并批次。</p>
    <ElAlert v-if="error" :title="error" type="error" :closable="false" />
    <div class="batch-print-preview"><MaterialBatchPrintSheet :items="rows" /></div>
    <template #footer><ElButton :disabled="busy" @click="emit('update:modelValue', false)">关闭</ElButton><ElButton type="primary" :loading="busy" :disabled="!rows.length" @click="print">打印 {{ rows.length }} 个批次</ElButton></template>
  </ElDialog>
  <Teleport to="body"><MaterialBatchPrintSheet v-if="printing" :items="rows" /></Teleport>
</template>
<style scoped>.batch-print-preview { overflow-x: auto; }.batch-print-preview :deep(article) { min-width: 680px; }</style>
