<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElButton } from 'element-plus'
import ProcessingPersonInput from './ProcessingPersonInput.vue'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import type { TeamEmployee } from '@/types/teamBusiness'

const props = defineProps<{ teamId: number; disabled?: boolean; invalid?: boolean }>()
const person = defineModel<TeamEmployee | null>({ required: true })
const emit = defineEmits<{ openChange: [boolean] }>()
const employees = ref<TeamEmployee[]>([])
const loading = ref(false)
const error = ref('')
let request = 0
const name = computed({
  get: () => person.value?.name || '',
  set: (value: string) => {
    person.value = employees.value.find((item) => item.name === value) || null
  },
})
async function load() {
  const token = ++request
  loading.value = true
  error.value = ''
  try {
    const result = await teamMaterialApi.employees(props.teamId)
    if (token !== request) return
    employees.value = result.filter((item) => item.active)
    if (person.value)
      person.value = employees.value.find((item) => item.id === person.value?.id) || null
  } catch (reason) {
    if (token === request)
      error.value = reason instanceof Error ? reason.message : '员工名单加载失败'
  } finally {
    if (token === request) loading.value = false
  }
}
function opened(value: boolean) {
  emit('openChange', value)
  if (value) void load()
}
watch(
  () => props.teamId,
  (_team, previousTeam) => {
    employees.value = []
    if (previousTeam !== undefined) person.value = null
    void load()
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  ++request
})
</script>

<template>
  <div class="receipt-person">
    <ProcessingPersonInput
      v-model="name"
      label="接收人"
      :options="employees.map((person) => person.name)"
      :disabled="disabled || !!error"
      :loading="loading"
      :invalid="invalid"
      @open-change="opened"
    />
    <span v-if="loading" class="person-status" role="status">加载员工…</span>
    <span v-if="error" class="person-error" role="alert">
      {{ error }} <ElButton link type="primary" @click="load()">重试</ElButton>
    </span>
  </div>
</template>

<style scoped>
.receipt-person {
  width: 220px;
  max-width: 100%;
}
.person-status,
.person-error {
  display: block;
  margin-top: 4px;
  font-size: 12px;
}
.person-status {
  color: var(--muted);
}
.person-error {
  color: var(--el-color-danger);
}
</style>
