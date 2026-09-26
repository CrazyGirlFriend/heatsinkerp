<script setup lang="ts">
import { Close } from '@element-plus/icons-vue'
import { ElButton, ElDrawer } from 'element-plus'
import { nextTick, ref, watch } from 'vue'

const props = withDefaults(defineProps<{ modelValue: boolean; docked: boolean; busy: boolean; title?: string }>(), { title: '转料单详情' })
const emit = defineEmits<{ close: [] }>()
const panel = ref<HTMLElement>()
function close() { if (!props.busy) emit('close') }
watch(() => [props.modelValue, props.docked], async ([open, docked]) => {
  if (open && docked) { await nextTick(); panel.value?.focus({ preventScroll: true }) }
}, { immediate: true })
</script>

<template>
  <aside v-if="docked && modelValue" ref="panel" class="transfer-detail-frame" :aria-label="title" tabindex="-1" @keydown.esc.stop.prevent="close">
    <header class="detail-frame-heading"><slot name="header" /><ElButton class="detail-close" text :icon="Close" :disabled="busy" aria-label="关闭转料详情" @click="close" /></header>
    <div class="detail-frame-body"><slot /></div>
    <footer class="detail-frame-footer"><slot name="footer" /></footer>
  </aside>
  <ElDrawer v-else-if="!docked" :model-value="modelValue" class="material-transfer-drawer" :title="title" size="min(960px, 100vw)" :show-close="!busy" :close-on-click-modal="!busy" :close-on-press-escape="!busy" append-to-body :destroy-on-close="false" @close="close">
    <template #header><slot name="header" /></template>
    <slot />
    <template #footer><slot name="footer" /></template>
  </ElDrawer>
</template>

<style scoped>
.transfer-detail-frame { display: flex; width: 100%; height: 100%; min-width: 0; min-height: 0; flex-direction: column; overflow: hidden; border: 1px solid var(--panel-line); border-radius: var(--card-radius); background: #fff; outline: none; }
.detail-frame-heading { position: relative; flex-shrink: 0; padding: 20px; border-bottom: 1px solid var(--line); }
.detail-close { position: absolute; top: 16px; right: 12px; width: 32px; height: 32px; padding: 0; color: var(--subtle); font-size: 20px; }
.detail-frame-body { flex: 1; min-height: 0; padding: 20px; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; }
.detail-frame-footer { flex-shrink: 0; padding: 16px 20px; border-top: 1px solid var(--line); background: #fff; }
</style>
