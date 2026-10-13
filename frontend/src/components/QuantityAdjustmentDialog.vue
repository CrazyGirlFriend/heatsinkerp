<script setup lang="ts">
import { materialWeightToleranceKg } from '@/config/materialRules'

import { sharedSerialLabel } from '@/types/sharedMaterial'
import SharedMaterialInfo from './SharedMaterialInfo.vue'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { focusFirstInvalidField } from '@/composables/useDialogValidation'
import {
  ElAlert,
  ElButton,
  ElDescriptions,
  ElDescriptionsItem,
  ElDialog,
  ElForm,
  ElFormItem,
  ElInput,
  ElInputNumber,
  ElOption,
  ElSelect,
  ElSwitch,
  ElPagination,
  ElTable,
  ElTableColumn,
} from 'element-plus'
import SpecificationInput from './SpecificationInput.vue'
import ProcessingPersonInput from './ProcessingPersonInput.vue'
import WeightInput from './WeightInput.vue'
import SludgeWeightFields from './SludgeWeightFields.vue'
import {
  processingProgressLabels,
  processingRoleLabels,
  type ProcessingRole,
} from '@/types/materialProcessing'
import { useAuthStore } from '@/stores/auth'
import { teamMaterialApi, TeamMaterialApiError } from '@/services/teamMaterialApi'
import type {
  CreateProcessingOutput,
  QuantityAdjustment,
  QuantityAdjustmentContext,
} from '@/types/teamMaterials'
import { materialRequestKey } from '@/utils/materialStock'
import { formatDateTime } from '@/utils/format'
import {
  isScrapType,
  isWeightOnlyType,
  materialTypeLabel,
  materialTypeOptions,
  type MaterialType,
} from '@/types/materialTransfer'
import { sludgePayload, sludgeWeight } from '@/utils/sludgeWeight'

const props = defineProps<{
  modelValue: boolean
  teamId: number
  sourceId: number | null
  canWrite?: boolean
  processing?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [boolean]; saved: [QuantityAdjustment] }>()
const auth = useAuthStore()
const formRef = ref<InstanceType<typeof ElForm>>()
const snapshot = ref<QuantityAdjustmentContext | null>(null)
const records = ref<QuantityAdjustment[]>([]),
  total = ref(0),
  page = ref(1)
const historyRecords = computed(() =>
  snapshot.value?.origin_processing_record
    ? [snapshot.value.origin_processing_record, ...records.value]
    : records.value,
)
const quantity = ref<number | undefined>(),
  processorName = ref(''),
  reason = ref(''),
  error = ref('')
const progress = ref<'partial' | 'complete'>('partial'),
  specification = ref(''),
  specificationValid = ref(true),
  submitted = ref(false)
const loading = ref(false),
  saving = ref(false),
  conflict = ref(false)
type OutputDraft = {
  serialNo?: string
  key: string
  role: ProcessingRole
  material_type: MaterialType
  quantity?: number
  weight?: number
  gross?: number
  percent?: number
  specification: string
  specificationValid: boolean
}
const detailed = ref(false),
  outputs = ref<OutputDraft[]>([])
const activeOutputs = computed(() =>
  outputs.value.filter(
    (line) =>
      Number(outputQuantity(line)) ||
      Number(line.weight) ||
      (line.material_type === 'sludge' && Number(line.gross)),
  ),
)
const outputQuantity = (line: OutputDraft) =>
  isWeightOnlyType(line.material_type) ? 0 : line.quantity
