import { computed, ref, watch, type Ref } from 'vue'
import { productionScheduleApi } from '@/services/productionScheduleApi'
import type { ProductionSchedule, ScheduleBatch, ScheduleSummary } from '@/types/productionSchedule'
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

export function useStockActionSchedules<Line extends ScheduleLine>(
  props: {
    modelValue: boolean
    teamId: number
    mode: 'dispatch' | 'loss'
    initialSchedule?: Pick<ProductionSchedule, 'id' | 'next_team_id' | 'external_destination'>
  },
  form: { nextTeamId: string | number; entryKind: DispatchKind; externalDestination: string },
  lines: Ref<Line[]>,
  nextTeamForLine: (line: Line) => number | null | undefined,
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
  function scheduleRemaining(schedule: ScheduleSummary, batch?: ScheduleBatch) {
    const basis =
      schedule.completion_basis ||
      (schedule.target_quantity != null || schedule.remaining_quantity != null
        ? 'quantity'
        : 'weight')
    const quantity = batch ? batch.target_quantity : schedule.remaining_quantity
    const weight = batch ? batch.target_weight : schedule.remaining_weight
    return {
      quantity:
        basis === 'weight' || quantity == null
          ? null
          : Math.max(0, quantity - (batch?.dispatched_quantity ?? 0)),
      weight:
        basis === 'quantity' || weight == null
          ? null
          : Math.max(0, weight - (batch?.dispatched_weight ?? 0)),
    }
  }
  function scheduleLabel(schedule: ScheduleSummary) {
    const { quantity, weight } = scheduleRemaining(schedule)
    return `${schedule.serial_no} · ${formatScheduleBatch(schedule)} · ${formatDateTime(schedule.due_at)}${quantity == null ? '' : ` · 待交 ${quantity} 件`}${weight == null ? '' : ` · 待交 ${weight} kg`}`
  }
  function selectedSchedule(line: ScheduleLine) {
    const options = lineSchedules(line)
    return (
      options.find((schedule) => schedule.id === line.scheduleId) ??
      (options.length === 1 ? options[0] : undefined)
    )
  }
  function lineScheduleBatches(line: ScheduleLine) {
    return selectedSchedule(line)?.batches || []
  }
  function selectedScheduleBatch(line: ScheduleLine) {
    const batches = lineScheduleBatches(line)
    return (
      batches.find((batch) => batch.id === line.scheduleBatchId) ??
      (batches.length === 1 ? batches[0] : undefined)
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
      if (!props.modelValue || isLoss.value || (external.value && !form.externalDestination)) return
      const destination = external.value
        ? { external_destination: form.externalDestination }
        : form.nextTeamId
          ? { next_team_id: Number(form.nextTeamId) }
          : undefined
      const applicable = lines.value.filter(
        (line) => !line.shared && isScheduleApplicable(line.materialType),
      )
      const ids = [...new Set(applicable.map((line) => Number(line.source.transfer.id)))]
      const lookups = applicable.flatMap((line) => {
        if (destination && !line.selectedRoute) return []
        const teamId = destination ? undefined : nextTeamForLine(line)
        if (!destination && !teamId) return []
        return [{ line, destination: destination ?? { next_team_id: teamId! } }]
      })
      if (!ids.length || (!destination && !lookups.length)) return
      schedulesLoading.value = true
      try {
        const candidates: Record<string, ScheduleSummary[]> = {}
        if (destination) {
          const result = await productionScheduleApi.candidates({
            team_id: props.teamId,
            source_transfer_ids: ids.join(','),
            ...destination,
          })
          if (!current) return
          for (const line of applicable)
            candidates[scheduleKey(line)] =
              result.items.find(
                (item) => item.source_transfer_id === Number(line.source.transfer.id),
              )?.schedules || []
        }
        for (const lookup of lookups) {
          if (!current) return
          const { line } = lookup
          const resolved = await productionScheduleApi.candidates({
            team_id: props.teamId,
            source_transfer_ids: String(line.source.transfer.id),
            ...lookup.destination,
            ...(line.selectedRoute
              ? {
                  serial_no: line.serialNo.trim(),
                  process_route_id: line.selectedRoute.id,
                }
              : {}),
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
    selectedSchedule,
    selectedScheduleBatch,
    scheduleRemaining,
    scheduleLabel,
  }
}
