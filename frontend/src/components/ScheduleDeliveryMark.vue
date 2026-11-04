<script setup lang="ts">
import { computed } from 'vue'
import { IconCircle, IconCircleCheckFilled, IconExclamationCircleFilled } from '@tabler/icons-vue'

const props = defineProps<{ state: string }>()
const label = computed(
  () =>
    ({
      pending: '待完成',
      completed: '按时完成',
      completed_late: '逾期完成',
      overdue: '逾期未交齐',
      unassessed: '备料转出',
    })[props.state] || '待完成',
)
</script>

<template>
  <span class="delivery-mark" :class="state" role="img" :aria-label="label">
    <IconCircleCheckFilled v-if="state === 'completed' || state === 'completed_late'" :size="18" />
    <IconExclamationCircleFilled v-else-if="state === 'overdue'" :size="18" />
    <IconCircle v-else :size="18" :stroke-width="1.7" />
  </span>
</template>

<style scoped>
.delivery-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  color: var(--wm-muted, #71717a);
  line-height: 1;
}
.completed {
  color: #249466;
}
.completed_late {
  color: #c47a20;
}
.overdue {
  color: #d44945;
}
</style>
