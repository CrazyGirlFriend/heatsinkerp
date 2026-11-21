<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElOption, ElTableColumn } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import AppButton from './AppButton.vue'
import AppDialog from './AppDialog.vue'
import AppSelect from './AppSelect.vue'
import WorkspaceTable from './WorkspaceTable.vue'
import MaterialInput from './MaterialInput.vue'
import WordDocumentPreview from './WordDocumentPreview.vue'
import ProcessRouteDrawingPreview from './ProcessRouteDrawingPreview.vue'
import ProcessRouteAttachments from './ProcessRouteAttachments.vue'
import { processRouteApi } from '@/services/processRouteApi'
import { productionScheduleApi } from '@/services/productionScheduleApi'
import type { ProcessRoute, RouteOrderDocument } from '@/types/processRoute'
import type { SharedMaterialSerial } from '@/types/sharedMaterial'

const props = defineProps<{
  modelValue: SharedMaterialSerial[]
  teamId: number
  disabled?: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [SharedMaterialSerial[]]
  'activate-member': [number]
  'routes-change': [ProcessRoute[]]
  'validation-change': [string]
}>()
const documents = ref(
  new Map<
    string,
    {
      route: ProcessRoute
      order: RouteOrderDocument
      taskId?: number
    }
  >(),
)
const errors = ref(new Map<string, string>())
const loading = ref(false)
const documentLabels = { word: '工艺原件', drawing: '图纸', order: '订单表' }
const preview = ref<{ serial: string; kind: keyof typeof documentLabels }>()
const previewDocuments = computed(() => preview.value && documents.value.get(preview.value.serial))
const drawingIndex = ref(0)
const orderDownload = computed(() => {
  const current = previewDocuments.value
  if (!current?.taskId) return undefined
  const { taskId, order } = current
  return () => productionScheduleApi.downloadOrder(taskId, order.filename)
})
function openPreview(serial: string, kind: keyof typeof documentLabels) {
  drawingIndex.value = 0
  preview.value = { serial: serial.trim(), kind }
}
function update(index: number, patch: Partial<SharedMaterialSerial>) {
  emit(
    'update:modelValue',
    props.modelValue.map((row, i) => (i === index ? { ...row, ...patch } : row)),
  )
}
const problem = computed(() => {
  const serials = props.modelValue.map((row) => row.serial_no.trim())
  if (serials.some((serial) => !serial)) return '请填写每个共投流水号'
  if (new Set(serials.map((serial) => serial.toLowerCase())).size !== serials.length)
    return '共投流水号不能重复'
  if (loading.value) return '正在读取共投工艺'
  const error = errors.value.values().next().value
  if (error) return error
  if (props.modelValue.some((row) => !row.process_route_id)) return '请为每个共投流水号读取工艺'
  return ''
})
watch(problem, (value) => emit('validation-change', value), { immediate: true })
watch(
  () => JSON.stringify([props.teamId, props.modelValue.map((row) => row.serial_no.trim())]),
  (_, __, onCleanup) => {
    let cancelled = false
    documents.value.clear()
    errors.value.clear()
    preview.value = undefined
    emit('routes-change', [])
    emit(
      'update:modelValue',
      props.modelValue.map((row) => ({
        ...row,
        process_route_id: undefined,
        process_route_version: undefined,
      })),
    )
    loading.value = true
    const timer = setTimeout(async () => {
      for (let index = 0; index < props.modelValue.length; index++) {
        const serial = props.modelValue[index]!.serial_no.trim()
        if (!serial) continue
        try {
          const route = await processRouteApi.resolve(serial)
          if (cancelled) return
          if (
            route.state !== 'published' ||
            route.route_kind === 'rework' ||
            route.steps[0]?.team_id !== props.teamId
          )
            throw new Error(`${serial}：请选择从本库房开始的正常工艺`)
          if (!route.filename || !route.drawings?.length)
            throw new Error(`${serial}：工艺原件或图纸未齐全`)
          const scheduled = await processRouteApi.dispatchOrder(route.id, serial)
          if (cancelled) return
          const order =
            scheduled?.document ||
            (route.source_data.order_document?.serial_no === serial
              ? route.source_data.order_document
              : undefined)
          if (!order) throw new Error(`${serial}：缺少订单表`)
          const fields = order.receipt_fields
          const hasDelivery = Boolean(
            fields.delivery_date?.value && fields.delivery_quantity?.value,
          )
          update(index, {
            process_route_id: route.id,
            process_route_version: route.version,
            customer_code: String(fields.customer_code?.value || ''),
            finished_specification: String(fields.finished_specification?.value || ''),
            delivery_date: hasDelivery ? String(fields.delivery_date!.value) : null,
            delivery_quantity: hasDelivery ? Number(fields.delivery_quantity!.value) : null,
          })
          documents.value.set(serial, { route, order, taskId: scheduled?.task_id })
        } catch (error) {
          if (cancelled) return
          const message = error instanceof Error && error.message
          errors.value.set(serial, message || `${serial}：工艺读取失败`)
        }
      }
      if (!cancelled) {
        loading.value = false
        emit(
          'routes-change',
          props.modelValue.flatMap((row) => documents.value.get(row.serial_no.trim())?.route || []),
        )
      }
    }, 300)
    onCleanup(() => {
      cancelled = true
      clearTimeout(timer)
    })
  },
  { immediate: true },
)
</script>

