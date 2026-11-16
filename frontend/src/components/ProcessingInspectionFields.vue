<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch, watchEffect } from 'vue'
import { ElFormItem, ElOption } from 'element-plus'
import AppInput from './AppInput.vue'
import AppNumberInput from './AppNumberInput.vue'
import AppSelect from './AppSelect.vue'
import AppButton from './AppButton.vue'
import AppAlert from './AppAlert.vue'
import CompactFormSection from './CompactFormSection.vue'
import WatermelonSegmented from './watermelon/WatermelonSegmented.vue'
import { useTeamDirectoryStore } from '@/stores/teamDirectory'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import { inspectionItemLabels, inspectionMethodLabels } from '@/services/inspectionApi'
import type { CreateQuantityAdjustment } from '@/types/teamMaterials'
import type { TeamDirectoryItem } from '@/types/teamBusiness'

const props = defineProps<{
  teamId: number
  quantity?: number
  submitted: boolean
  disabled?: boolean
}>()
const emit = defineEmits<{
  change: [value: NonNullable<CreateQuantityAdjustment['inspection']> | null]
}>()
const directory = useTeamDirectoryStore()
const teams = computed(() => directory.items.filter((team) => team.active))
const scope = ref('full')
const sample = ref<number>()
const failed = ref<number | undefined>(0)
const methods = ref<('visual' | 'microscope')[]>([])
const items = ref<('appearance' | 'dimension' | 'weight')[]>([])
const problemIds = ref<number[]>([])
const involved = ref<number[]>([])
const notes = ref('')
const dimension = ref(''),
  weight = ref('')
const problems = ref<TeamDirectoryItem[]>([])
const loading = ref(false),
  error = ref('')
let generation = 0
async function loadProblems() {
  const token = ++generation
  loading.value = true
  error.value = ''
  try {
    const result = await teamMaterialApi.inspectionProblems(props.teamId)
    if (token === generation) problems.value = result.filter((problem) => problem.active)
  } catch (e) {
    if (token === generation) error.value = e instanceof Error ? e.message : '检验问题读取失败'
  } finally {
    if (token === generation) loading.value = false
  }
}
watch(
  () => props.teamId,
  () => {
    problems.value = []
    problemIds.value = []
    void loadProblems()
    if (!directory.loaded && !directory.loading) void directory.refreshTeamDirectory()
  },
  { immediate: true },
)
watch(
  [() => props.quantity, scope],
  () => {
    if (scope.value === 'full') sample.value = props.quantity
  },
  { immediate: true },
)
const sampleValid = computed(
  () =>
    Number.isSafeInteger(sample.value) &&
    sample.value! > 0 &&
    sample.value! <= (props.quantity || 0),
)
const failedValid = computed(
  () =>
    Number.isSafeInteger(failed.value) &&
    failed.value! >= 0 &&
    failed.value! <= (sample.value || 0),
)
const passed = computed(() =>
  sampleValid.value && failedValid.value ? sample.value! - failed.value! : null,
)
const hasFailures = computed(() => (failed.value || 0) > 0)
const problemsValid = computed(
  () =>
    !loading.value &&
    !error.value &&
    problemIds.value.length > 0 &&
    problemIds.value.every((id) => problems.value.some((p) => p.id === id)),
)
const teamsValid = computed(
  () =>
    involved.value.length > 0 && involved.value.every((id) => teams.value.some((t) => t.id === id)),
)
watchEffect(() => {
  const valid =
    sampleValid.value &&
    failedValid.value &&
    methods.value.length &&
    items.value.length &&
    (!hasFailures.value || (problemsValid.value && teamsValid.value && notes.value.trim()))
  emit(
    'change',
    valid
      ? {
          scope: scope.value === 'full' ? 'full' : 'sample',
          sample_quantity: sample.value!,
          failed_quantity: failed.value!,
          methods: [...methods.value],
          items: [...items.value],
          problem_type_ids: hasFailures.value ? [...problemIds.value] : [],
          involved_team_ids: hasFailures.value ? [...involved.value] : [],
          notes: hasFailures.value ? notes.value.trim() : '',
          dimension_result: items.value.includes('dimension') ? dimension.value.trim() : '',
          weight_result: items.value.includes('weight') ? weight.value.trim() : '',
        }
      : null,
  )
})
onBeforeUnmount(() => {
  ++generation
})
</script>

