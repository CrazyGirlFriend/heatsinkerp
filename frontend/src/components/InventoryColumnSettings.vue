<script setup lang="ts" generic="K extends string = InventoryColumnKey">
import { computed, ref, shallowRef, watch } from 'vue'
import { ArrowDown, ArrowUp, Setting } from '@element-plus/icons-vue'
import { ElButton, ElCheckbox, ElMessage, ElPopover } from 'element-plus'
import { inventoryColumns, type InventoryColumnChoice, type InventoryColumnKey } from '@/types/inventoryColumns'

const props = defineProps<{ storageKey: string | null; columns?: readonly { key: K; label: string; defaultVisible?: boolean }[] }>()
const emit = defineEmits<{ change: [columns: InventoryColumnChoice<K>[]] }>()
const options = computed(() => props.columns || inventoryColumns.map((column, index) => ({ ...column, key: column.key as K, defaultVisible: index < 4 })))
const defaults = (): InventoryColumnChoice<K>[] => options.value.map(column => ({ key: column.key, visible: !!column.defaultVisible }))
const opened = ref(false)
const saved = shallowRef(defaults()), draft = shallowRef(defaults())
const label = (key: string) => options.value.find(column => column.key === key)!.label
const copy = (columns: InventoryColumnChoice<K>[]) => columns.map(column => ({ ...column }))
function normalize(value: unknown): InventoryColumnChoice<K>[] {
  if (!Array.isArray(value)) return defaults()
  const result: InventoryColumnChoice<K>[] = []
  for (const item of value) if (item && options.value.some(column => column.key === item.key) && typeof item.visible === 'boolean' && !result.some(column => column.key === item.key)) result.push({ key: item.key, visible: item.visible })
  return [...result, ...defaults().filter(column => !result.some(item => item.key === column.key))]
}
watch(opened, value => { if (value) draft.value = copy(saved.value) }, { flush: 'sync' })
watch(() => props.storageKey, key => {
  opened.value = false
  saved.value = defaults()
  if (key) {
    try { saved.value = normalize(JSON.parse(localStorage.getItem(key) || 'null')) } catch { /* Use defaults if storage is unavailable or invalid. */ }
  }
  draft.value = copy(saved.value)
  emit('change', copy(saved.value))
}, { immediate: true })
function move(index: number, offset: number) {
  const target = index + offset
  if (target < 0 || target >= draft.value.length) return
  const next = copy(draft.value)
  const item = next.splice(index, 1)[0]!
  next.splice(target, 0, item)
  draft.value = next
}
function apply() {
  saved.value = copy(draft.value)
  if (props.storageKey) {
    try { localStorage.setItem(props.storageKey, JSON.stringify(saved.value)) }
    catch { ElMessage.warning('列设置已应用，但浏览器未能保存，下次打开不会保留本次修改。') }
  }
  emit('change', copy(saved.value))
  opened.value = false
}
</script>

<template>
  <ElPopover v-model:visible="opened" trigger="click" placement="bottom-end" :width="320" popper-class="inventory-columns-popover">
    <template #reference><ElButton class="inventory-columns-trigger" :icon="Setting" :aria-expanded="opened">显示列</ElButton></template>
    <div class="column-settings">
      <header><strong>显示列</strong><ElButton link type="primary" @click="draft = defaults()">恢复默认</ElButton></header>
      <p>流水号、操作列始终显示。仅保存在当前浏览器。</p>
      <div class="column-choices" aria-label="库存明细可选列">
        <div v-for="(column, index) in draft" :key="column.key" class="column-choice">
          <ElCheckbox :model-value="column.visible" @update:model-value="draft = draft.map(item => item.key === column.key ? { ...item, visible: $event === true } : item)">{{ label(column.key) }}</ElCheckbox>
          <ElButton :icon="ArrowUp" text :disabled="index === 0" :aria-label="`上移${label(column.key)}`" @click="move(index, -1)" />
          <ElButton :icon="ArrowDown" text :disabled="index === draft.length - 1" :aria-label="`下移${label(column.key)}`" @click="move(index, 1)" />
        </div>
      </div>
      <footer><ElButton @click="opened = false">取消</ElButton><ElButton type="primary" @click="apply">应用</ElButton></footer>
    </div>
  </ElPopover>
</template>

<style scoped>
.column-settings { color: var(--el-text-color-primary); }
.column-settings header, .column-settings footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.column-settings header strong { font-size: 16px; }
.column-settings p { margin: 12px 0; color: var(--el-text-color-regular); font-size: 13px; line-height: 1.5; }
.column-choices { max-height: min(360px, 48vh); overflow-y: auto; border-block: 1px solid var(--el-border-color-lighter); padding: 6px 0; }
.column-choice { display: flex; align-items: center; min-height: 38px; gap: 2px; }
.column-choice > .el-checkbox { flex: 1; min-width: 0; margin-right: 4px; }
.column-choice :deep(.el-checkbox__label) { font-size: 14px; }
.column-choice > .el-button { padding: 7px; margin: 0; }
.column-settings footer { justify-content: flex-end; margin-top: 14px; }
.inventory-columns-trigger { margin-left: auto; flex-shrink: 0; }
</style>
