<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElFormItem, ElOption } from 'element-plus'
import AppAutocomplete from './AppAutocomplete.vue'
import AppSelect from './AppSelect.vue'
import { productionScheduleApi } from '@/services/productionScheduleApi'
import type { components } from '@/types/generated/api'
import { formatAmount, formatDateTime } from '@/utils/format'

type Option = components['schemas']['FeedingOption']
const props = defineProps<{
  teamId: number
  quantity: number
  weight: number
  refresh: number
  error?: string
}>()
const emit = defineEmits<{ select: [Option | undefined] }>()
const serial = ref('')
const options = ref<Option[]>([])
const selectedId = ref<number>()
const plan = computed(() => options.value.find((item) => item.schedule_id === selectedId.value))
const message = ref('')
const loading = ref(false)
async function suggest(query: string, callback: (items: { value: string }[]) => void) {
  try {
    const page = await productionScheduleApi.serialOptions({ query, page_size: 30 })
    callback(page.items.map((item) => ({ value: item.serial_no })))
  } catch {
    callback([])
  }
}
watch(
  [() => serial.value.trim(), () => props.teamId, () => props.refresh],
  ([value], _, onCleanup) => {
    const prior = plan.value
    options.value = []
    selectedId.value = undefined
    message.value = ''
    loading.value = !!value
    if (!value) return
    let current = true
    const timer = setTimeout(async () => {
      try {
        const result = await productionScheduleApi.feedingOptions(props.teamId, value)
        if (!current) return
        options.value = result
        selectedId.value =
          result.find((item) => item.schedule_id === prior?.schedule_id)?.schedule_id ??
          (result.length === 1 ? result[0]!.schedule_id : undefined)
        if (!result.length) message.value = '该流水号没有可投料的加工排期'
      } catch (e) {
        if (current) message.value = e instanceof Error ? e.message : '读取排期失败'
      } finally {
        if (current) loading.value = false
      }
    }, 200)
    onCleanup(() => {
      current = false
      clearTimeout(timer)
    })
  },
)
watch(plan, (value) => emit('select', value), { immediate: true, flush: 'sync' })
</script>
<template>
  <div class="dialog-form-grid">
    <ElFormItem label="目标流水号" required>
      <AppAutocomplete
        v-model="serial"
        :fetch-suggestions="suggest"
        aria-label="目标流水号"
        placeholder="输入或选择排期流水号"
        clearable
      />
    </ElFormItem>
    <ElFormItem label="加工排期" required :error="message || error">
      <AppSelect
        v-model="selectedId"
        :loading="loading"
        :disabled="!options.length"
        placeholder="选择加工排期"
        aria-label="加工排期"
      >
        <ElOption
          v-for="item in options"
          :key="item.schedule_id"
          :value="item.schedule_id"
          :label="`第${item.task_batch_number}批 · ${item.team_name} · ${formatDateTime(item.due_at)}`"
        />
      </AppSelect>
      <span v-if="message || error" role="status" class="dialog-field-hint">{{
        message || error
      }}</span>
    </ElFormItem>
    <div class="dialog-field-wide dialog-form-grid" aria-live="polite">
      <span class="dialog-field-hint"
        >本次投料 {{ formatAmount(quantity) }} 件 / {{ formatAmount(weight) }} kg</span
      >
      <span v-if="plan" class="dialog-field-hint"
        >排期待交
        {{
          [
            plan.remaining_quantity != null ? formatAmount(plan.remaining_quantity) + ' 件' : '',
            plan.remaining_weight != null ? formatAmount(plan.remaining_weight) + ' kg' : '',
          ]
            .filter(Boolean)
            .join(' / ')
        }}</span
      >
    </div>
  </div>
</template>
