<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { ElButton } from 'element-plus'
import { FullScreen, ScaleToOriginal } from '@element-plus/icons-vue'
import PageBackButton from '@/components/PageBackButton.vue'
import ScheduleTaskBoard from '@/components/ScheduleTaskBoard.vue'
const fullscreen = ref(false)
function escape(event: KeyboardEvent) {
  if (event.key === 'Escape' && !event.defaultPrevented) fullscreen.value = false
}
onMounted(() => document.addEventListener('keydown', escape))
onBeforeUnmount(() => document.removeEventListener('keydown', escape))
</script>
<template>
  <section
    class="page production-schedules-page reading-workspace"
    :class="{ 'production-schedules-page--fullscreen': fullscreen }"
  >
    <header class="production-schedules-heading">
      <div class="page-heading-start">
        <PageBackButton v-if="!fullscreen" />
        <div>
          <h1>生产排期</h1>
          <p v-if="!fullscreen">全局交货安排与班组进度</p>
        </div>
      </div>
      <ElButton
        :icon="fullscreen ? ScaleToOriginal : FullScreen"
        :aria-pressed="fullscreen"
        @click="fullscreen = !fullscreen"
        >{{ fullscreen ? '退出全屏' : '全屏查看' }}</ElButton
      >
    </header>
    <ScheduleTaskBoard :fullscreen="fullscreen" />
  </section>
</template>
<style scoped>
.production-schedules-page.reading-workspace {
  display: flex;
  flex-direction: column;
  gap: 20px;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}
.production-schedules-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  flex-shrink: 0;
}
.production-schedules-heading h1 {
  margin: 0;
}
.production-schedules-heading p {
  margin: 5px 0 0;
  color: var(--muted);
  font-size: 13px;
}
.production-schedules-page.reading-workspace.production-schedules-page--fullscreen {
  position: fixed;
  inset: 0;
  z-index: 1000;
  padding: 16px 22px;
  height: 100dvh;
  background: var(--surface);
  scrollbar-gutter: auto;
  border-radius: 0;
}
.production-schedules-page--fullscreen .production-schedules-heading h1 {
  font-size: 18px;
}
</style>
