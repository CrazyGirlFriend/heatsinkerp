<script setup lang="ts">
// Watermelon Edit Profile: rounded inset body, muted shell and spring entrance. See NOTICE.md.
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { motion, useReducedMotion } from 'motion-v'
import { IconX } from '@tabler/icons-vue'

defineOptions({ inheritAttrs: false })
const props = withDefaults(
  defineProps<{
    title: string
    width?: string
    closeOnClickModal?: boolean
    closeOnPressEscape?: boolean
    showClose?: boolean
  }>(),
  { width: 'min(760px, 94vw)', closeOnClickModal: true, closeOnPressEscape: true, showClose: true },
)
const open = defineModel<boolean>({ default: false })
const dialog = ref<HTMLDialogElement>()
const rendered = ref(false)
const visible = ref(false)
const reduced = useReducedMotion()
const id = useId()
let returnFocus: HTMLElement | null = null
let closeTimer: ReturnType<typeof setTimeout> | undefined
let unmounted = false
function close() {
  dialog.value?.close()
  rendered.value = false
  if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true })
  returnFocus = null
}
watch(
  open,
  async (value) => {
    clearTimeout(closeTimer)
    if (value) {
      if (!dialog.value?.open)
        returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
      rendered.value = true
      await nextTick()
      if (unmounted || !open.value || !dialog.value) return
      if (!dialog.value.open) dialog.value.showModal()
      visible.value = true
    } else {
      visible.value = false
      if (dialog.value?.open) closeTimer = setTimeout(close, reduced.value ? 0 : 160)
    }
  },
  { flush: 'post', immediate: true },
)
function cancel(event: Event) {
  event.preventDefault()
  if (props.closeOnPressEscape) open.value = false
}
function backdrop(event: MouseEvent) {
  if (event.target === dialog.value && props.closeOnClickModal) open.value = false
}
onBeforeUnmount(() => {
  unmounted = true
  clearTimeout(closeTimer)
  close()
})
</script>

<template>
  <Teleport to="body">
    <dialog
      ref="dialog"
      v-bind="$attrs"
      class="wm-dialog"
      :aria-labelledby="`${id}-title`"
      @cancel="cancel"
      @click="backdrop"
    >
      <motion.div
        v-if="rendered"
        class="wm-dialog-backdrop"
        aria-hidden="true"
        :initial="{ opacity: 0 }"
        :animate="{ opacity: visible ? 1 : 0 }"
        :transition="{ duration: reduced ? 0 : visible ? 0.3 : 0.15 }"
      />
      <motion.div
        v-if="rendered"
        class="wm-dialog-card"
        :style="{ width }"
        :initial="{ opacity: 0, scale: reduced ? 1 : 0.9, y: reduced ? 0 : 20 }"
        :animate="{
          opacity: visible ? 1 : 0,
          scale: visible || reduced ? 1 : 0.96,
          y: visible || reduced ? 0 : 12,
        }"
        :transition="
          reduced
            ? { duration: 0 }
            : visible
              ? { type: 'spring', damping: 20, stiffness: 300, mass: 0.8 }
              : { duration: 0.15 }
        "
      >
        <header class="wm-dialog-header">
          <div :id="`${id}-title`">
            <slot name="header"
              ><h2>{{ title }}</h2></slot
            >
          </div>
          <button v-if="showClose" type="button" aria-label="关闭弹窗" @click="open = false">
            <IconX :size="20" />
          </button>
        </header>
        <div class="wm-dialog-body"><slot /></div>
        <footer v-if="$slots.footer" class="wm-dialog-footer"><slot name="footer" /></footer>
      </motion.div>
    </dialog>
  </Teleport>
</template>

<style>
.wm-dialog {
  position: fixed;
  inset: 0;
  width: 100vw;
  max-width: none;
  height: 100dvh;
  max-height: none;
  margin: 0;
  padding: 24px;
  border: 0;
  background: transparent;
  overflow: auto;
  color: var(--wm-text, #141414);
}
.wm-dialog[open] {
  display: flex;
  align-items: center;
  justify-content: center;
}
.wm-dialog::backdrop {
  background: transparent;
}
.wm-dialog-backdrop {
  position: fixed;
  inset: 0;
  background: #0003;
  backdrop-filter: blur(1px);
  pointer-events: none;
}
.wm-dialog-card {
  position: relative;
  display: flex;
  flex-direction: column;
  max-height: calc(100dvh - 48px);
  min-height: 0;
  border: 1px solid var(--wm-border, #eae9ee);
  border-radius: 24px;
  background: var(--wm-muted-surface, #f5f5f7);
  box-shadow: 0 16px 50px #0000001c;
  overflow: hidden;
}
.wm-dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 17px 24px;
}
.wm-dialog-header h2,
.wm-dialog-header .el-dialog__title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  color: var(--wm-text, #111);
}
.wm-dialog-header button {
  display: grid;
  place-items: center;
  flex: 0 0 28px;
  height: 28px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--wm-muted, #888);
  cursor: pointer;
  border-radius: 50%;
}
.wm-dialog-header button:hover {
  background: var(--wm-hover, #e7e7eb);
  color: var(--wm-text, #111);
}
.wm-dialog-body {
  padding: 22px;
  overflow: auto;
  min-height: 0;
  border-block: 1px solid var(--wm-border, #eae9f2);
  border-radius: 18px;
  background: var(--wm-bg, #fff);
}
.wm-dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 16px 24px;
}
.wm-dialog :focus-visible {
  outline: 2px solid var(--wm-primary, #328369);
  outline-offset: 3px;
}
@media (prefers-color-scheme: dark) {
  .wm-dialog-backdrop {
    background: #0009;
  }
  .wm-dialog-card {
    box-shadow: 0 24px 64px #0008;
  }
}
@media (max-width: 600px) {
  .wm-dialog {
    padding: 12px;
  }
  .wm-dialog-body {
    padding: 16px;
  }
  .wm-dialog-card {
    max-height: calc(100dvh - 24px);
  }
}
</style>
