<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import { FullScreen, ScaleToOriginal, Upload } from '@element-plus/icons-vue'
import { ElButton } from 'element-plus'
import { workspaceToolsKey } from '@/utils/workspaceTools'
import PageBackButton from '@/components/PageBackButton.vue'
import WorkspaceTools from './WorkspaceTools.vue'
import {
  teamWorkspaceSections,
  teamWorkspaceSectionsFor,
  type TeamWorkspaceSection,
} from '@/config/teamWorkspaces'
import '@/styles/team-workspace.css'

const props = defineProps<{
  title: string
  engineering?: boolean
  modelValue: string
  warehouse?: boolean
  manageWarehouse?: boolean
  reallocations?: boolean
  processing?: boolean
  inspection?: boolean
  qualityCount?: number
  pendingCount?: number | null
  exportable?: boolean
  settings?: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [value: TeamWorkspaceSection]
  'fullscreen-change': [value: boolean]
  export: []
  settings: []
}>()
const sections = computed(() =>
  props.engineering
    ? teamWorkspaceSections.filter((section) => section.value === 'process-routes')
    : teamWorkspaceSectionsFor(
        Boolean(props.warehouse),
        Boolean(props.manageWarehouse),
        Boolean(props.reallocations),
        Boolean(props.processing),
        Boolean(props.inspection),
      ),
)
const sectionLabel = computed(
  () =>
    teamWorkspaceSections.find((section) => section.value === props.modelValue)?.label ||
    props.title,
)
const navigation = ref<HTMLElement>()
const fullscreen = ref(false),
  fullscreenBusy = ref(false)
const canFullscreen = computed(() =>
  [
    'process-routes',
    'stock',
    'delivery-schedule',
    'pending',
    'receipts',
    'processing',
    'inspections',
    'inspection-results',
    'quality-feedback',
    'outgoing',
    'reallocations',
    'losses',
    'materials',
    'material-types',
  ].includes(props.modelValue),
)
const contentTools = computed(() =>
  [
    'stock',
    'pending',
    'receipts',
    'processing',
    'outgoing',
    'reallocations',
    'losses',
    'materials',
    'material-types',
    'warehouse',
    'overview',
    'history',
  ].includes(props.modelValue),
)
provide(workspaceToolsKey, {
  fullscreen,
  fullscreenBusy,
  canFullscreen,
  exportable: computed(() => !!props.exportable),
  settings: computed(() => !!props.settings),
  toggleFullscreen,
  export: () => emit('export'),
  openSettings: () => emit('settings'),
})
let ownsFullscreen = false,
  disposed = false
function exitFullscreen() {
  fullscreen.value = false
  if (ownsFullscreen && document.fullscreenElement === document.documentElement)
    void document.exitFullscreen().catch(() => undefined)
  ownsFullscreen = false
}
async function toggleFullscreen() {
  if (fullscreenBusy.value) return
  if (fullscreen.value) {
    exitFullscreen()
    return
  }
  fullscreen.value = true
  if (document.fullscreenElement || !document.documentElement.requestFullscreen) return
  fullscreenBusy.value = true
  ownsFullscreen = true
  try {
    // Fullscreen the document so existing dialogs and dropdowns remain visible.
    await document.documentElement.requestFullscreen()
    if (disposed || !fullscreen.value) {
      if (document.fullscreenElement === document.documentElement)
        void document.exitFullscreen().catch(() => undefined)
      ownsFullscreen = false
    }
  } catch {
    ownsFullscreen = false
  } finally {
    // Keep the viewport view when native fullscreen is unavailable.
    fullscreenBusy.value = false
  }
}
function fullscreenChanged() {
  if (ownsFullscreen && document.fullscreenElement !== document.documentElement) {
    ownsFullscreen = false
    fullscreen.value = false
  }
}
function fullscreenShortcut(event: KeyboardEvent) {
  if (event.key === 'Escape' && !document.fullscreenElement && !event.defaultPrevented)
    exitFullscreen()
}
watch(fullscreen, (value) => emit('fullscreen-change', value), { flush: 'sync' })
watch([() => props.title, canFullscreen], ([title, supported], [previous]) => {
  if (title !== previous || !supported) exitFullscreen()
})
let observer: ResizeObserver | undefined
function revealSection() {
  const nav = navigation.value
  const current = nav?.querySelector<HTMLElement>('[aria-current=page]')
  if (!nav || !current || nav.scrollWidth <= nav.clientWidth) return
  const bounds = nav.getBoundingClientRect(),
    item = current.getBoundingClientRect()
  if (item.left < bounds.left + 6) nav.scrollLeft += item.left - bounds.left - 6
  else if (item.right > bounds.right - 6) nav.scrollLeft += item.right - bounds.right + 6
}
watch([() => props.modelValue, () => props.pendingCount, sections], revealSection, {
  flush: 'post',
})
onMounted(() => {
  document.addEventListener('fullscreenchange', fullscreenChanged)
  document.addEventListener('keydown', fullscreenShortcut)
  revealSection()
  if (typeof ResizeObserver !== 'undefined' && navigation.value) {
    observer = new ResizeObserver(revealSection)
    observer.observe(navigation.value)
  }
})
onBeforeUnmount(() => {
  disposed = true
  observer?.disconnect()
  document.removeEventListener('fullscreenchange', fullscreenChanged)
  document.removeEventListener('keydown', fullscreenShortcut)
  exitFullscreen()
})
</script>

