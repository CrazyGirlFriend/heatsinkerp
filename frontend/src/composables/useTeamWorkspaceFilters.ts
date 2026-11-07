import { computed, ref, watch, type ComputedRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { TeamWorkspaceSection } from '@/config/teamWorkspaces'
import { useTeamDirectoryStore } from '@/stores/teamDirectory'
import type { CalendarRange } from '@/types/recordFilters'
import {
  isExternalEntryKind,
  materialEntryLabel,
  materialTypeLabel,
  materialTypeOptions,
  type MaterialType,
} from '@/types/materialTransfer'
import { dispatchStatusLabels, type DispatchKind, type DispatchStatus } from '@/types/teamMaterials'

export function useTeamWorkspaceFilters(tab: ComputedRef<TeamWorkspaceSection>) {
  const route = useRoute()
  const router = useRouter()
  const directory = useTeamDirectoryStore()
  const queryText = (key: string) =>
    typeof route.query[key] === 'string' ? String(route.query[key]) : ''
  const page = computed(() =>
    Number.isSafeInteger(Number(queryText('page'))) && Number(queryText('page')) > 0
      ? Number(queryText('page'))
      : 1,
  )
  const pageSize = computed(() =>
    [10, 20, 50, 100].includes(Number(queryText('page_size')))
      ? Number(queryText('page_size'))
      : 10,
  )
  const queryDraft = ref('')
  const dateDraft = ref<CalendarRange>({ from: '', to: '' }),
    urgentDraft = ref(false)
  const materialDraft = ref<MaterialType | ''>('')
  const receiptSourceDraft = ref<'external' | 'internal' | 'return' | ''>('')
  const batchStatusLabels = {
    pending: '转出待确认',
    received: '已签收',
    dispatched: dispatchStatusLabels.dispatched,
    voided: dispatchStatusLabels.voided,
  }
  type BatchStatus = Exclude<DispatchStatus, 'partial'>
  const statusDraft = ref<BatchStatus | ''>('')
  const nextTeamDraft = ref<string | number>('')
  const kindDraft = ref<DispatchKind | ''>('')
  const dispatchKinds = ['transfer', 'warehouse_outbound', 'inspection_shipment'] as const
  const listFiltersOpen = ref(false)
  const listFilterCount = computed(
    () =>
      activeListFilters.value.length +
      Number(Boolean(queryText('date_from') || queryText('date_to'))),
  )
  const queryBeforeFilters = ref('')
  function openListFilters() {
    queryBeforeFilters.value = queryDraft.value
    syncListFilterDrafts()
  }
  function cancelListFilters() {
    syncListFilterDrafts()
    queryDraft.value = queryBeforeFilters.value
  }
  function syncListFilterDrafts() {
    dateDraft.value = { from: queryText('date_from'), to: queryText('date_to') }
    urgentDraft.value = queryText('urgent_only') === 'true'
    materialDraft.value = queryText('material_type') as MaterialType | ''
    receiptSourceDraft.value = queryText('receipt_source') as typeof receiptSourceDraft.value
    kindDraft.value = queryText('entry_kind') as typeof kindDraft.value
    statusDraft.value = queryText('status') as typeof statusDraft.value
    nextTeamDraft.value = queryText('next_team_id')
  }
  function applyListDialog() {
    applyFilters()
    listFiltersOpen.value = false
  }
  watch(tab, () => {
    listFiltersOpen.value = false
  })
  const activeListFilters = computed(() =>
    [
      {
        key: 'material_type',
        label: materialTypeLabel(queryText('material_type') as MaterialType),
      },
      {
        key: 'receipt_source',
        label: (
          { external: '外部来料（含退回）', internal: '车间转入', return: '外部退回' } as Record<
            string,
            string
          >
        )[queryText('receipt_source')],
      },
      {
        key: 'entry_kind',
        label: materialEntryLabel(dispatchKinds.find((kind) => kind === queryText('entry_kind'))),
      },
      { key: 'status', label: batchStatusLabels[queryText('status') as BatchStatus] },
      {
        key: 'next_team_id',
        label: directory.items.find((item) => String(item.id) === queryText('next_team_id'))?.name,
      },
      { key: 'urgent_only', label: '仅看加急' },
    ].filter(
      (item) =>
        queryText(item.key) && (item.key !== 'urgent_only' || queryText(item.key) === 'true'),
    ),
  )

  function resetListFilters() {
    queryDraft.value = ''
    dateDraft.value = { from: '', to: '' }
    urgentDraft.value = false
    materialDraft.value = ''
    receiptSourceDraft.value = ''
    kindDraft.value = ''
    statusDraft.value = ''
    nextTeamDraft.value = ''
  }
  function applyFilters(nextPage = 1, size = pageSize.value) {
    void router.replace({
      path: route.path,
      query: {
        tab: tab.value,
        ...(tab.value === 'receipts' && receiptSourceDraft.value
          ? { receipt_source: receiptSourceDraft.value }
          : {}),
        ...(dateDraft.value.from ? { date_from: dateDraft.value.from } : {}),
        ...(dateDraft.value.to ? { date_to: dateDraft.value.to } : {}),
        ...(urgentDraft.value ? { urgent_only: 'true' } : {}),
        ...(queryDraft.value.trim() ? { query: queryDraft.value.trim() } : {}),
        ...(['receipts', 'outgoing', 'reallocations'].includes(tab.value) && materialDraft.value
          ? { material_type: materialDraft.value }
          : {}),
        ...(tab.value === 'outgoing'
          ? {
              ...(kindDraft.value ? { entry_kind: kindDraft.value } : {}),
              ...(statusDraft.value ? { status: statusDraft.value } : {}),
              ...(!isExternalEntryKind(kindDraft.value) && nextTeamDraft.value
                ? { next_team_id: String(nextTeamDraft.value) }
                : {}),
            }
          : {}),
        ...(nextPage > 1 ? { page: String(nextPage) } : {}),
        ...(size !== 10 ? { page_size: String(size) } : {}),
      },
    })
  }
  function listParams() {
    return {
      date_from: queryText('date_from') || undefined,
      date_to: queryText('date_to') || undefined,
      urgent_only: queryText('urgent_only') === 'true' || undefined,
      query: queryText('query') || undefined,
      page: page.value,
      page_size: pageSize.value,
    }
  }
  function receiptParams() {
    return {
      material_type: materialTypeOptions.find(
        (option) => option.value === queryText('material_type'),
      )?.value,
      receipt_source: ['external', 'internal', 'return'].includes(queryText('receipt_source'))
        ? (queryText('receipt_source') as 'external' | 'internal' | 'return')
        : undefined,
    }
  }
  function dispatchParams() {
    return {
      material_type: receiptParams().material_type,
      next_team_id: isExternalEntryKind(queryText('entry_kind'))
        ? undefined
        : queryText('next_team_id') || undefined,
      status: Object.keys(batchStatusLabels).includes(queryText('status'))
        ? (queryText('status') as BatchStatus)
        : undefined,
      entry_kind: dispatchKinds.find((kind) => kind === queryText('entry_kind')),
    }
  }
  function resetFiltersFromRoute() {
    dateDraft.value = { from: queryText('date_from'), to: queryText('date_to') }
    urgentDraft.value = queryText('urgent_only') === 'true'
    receiptSourceDraft.value = ['external', 'internal', 'return'].includes(
      queryText('receipt_source'),
    )
      ? (queryText('receipt_source') as 'external' | 'internal' | 'return')
      : ''
    queryDraft.value = queryText('query')
    materialDraft.value =
      materialTypeOptions.find((option) => option.value === queryText('material_type'))?.value || ''
    statusDraft.value = Object.keys(batchStatusLabels).includes(queryText('status'))
      ? (queryText('status') as BatchStatus)
      : ''
    nextTeamDraft.value = queryText('next_team_id')
    kindDraft.value = dispatchKinds.find((kind) => kind === queryText('entry_kind')) || ''
  }

  return {
    queryText,
    page,
    pageSize,
    queryDraft,
    dateDraft,
    urgentDraft,
    materialDraft,
    receiptSourceDraft,
    batchStatusLabels,
    statusDraft,
    nextTeamDraft,
    kindDraft,
    dispatchKinds,
    listFiltersOpen,
    listFilterCount,
    openListFilters,
    cancelListFilters,
    applyListDialog,
    resetListFilters,
    applyFilters,
    listParams,
    receiptParams,
    dispatchParams,
    resetFiltersFromRoute,
  }
}
