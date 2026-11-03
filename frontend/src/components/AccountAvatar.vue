<script setup lang="ts">
import { computed } from 'vue'
import { avatarPresets } from '@/config/avatars'

const props = withDefaults(defineProps<{ avatarKey?: string; name?: string; size?: number }>(), {
  avatarKey: '',
  name: '',
  size: 36,
})
const index = computed(() => avatarPresets.findIndex((item) => item.key === props.avatarKey))
const portrait = computed(() => avatarPresets[index.value])
const initial = computed(() => Array.from(props.name.trim())[0] || '人')
const nameColors = [
  ['#e5eee8', '#315f47'],
  ['#e5edf5', '#3b5e7d'],
  ['#eee7f2', '#705480'],
  ['#f4eadc', '#806136'],
  ['#e2efed', '#386c67'],
  ['#f3e6e9', '#86566a'],
] as const
const nameColor = computed(() => {
  const hash = Array.from(props.name.trim()).reduce(
    (value, char) => (value * 31 + char.codePointAt(0)!) >>> 0,
    0,
  )
  return nameColors[hash % nameColors.length]!
})
const hairStyle = computed(() => (index.value < 8 ? index.value % 3 : 3 + ((index.value - 8) % 4)))
const glasses = computed(() => [2, 6, 10, 14].includes(index.value))
</script>

<template>
  <span
    class="account-avatar"
    :style="{
      width: `${size}px`,
      height: `${size}px`,
      fontSize: `${Math.round(size * 0.46)}px`,
      background: nameColor[0],
      color: nameColor[1],
    }"
    aria-hidden="true"
  >
    <svg v-if="portrait" viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg">
      <rect width="80" height="80" :fill="portrait.background" />
      <path
        v-if="hairStyle === 1 || hairStyle === 4"
        d="M22 47V29c0-24 36-25 36 0v25H22Z"
        :fill="portrait.hair"
      />
      <circle v-if="hairStyle === 5" cx="40" cy="12" r="10" :fill="portrait.hair" />
      <path d="M10 80v-9c0-17 16-21 30-21s30 4 30 21v9Z" :fill="portrait.shirt" />
      <path d="M33 45h14v12c-4 5-10 5-14 0Z" :fill="portrait.skin" />
      <ellipse cx="40" cy="31" rx="16" ry="21" :fill="portrait.skin" />
      <path
        v-if="hairStyle === 1"
        d="M23 33V24C23 4 57 2 57 26v6c-6-2-13-12-15-17-3 9-11 14-19 18Z"
        :fill="portrait.hair"
      />
      <path
        v-else-if="hairStyle === 2"
        d="M23 29V19C23 4 57 4 57 19v12l-5-11c-8 2-18 2-25-1Z"
        :fill="portrait.hair"
      />
      <path
        v-else-if="hairStyle === 3"
        d="M23 29V21c-5-4-2-10 3-10-1-7 8-9 12-5 4-6 13-3 13 2 9-1 13 10 6 14v9l-5-10c-8 3-17 3-24 0Z"
        :fill="portrait.hair"
      />
      <path
        v-else-if="hairStyle === 4"
        d="M22 34V22C22 3 58 3 58 22v13l-6-11-2-7-5 7-17-1-2 11Z"
        :fill="portrait.hair"
      />
      <path
        v-else-if="hairStyle === 5"
        d="M23 31V23C23 4 57 4 57 23v8l-5-9c-5 0-10-5-12-9-3 5-8 9-13 9Z"
        :fill="portrait.hair"
      />
      <path
        v-else-if="hairStyle === 6"
        d="M23 30V21C23 6 56 4 57 21v10l-5-10c-6-3-11-3-17-1l-8 3Z"
        :fill="portrait.hair"
      />
      <path
        v-else
        d="M23 29V22C20 9 31 4 43 7c17-2 19 8 13 24l-5-11c-8 7-19 2-24 5v5Z"
        :fill="portrait.hair"
      />
      <g fill="none" stroke="#493a30" stroke-linecap="round" stroke-width="1.5">
        <path d="M32 32h1m14 0h1M37 43q3 2 6 0" />
        <g v-if="glasses">
          <rect x="27" y="27" width="11" height="10" rx="3" />
          <rect x="42" y="27" width="11" height="10" rx="3" />
          <path d="M38 31h4" />
        </g>
      </g>
      <path d="m28 53 12 9 12-9-5 16H33Z" fill="#fff" opacity=".75" />
    </svg>
    <span v-else class="account-avatar__initial" :data-initial="initial" />
  </span>
</template>

<style scoped>
.account-avatar {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 50%;
  background: #e6eee8;
  color: #397956;
  vertical-align: middle;
}
.account-avatar svg {
  width: 100%;
  height: 100%;
}
.account-avatar__initial {
  font-size: 1em;
  font-weight: 600;
}
.account-avatar__initial::before {
  content: attr(data-initial);
}
</style>
