<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElButton, ElDialog, ElIcon, ElInput, useFormDisabled } from 'element-plus'
import { Check, Search, User } from '@element-plus/icons-vue'

const props = defineProps<{ options?: string[]; label?: string }>()
const name = defineModel<string>({ required: true })
const disabled = useFormDisabled()
const opened = ref(false)
const query = ref('')
const trigger = ref<HTMLButtonElement>()
const search = ref<InstanceType<typeof ElInput>>()
const matches = computed(() => {
  const term = query.value.trim().toLocaleLowerCase()
  return (props.options || []).filter((person) => person.toLocaleLowerCase().includes(term))
})
watch(opened, (value) => {
  if (value) query.value = ''
})
watch(disabled, (value) => {
  if (value) opened.value = false
})
function close() {
  opened.value = false
}
function choose(person: string) {
  if (disabled.value) return
  name.value = person
  close()
}
</script>

<template>
  <div class="processing-person-input">
    <button
      ref="trigger"
      type="button"
      class="person-trigger el-select__wrapper"
      :class="{ 'is-focused': opened, 'is-disabled': disabled }"
      :disabled="disabled"
      :aria-label="label || '加工人'"
      aria-haspopup="dialog"
      :aria-expanded="opened"
      @click="opened = true"
    >
      <span class="person-value" :class="{ 'is-placeholder': !name }">{{
        name || '请选择加工人'
      }}</span>
      <ElIcon class="person-icon"><User /></ElIcon>
    </button>
    <ElDialog
      v-model="opened"
      :title="`选择${label || '加工人'}`"
      width="min(560px, calc(100vw - 48px))"
      append-to-body
      align-center
      destroy-on-close
      :close-on-click-modal="false"
      @opened="search?.focus()"
      @closed="trigger?.focus()"
    >
      <section class="person-panel" @keydown.esc.stop.prevent="close">
        <header class="person-panel-header">
          <strong>本班组员工</strong>
          <span class="person-count">{{ matches.length }} 人</span>
          <ElButton v-if="name" link type="primary" @click="choose('')">清除选择</ElButton>
        </header>
        <ElInput
          ref="search"
          v-model="query"
          :aria-label="`搜索${label || '加工人'}`"
          :prefix-icon="Search"
          clearable
          placeholder="搜索姓名"
          maxlength="80"
          @keydown.enter.prevent
        />
        <div v-if="matches.length" class="person-grid" role="group" aria-label="员工名单">
          <button
            v-for="person in matches"
            :key="person"
            type="button"
            class="person-choice"
            :class="{ 'is-selected': person === name }"
            :aria-pressed="person === name"
            :title="person"
            @click="choose(person)"
          >
            <span>{{ person }}</span>
            <ElIcon v-if="person === name"><Check /></ElIcon>
          </button>
        </div>
        <p v-else class="person-empty" role="status">
          {{ options?.length ? '未找到匹配的员工' : '请先在班组设置中添加员工' }}
        </p>
      </section>
      <template #footer>
        <ElButton @click="close">取消</ElButton>
      </template>
    </ElDialog>
  </div>
</template>

<style scoped>
.processing-person-input {
  width: 100%;
  max-width: 240px;
}
.person-trigger {
  width: 100%;
  height: 36px;
  min-height: 36px;
  padding-block: 0;
  border: 0;
  font: inherit;
  text-align: left;
}
.person-value {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.is-placeholder,
.person-icon {
  color: var(--el-text-color-placeholder);
}
.person-panel {
  display: grid;
  gap: 12px;
  color: var(--text);
}
.person-panel-header {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 24px;
}
.person-panel-header strong {
  font-size: 14px;
}
.person-count {
  flex: 1;
  color: var(--muted);
  font-size: 12px;
}
.person-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  max-height: min(284px, calc(100dvh - 280px));
  overflow-y: auto;
  padding: 2px;
}
.person-choice {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-width: 0;
  height: 40px;
  padding: 0 8px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  transition:
    background var(--motion-fast),
    border-color var(--motion-fast);
}
.person-choice span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.person-choice:hover,
.person-choice.is-selected {
  border-color: var(--primary);
  background: var(--primary-soft);
  color: var(--primary);
}
.person-choice.is-selected {
  font-weight: 600;
}
.person-choice .el-icon {
  flex-shrink: 0;
}
.person-choice:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 0;
}
.person-empty {
  margin: 0;
  padding: 24px 8px;
  color: var(--muted);
  text-align: center;
}
</style>
