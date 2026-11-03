<script setup lang="ts">
import { IconSearch, IconX } from '@tabler/icons-vue'

withDefaults(
  defineProps<{ label: string; placeholder?: string; disabled?: boolean; maxlength?: number }>(),
  { placeholder: '搜索' },
)
const value = defineModel<string>({ default: '' })
const emit = defineEmits<{ search: []; clear: [] }>()
function clear() {
  value.value = ''
  emit('clear')
  emit('search')
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
  gap: 9px;
  height: 38px;
  padding: 0 11px;
  min-width: 0;
  border: 1px solid #e1e4e8;
  border-radius: 10px;
  background: #fff;
  color: #9298a1;
  transition:
    border-color 0.18s,
    box-shadow 0.18s;
}
.wm-search:focus-within {
  border-color: #9da7b2;
  box-shadow: 0 0 0 3px #eef0f3;
}
.wm-search input {
  font: inherit;
  font-size: 13px;
  width: 100%;
  min-width: 0;
  outline: 0;
  border: 0;
  background: transparent;
  color: #202326;
}
.wm-search input::placeholder {
  color: #9197a0;
}
.wm-search button {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  border: 0;
  background: transparent;
  color: #747b86;
  cursor: pointer;
  padding: 3px;
  font-size: 17px;
}
.wm-search button:disabled {
  cursor: default;
  opacity: 0.45;
}
.wm-search button:focus-visible {
  outline: 2px solid #437fba;
  outline-offset: 2px;
}
@media (prefers-reduced-motion: reduce) {
  .wm-search {
    transition: none;
  }
}
</style>
