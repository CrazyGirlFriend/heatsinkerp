<script setup lang="ts">
import { ElSkeleton } from 'element-plus'
withDefaults(
  defineProps<{ rows?: number; columns?: number; label?: string; loading?: boolean }>(),
  { rows: 5, columns: 4, label: '正在加载', loading: true },
)
</script>
<template>
  <ElSkeleton
    class="wm-skeleton"
    role="status"
    :aria-label="label"
    :aria-busy="loading"
    :loading="loading"
    :rows="rows"
    animated
  >
    <template #template>
      <slot name="template">
        <div
          v-for="row in rows"
          :key="row"
          class="wm-skeleton-row"
          :style="{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }"
        >
          <span v-for="column in columns" :key="column" class="wm-skeleton-cell" />
        </div>
      </slot>
    </template>
    <slot />
  </ElSkeleton>
</template>