<template>
  <section
    class="page workspace-page team-workspace reading-workspace team-workspace--reading"
    :class="{
      'team-workspace--fullscreen': fullscreen,
      'team-workspace--materials': ['materials', 'material-types'].includes(modelValue),
      'team-workspace--warehouse': modelValue === 'warehouse',
    }"
    :aria-label="title + '工作台'"
  >
    <h1 id="workspace-page-heading" class="sr-only">{{ sectionLabel }}</h1>
    <header v-if="fullscreen" class="team-workspace__navigation-row">
      <strong v-if="fullscreen" class="team-workspace__team"
        >{{ title }} · {{ sectionLabel }}</strong
      >
      <div v-if="fullscreen && $slots['fullscreen-status']" class="team-workspace__status">
        <slot name="fullscreen-status" />
      </div>
      <div v-if="canFullscreen || $slots.messages" class="team-workspace__commands">
        <slot name="messages" />
        <div v-if="canFullscreen" class="team-workspace__view-actions">
          <ElButton
            v-if="exportable"
            class="team-workspace__export action-warm"
            :icon="Upload"
            @click="emit('export')"
            >导出</ElButton
          ><ElButton
            class="team-workspace__fullscreen action-cool"
            :icon="fullscreen ? ScaleToOriginal : FullScreen"
            :aria-pressed="fullscreen"
            :disabled="fullscreenBusy"
            @click="toggleFullscreen"
            >{{ fullscreen ? '退出全屏' : '全屏查看' }}</ElButton
          >
        </div>
      </div>
    </header>
    <div v-show="!fullscreen" class="team-workspace__navigation-bar">
      <div class="team-workspace__heading page-heading-start">
        <PageBackButton /><strong class="team-workspace__title">{{ title }}</strong>
      </div>
      <nav
        v-show="sections.length > 1"
        ref="navigation"
        class="team-workspace__navigation"
        :aria-label="title + '功能'"
      >
        <ElButton
          v-for="section in sections"
          :key="section.value"
          text
          class="team-workspace__section"
          :class="{ 'is-current': modelValue === section.value }"
          :aria-current="modelValue === section.value ? 'page' : undefined"
          aria-controls="workspace-panel"
          @click="emit('update:modelValue', section.value)"
        >
          {{ section.label
          }}<span
            v-if="
              (section.value === 'pending' && pendingCount) ||
              (section.value === 'quality-feedback' && qualityCount)
            "
            class="team-workspace__pending"
            >{{ section.value === 'pending' ? pendingCount : qualityCount }}</span
          >
        </ElButton>
      </nav>
      <div v-if="$slots.messages || !contentTools" class="team-workspace__commands">
        <slot v-if="!fullscreen" name="messages" />
        <WorkspaceTools v-if="!contentTools"
          ><template v-if="$slots.settings" #actions><slot name="settings" /></template
        ></WorkspaceTools>
      </div>
    </div>
    <div
      id="workspace-panel"
      class="team-workspace__content"
      role="region"
      aria-labelledby="workspace-page-heading"
    >
      <slot />
    </div>
    <slot name="dialogs" />
  </section>
</template>

