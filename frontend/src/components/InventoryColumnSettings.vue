<script setup lang="ts" generic="K extends string = InventoryColumnKey">
import AppPopover from '@/components/AppPopover.vue'
import { showToast } from '@/stores/toast'
import { computed, ref, shallowRef, watch } from 'vue'
import { ArrowDown, ArrowUp, Setting } from '@element-plus/icons-vue'
import { IconColumns3 } from '@tabler/icons-vue'
import { ElCheckbox } from 'element-plus'
import ElButton from '@/components/AppButton.vue'
import {
  inventoryColumns,
  type InventoryColumnChoice,
  type InventoryColumnKey,
} from '@/types/inventoryColumns'

const props = defineProps<{
  storageKey: string | null
  columns?: readonly { key: K; label: string; defaultVisible?: boolean; required?: boolean }[]
  legacyKeys?: Record<string, readonly K[]>
  newVisibleKeys?: readonly K[]
  previousDefaults?: readonly InventoryColumnChoice<K>[]
  description?: string
  choicesLabel?: string
  showTrigger?: boolean
  compact?: boolean
  minimumVisible?: number
  initialChoices?: readonly InventoryColumnChoice<K>[]
}>()
const emit = defineEmits<{ change: [columns: InventoryColumnChoice<K>[]] }>()
const options = computed(
  () =>
    props.columns ||
    inventoryColumns.map((column, index) => ({
      ...column,
      key: column.key as K,
      defaultVisible: index < 4,
    })),
)
const defaults = (): InventoryColumnChoice<K>[] =>
  options.value.map((column) => ({ key: column.key, visible: !!column.defaultVisible }))
const opened = ref(false)
const anchor = shallowRef<HTMLElement>()
const saved = shallowRef(defaults()),
  draft = shallowRef(defaults())
const label = (key: string) => options.value.find((column) => column.key === key)!.label
const required = (key: string) =>
  props.columns?.some((column) => column.key === key && column.required)
const copy = (columns: InventoryColumnChoice<K>[]) => columns.map((column) => ({ ...column }))
function normalize(value: unknown): InventoryColumnChoice<K>[] {
  if (!Array.isArray(value)) return defaults()
  const result: InventoryColumnChoice<K>[] = []
  for (const item of value) {
    if (!item || typeof item.visible !== 'boolean') continue
    for (const key of props.legacyKeys?.[item.key] || [item.key]) {
      if (!options.value.some((column) => column.key === key)) continue
      // A retained column only supplies defaults for newly split fields, not explicit choices.
      if (
        key !== item.key &&
        options.value.some((column) => column.key === item.key) &&
        value.some((saved) => saved?.key === key && typeof saved.visible === 'boolean')
      )
        continue
      const existing = result.find((column) => column.key === key)
      if (existing) existing.visible ||= item.visible
      else result.push({ key, visible: item.visible })
    }
  }
  // Reveal only explicitly introduced fields; retain every saved visibility choice.
  return [
    ...result,
    ...defaults()
      .filter((column) => !result.some((item) => item.key === column.key))
      .map((column) => ({
        ...column,
        visible: result.length ? !!props.newVisibleKeys?.includes(column.key) : column.visible,
      })),
  ].map((column) => ({ ...column, visible: required(column.key) || column.visible }))
}
watch(
  opened,
  (value) => {
    if (value) draft.value = copy(saved.value)
  },
  { flush: 'sync' },
)
watch(
  [() => props.storageKey, () => JSON.stringify(props.columns)],
  ([key]) => {
    opened.value = false
    saved.value = normalize(props.initialChoices)
    if (key) {
      try {
        const stored = localStorage.getItem(key)
        const restored = stored ? normalize(JSON.parse(stored)) : saved.value
        const previous = props.previousDefaults?.filter((column) =>
          options.value.some((option) => option.key === column.key),
        )
        const unchangedPreset =
          previous?.length === restored.length &&
          previous.every(
            (column, index) =>
              column.key === restored[index]?.key && column.visible === restored[index]?.visible,
          )
        saved.value = unchangedPreset ? defaults() : restored
      } catch {
        /* Use defaults if storage is unavailable or invalid. */
      }
    }
    draft.value = copy(saved.value)
    emit('change', copy(saved.value))
  },
  { immediate: true },
)
function move(index: number, offset: number) {
  const target = index + offset
  if (target < 0 || target >= draft.value.length) return
  const next = copy(draft.value)
  const item = next.splice(index, 1)[0]!
  next.splice(target, 0, item)
  draft.value = next
}
function apply() {
  if (draft.value.filter((column) => column.visible).length < (props.minimumVisible || 0)) {
    showToast('请至少保留一列。', 'warning')
    return
  }
  saved.value = copy(draft.value)
  if (props.storageKey) {
    try {
      localStorage.setItem(props.storageKey, JSON.stringify(saved.value))
    } catch {
      showToast('列设置已应用，但浏览器未能保存，下次打开不会保留本次修改。', 'warning')
    }
  }
  emit('change', copy(saved.value))
  opened.value = false
}
defineExpose({
  open: (element?: HTMLElement) => {
    anchor.value = element
    opened.value = true
  },
})
</script>

