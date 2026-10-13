<script setup lang="ts">
import TeamEmployeeInput from './TeamEmployeeInput.vue'
import type { TeamEmployee } from '@/types/teamBusiness'

defineProps<{ teamId: number; disabled?: boolean; invalid?: boolean }>()
const person = defineModel<TeamEmployee | null>({ required: true })
const emit = defineEmits<{ openChange: [boolean] }>()
</script>

<template>
  <TeamEmployeeInput
    v-model="person"
    label="接收人"
    :team-id="teamId"
    :disabled="disabled"
    :invalid="invalid"
    @open-change="emit('openChange', $event)"
  />
</template>
