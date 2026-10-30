<script setup lang="ts">
import ScheduleTaskBoard from '@/components/ScheduleTaskBoard.vue'
import PageBackButton from '@/components/PageBackButton.vue'
</script>
<template>
  <section class="page reading-workspace dispatch-workspace">
    <ScheduleTaskBoard management
      ><template #heading
        ><header class="page-heading-start">
          <PageBackButton />
          <h1>调度工作台</h1>
        </header></template
      ></ScheduleTaskBoard
    >
  </section>
</template>
<style scoped>
.dispatch-workspace {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}
.dispatch-workspace h1 {
  margin: 0;
  font-size: 18px;
  line-height: 28px;
}
</style>
