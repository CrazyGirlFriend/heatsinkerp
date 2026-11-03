<script setup lang="ts">
import { computed } from 'vue'
import AccountAvatar from './AccountAvatar.vue'

const props = withDefaults(
  defineProps<{ name?: string | null; avatarKey?: string; size?: number }>(),
  {
    name: '',
    avatarKey: '',
    size: 22,
  },
)
const displayName = computed(() => props.name?.trim() || '—')
const hasPerson = computed(
  () => !['—', '-', '未登记', '未记录', '未指定', '待指定', '未选择', '未知'].includes(displayName.value),
)
</script>

<template>
  <span class="person-name" :title="displayName">
    <AccountAvatar v-if="hasPerson" :name="displayName" :avatar-key="avatarKey" :size="size" />
    <span class="person-name__text">{{ displayName }}</span>
  </span>
</template>

<style scoped>
.person-name {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  max-width: 100%;
  vertical-align: middle;
}
.person-name__text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media print {
  .person-name :deep(.account-avatar) {
    display: none;
  }
}
</style>