<template>
  <section class="shared-dispatch-fields" aria-label="共投流水号明细">
    <div class="shared-dispatch-heading">
      <h4>共投流水号</h4>
      <AppButton
        size="small"
        :icon="Plus"
        :disabled="disabled || modelValue.length >= 20"
        @click="emit('update:modelValue', [...modelValue, { serial_no: '' }])"
        >增加流水号</AppButton
      >
    </div>
    <WorkspaceTable
      @row-click="(row: SharedMaterialSerial) => emit('activate-member', modelValue.indexOf(row))"
      columns-key="SharedDispatchFields-1"
      class="shared-dispatch-table"
      :column-settings="false"
      :data="modelValue"
      size="small"
      :height="undefined"
      :fill="false"
    >
      <ElTableColumn label="流水号" min-width="176">
        <template #default="{ row, $index }">
          <MaterialInput
            class="shared-dispatch-serial"
            :model-value="row.serial_no"
            field="serial_no"
            :label="`共投流水号 ${$index + 1}`"
            :disabled="disabled"
            placeholder="输入或选择流水号"
            @focusin="emit('activate-member', $index)"
            @update:model-value="update($index, { serial_no: $event })"
          />
        </template>
      </ElTableColumn>
      <ElTableColumn label="工艺" min-width="122">
        <template #default="{ row }">
          <AppButton
            v-if="documents.has(row.serial_no.trim())"
            link
            class="shared-dispatch-document"
            :aria-label="`查看 ${row.serial_no} 工艺原件`"
            :title="documents.get(row.serial_no.trim())?.route.title"
            @click="openPreview(row.serial_no, 'word')"
            >{{ documents.get(row.serial_no.trim())?.route.title || '查看工艺' }}</AppButton
          >
          <span
            v-else-if="errors.has(row.serial_no.trim())"
            class="shared-dispatch-error"
            role="alert"
          >
            {{ errors.get(row.serial_no.trim()) }}
          </span>
          <span v-else class="shared-dispatch-placeholder">{{
            loading && row.serial_no.trim() ? '读取中…' : '—'
          }}</span>
        </template>
      </ElTableColumn>
      <ElTableColumn label="图纸" width="76">
        <template #default="{ row }">
          <AppButton
            v-if="documents.get(row.serial_no.trim())?.route.drawings?.length"
            link
            :aria-label="`查看 ${row.serial_no} 图纸`"
            @click="openPreview(row.serial_no, 'drawing')"
            >{{ documents.get(row.serial_no.trim())?.route.drawings?.length }} 张</AppButton
          >
          <span v-else class="shared-dispatch-placeholder">—</span>
        </template>
      </ElTableColumn>
      <ElTableColumn label="订单表" min-width="116">
        <template #default="{ row }">
          <AppButton
            v-if="documents.has(row.serial_no.trim())"
            link
            class="shared-dispatch-document"
            :aria-label="`查看 ${row.serial_no} 订单表`"
            :title="documents.get(row.serial_no.trim())?.order.filename"
            @click="openPreview(row.serial_no, 'order')"
            >{{ documents.get(row.serial_no.trim())?.order.filename || '查看订单' }}</AppButton
          >
          <span v-else class="shared-dispatch-placeholder">—</span>
        </template>
      </ElTableColumn>
      <ElTableColumn v-if="modelValue.length > 2" label="操作" width="64">
        <template #default="{ $index }"
          ><AppButton
            link
            :disabled="disabled"
            :aria-label="`移除共投流水号 ${$index + 1}`"
            @click="
              emit(
                'update:modelValue',
                modelValue.filter((_, i) => i !== $index),
              )
            "
            >移除</AppButton
          ></template
        >
      </ElTableColumn>
    </WorkspaceTable>
    <AppDialog
      v-if="preview && previewDocuments"
      :model-value="true"
      :title="`${preview.serial} · ${documentLabels[preview.kind]}`"
      width="min(960px, 94vw)"
      append-to-body
      @close="preview = undefined"
    >
      <WordDocumentPreview v-if="preview.kind === 'word'" :route="previewDocuments.route" />
      <template v-else-if="preview.kind === 'drawing'">
        <AppSelect
          v-if="(previewDocuments.route.drawings?.length || 0) > 1"
          v-model="drawingIndex"
          aria-label="选择图纸"
        >
          <ElOption
            v-for="(drawing, index) in previewDocuments.route.drawings"
            :key="drawing.id"
            :label="drawing.filename"
            :value="index"
          />
        </AppSelect>
        <ProcessRouteDrawingPreview
          class="shared-dispatch-drawing"
          :route-id="previewDocuments.route.id"
          :drawing="previewDocuments.route.drawings?.[drawingIndex]"
        />
      </template>
      <div v-else class="shared-dispatch-order">
        <ProcessRouteAttachments
          :route="previewDocuments.route"
          :documents="['order']"
          :order-document="previewDocuments.order"
          :order-task-id="previewDocuments.taskId"
          :order-download="orderDownload"
          :order-thumbnail="false"
        />
      </div>
    </AppDialog>
  </section>
</template>

<style scoped>
.shared-dispatch-fields {
  display: grid;
  gap: 8px;
  margin-bottom: 16px;
  min-width: 0;
}
.shared-dispatch-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.shared-dispatch-heading h4 {
  margin: 0;
  font-size: var(--font-size-section);
  font-weight: var(--font-weight-semibold);
}
.shared-dispatch-table :deep(.el-table__cell) {
  padding-block: 5px;
}
.shared-dispatch-serial {
  width: min(100%, 248px);
}
.shared-dispatch-document {
  max-width: 100%;
}
.shared-dispatch-document :deep(> span) {
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.shared-dispatch-placeholder {
  color: var(--muted);
}
.shared-dispatch-error {
  color: var(--el-color-danger);
  overflow-wrap: anywhere;
}
.shared-dispatch-drawing :deep(.drawing-preview-sheet),
.shared-dispatch-order :deep(.route-order-thumbnail--full) {
  height: min(65dvh, 640px);
  flex: none;
}
</style>
