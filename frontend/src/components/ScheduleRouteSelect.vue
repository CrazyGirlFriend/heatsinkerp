<script setup lang="ts">
import ElSelect from '@/components/AppSelect.vue'
import { ElOption } from 'element-plus'
import { formatDateTime } from '@/utils/format'

interface RouteChoice {
  id: number
  serial_nos?: string[]
  version: number
  published_at?: string | null
}
withDefaults(
  defineProps<{
    options: RouteChoice[]
    loading?: boolean
    disabled?: boolean
    label?: string
  }>(),
  { loading: false, disabled: false, label: '关联工艺' },
)
const selected = defineModel<number>()
const emit = defineEmits<{ change: [id: number] }>()
const serialLabel = (route: RouteChoice) => route.serial_nos?.join(' / ') || `工艺 #${route.id}`
</script>

<template>
  <ElSelect
    v-model="selected"
    :aria-label="label"
    :aria-busy="loading"
    filterable
    :loading="loading"
    :disabled="disabled || loading || !options.length"
    :placeholder="loading ? '加载工艺…' : options.length ? '搜索工艺流水号' : '暂无可用工艺'"
    @change="emit('change', $event)"
  >
    <ElOption
      v-for="route in options"
      :key="route.id"
      :value="route.id"
      :label="serialLabel(route)"
    >
      <div class="schedule-route-option">
        <span>{{ serialLabel(route) }}</span>
        <small>
          v{{ route.version }}
          <template v-if="route.published_at"> · {{ formatDateTime(route.published_at) }}</template>
        </small>
      </div>
    </ElOption>
  </ElSelect>
</template>

<style scoped>
.schedule-route-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.schedule-route-option > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.schedule-route-option > small {
  flex-shrink: 0;
  color: var(--muted);
  font-size: 12px;
  font-weight: 400;
}
</style>
