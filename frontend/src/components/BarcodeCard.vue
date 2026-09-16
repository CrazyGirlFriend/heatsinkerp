<script setup lang="ts">
import JsBarcode from 'jsbarcode'
import { nextTick, onMounted, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    value: string
    compact?: boolean
    entityLabel?: string
    textPosition?: 'top' | 'bottom'
  }>(),
  { compact: false, entityLabel: '业务编号', textPosition: 'bottom' },
)

const barcodeRef = ref<SVGSVGElement | null>(null)

async function renderBarcode(): Promise<void> {
  await nextTick()
  if (!barcodeRef.value || !props.value) return
  JsBarcode(barcodeRef.value, props.value, {
    format: 'CODE128',
    displayValue: true,
    textPosition: props.textPosition,
    height: props.compact ? 28 : 52,
    width: props.compact ? 1.15 : 1.7,
    font: 'Arial, sans-serif',
    fontSize: props.compact ? 13 : 14,
    textMargin: props.compact ? 2 : 5,
    margin: 0,
    background: 'transparent',
    lineColor: '#111827',
  })
}

onMounted(renderBarcode)
watch(() => [props.value, props.compact, props.textPosition], renderBarcode)
</script>

<template>
  <div class="barcode-card barcode-card--scrollable" :class="{ 'barcode-card--compact': compact }" :aria-label="`${entityLabel}条形码：${value}`">
    <svg ref="barcodeRef" />
  </div>
</template>

<style scoped>
.barcode-card {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  max-width: 100%;
  min-height: 86px;
  overflow-x: auto;
  overflow-y: hidden;
  overscroll-behavior-x: contain;
  scrollbar-width: thin;
  scrollbar-color: #c7d0da transparent;
}

.barcode-card--compact {
  min-height: 48px;
}

.barcode-card svg {
  display: block;
  flex: 0 0 auto;
  width: auto;
  max-width: none;
  height: auto;
  margin-inline: auto;
}

.barcode-card:not(.barcode-card--compact) svg {
  min-width: 320px;
}
</style>
