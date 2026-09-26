<script setup lang="ts">
import { computed } from 'vue'
import { teamWorkspaceSections } from '@/config/teamWorkspaces'
import '@/styles/team-workspace.css'

const props = defineProps<{ title: string; modelValue: string }>()
const sectionLabel = computed(() => teamWorkspaceSections.find(section => section.value === props.modelValue)?.label || props.title)
</script>

<template>
  <section class="page workspace-page team-workspace reading-workspace team-workspace--reading" :class="{ 'team-workspace--materials': modelValue === 'materials' }" :aria-label="title + '工作台'">
    <h1 id="workspace-page-heading" class="sr-only">{{ sectionLabel }}</h1>
    <div :id="`workspace-panel-${modelValue}`" class="team-workspace__content" role="region" aria-labelledby="workspace-page-heading"><slot /></div>
    <slot name="dialogs" />
  </section>
</template>

<style scoped>
.team-workspace { gap: 0; padding: 20px 24px; background: var(--workspace-bg); }
.team-workspace__content { display: flex; flex-direction: column; flex: 1; min-height: 0; min-width: 0; gap: 12px; overflow: hidden; overscroll-behavior: contain; scrollbar-width: thin; }
@media (max-width: 760px) {
  .team-workspace { padding: 12px; }
}
</style>
