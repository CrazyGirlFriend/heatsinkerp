<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { FullScreen, ScaleToOriginal, Upload } from '@element-plus/icons-vue'
import { ElButton } from 'element-plus'
import PageBackButton from '@/components/PageBackButton.vue'
import { teamWorkspaceSections, teamWorkspaceSectionsFor, type TeamWorkspaceSection } from '@/config/teamWorkspaces'
import '@/styles/team-workspace.css'

const props = defineProps<{ title: string; modelValue: string; warehouse?: boolean; manageWarehouse?: boolean; reallocations?: boolean; processing?: boolean; pendingCount?: number | null; exportable?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: TeamWorkspaceSection]; 'fullscreen-change': [value: boolean]; export: [] }>()
const sections = computed(() => teamWorkspaceSectionsFor(Boolean(props.warehouse), Boolean(props.manageWarehouse), Boolean(props.reallocations), Boolean(props.processing)))
const sectionLabel = computed(() => teamWorkspaceSections.find(section => section.value === props.modelValue)?.label || props.title)
const navigation = ref<HTMLElement>()
const fullscreen = ref(false), fullscreenBusy = ref(false)
const canFullscreen = computed(() => ['stock', 'pending', 'receipts', 'processing', 'outgoing', 'reallocations', 'losses', 'materials', 'material-types'].includes(props.modelValue))
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
    <header class="team-workspace__navigation-row">
      <strong v-if="fullscreen" class="team-workspace__team">{{ title }} · {{ sectionLabel }}</strong>
      <div v-else class="team-workspace__heading"><strong class="team-workspace__title">{{ title.endsWith('工作台') ? title : title + '工作台' }}</strong><PageBackButton /></div>
      <div v-if="fullscreen && $slots['fullscreen-status']" class="team-workspace__status"><slot name="fullscreen-status" /></div>
      <div v-if="canFullscreen || $slots.settings" class="team-workspace__commands">
        <div v-if="canFullscreen" class="team-workspace__view-actions"><ElButton v-if="exportable" class="team-workspace__export" text :icon="Upload" @click="emit('export')">导出</ElButton><ElButton class="team-workspace__fullscreen" text :icon="fullscreen ? ScaleToOriginal : FullScreen" :aria-pressed="fullscreen" :disabled="fullscreenBusy" @click="toggleFullscreen">{{ fullscreen ? '退出全屏' : '全屏查看' }}</ElButton></div>
        <div v-if="$slots.settings" v-show="!fullscreen" class="team-workspace__settings" :class="{ 'team-workspace__settings--separated': canFullscreen }"><slot name="settings" /></div>
      </div>
    </header>
    <nav v-show="!fullscreen" ref="navigation" class="team-workspace__navigation" :aria-label="title + '功能'">
      <ElButton v-for="section in sections" :key="section.value" text class="team-workspace__section" :class="{ 'is-current': modelValue === section.value }" :aria-current="modelValue === section.value ? 'page' : undefined" aria-controls="workspace-panel" @click="emit('update:modelValue', section.value)">
        {{ section.label }}<span v-if="section.value === 'pending' && pendingCount" class="team-workspace__pending">{{ pendingCount }}</span>
      </ElButton>
    </nav>
    <div id="workspace-panel" class="team-workspace__content" role="region" aria-labelledby="workspace-page-heading"><slot /></div>
    <slot name="dialogs" />
  </section>
</template>