<style scoped>
.team-workspace {
  gap: 0;
  padding: 18px 24px 20px;
}
.page.team-workspace.reading-workspace {
  background: transparent;
}
.page.team-workspace.reading-workspace.team-workspace--fullscreen {
  background: var(--workspace-bg);
}
.team-workspace__navigation-row {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 18px;
  min-width: 0;
  min-height: 36px;
  margin-bottom: 8px;
}
.team-workspace__navigation-bar {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 12px;
  min-width: 0;
  margin-bottom: 12px;
}
.team-workspace__heading {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  gap: 12px;
  min-width: 0;
}
.team-workspace__title {
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.3px;
}
.team-workspace__commands,
.team-workspace__view-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}
.team-workspace__commands :deep(.el-button) {
  height: 32px;
  margin: 0;
  padding-inline: 10px;
  border: 0;
  border-radius: 9px;
  font-size: 13px;
}
.team-workspace__commands :deep(.el-button:focus-visible) {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
.team-workspace__team {
  align-self: center;
  min-width: 0;
  padding-inline: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 16px;
}
.team-workspace__status {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  color: var(--el-color-warning);
  font-size: 12px;
}
.team-workspace--fullscreen .team-workspace__navigation-row {
  min-height: 32px;
  margin-bottom: 8px;
}
.team-workspace__navigation {
  display: flex;
  flex: 1;
  min-width: 0;
  padding: 3px;
  overflow-x: auto;
  border-radius: 24px;
  background: var(--glass-chrome-fill);
  -webkit-backdrop-filter: blur(16px) saturate(110%);
  backdrop-filter: blur(16px) saturate(110%);
  box-shadow:
    inset 0 1px 0 #fff,
    inset 0 -1px 0 #a9c3b32b,
    0 0 0 0.5px #6e8c7926,
    0 3px 10px #2548320a;
  scrollbar-width: thin;
  scrollbar-color: #bfcfc6 transparent;
}
.team-workspace__section.el-button {
  flex: 1 0 auto;
  min-width: max-content;
  height: 32px;
  margin: 0;
  padding: 0 12px;
  border-radius: 20px;
  color: var(--muted);
  background: transparent;
  font-size: 13px;
  font-weight: 500;
  transition:
    background-color var(--motion-standard) ease,
    color var(--motion-standard) ease,
    box-shadow var(--motion-standard) ease;
}
.team-workspace__section.el-button:where(:not(.is-current)):not(:disabled):not(.is-disabled):not(
    .is-loading
  ):hover {
  background: var(--glass-hover-fill);
  color: var(--primary);
  box-shadow: var(--glass-hover-shadow);
}
.team-workspace__section.el-button.is-current {
  background: var(--glass-selected-fill);
  color: var(--primary);
  font-weight: 620;
  box-shadow: var(--glass-selected-shadow);
}
.team-workspace__section.el-button:not(:disabled):not(.is-disabled):not(.is-loading):active {
  box-shadow:
    inset 0 1px 2px rgb(30 40 35 / 8%),
    inset 0 0 0 1px var(--glass-interaction-edge);
}
.team-workspace__section.el-button:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 1px;
}
.team-workspace__pending {
  min-width: 18px;
  margin-left: 5px;
  padding: 0 4px;
  border-radius: 6px;
  background: var(--action-warm-soft);
  color: var(--action-warm);
  font-size: 10px;
  font-weight: 600;
  line-height: 18px;
  font-variant-numeric: tabular-nums;
}
.team-workspace__content {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  min-width: 0;
  gap: 12px;
  overflow: hidden;
  overscroll-behavior: contain;
  scrollbar-width: thin;
}
@media (prefers-reduced-motion: reduce) {
  .team-workspace__section.el-button {
    transition: none;
  }
}
@media (max-width: 1280px) {
  .team-workspace {
    padding: 16px 18px;
  }
  .team-workspace__title {
    font-size: 18px;
  }
}
@media (max-width: 1080px) {
  .team-workspace {
    padding: 14px 15px;
  }
  .team-workspace__navigation-row {
    gap: 12px;
  }
  .team-workspace__title {
    font-size: 18px;
  }
  .team-workspace__section.el-button {
    padding-inline: 13px;
  }
}
@media (max-width: 760px) {
  .team-workspace {
    padding: 12px;
  }
  .team-workspace__navigation-row,
  .team-workspace__navigation-bar {
    flex-wrap: wrap;
  }
  .team-workspace__navigation {
    flex-basis: 100%;
    order: 2;
  }
  .team-workspace__commands {
    margin-left: auto;
  }
  .team-workspace__title {
    font-size: 18px;
  }
}
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .team-workspace__commands,
  .team-workspace__navigation {
    background: var(--surface);
  }
}
@media (prefers-reduced-transparency: reduce), (prefers-contrast: more) {
  .team-workspace__commands,
  .team-workspace__navigation {
    background: var(--surface);
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
}
</style>
