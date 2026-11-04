<script setup lang="ts">
// Vue adaptation of Watermelon Filter Disclosure. See NOTICE.md.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, type Component } from 'vue'
import { AnimatePresence, motion, useReducedMotion } from 'motion-v'
import { IconAdjustmentsHorizontal, IconCheck, IconChevronDown, IconX } from '@tabler/icons-vue'

const props = withDefaults(
  defineProps<{
    label?: string
    title?: string
    viewSwitch?: boolean
    options: ReadonlyArray<{
      value: string
      label: string
      icon?: Component
      color?: string
      disabled?: boolean
      count?: number | null
    }>
  }>(),
  { label: '筛选', title: '筛选条件' },
)
const value = defineModel<string>({ default: '' })
const emit = defineEmits<{ change: [value: string] }>()
const open = ref(false)
const trigger = ref<HTMLButtonElement>()
const menu = ref<HTMLElement>()
const teleportTarget = ref<HTMLElement | string>('body')
const position = ref({ left: 12, top: 12 })
const id = useId()
const reduced = useReducedMotion()
const spring = computed(() =>
  reduced.value ? { duration: 0 } : { type: 'spring' as const, stiffness: 360, damping: 30 },
)
const selected = computed(() => props.options.find((option) => option.value === value.value))
let closeTimer: ReturnType<typeof setTimeout> | undefined

function placePanel() {
  if (!open.value || !trigger.value || !menu.value) return
  const panel = menu.value.closest<HTMLElement>('.wm-filter-panel')!
  const rect = trigger.value.getBoundingClientRect()
  const width = panel.offsetWidth
  const height = panel.offsetHeight
  const below = rect.bottom + 8
  const above = rect.top - height - 8
  position.value = {
    left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
    top: Math.max(
      12,
      Math.min(
        below + height > window.innerHeight - 12 && above >= 12 ? above : below,
        window.innerHeight - height - 12,
      ),
    ),
  }
}
function enabledButtons() {
  return [
    ...(menu.value?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]:not(:disabled)') ||
      []),
  ]
}
async function show() {
  clearTimeout(closeTimer)
  teleportTarget.value = trigger.value?.closest('dialog') || 'body'
  open.value = true
  await nextTick()
  if (!open.value) return
  placePanel()
  const buttons = enabledButtons()
  ;(
    buttons.find((button) => button.getAttribute('aria-checked') === 'true') ||
    buttons[0] ||
    menu.value
  )?.focus()
}
function close(restore = true) {
  clearTimeout(closeTimer)
  open.value = false
  if (restore) trigger.value?.focus()
}
function choose(option: (typeof props.options)[number]) {
  if (option.disabled) return
  if (value.value !== option.value) {
    value.value = option.value
    emit('change', option.value)
  }
  clearTimeout(closeTimer)
  closeTimer = setTimeout(() => close(), reduced.value ? 0 : 180)
}
function outside(event: PointerEvent) {
  const target = event.target as Node
  if (open.value && !menu.value?.contains(target) && !trigger.value?.contains(target)) close(false)
}
function keyboard(event: KeyboardEvent) {
  if (!open.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
    return
  }
  if (!menu.value?.contains(event.target as Node)) return
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault()
    const buttons = enabledButtons()
    if (!buttons.length) return
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const index =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
    buttons[index]?.focus()
  }
}
function focusOut(event: FocusEvent) {
  const target = event.relatedTarget as Node | null
  if (target && !menu.value?.contains(target) && !trigger.value?.contains(target)) close(false)
}
onMounted(() => {
  document.addEventListener('pointerdown', outside)
  document.addEventListener('keydown', keyboard)
  window.addEventListener('resize', placePanel)
  window.addEventListener('scroll', placePanel, true)
})
onBeforeUnmount(() => {
  clearTimeout(closeTimer)
  document.removeEventListener('pointerdown', outside)
  document.removeEventListener('keydown', keyboard)
  window.removeEventListener('resize', placePanel)
  window.removeEventListener('scroll', placePanel, true)
})
</script>

