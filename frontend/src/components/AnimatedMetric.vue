<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
const props = withDefaults(
  defineProps<{
    value: number | null
    animate: boolean
    precision: number
    mode?: 'count' | 'roll'
  }>(),
  { mode: 'count' },
)
const displayed = ref(props.value)
const motionPreference = window.matchMedia?.('(prefers-reduced-motion: reduce)')
const reducedMotion = ref(motionPreference?.matches ?? false)
const motionEnabled = computed(() => props.animate && !reducedMotion.value)
const direction = ref('up')
const rolling = ref(false)
const rollDuration = 360
const leavingDigits = new Map<string, () => void>()
let frame = 0
const isNumber = (value: number | null): value is number => value != null && Number.isFinite(value)
const format = (value: number | null) =>
  isNumber(value)
    ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: props.precision }).format(value)
    : '—'
const actual = computed(() => format(props.value))
// Anchor integer places from the right, so unchanged digits remain still across a carry.
const digits = computed(() => {
  const text = format(displayed.value)
  const decimal = text.indexOf('.')
  const integerEnd = decimal < 0 ? text.length : decimal
  return Array.from(text, (character, index) => ({
    character,
    key: index < integerEnd ? `integer-${integerEnd - index}` : `fraction-${index - integerEnd}`,
    numeric: /[0-9]/.test(character),
  }))
})
// Finish superseded leaves immediately; rapid edits must never stack old digits.
function leaveDigit(place: string, numeric: boolean, done: () => void) {
  leavingDigits.get(place)?.()
  if (!numeric || !rolling.value || !motionEnabled.value) {
    done()
    return
  }
  const finish = () => {
    clearTimeout(timer)
    leavingDigits.delete(place)
    done()
  }
  const timer = setTimeout(finish, rollDuration)
  leavingDigits.set(place, finish)
}
function finishRolling() {
  for (const finish of leavingDigits.values()) finish()
}
function stop() {
  if (frame) cancelAnimationFrame(frame)
  frame = 0
}
function updateMotionPreference(event: MediaQueryListEvent) {
  reducedMotion.value = event.matches
}
motionPreference?.addEventListener('change', updateMotionPreference)
watch(
  () => [props.value, motionEnabled.value, props.mode, props.precision] as const,
  ([value, animate, mode]) => {
    stop()
    if (!animate || mode !== 'roll') finishRolling()
    const from = displayed.value
    if (mode === 'roll') {
      rolling.value = animate && isNumber(from) && isNumber(value)
      direction.value = isNumber(from) && isNumber(value) && value < from ? 'down' : 'up'
      displayed.value = value
      return
    }
    if (!animate || from === value || !isNumber(from) || !isNumber(value)) {
      displayed.value = value
      return
    }
    const start = performance.now()
    const step = (now: number) => {
      const progress = Math.min(1, Math.max(0, (now - start) / 700))
      displayed.value = progress === 1 ? value : from + (value - from) * (1 - (1 - progress) ** 3)
      frame = progress < 1 ? requestAnimationFrame(step) : 0
    }
    frame = requestAnimationFrame(step)
  },
)
onBeforeUnmount(() => {
  stop()
  finishRolling()
  motionPreference?.removeEventListener('change', updateMotionPreference)
})
</script>
<template>
  <span
    class="animated-metric"
    :aria-label="actual"
    :style="{ '--metric-roll-duration': `${rollDuration}ms` }"
  >
    <span
      v-if="mode === 'roll'"
      :key="motionEnabled ? 'motion' : 'static'"
      class="metric-digits"
      aria-hidden="true"
      ><span
        v-for="digit in digits"
        :key="digit.key"
        class="metric-place"
        :class="{ 'metric-place--numeric': digit.numeric }"
        :data-place="digit.key"
        ><Transition
          :name="`metric-roll-${direction}`"
          :css="digit.numeric && rolling && motionEnabled"
          @leave="(_element, done) => leaveDigit(digit.key, digit.numeric, done)"
        >
          <span :key="digit.character" class="metric-character">{{ digit.character }}</span>
        </Transition></span
      ></span
    >
    <span v-else aria-hidden="true">{{ format(displayed) }}</span>
  </span>
</template>
<style scoped>
.animated-metric {
  font-variant-numeric: tabular-nums;
}
.metric-digits {
  display: inline-flex;
  vertical-align: bottom;
}
.metric-place {
  display: inline-block;
  position: relative;
  overflow: hidden;
  line-height: 1.3;
}
.metric-place--numeric {
  width: 1ch;
  text-align: center;
}
.metric-character {
  display: block;
}
.metric-roll-up-enter-active,
.metric-roll-down-enter-active,
.metric-roll-up-leave-active,
.metric-roll-down-leave-active {
  transition:
    transform var(--metric-roll-duration) cubic-bezier(0.22, 1, 0.36, 1),
    opacity 240ms ease;
}
.metric-roll-up-leave-active,
.metric-roll-down-leave-active {
  position: absolute;
  inset: 0;
}
.metric-roll-up-enter-from,
.metric-roll-down-leave-to {
  transform: translateY(85%);
  opacity: 0;
}
.metric-roll-down-enter-from,
.metric-roll-up-leave-to {
  transform: translateY(-85%);
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .metric-character {
    transition: none !important;
    transform: none !important;
  }
}
</style>
