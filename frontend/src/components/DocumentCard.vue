<script setup lang="ts">
import { Document } from '@element-plus/icons-vue'
import { ElIcon } from 'element-plus'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import AppDisclosure from './AppDisclosure.vue'
const props = withDefaults(
  defineProps<{
    title?: string
    source?: string
    filename?: string
    missing?: string
    lazy?: boolean
    expanded?: boolean
    summaryFilename?: string
  }>(),
  { expanded: undefined },
)
const emit = defineEmits<{ 'update:expanded': [open: boolean] }>()
const card = ref<HTMLElement>()
const previewVisible = ref(!props.lazy)
let observer: IntersectionObserver | undefined
onMounted(() => {
  if (!props.lazy || !card.value) return
  if (typeof IntersectionObserver === 'undefined') {
    previewVisible.value = true
    return
  }
  observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      previewVisible.value = true
      observer?.disconnect()
    },
    { rootMargin: '80px' },
  )
  observer.observe(card.value)
})
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <section
    ref="card"
    class="document-card"
    :class="{
      'document-card--missing': missing,
      'document-card--disclosure': expanded !== undefined,
    }"
  >
    <component
      :is="expanded === undefined ? 'div' : AppDisclosure"
      class="document-card-body"
      :open="expanded"
      @update:open="emit('update:expanded', $event)"
    >
      <template v-if="expanded !== undefined" #summary>
        <strong>{{ title }}</strong>
        <span class="document-card-filename" :title="summaryFilename || filename">{{
          expanded ? source : summaryFilename || filename
        }}</span>
      </template>
      <template v-if="expanded !== false">
        <header v-if="expanded === undefined && (title || source)" class="document-card-heading">
          <strong v-if="title">{{ title }}</strong
          ><span v-if="source">{{ source }}</span>
        </header>
        <div v-if="missing" class="document-card-empty">
          <ElIcon><Document /></ElIcon><span>{{ missing }}</span>
        </div>
        <slot v-else-if="previewVisible" />
        <div v-else class="document-card-preview-placeholder" aria-label="附件预览待加载" />
        <span v-if="filename" class="document-card-filename" :title="filename">{{ filename }}</span>
        <div v-if="$slots.actions" class="document-card-actions"><slot name="actions" /></div>
      </template>
    </component>
  </section>
</template>

<style scoped>
.document-card-body,
.document-card--disclosure :deep(.app-disclosure-inner) {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 6px;
}
.document-card {
  min-width: 0;
  padding: 8px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--document-card-bg, #ffffffc9);
}
.document-card--disclosure {
  padding: 0;
  border: 0;
  border-bottom: 1px solid var(--line-light);
  border-radius: 0;
  background: transparent;
}
.document-card--disclosure .document-card-body {
  display: block;
}
.document-card--disclosure .document-card-filename {
  font-weight: var(--font-weight-regular);
}
.document-card--disclosure :deep(.app-disclosure-label strong) {
  flex-shrink: 0;
  font-weight: var(--font-weight-medium);
}
.document-card--disclosure :deep([data-open] .app-disclosure-inner) {
  padding-bottom: 10px;
}
.document-card-heading,
.document-card-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.document-card-preview-placeholder {
  height: 128px;
}
.document-card-heading {
  justify-content: space-between;
  font-size: var(--font-size-meta);
  line-height: 18px;
}
.document-card-heading strong {
  font-weight: var(--font-weight-medium);
}
.document-card-heading span,
.document-card-filename {
  color: var(--muted);
  font-size: var(--font-size-meta);
}
.document-card-filename {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.document-card-actions :deep(.el-button) {
  margin: 0;
}
.document-card-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 72px;
  color: var(--muted);
  font-size: var(--font-size-meta);
}
.document-card-empty .el-icon {
  font-size: 22px;
}
.document-card--missing {
  border-style: dashed;
  background: var(--document-card-empty-bg, #ffffff80);
}
@media (max-width: 760px) {
  .document-card {
    flex: 0 0 160px;
  }
}
</style>