<template>
  <CompactFormSection title="检验结果" class="processing-inspection-fields">
    <ElFormItem label="检验方式" class="form-field--medium" required>
      <WatermelonSegmented
        v-model="scope"
        label="检验方式"
        :options="[
          { value: 'full', label: '全检', disabled },
          { value: 'sample', label: '抽检', disabled },
        ]"
      />
    </ElFormItem>
    <ElFormItem
      label="检验件数"
      class="form-field--medium"
      required
      :error="submitted && !sampleValid ? '检验件数不能超过本次完成件数' : undefined"
    >
      <span v-if="scope === 'full'" class="inspection-result-value" aria-label="检验件数"
        >{{ sample ?? '—' }} 件</span
      >
      <AppNumberInput
        v-else
        v-model="sample"
        :min="1"
        :max="quantity || 0"
        :precision="0"
        aria-label="检验件数"
      />
    </ElFormItem>
    <ElFormItem label="合格件数" class="form-field--medium">
      <span class="inspection-result-value" aria-label="合格件数">{{ passed ?? '—' }} 件</span>
    </ElFormItem>
    <ElFormItem
      label="不合格件数"
      class="form-field--medium"
      required
      :error="submitted && !failedValid ? '不合格件数须在 0 至检验件数之间' : undefined"
    >
      <AppNumberInput
        v-model="failed"
        :min="0"
        :max="sample || 0"
        :precision="0"
        aria-label="不合格件数"
      />
    </ElFormItem>
    <ElFormItem
      label="检查手段"
      class="form-field--long"
      required
      :error="submitted && !methods.length ? '请选择检查手段' : undefined"
    >
      <AppSelect v-model="methods" multiple aria-label="检查手段" placeholder="选择检查手段">
        <ElOption
          v-for="(label, key) in inspectionMethodLabels"
          :key="key"
          :value="key"
          :label="label"
        />
      </AppSelect>
    </ElFormItem>
    <ElFormItem
      label="检查项目"
      class="form-field--long"
      required
      :error="submitted && !items.length ? '请选择检查项目' : undefined"
    >
      <AppSelect v-model="items" multiple aria-label="检查项目" placeholder="选择检查项目">
        <ElOption
          v-for="(label, key) in inspectionItemLabels"
          :key="key"
          :value="key"
          :label="label"
        />
      </AppSelect>
    </ElFormItem>
    <ElFormItem v-if="items.includes('dimension')" label="尺寸检查记录" class="form-field--long">
      <AppInput v-model="dimension" aria-label="尺寸检查记录" maxlength="2000" />
    </ElFormItem>
    <ElFormItem v-if="items.includes('weight')" label="重量检查记录" class="form-field--long">
      <AppInput v-model="weight" aria-label="重量检查记录" maxlength="2000" />
    </ElFormItem>
    <template v-if="hasFailures">
      <ElFormItem
        label="不合格问题"
        class="form-field--long"
        required
        :error="submitted && !problemsValid ? '请选择启用的检验问题' : undefined"
      >
        <AppSelect
          v-model="problemIds"
          multiple
          filterable
          :loading="loading"
          aria-label="不合格问题"
          placeholder="选择检验问题"
        >
          <ElOption
            v-for="problem in problems"
            :key="problem.id"
            :value="problem.id"
            :label="problem.name"
          />
        </AppSelect>
        <AppAlert v-if="error" type="error" :title="error" :closable="false" />
        <AppButton v-if="error" link @click="loadProblems">重试</AppButton>
        <small v-if="!loading && !error && !problems.length"
          >请先在检验班组管理中添加检验问题</small
        >
      </ElFormItem>
      <ElFormItem
        label="涉及班组"
        class="form-field--long"
        required
        :error="submitted && !teamsValid ? '请选择涉及班组' : undefined"
      >
        <AppSelect
          v-model="involved"
          multiple
          filterable
          :loading="directory.loading"
          aria-label="涉及班组"
          placeholder="选择涉及班组"
        >
          <ElOption v-for="team in teams" :key="team.id" :value="team.id" :label="team.name" />
        </AppSelect>
        <AppButton v-if="directory.error" link @click="directory.refreshTeamDirectory"
          >重新读取班组</AppButton
        >
      </ElFormItem>
      <ElFormItem
        label="问题说明"
        class="form-field--full"
        required
        :error="submitted && !notes.trim() ? '请填写不合格情况' : undefined"
      >
        <AppInput
          v-model="notes"
          type="textarea"
          :rows="2"
          maxlength="2000"
          show-word-limit
          aria-label="问题说明"
          placeholder="描述不合格情况"
        />
      </ElFormItem>
    </template>
  </CompactFormSection>
</template>

<style scoped>
.inspection-result-value {
  min-height: var(--wm-control-height, 40px);
  display: inline-flex;
  align-items: center;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
</style>
