<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { MaterialTransfer } from '@/types/materialTransfer'
import {
  groupTransferPrintItems,
  paginateTransferBlocks,
  transferPrintProfile,
  type TransferPrintBlock,
} from '@/utils/materialTransferPrint'
import MaterialTransferPrintCopy from './MaterialTransferPrintCopy.vue'
const props = defineProps<{ items: MaterialTransfer[] }>()
const groups = computed(() => groupTransferPrintItems(props.items))
const measurement = ref<HTMLElement | null>(null)
const pages = ref<TransferPrintBlock[][][]>([])
const error = ref('')
let generation = 0
onBeforeUnmount(() => {
  generation++
})
async function prepare(): Promise<void> {
  const current = ++generation
  await nextTick()
  if (document.fonts?.ready) await document.fonts.ready
  await nextTick()
  if (current !== generation) return
  try {
    pages.value = groups.value.map((group, index) => {
      const copy = measurement.value?.children[index] as HTMLElement | undefined
      const heading = copy?.querySelector('.transfer-print-lines thead')?.getBoundingClientRect()
      const footer = copy?.querySelector('.transfer-print-footer')?.getBoundingClientRect()
      const rows = copy?.querySelectorAll<HTMLElement>('[data-print-block]')
      // jsdom has no layout; the browser measures the physical A4 copy.
      if (!heading?.height || !footer || !rows) return [group.blocks]
      return paginateTransferBlocks(
        group.blocks,
        [...rows].map((row) => row.getBoundingClientRect().height),
        footer.top - heading.bottom - 8,
      )
    })
    error.value = ''
    await nextTick()
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '打印分页失败'
    throw reason
  }
}
watch(
  () => props.items,
  () => {
    pages.value = []
    void prepare().catch(() => {})
  },
  { deep: true, immediate: true },
)
defineExpose({ prepare })
</script>

<template>
  <div class="transfer-print-document">
    <div v-if="error" role="alert">{{ error }}</div>
    <div ref="measurement" class="transfer-print-measurement" aria-hidden="true">
      <MaterialTransferPrintCopy
        v-for="group in groups"
        :key="group.key"
        :group="group"
        :blocks="group.blocks"
        copy-name="转出留存联"
        :page-number="1"
        :page-count="1"
      />
    </div>
    <template v-for="(group, index) in groups" :key="group.key">
      <div
        v-for="(blocks, page) in pages[index] || [group.blocks]"
        :key="page"
        class="transfer-print-page"
        :data-print-group="index"
      >
        <MaterialTransferPrintCopy
          :group="group"
          :blocks="blocks"
          :copy-name="transferPrintProfile(group.items[0]!).copies[0]!"
          :page-number="page + 1"
          :page-count="pages[index]?.length || 1"
        />
        <div class="transfer-print-cut"><span>沿虚线裁切</span></div>
        <MaterialTransferPrintCopy
          :group="group"
          :blocks="blocks"
          :copy-name="transferPrintProfile(group.items[0]!).copies[1]!"
          :page-number="page + 1"
          :page-count="pages[index]?.length || 1"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.transfer-print-document {
  width: 186mm;
  color: #111;
  background: #fff;
}
.transfer-print-measurement {
  position: fixed;
  left: -20000px;
  top: 0;
  width: 186mm;
  visibility: hidden;
  pointer-events: none;
}
.transfer-print-page {
  width: 186mm;
  height: 269mm;
  margin: 0 0 8mm;
  break-inside: avoid;
  break-after: page;
}
.transfer-print-page:last-child {
  break-after: auto;
  margin-bottom: 0;
}
.transfer-print-cut {
  height: 9mm;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  font:
    7pt 'Microsoft YaHei',
    'PingFang SC',
    sans-serif;
  color: #555;
}
.transfer-print-cut::before,
.transfer-print-cut::after {
  content: '';
  flex: 1;
  border-top: 0.5pt dashed #555;
}
.transfer-print-cut span {
  padding: 0 4mm;
}
@media print {
  .transfer-print-measurement {
    display: none;
  }
  .transfer-print-page {
    margin: 0;
  }
  .transfer-print-document {
    print-color-adjust: exact;
    -webkit-print-color-adjust: exact;
  }
}
</style>
