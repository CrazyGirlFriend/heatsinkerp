<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElButton, ElTabPane, ElTabs } from 'element-plus'
import { IconFileText, IconPencil } from '@tabler/icons-vue'
import AppDialog from './AppDialog.vue'
import WordDocumentPreview from './WordDocumentPreview.vue'
import type { ProcessRoute } from '@/types/processRoute'

const props = defineProps<{
  route: ProcessRoute
  currentValues?: Record<string, string | number | null | undefined>
}>()
const emit = defineEmits<{ 'focus-field': [key: string] }>()
const activeTab = ref('original')
const expanded = ref(false)
const previewMounted = ref(false)
function expand() {
  previewMounted.value = true
  expanded.value = true
}
const activeField = ref('')
const fields = computed(() => Object.entries(props.route.source_data.receipt_fields || {}))
const selected = computed(() => props.route.source_data.receipt_fields?.[activeField.value])
function currentValue(key: string, original: string | number) {
  return props.currentValues ? props.currentValues[key] : original
}
function edited(key: string, original: string | number) {
  const current = currentValue(key, original)
  return current == null || String(current) !== String(original)
}
function display(value: string | number | null | undefined) {
  return value == null || value === '' ? '未填写' : String(value)
}
function sourceLabel(row: string) {
  const [table, line] = row.split(':')
  return table && line ? `原表 ${table} · 第 ${line} 行` : row || '原文'
}
function focusField(key: string) {
  activeField.value = key
  emit('focus-field', key)
}
</script>

<template>
  <aside class="document-preview" aria-label="导入工艺单对照">
    <header class="document-preview-heading">
      <strong>工艺单原件</strong>
      <ElButton size="small" @click="expand">放大预览</ElButton>
    </header>
    <p class="document-preview-filename">{{ route.filename }} · 只读</p>
    <ElTabs v-model="activeTab" class="document-preview-tabs">
      <ElTabPane label="原文件" name="original">
        <p v-if="selected" class="document-preview-selected">
          {{ selected.label }} · {{ sourceLabel(selected.source_row) }}
        </p>
        <WordDocumentPreview :route="route" />
      </ElTabPane>
      <ElTabPane label="字段对照" name="fields" lazy>
        <div v-if="activeTab === 'fields'" class="document-preview-body">
          <section v-if="fields.length" aria-label="导入字段对照">
            <h4>自动带入字段 <span>点击字段定位表单</span></h4>
            <ul class="document-preview-fields">
              <li v-for="[key, field] in fields" :key="key" :data-field="key">
                <button
                  type="button"
                  class="document-preview-field"
                  :class="{ 'document-preview-field--active': activeField === key }"
                  @click="focusField(key)"
                >
                  <span class="document-preview-field-heading">
                    <strong>{{ field.label }}</strong>
                    <span
                      class="document-preview-status"
                      :class="{ 'document-preview-status--edited': edited(key, field.value) }"
                      ><IconPencil
                        v-if="edited(key, field.value)"
                        :size="12"
                        stroke="1.7"
                        aria-hidden="true"
                      />
                      <IconFileText v-else :size="12" stroke="1.7" aria-hidden="true" />
                      {{ edited(key, field.value) ? '已修改' : '已带入' }}</span
                    >
                  </span>
                  <span class="document-preview-values">
                    <span
                      ><small>原文值</small><span>{{ display(field.value) }}</span></span
                    >
                    <span
                      ><small>当前填写值</small
                      ><span>{{ display(currentValue(key, field.value)) }}</span></span
                    >
                  </span>
                  <span class="document-preview-source"
                    >{{ field.source_label }} · {{ sourceLabel(field.source_row) }}</span
                  >
                </button>
              </li>
            </ul>
          </section>
          <p v-else class="document-preview-empty">该工艺单暂无可对照的导入字段，请查看原文件。</p>
          <ul v-if="route.source_data.field_warnings?.length" class="document-preview-warnings">
            <li v-for="warning in route.source_data.field_warnings" :key="warning">
              {{ warning }}
            </li>
          </ul>
        </div>
      </ElTabPane>
    </ElTabs>
  </aside>
  <AppDialog
    v-if="previewMounted"
    v-model="expanded"
    title="工艺单原文件"
    width="min(1320px, 96vw)"
    top="3vh"
    append-to-body
    :close-on-click-modal="false"
    @closed="previewMounted = false"
  >
    <div class="document-preview-expanded">
      <WordDocumentPreview :route="route" />
    </div>
    <template #footer><ElButton @click="expanded = false">关闭预览</ElButton></template>
  </AppDialog>
