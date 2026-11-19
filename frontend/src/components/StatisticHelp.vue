<script setup lang="ts">
import AppButton from '@/components/AppButton.vue'
import AppPopover from '@/components/AppPopover.vue'
import { ref } from 'vue'
import { ElIcon } from 'element-plus'
import { QuestionFilled } from '@element-plus/icons-vue'
defineProps<{ label: string }>()
const popover = ref<InstanceType<typeof AppPopover>>()
</script>
<template>
  <AppPopover
    ref="popover"
    trigger="click"
    :trigger-keys="[]"
    placement="bottom-start"
    :width="300"
  >
    <template #reference>
      <AppButton
        size="small"
        text
        class="statistic-help"
        :aria-label="label"
        @keydown.esc.stop="popover?.hide()"
      >
        <ElIcon><QuestionFilled /></ElIcon>
      </AppButton>
    </template>
    <div class="statistic-help-content"><slot /></div>
  </AppPopover>
</template>
<style scoped>
.statistic-help-content {
  color: var(--text);
  font-size: var(--font-size-label);
  line-height: 1.7;
}
</style>
