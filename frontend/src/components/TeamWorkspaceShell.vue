<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElButton } from 'element-plus'
import PageBackButton from '@/components/PageBackButton.vue'
import { teamWorkspaceSections, teamWorkspaceSectionsFor, type TeamWorkspaceSection } from '@/config/teamWorkspaces'
import '@/styles/team-workspace.css'

const props = defineProps<{ title: string; modelValue: string; warehouse?: boolean; manageWarehouse?: boolean; pendingCount?: number | null }>()
const emit = defineEmits<{ 'update:modelValue': [value: TeamWorkspaceSection] }>()
const sections = computed(() => teamWorkspaceSectionsFor(Boolean(props.warehouse), Boolean(props.manageWarehouse)))
const sectionLabel = computed(() => teamWorkspaceSections.find(section => section.value === props.modelValue)?.label || props.title)
const navigation = ref<HTMLElement>()
let observer: ResizeObserver | undefined
function revealSection() {
  const nav = navigation.value
  const current = nav?.querySelector<HTMLElement>('[aria-current=page]')
  if (!nav || !current || nav.scrollWidth <= nav.clientWidth) return
  const bounds = nav.getBoundingClientRect(), item = current.getBoundingClientRect()
  if (item.left < bounds.left + 6) nav.scrollLeft += item.left - bounds.left - 6
  else if (item.right > bounds.right - 6) nav.scrollLeft += item.right - bounds.right + 6
}
watch([() => props.modelValue, () => props.pendingCount, sections], revealSection, { flush: 'post' })
onMounted(() => {
  revealSection()
  if (typeof ResizeObserver !== 'undefined' && navigation.value) {
    observer = new ResizeObserver(revealSection)
    observer.observe(navigation.value)
  }
})
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <section class="page workspace-page team-workspace reading-workspace team-workspace--reading" :class="{ 'team-workspace--materials': ['materials', 'material-types'].includes(modelValue) }" :aria-label="title + '工作台'">
    <h1 id="workspace-page-heading" class="sr-only">{{ sectionLabel }}</h1>
    <div class="team-workspace__navigation-row">
    <PageBackButton />
    <nav ref="navigation" class="team-workspace__navigation" :aria-label="title + '功能'">
      <ElButton v-for="section in sections" :key="section.value" text class="team-workspace__section" :class="{ 'is-current': modelValue === section.value }" :aria-current="modelValue === section.value ? 'page' : undefined" aria-controls="workspace-panel" @click="emit('update:modelValue', section.value)">
        {{ section.label }}<span v-if="section.value === 'pending' && pendingCount" class="team-workspace__pending">{{ pendingCount }}</span>
      </ElButton>
    </nav>
    </div>
    <div id="workspace-panel" class="team-workspace__content" role="region" aria-labelledby="workspace-page-heading"><slot /></div>
    <slot name="dialogs" />
  </section>
</template>

<style scoped>
.team-workspace { gap: 0; padding: 20px 24px; background: var(--workspace-bg); }
.team-workspace__navigation-row { display: flex; flex: 0 0 auto; gap: 8px; min-width: 0; margin-bottom: 12px; }
.team-workspace__navigation { display: flex; flex: 1; gap: 4px; min-width: 0; padding: 6px; overflow-x: auto; border: 1px solid #d6e1d9; border-radius: 10px; background: #e9efeb; scrollbar-width: thin; }
.team-workspace__section.el-button { flex: 0 0 auto; height: 40px; margin: 0; padding: 0 16px; border-radius: 6px; color: var(--text); background: transparent; font-size: 16px; font-weight: 500; transition: background-color var(--motion-fast) ease, color var(--motion-fast) ease, box-shadow var(--motion-fast) ease; }
.team-workspace__section.el-button:not(.is-current):hover { background: rgb(255 255 255 / 75%); }
.team-workspace__section.el-button.is-current { background: var(--primary); color: #fff; font-weight: 600; box-shadow: 0 1px 3px rgb(36 49 42 / 14%); }
.team-workspace__section.el-button:focus-visible { outline: 2px solid var(--text); outline-offset: 2px; }
.team-workspace__pending { margin-left: 8px; padding: 0 6px; border-radius: 4px; background: var(--surface); color: var(--primary); font-size: 13px; font-weight: 600; line-height: 20px; font-variant-numeric: tabular-nums; }
.team-workspace__content { display: flex; flex-direction: column; flex: 1; min-height: 0; min-width: 0; gap: 12px; overflow: hidden; overscroll-behavior: contain; scrollbar-width: thin; }
@media (prefers-reduced-motion: reduce) {
  .team-workspace__section.el-button { transition: none; }
}
@media (max-width: 760px) {
  .team-workspace { padding: 12px; }
}
</style>
