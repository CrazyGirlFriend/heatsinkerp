<script setup lang="ts">
import AppButton from '@/components/AppButton.vue'
import { avatarPresets } from '@/config/avatars'
import AccountAvatar from './AccountAvatar.vue'

withDefaults(defineProps<{ modelValue: string; name?: string; disabled?: boolean }>(), {
  name: '',
  disabled: false,
})
const emit = defineEmits<{ 'update:modelValue': [string] }>()
</script>

<template>
  <div class="avatar-picker" role="group" aria-label="参考头像">
    <AppButton
      unstyled
      v-for="(item, index) in avatarPresets"
      :key="item.key"
      type="button"
      class="avatar-choice"
      :class="{ 'avatar-choice--selected': modelValue === item.key }"
      :aria-label="`头像 ${index + 1}`"
      :aria-pressed="modelValue === item.key"
      :disabled="disabled"
      @click="emit('update:modelValue', item.key)"
    >
      <AccountAvatar :avatar-key="item.key" :size="40" />
      <span class="avatar-choice__check" aria-hidden="true">✓</span>
    </AppButton>
    <AppButton
      unstyled
      type="button"
      class="avatar-default"
      :aria-pressed="!modelValue"
      :disabled="disabled"
      @click="emit('update:modelValue', '')"
    >
      <AccountAvatar :name="name" :size="24" /> 使用姓名头像
    </AppButton>
  </div>
</template>

<style scoped>
.avatar-picker {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  width: 100%;
}
.avatar-choice {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 56px;
  padding: 8px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--surface);
  cursor: pointer;
  transition:
    border-color var(--motion-fast),
    background var(--motion-fast),
    transform var(--motion-fast);
}
.avatar-choice:not(:disabled):hover,
.avatar-choice--selected {
  border-color: var(--primary);
  background: var(--primary-soft);
}
.avatar-choice:not(:disabled):active {
  transform: scale(0.97);
}
.avatar-choice:focus-visible,
.avatar-default:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
.avatar-choice__check {
  display: none;
  position: absolute;
  right: 5px;
  bottom: 5px;
  width: 17px;
  height: 17px;
  border-radius: 50%;
  background: var(--primary);
  color: #fff;
  font-size: 12px;
  line-height: 17px;
}
.avatar-choice--selected .avatar-choice__check {
  display: block;
}
.avatar-default {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  grid-column: 1 / -1;
  justify-self: start;
  padding: 2px 0;
  border: 0;
  background: transparent;
  color: var(--muted);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
@media (min-width: 600px) {
  .avatar-picker {
    grid-template-columns: repeat(8, minmax(0, 1fr));
  }
}
.avatar-default[aria-pressed='true'] {
  color: var(--primary);
}
.avatar-choice:disabled,
.avatar-default:disabled {
  cursor: default;
  opacity: 0.7;
}
@media (prefers-reduced-motion: reduce) {
  .avatar-choice {
    transition: none;
  }
  .avatar-choice:not(:disabled):active {
    transform: none;
  }
}
</style>