const outputTotal = computed(() =>
  activeOutputs.value.reduce((sum, line) => sum + (outputQuantity(line) || 0), 0),
)
const outputWeight = computed(
  () =>
    Math.round(activeOutputs.value.reduce((sum, line) => sum + (line.weight || 0), 0) * 1000000) /
    1000000,
)
const measuredOutputs = computed(
  () =>
    activeOutputs.value.length > 0 &&
    activeOutputs.value.every((line) => line.weight != null && Number.isFinite(line.weight)),
)
const weightDifference = computed(
  () => Math.round((outputWeight.value - (snapshot.value?.weight || 0)) * 1000000) / 1000000,
)
const cumulativeWeightDifference = computed(
  () =>
    Math.round(((snapshot.value?.weight_difference || 0) + weightDifference.value) * 1000000) /
    1000000,
)
const progressInvalid = computed(
  () =>
    !progress.value ||
    (detailed.value &&
      progress.value === 'complete' &&
      activeOutputs.value.some((line) => line.role === 'remaining')),
)
function addOutput(role: ProcessingRole = 'produced') {
  outputs.value.push({
    key: materialRequestKey(),
    role,
    material_type:
      role === 'scrap'
        ? 'waste'
        : snapshot.value?.material_type && !isScrapType(snapshot.value.material_type)
          ? snapshot.value.material_type
          : 'semi_finished',
    specification: '',
    specificationValid: true,
  })
}
function outputRoleChanged(line: OutputDraft) {
  if (
    line.role === 'remaining' &&
    snapshot.value?.material_type &&
    line.material_type !== snapshot.value.material_type
  ) {
    line.material_type = snapshot.value.material_type
    outputTypeChanged(line)
  }
  if (isScrapType(line.material_type) !== (line.role === 'scrap')) {
    line.material_type = line.role === 'scrap' ? 'waste' : 'semi_finished'
    outputTypeChanged(line)
  }
}
function outputTypeChanged(line: OutputDraft) {
  line.quantity = isWeightOnlyType(line.material_type) ? 0 : undefined
  line.weight = line.gross = line.percent = undefined
}
function outputError(line: OutputDraft, field: 'quantity' | 'weight' | 'specification' | 'serial') {
  if (!submitted.value || !activeOutputs.value.includes(line)) return false
  if (field === 'serial')
    return (
      snapshot.value?.shared_unallocated &&
      line.role === 'produced' &&
      !snapshot.value.shared_serials?.some((member) => member.serial_no === line.serialNo)
    )
  if (field === 'quantity')
    return (
      !Number.isSafeInteger(outputQuantity(line)) ||
      outputQuantity(line)! < 0 ||
      outputQuantity(line)! > 2147483647
    )
  if (field === 'specification') return !line.specificationValid
  return line.material_type === 'sludge'
    ? !sludgeWeight(line.gross, line.percent)
    : line.weight == null ||
        !Number.isFinite(line.weight) ||
        line.weight < 0 ||
        line.weight > 99999999999.999
}
watch(detailed, (value) => {
  submitted.value = false
  if (value && !outputs.value.length) {
    addOutput('remaining')
    addOutput('produced')
    addOutput('scrap')
  }
})
const editable = computed(
  () =>
    props.canWrite &&
    auth.isTeamAccount &&
    auth.currentUser?.active !== false &&
    !auth.currentUserError &&
    Number(auth.currentUser?.team_id) === props.teamId,
)
const hasStock = computed(
  () => !!snapshot.value && (snapshot.value.quantity > 0 || snapshot.value.weight > 0),
)
let generation = 0,
  requestKey = '',
  fingerprint = ''

