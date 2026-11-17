import { computed, ref, watch, type Ref } from 'vue'
import { productionScheduleApi } from '@/services/productionScheduleApi'
import type { ProductionSchedule, ScheduleSummary } from '@/types/productionSchedule'
import { isScheduleApplicable } from '@/utils/inventorySchedule'
import { formatDateTime } from '@/utils/format'
import { formatScheduleBatch } from '@/utils/scheduleBatch'
import { isExternalEntryKind, type MaterialType } from '@/types/materialTransfer'
import type { DispatchKind, StockBatch } from '@/types/teamMaterials'

interface ScheduleLine {
  serialNo: string
  selectedRoute?: { id: number }
  source: StockBatch
  shared: boolean
  materialType: MaterialType | ''
  scheduleId?: number
  scheduleBatchId?: number
}

export function useStockActionSchedules(
  props: {
    modelValue: boolean
    teamId: number
    mode: 'dispatch' | 'loss'
    initialSchedule?: Pick<ProductionSchedule, 'id' | 'next_team_id' | 'external_destination'>
  },
  form: { nextTeamId: string | number; entryKind: DispatchKind; externalDestination: string },
  lines: Ref<ScheduleLine[]>,
) {
  const isLoss = computed(() => props.mode === 'loss')
  const external = computed(() => !isLoss.value && isExternalEntryKind(form.entryKind))
  const scheduleCandidates = ref<Record<string, ScheduleSummary[]>>({})
  const schedulesLoading = ref(false)
  const scheduleError = ref('')
  const scheduleRefresh = ref(0)
  const scheduleKey = (line: ScheduleLine) =>
    `${line.source.transfer.id}:${line.serialNo}:${line.selectedRoute?.id || ''}`
  function lineSchedules(line: ScheduleLine) {
    return !line.shared && isScheduleApplicable(line.materialType)
      ? scheduleCandidates.value[scheduleKey(line)] || []
      : []
  }
  function scheduleLabel(schedule: ScheduleSummary) {
    const basis =
      schedule.completion_basis ||
      (schedule.target_quantity != null || schedule.remaining_quantity != null
        ? 'quantity'
        : 'weight')
    const quantity = basis === 'weight' ? null : schedule.remaining_quantity
    const weight = basis === 'quantity' ? null : schedule.remaining_weight
    return `${schedule.serial_no} · ${formatScheduleBatch(schedule)} · ${formatDateTime(schedule.due_at)}${quantity == null ? '' : ` · 待交 ${quantity} 件`}${weight == null ? '' : ` · 待交 ${weight} kg`}`
  }
  function lineScheduleBatches(line: ScheduleLine) {
    const options = lineSchedules(line)
    return (
      (
        options.find((s) => s.id === line.scheduleId) ||
        (options.length === 1 ? options[0] : undefined)
      )?.batches || []
    )
  }
  watch(
    () =>
      [
        props.modelValue,
        props.teamId,
        props.mode,
        form.nextTeamId,
        form.entryKind,
        form.externalDestination,
        lines.value
          .map(
            (line) =>
              `${line.source.transfer.id}:${line.materialType}:${line.serialNo}:${line.selectedRoute?.id}:${line.shared}`,
          )
          .join(','),
        scheduleRefresh.value,
      ] as const,
    async (_, __, onCleanup) => {
      let current = true
      onCleanup(() => {
        current = false
      })
      scheduleError.value = ''
      scheduleCandidates.value = {}
      schedulesLoading.value = false
      if (
        !props.modelValue ||
        isLoss.value ||
        (!external.value && !form.nextTeamId) ||
        (external.value && !form.externalDestination)
      )
        return
      const ids = [
        ...new Set(
          lines.value
            .filter((line) => isScheduleApplicable(line.materialType))
            .map((line) => Number(line.source.transfer.id)),
        ),
      ]
      if (!ids.length) return
      schedulesLoading.value = true
      try {
        const result = await productionScheduleApi.candidates({
          team_id: props.teamId,
          source_transfer_ids: ids.join(','),
          ...(external.value
            ? { external_destination: form.externalDestination }
            : { next_team_id: Number(form.nextTeamId) }),
        })
        const candidates: Record<string, ScheduleSummary[]> = Object.fromEntries(
          lines.value.map((line) => [
            scheduleKey(line),
            result.items.find((item) => item.source_transfer_id === Number(line.source.transfer.id))
              ?.schedules || [],
          ]),
        )
        for (const line of lines.value) {
          if (!current) return
          if (line.shared || !line.selectedRoute || !isScheduleApplicable(line.materialType))
            continue
          const resolved = await productionScheduleApi.candidates({
            team_id: props.teamId,
            source_transfer_ids: String(line.source.transfer.id),
            serial_no: line.serialNo.trim(),
            process_route_id: line.selectedRoute.id,
            ...(external.value
              ? { external_destination: form.externalDestination }
              : { next_team_id: Number(form.nextTeamId) }),
          })
          candidates[scheduleKey(line)] = resolved.items[0]?.schedules || []
        }
        if (!current) return
        scheduleCandidates.value = candidates
        for (const line of lines.value) {
          const options = lineSchedules(line)
          if (!options.some((option) => option.id === line.scheduleId)) {
            line.scheduleId =
              options.find((option) => option.id === props.initialSchedule?.id)?.id ??
              (options.length === 1 ? options[0]!.id : undefined)
          }
        }
        const initial = props.initialSchedule
        const sameDestination =
          initial &&
          (external.value
            ? initial.external_destination === form.externalDestination
            : initial.next_team_id === Number(form.nextTeamId))
        if (
          sameDestination &&
          !lines.value.some((line) =>
            lineSchedules(line).some((option) => option.id === initial.id),
          )
        )
          scheduleError.value = '该排期已调整或已完成，请返回交货排期刷新后再操作。'
      } catch (error) {
        if (current)
          scheduleError.value = error instanceof Error ? error.message : '交货排期读取失败，请重试'
      } finally {
        if (current) schedulesLoading.value = false
      }
    },
    { immediate: true },
  )

  return {
    schedulesLoading,
    scheduleError,
    scheduleRefresh,
    lineSchedules,
    lineScheduleBatches,
    scheduleLabel,
  }
}
