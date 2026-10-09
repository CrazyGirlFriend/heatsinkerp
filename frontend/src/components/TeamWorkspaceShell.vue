<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { FullScreen, ScaleToOriginal } from '@element-plus/icons-vue'
import { ElButton } from 'element-plus'
import PageBackButton from '@/components/PageBackButton.vue'
import { teamWorkspaceSections, teamWorkspaceSectionsFor, type TeamWorkspaceSection } from '@/config/teamWorkspaces'
import '@/styles/team-workspace.css'

const props = defineProps<{ title: string; modelValue: string; warehouse?: boolean; manageWarehouse?: boolean; reallocations?: boolean; pendingCount?: number | null; exportable?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: TeamWorkspaceSection]; 'fullscreen-change': [value: boolean]; export: [] }>()
const sections = computed(() => teamWorkspaceSectionsFor(Boolean(props.warehouse), Boolean(props.manageWarehouse), Boolean(props.reallocations)))
const sectionLabel = computed(() => teamWorkspaceSections.find(section => section.value === props.modelValue)?.label || props.title)
const navigation = ref<HTMLElement>()
const fullscreen = ref(false), fullscreenBusy = ref(false)
const canFullscreen = computed(() => ['stock', 'pending', 'receipts', 'outgoing', 'reallocations', 'losses', 'materials', 'material-types'].includes(props.modelValue))
let ownsFullscreen = false, disposed = false
function exitFullscreen() {
  fullscreen.value = false
  if (ownsFullscreen && document.fullscreenElement === document.documentElement) void document.exitFullscreen().catch(() => undefined)
  ownsFullscreen = false
}
async function toggleFullscreen() {
  if (fullscreenBusy.value) return
  if (fullscreen.value) { exitFullscreen(); return }
  fullscreen.value = true
  if (document.fullscreenElement || !document.documentElement.requestFullscreen) return
  fullscreenBusy.value = true; ownsFullscreen = true
  try {
    // Fullscreen the document so existing dialogs and dropdowns remain visible.
    await document.documentElement.requestFullscreen()
    if (disposed || !fullscreen.value) {
      if (document.fullscreenElement === document.documentElement) void document.exitFullscreen().catch(() => undefined)
      ownsFullscreen = false
    }
  } catch { ownsFullscreen = false } // Keep the viewport view when native fullscreen is unavailable.
  finally { fullscreenBusy.value = false }
}
function fullscreenChanged() { if (ownsFullscreen && document.fullscreenElement !== document.documentElement) { ownsFullscreen = false; fullscreen.value = false } }
function fullscreenShortcut(event: KeyboardEvent) { if (event.key === 'Escape' && !document.fullscreenElement && !event.defaultPrevented) exitFullscreen() }
watch(fullscreen, value => emit('fullscreen-change', value), { flush: 'sync' })
watch([() => props.title, canFullscreen], ([title, supported], [previous]) => { if (title !== previous || !supported) exitFullscreen() })
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
  document.addEventListener('fullscreenchange', fullscreenChanged)
  document.addEventListener('keydown', fullscreenShortcut)
  revealSection()
  if (typeof ResizeObserver !== 'undefined' && navigation.value) {
    observer = new ResizeObserver(revealSection)
    observer.observe(navigation.value)
  }
})
onBeforeUnmount(() => { disposed = true; observer?.disconnect(); document.removeEventListener('fullscreenchange', fullscreenChanged); document.removeEventListener('keydown', fullscreenShortcut); exitFullscreen() })
</script>

<template>
  <section class="page workspace-page team-workspace reading-workspace team-workspace--reading" :class="{ 'team-workspace--fullscreen': fullscreen, 'team-workspace--materials': ['materials', 'material-types'].includes(modelValue), 'team-workspace--warehouse': modelValue === 'warehouse' }" :aria-label="title + '工作台'">
    <h1 id="workspace-page-heading" class="sr-only">{{ sectionLabel }}</h1>
    <div class="team-workspace__navigation-row">
    <strong v-if="fullscreen" class="team-workspace__team">{{ title }} · {{ sectionLabel }}</strong><PageBackButton v-else />
    <nav v-show="!fullscreen" ref="navigation" class="team-workspace__navigation" :aria-label="title + '功能'">
      <ElButton v-for="section in sections" :key="section.value" text class="team-workspace__section" :class="{ 'is-current': modelValue === section.value }" :aria-current="modelValue === section.value ? 'page' : undefined" aria-controls="workspace-panel" @click="emit('update:modelValue', section.value)">
        {{ section.label }}<span v-if="section.value === 'pending' && pendingCount" class="team-workspace__pending">{{ pendingCount }}</span>
      </ElButton>
    </nav>
    <div v-if="$slots.settings" v-show="!fullscreen" class="team-workspace__settings"><slot name="settings" /></div>
    <div v-if="fullscreen && $slots['fullscreen-status']" class="team-workspace__status"><slot name="fullscreen-status" /></div>
    <div v-if="canFullscreen" class="team-workspace__view-actions"><ElButton v-if="exportable" class="team-workspace__export action-cool" @click="emit('export')">导出</ElButton><ElButton class="team-workspace__fullscreen action-cool" :icon="fullscreen ? ScaleToOriginal : FullScreen" :aria-pressed="fullscreen" :disabled="fullscreenBusy" @click="toggleFullscreen">{{ fullscreen ? '退出全屏' : '全屏查看' }}</ElButton></div>
    </div>
    <div id="workspace-panel" class="team-workspace__content" role="region" aria-labelledby="workspace-page-heading"><slot /></div>
    <slot name="dialogs" />
  </section>
</template>

<style scoped>
.team-workspace { gap: 0; padding: 20px 24px; background: var(--workspace-bg); }
.team-workspace__navigation-row { display: flex; flex: 0 0 auto; gap: 8px; min-width: 0; margin-bottom: 12px; }
.team-workspace__settings { display: flex; flex: 0 0 auto; align-items: center; }
.team-workspace__view-actions { display: flex; flex: 0 0 auto; align-items: center; gap: 8px; margin-left: auto; }
.team-workspace__export.el-button { height: 36px; margin: 0; padding-inline: 12px; }
.team-workspace__fullscreen.el-button { flex: 0 0 auto; align-self: center; height: 36px; margin: 0; padding-inline: 12px; }
.team-workspace__team { align-self: center; min-width: 0; padding-inline: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 16px; }
.team-workspace__status { display: flex; align-items: center; flex-shrink: 0; color: var(--el-color-warning); font-size: 12px; }
.team-workspace__settings :deep(.el-button) { height: 36px; margin: 0; padding-inline: 10px; color: var(--muted); font-size: 14px; }
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
  .team-workspace__navigation-row { flex-wrap: wrap; }
  .team-workspace__navigation { order: 1; flex-basis: 100%; }
  .team-workspace__settings { margin-left: auto; }
}
</style>