async function load(refreshSnapshot = false) {
  if (!props.modelValue || props.sourceId == null || saving.value) return
  const current = ++generation
  loading.value = true
  error.value = ''
  try {
    const result = await teamMaterialApi.quantityContext(props.teamId, props.sourceId, page.value)
    if (current !== generation) return
    if (!snapshot.value) {
      quantity.value = result.quantity
      progress.value = result.processing_status || 'partial'
      specification.value = result.transfer_specification || ''
    }
    if (!snapshot.value || refreshSnapshot) {
      snapshot.value = result
      conflict.value = false
    }
    if (result.shared_unallocated && props.processing) detailed.value = true
    records.value = result.items
    total.value = result.total
  } catch (e) {
    if (current === generation) error.value = e instanceof Error ? e.message : '件数记录读取失败'
  } finally {
    if (current === generation) loading.value = false
  }
}
function close() {
  if (!saving.value) emit('update:modelValue', false)
}
async function save() {
  if (
    !editable.value ||
    loading.value ||
    saving.value ||
    conflict.value ||
    !snapshot.value ||
    props.sourceId == null
  )
    return
  error.value = ''
  submitted.value = true
  const byOutput = props.processing && detailed.value
  const count = byOutput ? outputTotal.value : quantity.value
  const invalidOutputs =
    byOutput &&
    (!activeOutputs.value.length ||
      activeOutputs.value.some((line) =>
        ['quantity', 'weight', 'specification', 'serial'].some((field) =>
          outputError(line, field as 'quantity' | 'weight' | 'specification' | 'serial'),
        ),
      ))
  if (
    !processorName.value.trim() ||
    processorName.value.trim().length > 80 ||
    invalidOutputs ||
    (props.processing && !byOutput && !specificationValid.value) ||
    !Number.isSafeInteger(count) ||
    count! < 0 ||
    count! > 2147483647 ||
    (props.processing && progressInvalid.value) ||
    reason.value.trim().length > 2000
  ) {
    await nextTick()
    focusFirstInvalidField(formRef.value?.$el)
    return
  }
  if (!props.processing && quantity.value === snapshot.value.quantity) {
    error.value = '件数未发生变化'
    return
  }
  const outputLines: CreateProcessingOutput[] = activeOutputs.value.map((line) => ({
    role: line.role,
    ...(snapshot.value?.shared_unallocated && line.role === 'produced'
      ? { serial_no: line.serialNo }
      : {}),
    quantity: outputQuantity(line)!,
    weight: line.weight!,
    material_type: line.material_type,
    transfer_specification: line.specification.trim(),
    ...(line.material_type === 'sludge'
      ? sludgePayload(line.material_type, line.gross, line.percent)
      : {}),
  }))
  const body = {
    source_transfer_id: props.sourceId,
    quantity: count!,
    expected_revision: snapshot.value.revision,
    processor_name: processorName.value.trim(),
    reason: reason.value.trim(),
    ...(props.processing
      ? {
          processing_status: progress.value,
          ...(byOutput
            ? { outputs: outputLines }
            : { transfer_specification: specification.value.trim() }),
        }
      : {}),
  }
  const nextFingerprint = JSON.stringify(body)
  if (fingerprint !== nextFingerprint || !requestKey) {
    requestKey = materialRequestKey()
    fingerprint = nextFingerprint
  }
  const current = generation
  saving.value = true
  try {
    const result = await teamMaterialApi.changeQuantity(props.teamId, {
      ...body,
      idempotency_key: requestKey,
    })
    if (current !== generation) return
    emit('saved', result)
    emit('update:modelValue', false)
  } catch (e) {
    if (current !== generation) return
    error.value = e instanceof Error ? e.message : '件数变更失败，请重试'
    conflict.value = e instanceof TeamMaterialApiError && e.status === 409
  } finally {
    if (current === generation) saving.value = false
  }
}
watch(
  () => [props.modelValue, props.teamId, props.sourceId],
  () => {
    ++generation
    snapshot.value = null
    records.value = []
    total.value = 0
    page.value = 1
    quantity.value = undefined
    processorName.value = ''
    reason.value = error.value = requestKey = fingerprint = ''
    progress.value = 'partial'
    specification.value = ''
    specificationValid.value = true
    submitted.value = false
    detailed.value = false
    outputs.value = []
    loading.value = saving.value = conflict.value = false
    if (props.modelValue) void load()
  },
  { immediate: true },
)
watch(
  () => `${auth.currentUser?.id}:${auth.currentUser?.team_id}:${auth.currentUser?.active}`,
  () => {
    ++generation
    emit('update:modelValue', false)
  },
)
onBeforeUnmount(() => {
  ++generation
})
</script>

