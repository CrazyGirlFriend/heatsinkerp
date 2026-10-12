<script setup lang="ts">
import { ref } from 'vue'
import MaterialTransferPrintDocument from './MaterialTransferPrintDocument.vue'
import { materialDocumentTitle, type MaterialTransfer } from '@/types/materialTransfer'
defineProps<{ transfer: MaterialTransfer }>()
const documentRef = ref<InstanceType<typeof MaterialTransferPrintDocument> | null>(null)
defineExpose({ prepare: () => documentRef.value?.prepare() })
</script>

<template>
  <article class="material-transfer-print-sheet" :aria-label="`A4 双联${materialDocumentTitle(transfer)}`"><MaterialTransferPrintDocument ref="documentRef" :items="[transfer]" /></article>
</template>

<style scoped>
.material-transfer-print-sheet { position: fixed; left: -20000px; top: 0; visibility: hidden; width: 186mm; color: #111; background: #fff; }
@media print {
  @page { size: A4 portrait; margin: 12mm; }
  :global(body.material-transfer-printing) { background: #fff !important; }
  :global(body.material-transfer-printing > :not(.material-transfer-print-sheet)) { display: none !important; }
  .material-transfer-print-sheet { display: block !important; position: static; visibility: visible; width: 186mm; margin: 0; padding: 0; }
}
</style>
