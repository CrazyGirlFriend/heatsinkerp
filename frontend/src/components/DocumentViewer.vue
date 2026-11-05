<script setup lang="ts">
import AppButton from '@/components/AppButton.vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { ElIcon, useZIndex } from 'element-plus'
import { ElFocusTrap } from 'element-plus/es/components/focus-trap/index'
import { Close, FullScreen, ZoomIn, ZoomOut } from '@element-plus/icons-vue'

const props = withDefaults(
  defineProps<{ title: string; pdf?: string; html?: string; initialZoom?: number | 'fit' }>(),
  { initialZoom: 'fit' },
)
const emit = defineEmits<{ close: [] }>()
const root = ref<HTMLElement>(),
  frame = ref<HTMLIFrameElement>()
const zoom = ref<number | 'fit'>(props.initialZoom)
const { nextZIndex } = useZIndex()
const zIndex = nextZIndex()
const pdfSource = computed(() =>
  props.pdf
    ? `${props.pdf}#toolbar=0&navpanes=0&${zoom.value === 'fit' ? 'view=Fit' : `zoom=${zoom.value}`}`
    : undefined,
)
let observer: ResizeObserver | undefined
function fitWord() {
  const doc = frame.value?.contentDocument
  const pages = doc?.getElementById('original-pages')
  if (!pages || !frame.value) return
  const width = Math.max(
    ...[...doc!.querySelectorAll<HTMLElement>('section.docx-original')].map(
      (page) => page.scrollWidth,
    ),
    1,
  )
  const scale =
    zoom.value === 'fit' ? Math.min(1.5, (frame.value.clientWidth - 48) / width) : zoom.value / 100
  pages.style.setProperty('zoom', String(Math.max(0.1, scale)))
}
function changeZoom(change: number) {
  zoom.value = Math.max(25, Math.min(300, (zoom.value === 'fit' ? 100 : zoom.value) + change))
  if (!props.pdf) fitWord()
}
function fit() {
  zoom.value = 'fit'
  if (!props.pdf) fitWord()
}
onMounted(async () => {
  await nextTick()
  if (!props.pdf && frame.value) {
    observer = new ResizeObserver(() => {
      if (zoom.value === 'fit') fitWord()
    })
    observer.observe(frame.value)
  }
})
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <Teleport to="body">
    <Transition name="document-viewer" appear>
      <section
        ref="root"
        class="document-viewer"
        role="dialog"
        aria-modal="true"
        :aria-label="`${title}放大预览`"
        :style="{ zIndex }"
        @click.self="emit('close')"
      >
        <ElFocusTrap
          :trapped="true"
          :focus-trap-el="root"
          focus-start-el="first"
          loop
          @release-requested="emit('close')"
        >
          <AppButton
            text
            native-type="button"
            class="document-viewer__close"
            aria-label="关闭放大预览"
            @click="emit('close')"
          >
            <ElIcon><Close /></ElIcon>
          </AppButton>
          <iframe
            ref="frame"
            :src="pdfSource"
            :srcdoc="pdf ? undefined : html"
            :sandbox="pdf ? undefined : 'allow-same-origin'"
            referrerpolicy="no-referrer"
            :title="title"
            @load="!pdf && fitWord()"
          />
          <nav class="document-viewer__tools" aria-label="文件缩放">
            <AppButton
              text
              native-type="button"
              aria-label="缩小文件"
              :disabled="zoom !== 'fit' && zoom <= 25"
              @click="changeZoom(-25)"
            >
              <ElIcon><ZoomOut /></ElIcon>
            </AppButton>
            <span aria-live="polite">{{ zoom === 'fit' ? '适合窗口' : `${zoom}%` }}</span>
            <AppButton
              text
              native-type="button"
              aria-label="放大文件"
              :disabled="zoom !== 'fit' && zoom >= 300"
              @click="changeZoom(25)"
            >
              <ElIcon><ZoomIn /></ElIcon>
            </AppButton>
            <AppButton text native-type="button" aria-label="适合窗口" @click="fit">
              <ElIcon><FullScreen /></ElIcon>
            </AppButton>
          </nav>
        </ElFocusTrap>
      </section>
    </Transition>
  </Teleport>
</template>

<style scoped>
.document-viewer {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: stretch;
  justify-content: center;
  padding: 56px 48px 80px;
  background: var(--wm-canvas, #edf1ef);
}
.document-viewer iframe {
  width: 100%;
  height: 100%;
  border: 0;
  background: var(--wm-muted-surface, #eef1f0);
}
.document-viewer .app-button {
  width: 36px;
  height: 36px;
  min-height: 36px;
  margin: 0;
  padding: 0;
  border-radius: 8px;
  color: var(--wm-text, var(--text));
  font-size: 20px;
}
.document-viewer__close {
  position: absolute;
  right: 22px;
  top: 12px;
}
.document-viewer__tools {
  position: absolute;
  left: 50%;
  bottom: 20px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 12px;
  border: 1px solid var(--wm-border, var(--line));
  border-radius: 12px;
  background: var(--wm-surface, var(--surface));
  box-shadow: 0 4px 18px #243d2e12;
}
.document-viewer__tools > span {
  min-width: 64px;
  text-align: center;
  color: var(--wm-muted, var(--muted));
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.document-viewer-enter-active,
.document-viewer-leave-active {
  transition: opacity 180ms ease;
}
.document-viewer-enter-active .document-viewer__tools,
.document-viewer-leave-active .document-viewer__tools {
  transition: translate 180ms ease;
}
.document-viewer-enter-from,
.document-viewer-leave-to {
  opacity: 0;
}
.document-viewer-enter-from .document-viewer__tools,
.document-viewer-leave-to .document-viewer__tools {
  translate: 0 6px;
}
@media (prefers-reduced-motion: reduce) {
  .document-viewer-enter-active,
  .document-viewer-leave-active,
  .document-viewer-enter-active .document-viewer__tools,
  .document-viewer-leave-active .document-viewer__tools {
    transition: none;
  }
}
</style>
