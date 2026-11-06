<script setup lang="ts">
import StatisticHelp from './StatisticHelp.vue'
defineProps<{ title: string; subtitle?: string; help?: string }>()
</script>
<template>
  <article class="dashboard-card" :aria-label="title">
    <header class="dashboard-card__header">
      <div>
        <div class="dashboard-card__title">
          <h2>{{ title }}</h2>
          <StatisticHelp v-if="help" :label="`${title}统计说明`">{{ help }}</StatisticHelp>
        </div>
        <p v-if="subtitle">{{ subtitle }}</p>
      </div>
      <slot name="actions" />
    </header>
    <div class="dashboard-card__body"><slot /></div>
    <footer v-if="$slots.footer" class="dashboard-card__footer"><slot name="footer" /></footer>
  </article>
</template>
<style scoped>
.dashboard-card {
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--wm-bg);
  border: 1px solid var(--wm-border);
  border-radius: 14px;
  overflow: hidden;
}
.dashboard-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 20px 10px;
}
.dashboard-card__title {
  display: flex;
  align-items: center;
  gap: 4px;
}
.dashboard-card h2 {
  margin: 0;
  color: var(--wm-text);
  font-size: 15px;
  font-weight: 600;
}
.dashboard-card p {
  margin: 5px 0 0;
  font-size: 12px;
  color: var(--wm-muted);
}
.dashboard-card__body {
  flex: 1;
  min-height: 0;
  padding: 0 20px 16px;
}
.dashboard-card__footer {
  padding: 12px 20px;
  border-top: 1px solid var(--wm-border);
}
</style>
