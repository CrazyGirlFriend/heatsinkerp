<script setup lang="ts">
import PageBackButton from '@/components/PageBackButton.vue'
import TeamQualityFeedback from '@/components/TeamQualityFeedback.vue'
</script>

<template>
  <section class="page reading-workspace quality-management-page">
    <header class="page-heading-start">
      <PageBackButton />
      <h1>质量管理</h1>
    </header>
    <TeamQualityFeedback show-all />
  </section>
</template>

<style scoped>
.quality-management-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
  min-height: 0;
}
.quality-management-page h1 {
  margin: 0;
  font-size: var(--workspace-heading-size);
  line-height: 28px;
}
</style>