<style scoped>
.team-workspace { gap: 0; padding: 26px 28px 24px; }
.page.team-workspace.reading-workspace { background: transparent; }
.page.team-workspace.reading-workspace.team-workspace--fullscreen { background: var(--workspace-bg); }
.team-workspace__navigation-row { display: flex; flex: 0 0 auto; align-items: center; gap: 18px; min-width: 0; min-height: 55px; margin-bottom: 21px; }
.team-workspace__heading { display: flex; align-items: center; flex: 1; gap: 12px; min-width: 0; }
.team-workspace__title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 29px; font-weight: 640; letter-spacing: -.9px; }
.team-workspace__heading :deep(.page-back-button) { height: 32px; padding-inline: 8px; border-radius: 20px; font-size: 12px; }
.team-workspace__commands { display: flex; flex: 0 0 auto; align-items: center; gap: 2px; margin-left: auto; padding: 4px; border-radius: 24px; background: linear-gradient(160deg, #ffffffe0, #ffffff47 65%, #ffffff85); -webkit-backdrop-filter: blur(10px) saturate(125%); backdrop-filter: blur(10px) saturate(125%); box-shadow: 0 5px 13px #233e2d12, 0 0 0 .5px #4b6c581a, inset 0 1px 1px #fff, inset 0 -1px 1px #ffffffb8; }
.team-workspace__settings, .team-workspace__view-actions { display: flex; flex: 0 0 auto; align-items: center; gap: 2px; }
.team-workspace__settings--separated::before { content: ''; width: 1px; height: 20px; margin-inline: 5px; background: var(--line); }
.team-workspace__commands :deep(.el-button) { height: 32px; margin: 0; padding-inline: 13px; border: 0; border-radius: 20px; background: transparent; color: var(--muted); font-size: 13px; font-weight: 500; }
.team-workspace__commands :deep(.el-button:hover:not(:disabled)) { background: #ffffff85; color: var(--primary); }
.team-workspace__commands :deep(.el-button:focus-visible) { outline: 2px solid var(--primary); outline-offset: 2px; }
.team-workspace__commands .team-workspace__export.el-button { background: var(--action-warm-soft); color: var(--action-warm); box-shadow: inset 0 1px 0 #ffffffa3; }
.team-workspace__commands .team-workspace__export.el-button:hover { background: #eee2cc; }
.team-workspace__team { align-self: center; min-width: 0; padding-inline: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 16px; }
.team-workspace__status { display: flex; align-items: center; flex-shrink: 0; color: var(--el-color-warning); font-size: 12px; }
.team-workspace--fullscreen .team-workspace__navigation-row { min-height: 40px; margin-bottom: 12px; }
.team-workspace__navigation { display: flex; flex: 0 0 auto; min-width: 0; margin-bottom: 20px; padding: 5px; overflow-x: auto; border-radius: 24px; background: linear-gradient(180deg, #c7d6ce45, #e0e9e359); box-shadow: inset 0 1px 2px #2f4f3b10, 0 1px 0 #ffffffe6; scrollbar-width: thin; scrollbar-color: #bfcfc6 transparent; }
.team-workspace__section.el-button { flex: 1 0 auto; min-width: max-content; height: 35px; margin: 0; padding: 0 16px; border-radius: 20px; color: var(--muted); background: transparent; font-size: 14px; font-weight: 500; transition: background-color var(--motion-standard) ease, color var(--motion-standard) ease, box-shadow var(--motion-standard) ease; }
.team-workspace__section.el-button:not(.is-current):hover { background: #ffffff3b; color: var(--primary); }
.team-workspace__section.el-button.is-current { background: linear-gradient(165deg, #fffffff0, #dceee2bd); color: var(--primary); font-weight: 620; box-shadow: 0 3px 8px #1d35241a, inset 0 1px .5px #fff, inset 0 -1px .5px #ffffffbf; }
.team-workspace__section.el-button:focus-visible { outline: 2px solid var(--primary); outline-offset: 1px; }
.team-workspace__pending { min-width: 18px; margin-left: 5px; padding: 0 4px; border-radius: 6px; background: var(--action-warm-soft); color: var(--action-warm); font-size: 10px; font-weight: 600; line-height: 18px; font-variant-numeric: tabular-nums; }
.team-workspace__content { display: flex; flex-direction: column; flex: 1; min-height: 0; min-width: 0; gap: 12px; overflow: hidden; overscroll-behavior: contain; scrollbar-width: thin; }
@media (prefers-reduced-motion: reduce) {
  .team-workspace__section.el-button { transition: none; }
}
@media (max-width: 1280px) {
  .team-workspace { padding: 21px 20px; }
  .team-workspace__title { font-size: 26px; }
}
@media (max-width: 1080px) {
  .team-workspace { padding: 18px 15px; }
  .team-workspace__navigation-row { gap: 12px; }
  .team-workspace__title { font-size: 24px; }
  .team-workspace__section.el-button { padding-inline: 13px; }
}
@media (max-width: 760px) {
  .team-workspace { padding: 12px; }
  .team-workspace__navigation-row { flex-wrap: wrap; }
  .team-workspace__heading { flex-basis: 100%; }
  .team-workspace__commands { margin-left: 0; }
  .team-workspace__title { font-size: 22px; }
}
</style>