</template>

<style scoped>
.document-preview {
  --document-edited-ink: color-mix(in srgb, var(--danger) 55%, var(--action-warm));
  position: sticky;
  top: 0;
  display: flex;
  flex-direction: column;
  min-width: 0;
  max-height: min(740px, 72dvh);
  padding: 12px;
  border: 1px solid var(--glass-edge, var(--line));
  border-radius: 16px;
  background: var(--glass-shell-fill, var(--surface));
  box-shadow: var(--glass-hover-shadow);
  backdrop-filter: blur(16px);
  color: var(--text);
}
.document-preview-heading,
.document-preview-field-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.document-preview-heading > strong {
  font-size: 14px;
}
.document-preview-filename {
  margin: 4px 0 6px;
  color: var(--muted);
  font-size: 11px;
  overflow-wrap: anywhere;
}
.document-preview-tabs {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.document-preview-tabs :deep(.el-tabs__header) {
  flex-shrink: 0;
  margin-bottom: 8px;
}
.document-preview-tabs :deep(.el-tabs__item) {
  height: 30px;
  color: var(--muted);
  font-size: 12px;
}
.document-preview-tabs :deep(.el-tabs__item.is-active) {
  color: var(--text);
}
.document-preview-tabs :deep(.el-tabs__content) {
  min-height: 0;
  overflow: auto;
  padding: 8px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--surface);
  overscroll-behavior: contain;
}
.document-preview-body {
  padding: 0;
}
.document-preview-selected {
  margin: 0 0 8px;
  color: var(--muted);
  font-size: 11px;
}
h4 {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 0 0 10px;
  font-size: 13px;
}
h4 > span {
  color: var(--muted);
  font-size: 11px;
  font-weight: 400;
}
.document-preview-fields {
  display: grid;
  gap: 6px;
  padding: 0;
  margin: 0 0 12px;
  list-style: none;
}
.document-preview-field {
  display: block;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.18s ease,
    background 0.18s ease;
}
.document-preview-field:hover,
.document-preview-field--active {
  border-color: color-mix(in srgb, var(--muted) 32%, var(--line));
  background: var(--surface-soft);
}
.document-preview-field:focus-visible {
  outline: 2px solid var(--muted);
  outline-offset: 2px;
}
.document-preview-field-heading > strong {
  font-size: 13px;
}
.document-preview-status {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: var(--muted);
  font-size: 11px;
  white-space: nowrap;
}
.document-preview-status--edited {
  color: var(--document-edited-ink);
}
.document-preview-status svg {
  flex-shrink: 0;
}
.document-preview-values {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin: 9px 0 7px;
  font-size: 13px;
}
.document-preview-values > span {
  display: flex;
  flex-direction: column;
  gap: 4px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.document-preview-values small,
.document-preview-source {
  color: var(--muted);
  font-size: 11px;
}
.document-preview-source {
  display: block;
  overflow-wrap: anywhere;
}
.document-preview-warnings {
  margin: 0 0 16px;
  padding-left: 18px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.6;
}
.document-preview-warnings li::marker {
  color: var(--document-edited-ink);
}
.document-preview-empty {
  color: var(--muted);
  font-size: 13px;
}
.document-preview-expanded {
  display: flex;
  height: 72dvh;
  min-height: 0;
  overflow: auto;
}
@media (prefers-reduced-motion: reduce) {
  .document-preview-field {
    transition: none;
  }
}
</style>
