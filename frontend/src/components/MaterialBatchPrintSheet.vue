<script setup lang="ts">
import { ref } from 'vue'
import MaterialTransferPrintDocument from './MaterialTransferPrintDocument.vue'
import type { MaterialTransfer } from '@/types/materialTransfer'
defineProps<{ items: MaterialTransfer[] }>()
const documentRef = ref<InstanceType<typeof MaterialTransferPrintDocument> | null>(null)
defineExpose({ prepare: () => documentRef.value?.prepare() })
</script>

<template>
  <article class="material-batches-print-sheet" aria-label="多批次转料打印单"><MaterialTransferPrintDocument ref="documentRef" :items="items" /></article>
</template>

<style scoped>
.material-batches-print-sheet { width: 186mm; color: #111; background: #fff; }
@media print {
  @page { size: A4 portrait; margin: 12mm; }
  :global(body.material-batches-printing > :not(.material-batches-print-sheet)) { display: none !important; }
  .material-batches-print-sheet { display: block !important; width: 186mm; margin: 0; padding: 0; }
}
</style>