<template>
  <ElDialog
    :model-value="modelValue"
    :title="
      processing ? (editable ? '加工登记' : '加工记录') : editable ? '加工件数变更' : '件数变更记录'
    "
    :width="processing ? 'min(1440px, calc(100vw - 32px))' : 'min(780px, 94vw)'"
    align-center
    append-to-body
    class="processing-registration-dialog"
    :close-on-click-modal="!saving"
    :close-on-press-escape="!saving"
    :show-close="!saving"
    @close="close"
  >
    <ElAlert v-if="error" :title="error" type="error" :closable="false" />
    <div v-if="loading" role="status" class="quantity-loading">正在读取件数记录…</div>
    <template v-if="snapshot">
      <ElDescriptions :column="2" border class="quantity-summary">
        <ElDescriptionsItem v-if="processing" label="流水号">{{
          sharedSerialLabel(snapshot)
        }}</ElDescriptionsItem>
        <ElDescriptionsItem v-if="processing" label="物料类型">{{
          materialTypeLabel(snapshot.material_type || null)
        }}</ElDescriptionsItem>
        <ElDescriptionsItem label="来源批次" :span="2">{{ snapshot.batch_no }}</ElDescriptionsItem>
        <ElDescriptionsItem label="未转出件数">{{ snapshot.quantity }} 件</ElDescriptionsItem>
        <ElDescriptionsItem label="未转出重量">{{ snapshot.weight }} kg</ElDescriptionsItem>
        <ElDescriptionsItem v-if="processing" label="当前实际尺寸" :span="2">{{
          snapshot.transfer_specification || '—'
        }}</ElDescriptionsItem>
      </ElDescriptions>
      <SharedMaterialInfo :item="snapshot" />
      <ElForm
        v-if="editable && hasStock"
        ref="formRef"
        class="processing-registration-form"
        label-position="top"
        :show-message="false"
        :disabled="saving || loading"
        @submit.prevent="save"
      >
        <p v-if="!processing" class="quantity-note">
          只修改本批未转出的件数，重量、原签收单和已转出件数不变。保存后立即生效，取消出库不会撤销本次修改。
        </p>
        <div v-if="processing" class="processing-mode">
          <ElSwitch
            v-model="detailed"
            :disabled="snapshot.shared_unallocated"
            aria-label="按明细登记"
            active-text="按明细登记"
          /><span>{{
            detailed
              ? '逐行填写本批全部未转出实物，剩余大料、不同尺寸小料和废料分别录入。保存后从实际子批出库。'
              : '仅登记总件数和统一尺寸；一批包含多种尺寸或废料时，启用明细登记。'
          }}</span>
        </div>
        <section
          v-if="processing && detailed"
          class="processing-outputs"
          :class="{ 'is-error': submitted && !activeOutputs.length }"
          aria-label="加工后完整实物明细"
        >
          <div class="processing-output-scroll">
            <table class="processing-output-table">
              <thead>
                <tr>
                  <th>类别</th>
                  <th>物料类型</th>
                  <th>件数</th>
                  <th>实测重量</th>
                  <th>实际尺寸（选填）</th>
                  <th v-if="snapshot.shared_unallocated" class="shared-owner-column">
                    归属流水号 *
                  </th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <template v-for="(line, index) in outputs" :key="line.key"
                  ><tr>
                    <td>
                      <ElSelect
                        v-model="line.role"
                        :aria-label="`明细${index + 1}类别`"
                        @change="outputRoleChanged(line)"
                        ><ElOption
                          v-for="(label, value) in processingRoleLabels"
                          :key="value"
                          :value="value"
                          :label="label"
                      /></ElSelect>
                    </td>
                    <td>
                      <ElSelect
                        v-model="line.material_type"
                        :aria-label="`明细${index + 1}物料类型`"
                        :disabled="line.role === 'remaining' && !!snapshot.material_type"
                        @change="outputTypeChanged(line)"
                        ><ElOption
                          v-for="type in materialTypeOptions.filter(
                            (type) => isScrapType(type.value) === (line.role === 'scrap'),
                          )"
                          :key="type.value"
                          :value="type.value"
                          :label="type.label"
                      /></ElSelect>
                    </td>
                    <td>
                      <span v-if="isWeightOnlyType(line.material_type)" class="dialog-input-unit"
                        >仅计重量</span
                      >
                      <div
                        v-else
                        class="dialog-field"
                        :class="{ 'is-error': outputError(line, 'quantity') }"
                      >
                        <ElInputNumber
                          v-model="line.quantity"
                          :aria-label="`明细${index + 1}件数`"
                          :min="0"
                          :max="2147483647"
                          :precision="0"
                          controls-position="right"
                        />
                      </div>
                    </td>
                    <td>
                      <span v-if="line.material_type === 'sludge'"
                        >{{ line.weight ?? '—' }} kg（折算）</span
                      >
                      <div
                        v-else
                        class="dialog-field"
                        :class="{ 'is-error': outputError(line, 'weight') }"
                      >
                        <WeightInput v-model="line.weight" :ariaLabel="`明细${index + 1}重量`" />
                      </div>
                    </td>
                    <td>
                      <div
                        class="dialog-field"
                        :class="{ 'is-error': outputError(line, 'specification') }"
                      >
                        <SpecificationInput
                          v-model="line.specification"
                          :label="`明细${index + 1}实际尺寸`"
                          @validity-change="line.specificationValid = $event"
                        />
                      </div>
                    </td>
                    <td v-if="snapshot.shared_unallocated">
                      <div
                        v-if="line.role === 'produced'"
                        class="dialog-field"
                        :class="{ 'is-error': outputError(line, 'serial') }"
                      >
                        <ElSelect
                          v-model="line.serialNo"
                          :aria-label="`明细${index + 1}归属流水号`"
                          placeholder="请选择"
                          filterable
                          ><ElOption
                            v-for="member in snapshot.shared_serials"
                            :key="member.serial_no"
                            :value="member.serial_no"
                            :label="member.serial_no"
                        /></ElSelect>
                      </div>
                      <span v-else>{{ line.role === 'scrap' ? '共投废料' : '共投未分配' }}</span>
                    </td>
                    <td>
                      <ElButton
                        text
                        :aria-label="`移除明细${index + 1}`"
                        @click="outputs.splice(index, 1)"
                        >移除</ElButton
                      >
                    </td>
                  </tr>
                  <tr v-if="line.material_type === 'sludge'">
                    <td :colspan="snapshot.shared_unallocated ? 7 : 6">
                      <SludgeWeightFields
                        v-model:gross="line.gross"
                        v-model:percent="line.percent"
                        :label="`明细${index + 1}`"
                        :gross-error="outputError(line, 'weight') ? '请填写实重和比例' : ''"
                        :percent-error="outputError(line, 'weight') ? '请填写实重和比例' : ''"
                        @update:weight="line.weight = $event"
                      />
                    </td></tr
                ></template>
              </tbody>
            </table>
          </div>
          <footer>
            <ElButton text :disabled="outputs.length >= 100" @click="addOutput()">增加明细</ElButton
            ><span
              >共 {{ activeOutputs.length }} 行 · {{ outputTotal }} 件 ·
              {{ outputWeight }} kg；空白或全零行不提交</span
            >
          </footer>
        </section>
        <p
          v-if="
            processing &&
            detailed &&
            measuredOutputs &&
            (weightDifference || cumulativeWeightDifference)
          "
          class="quantity-note processing-weight-notice"
          role="status"
        >
          本次实测比账面{{ weightDifference >= 0 ? '多' : '少' }}
          {{ Math.abs(weightDifference) }} kg；同一来源在本班组累计{{
            cumulativeWeightDifference >= 0 ? '多' : '少'
          }}
          {{ Math.abs(cumulativeWeightDifference) }} kg，{{
            Math.abs(cumulativeWeightDifference) <= materialWeightToleranceKg
              ? `在每批 ${materialWeightToleranceKg} kg 提醒范围内`
              : `超过每批 ${materialWeightToleranceKg} kg，请核对实测值，仍可提交`
          }}。拆分和继续加工沿用同一批提醒额度，不按件数换算重量或自动记作损耗。
        </p>
        <div class="dialog-form-grid">
          <ElFormItem
            label="加工后本批未转出总件数"
            required
            :class="{
              'is-error':
                submitted &&
                (!Number.isSafeInteger(detailed ? outputTotal : quantity) ||
                  (detailed ? outputTotal : quantity!) < 0 ||
                  (detailed ? outputTotal : quantity!) > 2147483647),
            }"
            ><strong v-if="processing && detailed" class="dialog-readonly"
              >{{ outputTotal }} 件（明细合计）</strong
            ><ElInputNumber
              v-else
              v-model="quantity"
              aria-label="加工后未转出件数"
              :min="0"
              :max="2147483647"
              :precision="0"
              controls-position="right"
              ><template #suffix><span class="dialog-input-unit">件</span></template></ElInputNumber
            ></ElFormItem
          >
          <ElFormItem
            v-if="processing"
            label="本批加工进度"
            required
            :class="{ 'is-error': submitted && progressInvalid }"
            ><ElSelect v-model="progress" aria-label="本批加工进度"
              ><ElOption
                v-for="(label, value) in processingProgressLabels"
                :key="value"
                :value="value"
                :label="label" /></ElSelect
            ><small
              v-if="detailed && activeOutputs.some((line) => line.role === 'remaining')"
              class="dialog-field-hint"
              >仍有剩余大料，请选择部分加工。</small
            ></ElFormItem
          >
          <ElFormItem
            label="加工人"
            required
            :class="{
              'is-error': submitted && (!processorName.trim() || processorName.trim().length > 80),
            }"
          >
            <ProcessingPersonInput
              v-model="processorName"
              :options="snapshot.processor_options"
              :invalid="submitted && (!processorName.trim() || processorName.trim().length > 80)"
            />
          </ElFormItem>
          <ElFormItem
            v-if="processing && !detailed"
            label="加工后实际尺寸（选填）"
            class="dialog-field-wide"
            :class="{ 'is-error': submitted && !specificationValid }"
            ><SpecificationInput
              v-model="specification"
              label="加工后实际尺寸"
              @validity-change="specificationValid = $event"
          /></ElFormItem>
          <ElFormItem
            label="加工说明（选填）"
            class="dialog-field-wide"
            :class="{ 'is-error': submitted && reason.trim().length > 2000 }"
            ><ElInput
              v-model="reason"
              type="textarea"
              aria-label="加工说明"
              :rows="2"
              maxlength="2000"
              show-word-limit
              placeholder="选填，例如：10 块板材切割为 100 件"
          /></ElFormItem>
        </div>
      </ElForm>
      <p v-else-if="editable" class="quantity-note">本批没有未转出的库存，不能修改件数。</p>
      <h3 class="quantity-history-title">本批操作记录</h3>
      <ElTable
        :data="historyRecords"
        class="business-table"
        empty-text="暂无件数变更"
        aria-label="件数变更记录"
      >
        <ElTableColumn label="操作" min-width="135" align="center"
          ><template #default="{ row }">{{
            row.id === snapshot.origin_processing_record?.id
              ? '创建本批的加工登记'
              : row.operation_kind === 'outbound_clearance'
                ? '出库余件清零'
                : row.processing_status
                  ? processingProgressLabels[row.processing_status as 'partial' | 'complete']
                  : '件数变更'
          }}</template></ElTableColumn
        >
        <ElTableColumn label="时间" min-width="170" align="center">
          <template #default="{ row }">{{ formatDateTime(row.created_at) }}</template>
        </ElTableColumn>
        <ElTableColumn label="加工人" min-width="110" align="center">
          <template #default="{ row }">{{
            row.operation_kind === 'outbound_clearance' ? '—' : row.processor_name || '未登记'
          }}</template>
        </ElTableColumn>
        <ElTableColumn label="变更前 → 变更后" min-width="140" align="center"
          ><template #default="{ row }"
            >{{ row.before_quantity }} → {{ row.after_quantity }} 件</template
          ></ElTableColumn
        >
        <ElTableColumn prop="reason" label="加工说明" min-width="220" align="center" />
        <ElTableColumn v-if="processing" label="登记后尺寸" min-width="180" show-overflow-tooltip
          ><template #default="{ row }">{{
            row.after_specification || '—'
          }}</template></ElTableColumn
        >
        <ElTableColumn v-if="processing" label="实物明细 / 登记后重量" min-width="300"
          ><template #default="{ row }"
            ><div
              v-for="output in row.outputs || []"
              :key="output.id"
              class="processing-history-output"
            >
              <strong
                >{{ output.batch_no
                }}{{
                  output.serial_no
                    ? ' · ' + (output.shared_unallocated ? '共投未分配' : output.serial_no)
                    : ''
                }}
                · {{ processingRoleLabels[output.role as ProcessingRole] }}</strong
              ><span
                >{{ materialTypeLabel(output.material_type) }} · {{ output.quantity }} 件 /
                {{ output.weight }} kg · {{ output.transfer_specification || '未填尺寸' }}</span
              ><span v-if="output.on_hand_weight != null"
                >当前未转出 {{ output.on_hand_quantity }} 件 /
                {{ output.on_hand_weight }} kg；待签收 {{ output.in_transit_quantity ?? 0 }} 件 /
                {{ output.in_transit_weight ?? 0 }} kg</span
              ><span v-if="output.material_type === 'sludge'"
                >实重 {{ output.sludge_gross_weight }} kg · 有效材料
                {{ output.sludge_content_percent }}%</span
              >
            </div>
            <span v-if="!row.outputs?.length"
              >{{ row.after_weight ?? row.weight }} kg</span
            ></template
          ></ElTableColumn
        >
      </ElTable>
      <ElPagination
        v-if="total > 10"
        :current-page="page"
        :page-size="10"
        :total="total"
        :disabled="loading || saving"
        layout="prev, pager, next"
        @current-change="
          ($event) => {
            page = $event
            load()
          }
        "
      />
    </template>
    <template #footer>
      <ElButton :disabled="saving" @click="close">关闭</ElButton>
      <ElButton
        v-if="conflict || (!snapshot && error)"
        :disabled="loading || saving"
        @click="load(true)"
        >刷新并核对</ElButton
      >
      <ElButton
        v-if="editable"
        type="primary"
        :loading="saving"
        :disabled="loading || conflict || !hasStock"
        @click="save"
        >{{ processing ? '保存加工登记' : '保存件数' }}</ElButton
      >
    </template>
  </ElDialog>