<template>
  <button
    ref="trigger"
    type="button"
    class="wm-filter-trigger"
    :class="{ active: !!value && !viewSwitch, 'wm-view-switch': viewSwitch }"
    :aria-current="viewSwitch ? 'page' : undefined"
    aria-haspopup="menu"
    :aria-controls="`${id}-filter`"
    :aria-expanded="open"
    @click="open ? close() : show()"
    @keydown.down.prevent="show()"
  >
    <IconAdjustmentsHorizontal v-if="!viewSwitch" :size="17" />{{
      value && selected ? selected.label : label
    }}
    <span v-if="viewSwitch && selected?.count" class="wm-view-count">{{ selected.count }}</span>
    <IconChevronDown v-if="viewSwitch" :size="16" :class="{ 'is-open': open }" />
    <span v-else-if="value" class="wm-active-dot" />
  </button>
  <Teleport :to="teleportTarget">
    <AnimatePresence>
      <motion.div
        v-if="open"
        :key="id"
        class="wm-filter-panel"
        :style="{ left: `${position.left}px`, top: `${position.top}px` }"
        :initial="{ opacity: 0, scale: reduced ? 1 : 0.92, y: reduced ? 0 : -8 }"
        :animate="{ opacity: 1, scale: 1, y: 0 }"
        :exit="{ opacity: 0, scale: reduced ? 1 : 0.96, y: reduced ? 0 : -4 }"
        :transition="spring"
      >
        <div
          :id="`${id}-filter`"
          ref="menu"
          role="menu"
          :aria-label="title"
          tabindex="-1"
          @focusout="focusOut"
        >
          <header v-if="!viewSwitch">
            <span>{{ title }}</span>
            <button type="button" :aria-label="`关闭${label}`" @click="close()">
              <IconX :size="16" />
            </button>
          </header>
          <motion.button
            v-for="(option, index) in options"
            :key="option.value"
            type="button"
            role="menuitemradio"
            tabindex="-1"
            :aria-checked="value === option.value"
            :disabled="option.disabled"
            :class="{ selected: value === option.value }"
            :initial="{ opacity: 0, y: reduced ? 0 : 10 }"
            :animate="{ opacity: 1, y: 0 }"
            :transition="{ ...spring, delay: reduced ? 0 : index * 0.025 }"
            :while-press="{ scale: reduced || option.disabled ? 1 : 0.98 }"
            @click="choose(option)"
          >
            <component
              :is="option.icon"
              v-if="option.icon"
              :size="20"
              :style="{ color: option.color }"
            />
            <span>{{ option.label }}</span>
            <span v-if="option.count" class="wm-view-count">{{ option.count }}</span>
            <motion.span
              v-if="value === option.value"
              :layout-id="`${id}-check`"
              class="wm-filter-check"
              :transition="spring"
              ><IconCheck :size="13" stroke="3"
            /></motion.span>
          </motion.button>
        </div>
      </motion.div>
    </AnimatePresence>
  </Teleport>
</template>

<style>
.wm-filter-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  gap: 7px;
  height: 36px;
  padding: 0 12px;
  border: 1px solid var(--wm-border, #e1e4e8);
  background: var(--wm-surface, #fff);
  border-radius: 8px;
  color: var(--wm-text, #4e5660);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  transition:
    background 180ms,
    box-shadow 180ms;
}
.wm-filter-trigger:hover {
  background: var(--wm-hover, #f7f8fa);
}
.wm-filter-trigger.wm-view-switch {
  padding: 0 8px;
  border-color: transparent;
  background: transparent;
  font-size: 15px;
  font-weight: 500;
}
.wm-filter-trigger.wm-view-switch:hover {
  background: var(--wm-hover);
}
.wm-view-switch > svg {
  transition: transform 180ms;
}
.wm-view-switch > svg.is-open {
  transform: rotate(180deg);
}
.wm-view-count {
  padding: 0 6px;
  border-radius: 6px;
  background: var(--wm-muted-surface);
  font-size: 12px;
  line-height: 20px;
  font-variant-numeric: tabular-nums;
}
@media (prefers-reduced-motion: reduce) {
  .wm-view-switch > svg {
    transition: none;
  }
}
.wm-filter-trigger.active {
  border-color: var(--wm-success-text, #b9d8cd);
  color: var(--wm-success-text, #247960);
  background: var(--wm-success-bg, #f3faf7);
}
.wm-active-dot {
  width: 5px;
  height: 5px;
  background: currentColor;
  border-radius: 50%;
}
.wm-filter-panel {
  position: fixed;
  z-index: 2600;
  box-sizing: border-box;
  width: 264px;
  max-width: calc(100vw - 24px);
  max-height: calc(100dvh - 24px);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 8px;
  border: 1px solid var(--wm-border, #e5e5e9);
  border-radius: 12px;
  background: var(--wm-surface, #fefefe);
  color: var(--wm-text, #24282e);
  box-shadow:
    0 12px 40px #1e27341c,
    0 2px 8px #1e273408;
  transform-origin: top left;
}
.wm-filter-panel header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 10px 10px;
  color: var(--wm-muted, #91959d);
  font-size: 11px;
}
.wm-filter-panel header button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 3px;
  border: 0;
  background: transparent;
  color: var(--wm-muted, #9298a1);
  cursor: pointer;
}
.wm-filter-panel [role='menuitemradio'] {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 42px;
  padding: 8px 12px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  font: inherit;
  font-size: 14px;
  color: var(--wm-text, #535257);
  text-align: left;
  cursor: pointer;
}
.wm-filter-panel [role='menuitemradio']:hover:not(:disabled),
.wm-filter-panel [role='menuitemradio']:focus-visible {
  background: var(--wm-hover, #f3f4f5);
}
.wm-filter-panel [role='menuitemradio'].selected {
  background: var(--wm-success-bg, #f1f7f3);
  color: var(--wm-success-text, #253e31);
}
.wm-filter-panel [role='menuitemradio']:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.wm-filter-check {
  margin-left: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--wm-success-text, #31b971);
  color: var(--wm-success-bg, white);
}
.wm-filter-trigger:focus-visible,
.wm-filter-panel button:focus-visible {
  outline: 2px solid var(--wm-primary, #437fba);
  outline-offset: 2px;
}
</style>