<template>
  <AppPopover
    :virtual-ref="anchor"
    :virtual-triggering="showTrigger === false || !!anchor"
    v-model:visible="opened"
    :trigger="showTrigger === false || anchor ? [] : 'click'"
    :trigger-keys="showTrigger === false || anchor ? [] : undefined"
    :placement="compact ? 'bottom-start' : 'bottom-end'"
    :width="320"
    popper-class="inventory-columns-popover"
    :popper-options="{
      modifiers: [{ name: 'preventOverflow', options: { altAxis: true, padding: 12 } }],
    }"
  >
    <template #reference
      ><ElButton
        v-show="showTrigger !== false"
        class="inventory-columns-trigger"
        :class="{ 'inventory-columns-trigger--compact': compact }"
        :unstyled="compact"
        :icon="compact ? undefined : Setting"
        aria-label="显示列"
        title="显示列"
        :aria-expanded="opened"
        ><IconColumns3 v-if="compact" :size="17" /><template v-else>显示列</template></ElButton
      ></template
    >
    <div v-if="opened || !compact" class="column-settings">
      <header>
        <strong>显示列</strong
        ><ElButton link type="primary" @click="draft = defaults()">恢复默认</ElButton>
      </header>
      <p>{{ description ?? '流水号、操作列始终显示。仅保存在当前浏览器。' }}</p>
      <div class="column-choices" :aria-label="choicesLabel ?? '库存明细可选列'">
        <div v-for="(column, index) in draft" :key="column.key" class="column-choice">
          <ElCheckbox
            :model-value="column.visible"
            :disabled="required(column.key)"
            @update:model-value="
              draft = draft.map((item) =>
                item.key === column.key ? { ...item, visible: $event === true } : item,
              )
            "
            >{{ label(column.key) }}</ElCheckbox
          >
          <ElButton
            :icon="ArrowUp"
            text
            :disabled="index === 0"
            :aria-label="`上移${label(column.key)}`"
            @click="move(index, -1)"
          />
          <ElButton
            :icon="ArrowDown"
            text
            :disabled="index === draft.length - 1"
            :aria-label="`下移${label(column.key)}`"
            @click="move(index, 1)"
          />
        </div>
      </div>
      <footer>
        <ElButton @click="opened = false">取消</ElButton
        ><ElButton type="primary" @click="apply">应用</ElButton>
      </footer>
    </div>
  </AppPopover>
</template>

<style scoped>
.column-settings {
  color: var(--el-text-color-primary);
}
.column-settings header,
.column-settings footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.column-settings header strong {
  font-size: 16px;
}
.column-settings p {
  margin: 12px 0;
  color: var(--el-text-color-regular);
  font-size: 13px;
  line-height: 1.5;
}
.column-choices {
  max-height: min(360px, 48vh);
  overflow-y: auto;
  border-block: 1px solid var(--el-border-color-lighter);
  padding: 6px 0;
}
.column-choice {
  display: flex;
  align-items: center;
  min-height: 38px;
  gap: 2px;
}
.column-choice > .el-checkbox {
  flex: 1;
  min-width: 0;
  margin-right: 4px;
}
.column-choice :deep(.el-checkbox__label) {
  font-size: 14px;
}
.column-choice > .el-button {
  padding: 7px;
  margin: 0;
}
.column-settings footer {
  justify-content: flex-end;
  margin-top: 14px;
}
.inventory-columns-trigger {
  margin-left: auto;
  flex-shrink: 0;
}
.inventory-columns-trigger--compact {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--el-text-color-regular, var(--wm-muted));
  cursor: pointer;
}
.inventory-columns-trigger--compact:hover,
.inventory-columns-trigger--compact[aria-expanded='true'] {
  background: var(--wm-hover, var(--el-fill-color));
  color: var(--el-text-color-primary, var(--wm-text));
}
.inventory-columns-trigger--compact:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}
</style>
