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
</script>

<template>
  <span
    class="account-avatar"
    :style="{ width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.38)}px` }"
    aria-hidden="true"
  >
    <svg v-if="portrait" viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg">
      <rect width="80" height="80" :fill="portrait.background" />
      <path v-if="index % 3 === 1" d="M22 47V29c0-24 36-25 36 0v25H22Z" :fill="portrait.hair" />
      <path d="M10 80v-9c0-17 16-21 30-21s30 4 30 21v9Z" :fill="portrait.shirt" />
      <path d="M33 45h14v12c-4 5-10 5-14 0Z" :fill="portrait.skin" />
      <ellipse cx="40" cy="31" rx="16" ry="21" :fill="portrait.skin" />
      <path
        v-if="index % 3 === 1"
        d="M23 33V24C23 4 57 2 57 26v6c-6-2-13-12-15-17-3 9-11 14-19 18Z"
        :fill="portrait.hair"
      />
      <path
        v-else-if="index % 3 === 2"
        d="M23 29V19C23 4 57 4 57 19v12l-5-11c-8 2-18 2-25-1Z"
        :fill="portrait.hair"
      />
      <path
        v-else
        d="M23 29V22C20 9 31 4 43 7c17-2 19 8 13 24l-5-11c-8 7-19 2-24 5v5Z"
        :fill="portrait.hair"
      />
      <g fill="none" stroke="#493a30" stroke-linecap="round" stroke-width="1.5">
        <path d="M32 32h1m14 0h1M37 43q3 2 6 0" />
        <g v-if="index === 2 || index === 6">
          <rect x="27" y="27" width="11" height="10" rx="3" />
          <rect x="42" y="27" width="11" height="10" rx="3" />
          <path d="M38 31h4" />
        </g>
      </g>
      <path d="m28 53 12 9 12-9-5 16H33Z" fill="#fff" opacity=".75" />
    </svg>
    <span v-else class="account-avatar__initial">{{ initial }}</span>
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
</style>
