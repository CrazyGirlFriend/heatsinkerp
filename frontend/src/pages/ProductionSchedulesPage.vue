<script setup lang="ts">
import ScheduleTaskBoard from '@/components/ScheduleTaskBoard.vue'
</script>
<template>
  <section class="page production-schedules-page reading-workspace" aria-label="生产排期">
    <ScheduleTaskBoard />
  </section>
</template>
<style scoped>
.production-schedules-page.reading-workspace {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}
</style>
