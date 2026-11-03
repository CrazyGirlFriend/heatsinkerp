<script setup lang="ts">
import { IconSearch, IconX } from '@tabler/icons-vue'

const props = withDefaults(
  defineProps<{
    label: string
    placeholder?: string
    disabled?: boolean
    maxlength?: number | string
    searchOnClear?: boolean
  }>(),
  { placeholder: '搜索', searchOnClear: true },
)
const value = defineModel<string>({ default: '' })
const emit = defineEmits<{ search: []; clear: [] }>()
function clear() {
  value.value = ''
  emit('clear')
  if (props.searchOnClear) emit('search')
}
function searchOnEnter(event: KeyboardEvent) {
  if (event.isComposing) return
  event.preventDefault()
  emit('search')
}
</script>

<template>
  <div class="wm-search">
    <IconSearch :size="18" />
    <input
      v-model="value"
      :aria-label="label"
      :placeholder="placeholder"
      :disabled="disabled"
      :maxlength="maxlength"
      @keydown.enter="searchOnEnter"
    />
    <button v-if="value" type="button" aria-label="清空搜索" :disabled="disabled" @click="clear">
      <IconX :size="15" />
    </button>
    <button type="button" :aria-label="label" :disabled="disabled" @click="emit('search')">
      <span aria-hidden="true">↵</span>
    </button>
  </div>
</template>

<style>
.wm-search {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 12px;
  min-width: 0;
  border: 1px solid var(--wm-control-border, #e4e4e7);
  border-radius: 8px;
  background: var(--wm-control-bg, #fff);
  color: var(--wm-text-muted, #71717a);
  transition:
    border-color 0.18s,
    box-shadow 0.18s;
}
.wm-search:focus-within {
  border-color: var(--wm-focus-ring, #a1a1aa);
  box-shadow: 0 0 0 1px var(--wm-focus-ring, #a1a1aa);
}
.wm-search input {
  font: inherit;
  font-size: 14px;
  width: 100%;
  min-width: 0;
  outline: 0;
  border: 0;
  background: transparent;
  color: var(--wm-text, #18181b);
}
.wm-search input::placeholder {
  color: var(--wm-placeholder, #71717a);
}
.wm-search button {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  border: 0;
  background: transparent;
  color: var(--wm-text-muted, #71717a);
  cursor: pointer;
  padding: 3px;
  font-size: 17px;
}
.wm-search button:disabled {
  cursor: default;
  opacity: 0.45;
}
.wm-search button:focus-visible {
  outline: 2px solid var(--wm-focus-ring, #71717a);
  outline-offset: 2px;
}
@media (prefers-reduced-motion: reduce) {
  .wm-search {
    transition: none;
  }
}
</style>
