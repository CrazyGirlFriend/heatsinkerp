<script setup lang="ts">
import { computed } from 'vue'
import { teamWorkspaceSections } from '@/config/teamWorkspaces'
import '@/styles/team-workspace.css'

const props = defineProps<{ title: string; modelValue: string }>()
const sectionLabel = computed(() => teamWorkspaceSections.find(section => section.value === props.modelValue)?.label || props.title)
</script>

<template>
  <section class="page workspace-page team-workspace reading-workspace team-workspace--reading" :aria-label="title + '工作台'">
    <h1 id="workspace-page-heading" class="sr-only">{{ sectionLabel }}</h1>
    <div v-if="$slots.actions" class="team-workspace__navigation" role="group" aria-label="工作台操作"><slot name="actions" /></div>
    <div :id="`workspace-panel-${modelValue}`" class="team-workspace__content" role="region" aria-labelledby="workspace-page-heading"><slot /></div>
    <slot name="dialogs" />
  </section>
</template>

<style scoped>
.team-workspace { gap: 0; padding: 20px 24px; background: var(--workspace-bg); }
.team-workspace__navigation { display: flex; flex-shrink: 0; align-items: center; justify-content: flex-end; gap: 8px; min-height: 36px; margin-bottom: 12px; }
.team-workspace__navigation > :deep(.workspace-actions) { flex: 0 1 auto; margin-left: 0; }
.team-workspace__content { display: flex; flex-direction: column; flex: 1; min-height: 0; min-width: 0; gap: 12px; overflow: hidden; overscroll-behavior: contain; scrollbar-width: thin; }
@media (max-width: 760px) {
  .team-workspace { padding: 12px; }
  .team-workspace__navigation { flex-wrap: wrap; justify-content: flex-start; }
  .team-workspace__navigation > :deep(.workspace-actions) { width: auto; }
}
</style>
