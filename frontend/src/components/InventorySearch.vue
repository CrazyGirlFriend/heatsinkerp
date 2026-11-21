<script setup lang="ts">
import { computed, nextTick, ref, useId } from 'vue'
import { ElTag } from 'element-plus'
import { IconX } from '@tabler/icons-vue'
import AppPopover from './AppPopover.vue'
import WatermelonSearch from './watermelon/WatermelonSearch.vue'

const props = defineProps<{ placeholder: string; remainders: boolean; filtersOpen: boolean }>()
const query = defineModel<string>({ default: '' })
const emit = defineEmits<{
  search: []
  remainder: [value: boolean]
  conditions: [anchor: HTMLElement]
}>()
const search = ref<InstanceType<typeof WatermelonSearch>>()
const listId = useId()
const anchor = ref<HTMLElement>()
const open = ref(false),
  highlighted = ref(-1)
const choices = ['只看可用余料', '库存与流转条件']
const visible = computed(() => open.value && !query.value.trim() && !props.filtersOpen)
function activate(event: Event) {
  open.value = event.target instanceof HTMLInputElement
}
function edited(value: string) {
  highlighted.value = -1
  open.value = !value.trim() && document.activeElement === anchor.value?.querySelector('input')
}
function dismiss() {
  open.value = false
  highlighted.value = -1
}
function choose(value: boolean) {
  emit('remainder', value)
  void nextTick(() => {
    search.value?.focus()
    dismiss()
  })
}
function pick(index: number) {
  dismiss()
  if (index === 0) choose(!props.remainders)
  else if (anchor.value) emit('conditions', anchor.value)
}
function keyboard(event: KeyboardEvent) {
  if (event.isComposing || !(event.target instanceof HTMLInputElement)) return
  if (['ArrowDown', 'ArrowUp'].includes(event.key) && !query.value.trim() && !props.filtersOpen) {
    event.preventDefault()
    open.value = true
    const direction = event.key === 'ArrowDown' ? 1 : -1
    highlighted.value =
      highlighted.value < 0
        ? direction === 1
          ? 0
          : choices.length - 1
        : (highlighted.value + direction + choices.length) % choices.length
  } else if (visible.value && event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    dismiss()
  } else if (visible.value && highlighted.value >= 0 && event.key === 'Enter') {
    event.preventDefault()
    event.stopPropagation()
    pick(highlighted.value)
  }
}
function submit() {
  dismiss()
  emit('search')
}
</script>

<template>
  <AppPopover
    :visible="visible"
    placement="bottom-start"
    :show-arrow="false"
    :offset="6"
    width="auto"
    popper-class="inventory-search-options"
    :teleported="false"
    role="group"
  >
    <template #reference>
      <div
        ref="anchor"
        class="inventory-search"
        @keydown.capture="keyboard"
        @focusout="dismiss"
        @focusin="activate"
        @click="activate"
      >
        <WatermelonSearch
          ref="search"
          v-model="query"
          label="库存明细搜索"
          :placeholder="remainders ? '搜索余料' : placeholder"
          :input-attrs="{
            role: 'combobox',
            'aria-autocomplete': 'list',
            'aria-expanded': visible,
            'aria-controls': visible ? listId : undefined,
            'aria-activedescendant':
              visible && highlighted >= 0 ? listId + '-' + highlighted : undefined,
          }"
          @update:model-value="edited"
          @search="submit"
        >
          <template v-if="remainders" #prefix>
            <button type="button" aria-label="清除可用余料筛选" @click="choose(false)">
              <ElTag type="info" size="small" round
                >可用余料 <IconX :size="12" aria-hidden="true"
              /></ElTag>
            </button>
          </template>
        </WatermelonSearch>
      </div>
    </template>
    <div :id="listId" role="listbox" aria-label="库存快捷筛选">
      <button
        v-for="(label, index) in choices"
        :key="label"
        :id="listId + '-' + index"
        type="button"
        tabindex="-1"
        role="option"
        :aria-selected="highlighted === index"
        @pointerdown.prevent
        @click="pick(index)"
      >
        {{ label }}<span v-if="!index && remainders" aria-hidden="true">✓</span
        ><span v-if="index" aria-hidden="true">›</span>
      </button>
    </div>
  </AppPopover>
</template>

<style>
.inventory-search {
  width: 100%;
  min-width: 0;
}
.inventory-search .el-tag__content {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}
.inventory-search-options.el-popper {
  padding: 4px;
  min-width: 180px;
}
.inventory-search-options [role='option'] {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
  border: 0;
  width: 100%;
  padding: 8px 12px;
  text-align: left;
  border-radius: var(--radius-control);
  font: inherit;
  color: var(--wm-text);
  background: transparent;
  cursor: pointer;
}
.inventory-search-options [role='option']:hover,
.inventory-search-options [role='option'][aria-selected='true'] {
  background: var(--wm-muted-surface);
}
</style>
