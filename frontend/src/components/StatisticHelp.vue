<script setup lang="ts">
import { ref } from 'vue'
import { ElIcon, ElPopover } from 'element-plus'
import { QuestionFilled } from '@element-plus/icons-vue'
defineProps<{ label: string }>()
const popover = ref<InstanceType<typeof ElPopover>>()
</script>
<template>
  <ElPopover ref="popover" trigger="click" :trigger-keys="[]" placement="bottom-start" :width="300">
    <template #reference>
      <button
        type="button"
        class="statistic-help"
        :aria-label="label"
        @keydown.esc.stop="popover?.hide()"
      >
        <ElIcon><QuestionFilled /></ElIcon>
      </button>
    </template>
    <div class="statistic-help-content"><slot /></div>
  </ElPopover>
</template>
<style scoped>
.statistic-help {
  display: inline-grid;
  place-items: center;
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  color: var(--muted);
  background: transparent;
  font-size: 14px;
}
.statistic-help:hover,
.statistic-help:focus-visible {
  color: var(--primary);
  background: var(--primary-soft);
}
.statistic-help-content {
  color: var(--text);
  font-size: 13px;
  line-height: 1.7;
}
</style>
