<script setup lang="ts">
import PersonName from './PersonName.vue'

defineProps<{
  people?: { id: number; name?: string | null }[]
  fallback?: string | null
}>()
</script>

<template>
  <span class="processing-people">
    <template v-if="people?.length">
      <PersonName v-for="person in people" :key="person.id" :name="person.name || '未登记'" />
    </template>
    <PersonName v-else :name="fallback || '未登记'" />
  </span>
</template>

<style scoped>
.processing-people {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 12px;
}
</style>