</template>

<style scoped>
.quantity-summary {
  margin-block: 16px;
}
.quantity-note {
  color: var(--muted);
  line-height: 1.7;
  font-size: 14px;
}
.quantity-history-title {
  margin: 24px 0 12px;
  font-size: 16px;
  font-weight: 600;
}
.quantity-loading {
  padding: 12px 0;
  color: var(--muted);
}
.el-pagination {
  justify-content: flex-end;
  margin-top: 12px;
}
.processing-mode,
.processing-outputs > footer {
  display: flex;
  align-items: center;
  gap: 12px;
  justify-content: space-between;
  margin-bottom: 12px;
}
.processing-mode > span,
.processing-outputs > footer > span {
  color: var(--muted);
  font-size: 12px;
}
.processing-mode .el-switch {
  flex-shrink: 0;
}
.processing-outputs {
  border: 1px solid var(--line);
  border-radius: 10px;
  margin-bottom: 14px;
  overflow: hidden;
}
.processing-outputs.is-error {
  border-color: var(--el-color-danger);
}
.processing-output-scroll {
  overflow-x: auto;
}
.processing-output-table {
  width: 100%;
  min-width: 1208px;
  table-layout: fixed;
  border-collapse: collapse;
  font-size: 12px;
}
.processing-output-table th {
  padding: 8px;
  text-align: center;
  font-weight: 500;
  background: var(--surface-soft);
  color: var(--muted);
}
.processing-output-table td {
  padding: 8px;
  vertical-align: middle;
  text-align: center;
  border-top: 1px solid var(--line);
}
.processing-output-table th:nth-child(1) {
  width: 128px;
}
.processing-output-table th:nth-child(2) {
  width: 112px;
}
.processing-output-table th:nth-child(3) {
  width: 116px;
}
.processing-output-table th:nth-child(4) {
  width: 208px;
}
.processing-output-table .shared-owner-column {
  width: 150px;
}
.processing-output-table:has(.shared-owner-column) {
  min-width: 1358px;
}
.processing-output-table th:last-child {
  width: 60px;
}
.processing-output-table .dialog-field {
  margin: 0;
}
.processing-output-table :deep(.specification-input) {
  display: grid;
  grid-template-columns: 150px minmax(0, 1fr);
  gap: 4px;
  align-items: center;
}
.processing-output-table :deep(.specification-input > .el-select) {
  width: 100%;
}
.processing-output-table :deep(.specification-dimensions) {
  flex: 1 1 auto;
  flex-wrap: nowrap;
  gap: 4px;
}
.processing-output-table :deep(.specification-dimensions label) {
  flex: 0 0 128px;
  min-width: 128px;
  max-width: 128px;
}
.processing-output-table :deep(.specification-dimensions label:last-child) {
  flex-basis: 148px;
  min-width: 148px;
  max-width: 148px;
}
.processing-output-table :deep(.specification-error) {
  grid-column: 1 / -1;
  text-align: left;
}
.processing-output-table :deep(.el-input__inner) {
  text-align: center;
}
.processing-output-table :deep(.el-select__selected-item) {
  text-align: center;
}
.processing-registration-form > .dialog-form-grid {
  grid-template-columns: 200px 240px minmax(0, 1fr);
}
.processing-registration-form .dialog-field-wide {
  grid-column: 1 / -1;
}

.processing-outputs > footer {
  margin: 0;
  padding: 6px 10px;
  border-top: 1px solid var(--line);
  flex-wrap: wrap;
}
.processing-weight-notice {
  color: var(--action-warm);
  font-size: 12px;
}
.processing-history-output {
  display: grid;
  gap: 3px;
  padding-block: 5px;
  font-size: 12px;
}
.processing-history-output strong {
  font-weight: 500;
}
@media (max-width: 760px) {
  .processing-mode {
    align-items: flex-start;
    flex-direction: column;
    gap: 4px;
  }
}
</style>

<style>
.processing-registration-dialog {
  display: flex;
  flex-direction: column;
  max-height: calc(100dvh - 32px);
}
.processing-registration-dialog .el-dialog__body {
  min-height: 0;
  overflow: auto;
}
.processing-registration-dialog .el-input-number {
  width: 100%;
}
@media (max-width: 600px) {
  .processing-registration-dialog .el-descriptions__label {
    width: 80px;
  }
  .processing-registration-dialog .el-descriptions__content {
    overflow-wrap: anywhere;
  }
}
</style>
