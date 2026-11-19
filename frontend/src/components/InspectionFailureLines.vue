<script setup lang="ts">
import { computed, ref, watchEffect, onMounted } from 'vue'
import { ElFormItem, ElOption } from 'element-plus'
import AppButton from './AppButton.vue'
import AppSelect from './AppSelect.vue'
import AppNumberInput from './AppNumberInput.vue'
import { useTeamDirectoryStore } from '@/stores/teamDirectory'
import { teamCanProcess } from '@/config/teamWorkspaces'
import sheets from '@/config/productionTemplateColumns.json'
import type { components } from '@/types/generated/api'

type Line = components['schemas']['FailureLine']
const props = defineProps<{ failed: number; submitted: boolean }>()
const emit = defineEmits<{ change: [value: Line[] | null] }>()
const directory = useTeamDirectoryStore()
const teams = computed(() => directory.items.filter((t) => t.active && teamCanProcess(t)))
onMounted(() => {
  if (!directory.loaded && !directory.loading) void directory.refreshTeamDirectory()
})
const headers = sheets['FACTORY-QC'].columns
const problems = headers.find((h) => h.label === '废品')!.children!
const repairColumns = headers.find((h) => h.label === '返修数量明细')!.children!
const mappedTeams = [
  'FACTORY-ROLL',
  'FACTORY-WIRE',
  'FACTORY-GRIND',
  'FACTORY-ANNEAL',
  'FACTORY-ENGRAVE',
]
let nextId = 0
function emptyLine(quantity?: number) {
  return {
    id: ++nextId,
    category: undefined as Line['category'] | undefined,
    quantity,
    disposition: undefined as Line['disposition'] | undefined,
    repair_team_id: undefined as number | undefined,
    repair_column: undefined as Line['repair_column'],
  }
}
const lines = ref([emptyLine(props.failed)])
function needsColumn(id?: number) {
  const team = teams.value.find((t) => Number(t.id) === id)
  return team && !mappedTeams.includes(team.code || '')
}
const total = computed(() => lines.value.reduce((sum, l) => sum + (l.quantity || 0), 0))
const validLines = computed(() => {
  const result: Line[] = []
  for (const line of lines.value) {
    if (
      !line.category ||
      !line.disposition ||
      !Number.isSafeInteger(line.quantity) ||
      (line.quantity ?? 0) < 1 ||
      (line.disposition === 'rework' &&
        !teams.value.some((t) => Number(t.id) === line.repair_team_id))
    ) {
      return null
    }
    result.push({
      category: line.category,
      disposition: line.disposition,
      quantity: line.quantity!,
      ...(line.disposition === 'rework'
        ? {
            repair_team_id: line.repair_team_id,
            repair_column: needsColumn(line.repair_team_id) ? line.repair_column : undefined,
          }
        : {}),
    })
  }
  return total.value === props.failed ? result : null
})
watchEffect(() => emit('change', validLines.value))
</script>

<template>
  <ElFormItem
    label="不合格明细"
    required
    class="form-field--full"
    :class="{ 'is-error': submitted && !validLines }"
    :error="
      submitted && !validLines
        ? total !== failed
          ? '分类件数合计须等于不合格件数'
          : '请填写问题类别、件数和处理方式，返修须选择班组'
        : undefined
    "
  >
    <div class="failure-lines">
      <div v-for="(line, index) in lines" :key="line.id" class="failure-row">
        <AppSelect v-model="line.category" aria-label="问题类别" placeholder="问题类别" filterable>
          <ElOption v-for="p in problems" :key="p.key" :value="p.label" :label="p.label" />
        </AppSelect>
        <AppNumberInput
          v-model="line.quantity"
          :min="1"
          :max="failed"
          :precision="0"
          aria-label="分类件数"
        />
        <AppSelect v-model="line.disposition" aria-label="处理方式" placeholder="处理方式">
          <ElOption label="返修" value="rework" /><ElOption label="判废" value="scrap" />
        </AppSelect>
        <AppSelect
          v-if="line.disposition === 'rework'"
          v-model="line.repair_team_id"
          aria-label="返修班组"
          placeholder="返修班组"
          @change="line.repair_column = undefined"
        >
          <ElOption
            v-for="team in teams"
            :key="team.id"
            :label="team.name"
            :value="Number(team.id)"
          />
        </AppSelect>
        <AppSelect
          v-if="line.disposition === 'rework' && needsColumn(line.repair_team_id)"
          v-model="line.repair_column"
          clearable
          aria-label="返修明细列"
          placeholder="原表返修明细（选填）"
        >
          <ElOption
            v-for="column in repairColumns"
            :key="column.key"
            :value="column.label"
            :label="column.label"
          />
        </AppSelect>
        <AppButton v-if="lines.length > 1" link @click="lines.splice(index, 1)">移除</AppButton>
      </div>
      <AppButton link @click="lines.push(emptyLine(Math.max(0, failed - total) || undefined))"
        >增加分类</AppButton
      >
      <span>已分 {{ total }} / {{ failed }} 件</span>
    </div>
  </ElFormItem>
</template>
<style scoped>
.failure-lines {
  width: 100%;
}
.failure-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}
.failure-row > * {
  max-width: 100%;
  width: auto;
  min-width: 7em;
}
</style>
