<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElButton, ElOption, ElSelect } from 'element-plus'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import { useTeamDirectoryStore } from '@/stores/teamDirectory'
import type { TeamDirectoryItem } from '@/types/teamBusiness'
defineProps<{ modelValue?: number }>()
const emit = defineEmits<{ 'update:modelValue': [value: number | undefined] }>()
const directory = useTeamDirectoryStore()
const team = computed(() => directory.items.find((item) => item.code === 'FACTORY-QC'))
const choices = ref<TeamDirectoryItem[]>([])
const loading = ref(false)
const error = ref('')
let generation = 0
async function load() {
  const token = ++generation
  choices.value = []
  error.value = ''
  loading.value = false
  if (!team.value) return
  loading.value = true
  try {
    const result = await teamMaterialApi.inspectionProblems(Number(team.value.id))
    if (token === generation) choices.value = result
  } catch (e) {
    if (token === generation) error.value = e instanceof Error ? e.message : '检验问题读取失败'
  } finally {
    if (token === generation) loading.value = false
  }
}
watch(team, load, { immediate: true })
onBeforeUnmount(() => {
  ++generation
})
</script>
<template>
  <div>
    <ElSelect
      :model-value="modelValue"
      aria-label="检验问题筛选"
      placeholder="全部问题"
      clearable
      filterable
      :loading="loading"
      @update:model-value="emit('update:modelValue', $event || undefined)"
    >
      <ElOption
        v-for="item in choices"
        :key="item.id"
        :value="item.id"
        :label="`${item.name}${item.active ? '' : '（已停用）'}`"
      />
    </ElSelect>
    <div v-if="error" class="inspection-filter-error">
      <span>{{ error }}</span
      ><ElButton link type="primary" @click="load">重试</ElButton>
    </div>
  </div>
</template>
<style scoped>
.inspection-filter-error {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--muted);
  font-size: 13px;
}
</style>
