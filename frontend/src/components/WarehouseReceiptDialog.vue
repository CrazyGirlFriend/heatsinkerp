<script setup lang="ts">
import AppDialog from '@/components/AppDialog.vue'
import FormWorkspace from './FormWorkspace.vue'
import CompactFormSection from './CompactFormSection.vue'
import ImportedDataConfirmation from './ImportedDataConfirmation.vue'
import { IconLink } from '@tabler/icons-vue'
import AppNumberInput from './AppNumberInput.vue'
import FormValidationNotice from './FormValidationNotice.vue'
import { useWatermelonAppearance } from '@/composables/useWorkspaceAppearance'
const watermelon = useWatermelonAppearance()
import WeightInput from './WeightInput.vue'
import { useDialogValidation } from '@/composables/useDialogValidation'
import MaterialInput from './MaterialInput.vue'
import SpecificationInput from './SpecificationInput.vue'
import AutofillBadge from './AutofillBadge.vue'
import WarehouseReceiptDocuments from './WarehouseReceiptDocuments.vue'
import { warehouseReceiptDocumentApi } from '@/services/warehouseReceiptDocumentApi'
import type { ReceiptDocument } from '@/types/warehouseReceiptDocuments'
import ProcessRouteEditor from './ProcessRouteEditor.vue'
import PublishedProcessRoutePicker from './PublishedProcessRoutePicker.vue'
import { useDocumentImport } from '@/composables/useDocumentImport'
import { processRouteApi } from '@/services/processRouteApi'
import type { ProcessRoute, RouteMaterialField, RouteOrderDocument } from '@/types/processRoute'
import { useMaterialAutofill } from '@/composables/useMaterialAutofill'
import type { MaterialInputField } from '@/services/materialInputApi'

import SludgeWeightFields from './SludgeWeightFields.vue'
import { sludgePayload, sludgeWeight } from '@/utils/sludgeWeight'
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import {
  ElAlert,
  ElForm,
  ElFormItem,
  ElInput,
  ElOption,
  ElSelect,
  ElSwitch,
  ElDatePicker,
} from 'element-plus'
import ElButton from '@/components/AppButton.vue'
import { useAuthStore } from '@/stores/auth'
import MaterialDeliveryFields from './MaterialDeliveryFields.vue'
import WarehouseLocationSelect from './WarehouseLocationSelect.vue'
import { deliveryError } from '@/utils/materialDelivery'
import { useTeamDirectoryStore } from '@/stores/teamDirectory'
import { teamMaterialApi, TeamMaterialApiError } from '@/services/teamMaterialApi'
import {
  materialDocumentTextFields,
  isScrapType,
  isWeightOnlyType,
  materialTypeOptions,
  type MaterialTransfer,
  type MaterialTransferTextField,
  type MaterialType,
} from '@/types/materialTransfer'
import type { SharedMaterialSerial } from '@/types/sharedMaterial'
import type { CreateWarehouseReceipt } from '@/types/teamMaterials'

const props = defineProps<{ modelValue: boolean; teamId: number }>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  saved: [transfer: MaterialTransfer]
}>()
const auth = useAuthStore()
const directory = useTeamDirectoryStore()
const warehouse = computed(() =>
  directory.items.find(
    (team) =>
      Number(team.id) === props.teamId &&
      team.active &&
      team.code === 'FACTORY-WAREHOUSE' &&
      team.kind === 'warehouse',
  ),
)
const canWrite = computed(
  () =>
    Boolean(warehouse.value) &&
    directory.loaded &&
    !directory.error &&
    auth.isTeamAccount &&
    auth.currentUser?.active !== false &&
    auth.currentUser?.id != null &&
    Number(auth.currentUser.team_id) === props.teamId &&
    !auth.currentUserError,
)
const identity = computed(() => `${auth.currentUser?.id ?? ''}:${props.teamId}`)
const saving = ref(false),
  locationBusy = ref(false)
const error = ref('')
const specificationKeys = ['finished_specification', 'transfer_specification']
const documentSections = [
  {
    name: 'document',
    label: '物料资料',
    fields: materialDocumentTextFields.filter(
      (field) =>
        !field.multiline && !specificationKeys.includes(field.key) && field.key !== 'material_name',
    ),
  },
  {
    name: 'specification',
    label: '规格工艺',
    fields: materialDocumentTextFields.filter(
      (field) =>
        specificationKeys.includes(field.key) ||
        ['technical_requirements', 'special_process'].includes(field.key),
    ),
  },
  {
    name: 'notes',
    label: '补充说明',
    fields: materialDocumentTextFields.filter((field) => field.key === 'material_description'),
  },
]
const importedRoute = ref<ProcessRoute | null>(null)
const importBusy = ref(false),
  routeEditorOpen = ref(false),
  routeReviewed = ref(false)
const routePickerOpen = ref(false)
const documentImport = useDocumentImport()
const documents = ref<ReceiptDocument[]>([])
const documentsBusy = ref(false)
const confirmedImports = ref(false)
const previewSerial = ref('')
const inheritedOrder = ref<RouteOrderDocument | null>(null)
const importFields = ref<Record<string, RouteMaterialField>>({})
const needsConfirmation = computed(() => Boolean(importedRoute.value || documents.value.length))
let importGeneration = 0
const attempt = ref<CreateWarehouseReceipt | null>(null)
const recoveryBlocked = ref(false)
const readonly = computed(
  () =>
    !props.modelValue ||
    !canWrite.value ||
    saving.value ||
    importBusy.value ||
    documentsBusy.value ||
    Boolean(attempt.value) ||
    recoveryBlocked.value,
)
const form = reactive({
  gross: undefined as number | undefined,
  percent: undefined as number | undefined,
  receiptKind: 'external' as 'external' | 'return',
  externalSource: '',
  returnDispatchNo: '',
  warehouseLocation: '',
  warehouseLocationKey: '',
  serialNo: '',
  materialType: '' as MaterialType | '',
  quantity: 0 as number | undefined,
  deliveryDate: '',
  deliveryQuantity: undefined as number | undefined,
  weight: 0 as number | undefined,
  notes: '',
  finishedQuantity: undefined as number | undefined,
  document: Object.fromEntries(
    materialDocumentTextFields.map((field) => [field.key, '']),
  ) as Record<MaterialTransferTextField, string>,
})
const shared = ref(false)
type MemberDraft = SharedMaterialSerial & {
  planned_specification: string
  specificationValid?: boolean
  documentSerial?: boolean
  serialSource?: { value: string; filename: string }
}
const members = ref<MemberDraft[]>([])
const newMember = (): MemberDraft => ({
  serial_no: '',
  customer_code: '',
  finished_specification: '',
  delivery_date: null,
  delivery_quantity: null,
  planned_weight: null,
  planned_quantity: null,
  planned_specification: '',
})
const plannedWeight = computed(
  () =>
    Math.round(
      members.value.reduce((sum, member) => sum + (member.planned_weight || 0), 0) * 1000000,
    ) / 1000000,
)
const plannedQuantity = computed(() =>
  members.value.reduce((sum, member) => sum + (member.planned_quantity || 0), 0),
)
const planWeightDifference = computed(
  () => Math.round((plannedWeight.value - (form.weight || 0)) * 1000000) / 1000000,
)
const sharedEntry = computed(() => shared.value && form.receiptKind === 'external')
const importedMember = computed(() =>
  sharedEntry.value
    ? members.value.find(
        (member) =>
          member.documentSerial ||
          member.serial_no === String(documentImport.original('serial_no')),
      )
    : undefined,
)
const importedMemberSignature = ref('')
function memberSignature() {
  return JSON.stringify(members.value.map(({ specificationValid: _valid, ...member }) => member))
}
const importedValues = computed<Record<string, string | number | null | undefined>>(() => ({
  ...form.document,
  serial_no: sharedEntry.value ? importedMember.value?.serial_no : form.serialNo,
  ...(sharedEntry.value
    ? {
        customer_code: importedMember.value?.customer_code,
        finished_specification: importedMember.value?.finished_specification,
      }
    : {}),
  quantity: form.quantity,
  weight: form.weight,
  finished_quantity: form.finishedQuantity,
  delivery_date: sharedEntry.value ? importedMember.value?.delivery_date : form.deliveryDate,
  delivery_quantity: sharedEntry.value
    ? importedMember.value?.delivery_quantity
    : form.deliveryQuantity,
  external_source: form.externalSource,
}))
function assignImportedField(key: string, value: string | number | undefined) {
  if (key in form.document)
    form.document[key as MaterialTransferTextField] = value == null ? '' : String(value)
  else if (key === 'serial_no') form.serialNo = value == null ? '' : String(value)
  else if (key === 'quantity') form.quantity = value == null ? 0 : Number(value)
  else if (key === 'weight') form.weight = value == null ? 0 : Number(value)
  else if (key === 'delivery_date') form.deliveryDate = value == null ? '' : String(value)
  else if (key === 'delivery_quantity')
    form.deliveryQuantity = value == null ? undefined : Number(value)
  else if (key === 'finished_quantity')
    form.finishedQuantity = value == null ? undefined : Number(value)
  else if (key === 'external_source') form.externalSource = value == null ? '' : String(value)
}
function documentSource(key: string) {
  return (
    importFields.value[key]?.source_filename ||
    (documentImport.original(key) !== undefined ? '工艺资料' : '')
  )
}
function applyImportFields() {
  const route = importedRoute.value
  const fields: Record<string, RouteMaterialField> = Object.fromEntries(
    Object.entries(route?.source_data.receipt_fields || {})
      .filter(
        ([key, field]) =>
          field.value !== '' &&
          (!route?.source_data.review_required ||
            !['quantity', 'weight', 'finished_quantity'].includes(key)),
      )
      .map(([key, field]) => [
        key,
        { ...field, source_filename: field.source_filename || route?.filename },
      ]),
  )
  // Browsing another shared serial's order must not change this batch's material fields.
  if (!sharedEntry.value && inheritedOrder.value?.serial_no === form.serialNo.trim())
    for (const [key, field] of Object.entries(inheritedOrder.value.receipt_fields)) {
      if (!fields[key]) fields[key] = field
    }
  for (const document of [...documents.value].sort(
    (a, b) => Number(b.kind === 'process') - Number(a.kind === 'process'),
  )) {
    for (const [key, field] of Object.entries(document.parsed.receipt_fields || {})) {
      if (
        document.parsed.review_required &&
        ['quantity', 'weight', 'finished_quantity'].includes(key)
      )
        continue
      if (field.value !== '' && (document.kind !== 'order' || !fields[key]))
        fields[key] = { ...field, source_filename: document.filename }
    }
  }
  for (const key of new Set([...Object.keys(importFields.value), ...Object.keys(fields)])) {
    const value = importedValues.value[key]
    const state = documentImport.state(key, value)
    if (
      state !== 'edited' &&
      (value == null ||
        value === '' ||
        (['quantity', 'weight'].includes(key) && value === 0) ||
        state === 'imported' ||
        !!autofill.source(key))
    )
      assignImportedField(key, fields[key]?.value)
  }
  importFields.value = fields
  documentImport.record(fields)
  confirmedImports.value = false
}
function uploadedDocument(document: ReceiptDocument) {
  documents.value = [
    ...documents.value.filter(
      (item) =>
        item.id !== document.id && (document.kind === 'drawing' || item.kind !== document.kind),
    ),
    document,
  ]
  applyImportFields()
}
async function removeDocument(id: number) {
  if (readonly.value) return
  const current = importGeneration
  documentsBusy.value = true
  try {
    await warehouseReceiptDocumentApi.remove(id)
    if (current !== importGeneration || !props.modelValue) return
    documents.value = documents.value.filter((item) => item.id !== id)
    applyImportFields()
  } catch (failure) {
    if (current === importGeneration)
      error.value = failure instanceof Error ? failure.message : '附件移除失败'
  } finally {
    if (current === importGeneration) documentsBusy.value = false
  }
}
function receiveOrder(document: RouteOrderDocument | null) {
  inheritedOrder.value = document
  if (!attempt.value) applyImportFields()
}
function documentChanged(key: string) {
  return documentImport.state(key, importedValues.value[key]) === 'edited'
}
function importedClass(key: string) {
  const state = documentImport.state(key, importedValues.value[key])
  return {
    'document-field--imported': state === 'imported',
    'document-field--edited': state === 'edited',
  }
}
async function selectRoute(route: ProcessRoute) {
  if (readonly.value || !props.modelValue) return
  if (route.state !== 'published') {
    error.value = '请选择工艺班组已发布的工艺'
    return
  }
  const current = ++importGeneration
  importBusy.value = true
  error.value = ''
  try {
    if (current !== importGeneration || !props.modelValue) return
    const fields = Object.fromEntries(
      Object.entries(route.source_data.receipt_fields || {}).filter(
        ([key, field]) =>
          field.value !== '' &&
          (!route.source_data.review_required ||
            !['quantity', 'weight', 'finished_quantity'].includes(key)),
      ),
    )
    const replace = (key: string) => {
      const value = importedValues.value[key]
      return (
        value == null ||
        value === '' ||
        (['quantity', 'weight'].includes(key) && value === 0) ||
        !!autofill.source(key) ||
        documentImport.state(key, value) === 'imported'
      )
    }
    const replaceable = new Set(
      Object.keys({ ...importedRoute.value?.source_data.receipt_fields, ...fields }).filter(
        replace,
      ),
    )
    const replaceMembers =
      !members.value.some((member) => member.serial_no.trim()) ||
      Boolean(importedMemberSignature.value && importedMemberSignature.value === memberSignature())
    autofill.reset()
    for (const key of Object.keys(importedRoute.value?.source_data.receipt_fields || {})) {
      if (!(key in fields) && replaceable.has(key)) assignImportedField(key, undefined)
    }
    for (const [key, field] of Object.entries(fields)) {
      if (replaceable.has(key)) assignImportedField(key, field.value)
    }
    if (replaceMembers) {
      shared.value = route.serial_nos.length > 1
      members.value =
        route.serial_nos.length > 1
          ? route.serial_nos.map((serial) => ({
              ...newMember(),
              serial_no: serial,
              documentSerial: serial === String(fields.serial_no?.value),
              serialSource: { value: serial, filename: route.filename },
              ...(serial === String(fields.serial_no?.value)
                ? {
                    customer_code: String(fields.customer_code?.value || ''),
                    finished_specification: String(fields.finished_specification?.value || ''),
                    delivery_date: fields.delivery_date ? String(fields.delivery_date.value) : null,
                    delivery_quantity: fields.delivery_quantity
                      ? Number(fields.delivery_quantity.value)
                      : null,
                  }
                : {}),
            }))
          : [newMember(), newMember()]
      importedMemberSignature.value = memberSignature()
    }
    if (route.serial_nos.length === 1 && !fields.serial_no && replace('serial_no'))
      assignImportedField('serial_no', route.serial_nos[0])
    if (route.filename)
      documents.value = documents.value.filter((document) => document.kind !== 'process')
    importedRoute.value = route
    inheritedOrder.value = null
    applyImportFields()
    routeReviewed.value = true
    validation.reset()
  } catch (failure) {
    if (current === importGeneration)
      error.value = failure instanceof Error ? failure.message : '工艺关联失败'
  } finally {
    if (current === importGeneration) importBusy.value = false
  }
}
const intakeSerials = computed(() =>
  sharedEntry.value
    ? members.value.map((member) => member.serial_no.trim())
    : [form.serialNo.trim()],
)
const routeSerialsMatch = computed(
  () =>
    !importedRoute.value ||
    !sharedEntry.value ||
    (intakeSerials.value.length === importedRoute.value.serial_nos.length &&
      intakeSerials.value.every((serial) => importedRoute.value!.serial_nos.includes(serial))),
)
watch(intakeSerials, () => {
  routeReviewed.value = routeSerialsMatch.value && importedRoute.value?.state === 'published'
})
const visibleSections = computed(() =>
  documentSections.map((section) => ({
    ...section,
    fields: section.fields.filter(
      (field) =>
        !sharedEntry.value || !['customer_code', 'finished_specification'].includes(field.key),
    ),
  })),
)
watch(sharedEntry, (active) => {
  if (active && members.value.length < 2) members.value = [newMember(), newMember()]
})
const weightOnly = computed(() => isWeightOnlyType(form.materialType))
const enteredQuantity = computed(() => (weightOnly.value ? 0 : form.quantity))
const autofill = useMaterialAutofill(() => (sharedEntry.value ? '' : form.serialNo), form.document)
const specificationValidity = reactive<Record<string, boolean>>({
  finished_specification: true,
  transfer_specification: true,
})
const suggestionFields = [
  'material_name',
  'customer_code',
  'product_code',
  'part_no',
  'outsourced_unit',
]
let generation = 0
const storageKey = (scope: string) => `heatsink-flow.pending-warehouse-receipt.v1:${scope}`

function fill(payload: CreateWarehouseReceipt | null = null) {
  ++importGeneration
  importBusy.value = false
  importedRoute.value = null
  documents.value = []
  documentsBusy.value = false
  confirmedImports.value = payload?.confirmed_imports ?? false
  inheritedOrder.value = null
  importFields.value = {}
  previewSerial.value = ''
  routeEditorOpen.value = false
  routePickerOpen.value = false
  routeReviewed.value = false
  documentImport.reset()
  importedMemberSignature.value = ''
  autofill.reset()
  specificationValidity.finished_specification = specificationValidity.transfer_specification = true
  form.warehouseLocation = payload?.warehouse_location || ''
  form.warehouseLocationKey = payload?.warehouse_location_reservation_key || ''
  form.receiptKind = payload?.receipt_kind || 'external'
  form.externalSource = payload?.external_source || ''
  form.returnDispatchNo = payload?.return_dispatch_no || ''
  shared.value = Boolean(payload?.shared_serials?.length)
  members.value = payload?.shared_serials?.map((member) => ({
    ...member,
    planned_specification: member.planned_specification || '',
  })) || [newMember(), newMember()]
  form.serialNo = payload?.serial_no || ''
  form.materialType = payload?.material_type || ''
  form.quantity = payload?.quantity ?? 0
  form.weight = payload?.weight ?? 0
  form.notes = payload?.notes || ''
  form.gross = payload?.sludge_gross_weight ?? undefined
  form.percent = payload?.sludge_content_percent ?? undefined
  form.finishedQuantity = payload?.finished_quantity ?? undefined
  form.deliveryDate = payload?.delivery_date || ''
  form.deliveryQuantity = payload?.delivery_quantity ?? undefined
  materialDocumentTextFields.forEach((field) => {
    form.document[field.key] = payload?.[field.key] || ''
  })
}
function restoreAttempt() {
  attempt.value = null
  recoveryBlocked.value = false
  error.value = ''
  validation.reset()
  try {
    const saved = sessionStorage.getItem(storageKey(identity.value))
    if (saved) {
      const payload = JSON.parse(saved) as CreateWarehouseReceipt
      if (
        !payload ||
        typeof payload.idempotency_key !== 'string' ||
        !payload.idempotency_key ||
        typeof payload.serial_no !== 'string' ||
        typeof payload.material_name !== 'string'
      )
        throw new Error('Invalid draft')
      attempt.value = payload
    }
  } catch {
    recoveryBlocked.value = true
    error.value = '上次入库草稿读取失败，请先在入库记录中核对，避免重复登记。'
  }
  fill(attempt.value)
  if (attempt.value?.document_ids?.length) {
    const current = importGeneration
    void Promise.all(attempt.value.document_ids.map((id) => warehouseReceiptDocumentApi.detail(id)))
      .then((items) => {
        if (current === importGeneration && props.modelValue) documents.value = items
      })
      .catch(() => {
        if (current === importGeneration) error.value = '附件暂时无法加载，重试仍沿用上次附件'
      })
  }
  if (attempt.value?.process_route) {
    const pending = attempt.value.process_route,
      current = importGeneration
    void processRouteApi
      .detail(pending.id)
      .then((route) => {
        if (current !== importGeneration || !props.modelValue) return
        importedRoute.value = { ...route, ...pending }
        importFields.value = route.source_data.receipt_fields || {}
        documentImport.record(importFields.value)
        routeReviewed.value = true
      })
      .catch(() => {
        if (current === importGeneration)
          error.value = '原工艺单暂时无法加载，入库重试仍沿用上次核对内容'
      })
  }
}
function close() {
  if (!saving.value) emit('update:modelValue', false)
}
const validation = useDialogValidation(() => {
  const issues: Record<string, string> = {}
  if (needsConfirmation.value && !confirmedImports.value)
    issues.confirmedImports = '请核对文件带入的信息，并勾选确认'
  if (importedRoute.value && (!routeReviewed.value || !routeSerialsMatch.value))
    issues.processRoute = '共投流水号须与所选工艺一致，请重新关联工艺'
  if (
    importedRoute.value &&
    (form.receiptKind !== 'external' || isScrapType(form.materialType || null))
  )
    issues.processRoute = '工艺单用于正常物料的首次入库'
  if (!form.externalSource.trim() || form.externalSource.trim().length > 240)
    issues.externalSource = '请填写外部来源单位'
  if (
    !sharedEntry.value &&
    ((!form.serialNo.trim() && form.receiptKind === 'return') || form.serialNo.trim().length > 80)
  )
    issues.serialNo = '请输入有效流水号'
  if (sharedEntry.value) {
    const serials = members.value.map((member) => member.serial_no.trim().toLocaleLowerCase())
    members.value.forEach((member, index) => {
      if (
        !member.serial_no.trim() ||
        member.serial_no.length > 80 ||
        serials.indexOf(serials[index]!) !== index ||
        member.serial_no.startsWith('共投-')
      )
        issues[`member${index}serial`] = '流水号不能为空或重复'
      if (
        member.planned_weight == null ||
        !Number.isFinite(member.planned_weight) ||
        member.planned_weight <= 0 ||
        member.planned_weight > 99999999999.999 ||
        Math.abs(member.planned_weight * 1000000 - Math.round(member.planned_weight * 1000000)) >
          0.0001
      )
        issues[`member${index}weight`] = '请填写计划用料重量'
      if (
        !Number.isSafeInteger(member.planned_quantity) ||
        Number(member.planned_quantity) <= 0 ||
        Number(member.planned_quantity) > 2147483647
      )
        issues[`member${index}quantity`] = '请填写计划切出件数'
      if (
        !member.planned_specification.trim() ||
        member.planned_specification.length > 240 ||
        member.specificationValid === false
      )
        issues[`member${index}cutting`] = '请填写完整的计划切割尺寸'
      if ((member.customer_code?.length || 0) > 80) issues[`member${index}customer`] = '内容过长'
      if ((member.finished_specification?.length || 0) > 240)
        issues[`member${index}specification`] = '内容过长'
      const message = deliveryError(
        member.delivery_date || '',
        member.delivery_quantity ?? undefined,
      )
      if (message) issues[`member${index}delivery`] = message
    })
    if (members.value.length < 2 || members.value.length > 20)
      issues.members = '请选择 2 至 20 个流水号'
    if (isScrapType(form.materialType || null)) issues.materialType = '共投入库请选择正常物料'
  }
  if (!form.document.material_name.trim()) issues.material_name = '请输入材质'
  if (!form.materialType) issues.materialType = '请选择物料类型'
  if (form.materialType === 'sludge' && !sludgeWeight(form.gross, form.percent)) {
    if (!sludgeWeight(form.gross, 100)) issues.gross = '请填写有效废泥实重'
    if (!sludgeWeight(1, form.percent)) issues.percent = '请填写有效材料占比'
    if (!issues.gross && !issues.percent) issues.gross = '折算重量须达到 0.000001 kg'
  }
  if (form.warehouseLocation.length > 80) issues.warehouseLocation = '仓位不能超过 80 个字符'
  if (
    enteredQuantity.value == null ||
    !Number.isInteger(enteredQuantity.value) ||
    enteredQuantity.value < 0 ||
    enteredQuantity.value > 2147483647
  )
    issues.quantity = '请填写有效非负整数'
  if (
    form.materialType !== 'sludge' &&
    (form.weight == null ||
      !Number.isFinite(form.weight) ||
      form.weight < 0 ||
      form.weight > 99999999999.999 ||
      Math.abs(form.weight * 1000000 - Math.round(form.weight * 1000000)) > 0.0001)
  )
    issues.weight = '请填写有效非负重量'
  else if (weightOnly.value && !form.weight) issues.weight = '请填写大于 0 的重量'
  else if (enteredQuantity.value === 0 && form.weight === 0) {
    issues.quantity = issues.weight = '件数和重量至少一项大于 0'
  }
  if (form.receiptKind === 'external' && !weightOnly.value && !sharedEntry.value) {
    const message = deliveryError(form.deliveryDate, form.deliveryQuantity)
    if (message)
      issues[
        !form.deliveryDate || message.includes('有效的要求发货日期')
          ? 'deliveryDate'
          : 'deliveryQuantity'
      ] = message
  }
  for (const field of materialDocumentTextFields) {
    if (sharedEntry.value && ['customer_code', 'finished_specification'].includes(field.key))
      continue
    if (specificationValidity[field.key] === false) issues[field.key] = '请填完整规格尺寸'
    else if (form.document[field.key].trim().length > field.maxLength)
      issues[field.key] = '内容过长'
  }
  if (
    !weightOnly.value &&
    form.finishedQuantity != null &&
    (!Number.isInteger(form.finishedQuantity) ||
      form.finishedQuantity < 0 ||
      form.finishedQuantity > 2147483647)
  )
    issues.finishedQuantity = '请填写有效非负整数'
  if (form.notes.trim().length > 2000) issues.notes = '内容过长'
  const order = documents.value.find((document) => document.kind === 'order')
  const serials = intakeSerials.value.filter(Boolean)
  if (order?.parsed.serial_no && serials.length && !serials.includes(order.parsed.serial_no))
    issues[sharedEntry.value ? 'members' : 'serialNo'] = '订单表流水号与本次入库不一致，请核对'
  return issues
})
const { formRef, fieldErrors } = validation
function payload(): CreateWarehouseReceipt {
  return {
    ...Object.fromEntries(
      materialDocumentTextFields.map((field) => [
        field.key,
        form.document[field.key].trim() || null,
      ]),
    ),
    serial_no: sharedEntry.value ? '' : form.serialNo.trim(),
    material_name: form.document.material_name.trim(),
    material_type: form.materialType as MaterialType,
    receipt_kind: form.receiptKind,
    external_source: form.externalSource.trim(),
    return_dispatch_no: form.receiptKind === 'return' ? form.returnDispatchNo.trim() || null : null,
    warehouse_location: form.warehouseLocation.trim() || null,
    ...(form.warehouseLocationKey
      ? { warehouse_location_reservation_key: form.warehouseLocationKey }
      : {}),
    quantity: Number(enteredQuantity.value),
    weight: Number(form.weight),
    notes: form.notes.trim(),
    finished_quantity: weightOnly.value ? null : (form.finishedQuantity ?? null),
    ...(form.materialType === 'sludge'
      ? sludgePayload(form.materialType, form.gross, form.percent)
      : {}),
    ...(form.receiptKind === 'external'
      ? {
          delivery_date: weightOnly.value ? null : form.deliveryDate || null,
          delivery_quantity: weightOnly.value ? null : (form.deliveryQuantity ?? null),
        }
      : {}),
    ...(sharedEntry.value
      ? {
          customer_code: null,
          finished_specification: null,
          delivery_date: null,
          delivery_quantity: null,
          shared_serials: members.value.map((member) => ({
            serial_no: member.serial_no.trim(),
            customer_code: member.customer_code?.trim() || null,
            finished_specification: member.finished_specification?.trim() || null,
            delivery_date: member.delivery_date || null,
            delivery_quantity: member.delivery_quantity ?? null,
            planned_weight: member.planned_weight,
            planned_quantity: member.planned_quantity,
            planned_specification: member.planned_specification.trim(),
          })),
        }
      : {}),
    ...(importedRoute.value
      ? {
          process_route: {
            id: importedRoute.value.id,
            version: importedRoute.value.version,
            title: importedRoute.value.title,
            serial_nos: importedRoute.value.serial_nos,
            steps: importedRoute.value.steps,
            review_note: importedRoute.value.review_note,
          },
        }
      : {}),
    document_ids: documents.value.map((document) => document.id),
    confirmed_imports: confirmedImports.value,
    idempotency_key:
      globalThis.crypto?.randomUUID?.() ||
      `warehouse-receipt-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  }
}
async function submit() {
  if (routePickerOpen.value) return
  if (
    locationBusy.value ||
    importBusy.value ||
    documentsBusy.value ||
    saving.value ||
    recoveryBlocked.value ||
    !canWrite.value ||
    (!attempt.value && !validation.validate())
  )
    return
  const scope = identity.value,
    teamId = props.teamId,
    current = ++generation
  saving.value = true
  error.value = ''
  try {
    await auth.refreshCurrentUser()
    await directory.refreshTeamDirectory()
    if (current !== generation || scope !== identity.value || !props.modelValue) return
    if (!canWrite.value) {
      error.value = '账号或库房信息已变更，当前不能入库'
      return
    }
    const body = attempt.value || payload()
    // Persist before sending: a lost response or reopened dialog must retry the same entry.
    try {
      sessionStorage.setItem(storageKey(scope), JSON.stringify(body))
    } catch {
      error.value = '无法保存本次入库的重试信息，请检查浏览器存储后重试'
      return
    }
    attempt.value = body
    try {
      const saved = await teamMaterialApi.createReceipt(teamId, body)
      sessionStorage.removeItem(storageKey(scope))
      if (current !== generation || scope !== identity.value || !props.modelValue) return
      attempt.value = null
      emit('saved', saved)
      emit('update:modelValue', false)
    } catch (failure) {
      const definitive =
        failure instanceof TeamMaterialApiError &&
        ([400, 403, 404, 422].includes(failure.status) ||
          (failure.status === 409 && /仓位|工艺/.test(failure.message)))
      if (definitive) sessionStorage.removeItem(storageKey(scope))
      if (current !== generation || scope !== identity.value || !props.modelValue) return
      if (definitive) {
        attempt.value = null
        if (failure.message.includes('工艺') && importedRoute.value) {
          routeReviewed.value = false
          try {
            const latest = await processRouteApi.detail(importedRoute.value.id)
            if (current === generation && scope === identity.value && props.modelValue)
              importedRoute.value = latest
          } catch {
            /* Keep the local comparison available if refresh is unavailable. */
          }
        }
        if (failure.message.includes('仓位')) {
          form.warehouseLocation = ''
          form.warehouseLocationKey = ''
        }
      }
      error.value = failure instanceof Error ? failure.message : '入库提交失败，请重试核对'
    }
  } catch (failure) {
    if (current === generation && scope === identity.value)
      error.value = failure instanceof Error ? failure.message : '账号信息核验失败，请重试'
  } finally {
    if (current === generation) saving.value = false
  }
}
watch(
  [importedValues, () => form.materialType, () => memberSignature(), () => importedRoute.value?.id],
  () => {
    if (!attempt.value) confirmedImports.value = false
  },
  { flush: 'sync' },
)
watch(
  intakeSerials,
  (serials) => {
    if (!serials.includes(previewSerial.value)) previewSerial.value = serials.find(Boolean) || ''
  },
  { immediate: true },
)
watch(
  () => props.modelValue,
  (open) => {
    ++generation
    ++importGeneration
    importBusy.value = false
    saving.value = false
    if (open) restoreAttempt()
  },
  { immediate: true },
)
watch(identity, () => {
  ++generation
  saving.value = false
  attempt.value = null
  fill()
  emit('update:modelValue', false)
})
onBeforeUnmount(() => {
  ++generation
  ++importGeneration
})
</script>

<template>
  <AppDialog
    :model-value="modelValue"
    title="库房手工入库"
    width="min(1440px, 96vw)"
    top="16px"
    class="warehouse-receipt-dialog"
    :close-on-click-modal="!saving"
    :close-on-press-escape="!saving"
    :show-close="!saving"
    @close="close"
  >
    <template #header="{ titleId, titleClass }"
      ><div class="receipt-heading">
        <h2 :id="titleId" :class="titleClass">手工入库</h2>
        <span
          >入库库房 · <strong>{{ warehouse?.name || '当前库房不可用' }}</strong></span
        >
      </div></template
    >
    <ElAlert v-if="error" :title="error" type="error" :closable="false" />
    <ElAlert
      v-if="!canWrite"
      type="warning"
      :closable="false"
      title="仅绑定正式库房的有效班组账号可以手工入库"
    />
    <ElAlert
      v-if="attempt"
      class="receipt-retry"
      type="warning"
      :closable="false"
      title="上次提交结果待确认"
      description="请重试核对同一次入库。核对完成前保留原内容，避免重复登记。"
      show-icon
    />
    <FormWorkspace class="receipt-document-layout">
      <template #documents>
        <div v-if="modelValue" class="receipt-document-panel" aria-label="入库附件">
          <ElSelect v-if="sharedEntry" v-model="previewSerial" aria-label="附件流水号">
            <ElOption
              v-for="serial in intakeSerials.filter(Boolean)"
              :key="serial"
              :value="serial"
              :label="serial"
            />
          </ElSelect>
          <WarehouseReceiptDocuments
            :team-id="teamId"
            :route="importedRoute || undefined"
            :serial-no="previewSerial"
            :documents="documents"
            editable
            :disabled="readonly"
            @uploaded="uploadedDocument"
            @remove="removeDocument"
            @inherited-order="receiveOrder"
            @busy="documentsBusy = $event"
            @error="error = $event"
          />
        </div>
      </template>
      <ElForm
        ref="formRef"
        class="receipt-form"
        label-position="top"
        :show-message="watermelon"
        @submit.prevent="submit"
      >
        <FormValidationNotice
          v-if="watermelon"
          :message="
            Object.keys(fieldErrors).length
              ? `还有 ${Object.keys(fieldErrors).length} 项需要填写或修改`
              : ''
          "
        />
        <ElFormItem
          v-if="form.receiptKind === 'external' || importedRoute"
          label="关联工艺"
          :error="fieldErrors.processRoute"
          class="receipt-route-choice"
        >
          <div class="receipt-route-choice-content">
            <strong>{{ importedRoute?.serial_nos.join('、') || '未关联' }}</strong>
            <ElButton :loading="importBusy" :disabled="readonly" @click="routePickerOpen = true">
              <IconLink :size="16" />{{ importedRoute ? '更换工艺' : '选择工艺' }}
            </ElButton>
            <ElButton v-if="importedRoute" link :disabled="readonly" @click="routeEditorOpen = true"
              >查看工艺</ElButton
            >
          </div>
        </ElFormItem>
        <CompactFormSection title="入库信息" class="receipt-primary-section">
          <template v-if="sharedEntry" #actions
            ><span class="receipt-shared-summary"
              >共投 · {{ members.length }} 个流水号</span
            ></template
          >
          <ElFormItem label="入库来源" :error="fieldErrors.receiptKind" required
            ><ElSelect v-model="form.receiptKind" aria-label="入库来源" :disabled="readonly"
              ><ElOption value="external" label="外部来料" /><ElOption
                value="return"
                label="外部退回" /></ElSelect
          ></ElFormItem>
          <ElFormItem
            label="外部来源单位"
            :error="fieldErrors.externalSource"
            :class="importedClass('external_source')"
            required
            ><template #label
              >外部来源单位<AutofillBadge
                :source="documentSource('external_source')"
                kind="document"
                :modified="documentChanged('external_source')" /></template
            ><MaterialInput
              v-model="form.externalSource"
              field="external_source"
              label="外部来源单位"
              :maxlength="240"
              :disabled="readonly"
              placeholder="供应商、外委单位或退回单位"
          /></ElFormItem>
          <ElFormItem
            v-if="form.receiptKind === 'return'"
            label="原出库批次"
            :error="fieldErrors.returnDispatchNo"
            class="dialog-field-wide"
            ><ElInput
              v-model="form.returnDispatchNo"
              aria-label="原出库批次"
              maxlength="40"
              :disabled="readonly"
              placeholder="选填已确认的出库批次号；流水号沿用原号"
          /></ElFormItem>
          <ElFormItem
            v-if="!sharedEntry"
            label="流水号"
            :error="fieldErrors.serialNo"
            :class="['receipt-identity-field', importedClass('serial_no')]"
            :required="form.receiptKind === 'return'"
            ><template #label
              >流水号<AutofillBadge
                :source="documentSource('serial_no')"
                kind="document"
                :modified="documentChanged('serial_no')" /></template
            ><MaterialInput
              v-model="form.serialNo"
              field="serial_no"
              label="流水号"
              :maxlength="80"
              :disabled="readonly"
              placeholder="选填，出库时可补充"
              @selected="autofill.select"
          /></ElFormItem>
          <ElFormItem
            label="材质"
            :error="fieldErrors.material_name"
            :class="['receipt-identity-field', importedClass('material_name')]"
            required
            ><template #label
              >材质<AutofillBadge
                :source="documentSource('material_name') || autofill.source('material_name')"
                :kind="documentSource('material_name') ? 'document' : undefined"
                :modified="documentChanged('material_name')" /></template
            ><MaterialInput
              v-model="form.document.material_name"
              field="material_name"
              label="材质"
              :disabled="readonly"
              placeholder="输入或选择材质"
          /></ElFormItem>
          <ElFormItem label="物料类型" :error="fieldErrors.materialType" required
            ><ElSelect
              v-model="form.materialType"
              aria-label="物料类型"
              placeholder="选择物料类型"
              :disabled="readonly"
              ><ElOption
                v-for="item in materialTypeOptions"
                :key="item.value"
                :label="item.label"
                :value="item.value" /></ElSelect
          ></ElFormItem>
        </CompactFormSection>
        <CompactFormSection title="数量与交期" class="dialog-section-quantities">
          <MaterialDeliveryFields
            class="form-field--long"
            v-if="form.receiptKind === 'external' && !weightOnly && !sharedEntry"
            v-model:date="form.deliveryDate"
            v-model:quantity="form.deliveryQuantity"
            :disabled="readonly"
            :date-error="fieldErrors.deliveryDate"
            :quantity-error="fieldErrors.deliveryQuantity"
            :document-source="importedRoute?.filename"
            :date-source="documentSource('delivery_date')"
            :quantity-source="documentSource('delivery_quantity')"
            :date-state="documentImport.state('delivery_date', importedValues.delivery_date)"
            :quantity-state="
              documentImport.state('delivery_quantity', importedValues.delivery_quantity)
            "
          />
          <ElFormItem
            v-if="!weightOnly"
            label="入库件数"
            class="form-field--short"
            :error="fieldErrors.quantity"
            :class="importedClass('quantity')"
            required
            ><template #label
              >入库件数<AutofillBadge
                :source="documentSource('quantity')"
                kind="document"
                :modified="documentChanged('quantity')" /></template
            ><AppNumberInput
              v-model="form.quantity"
              aria-label="入库件数"
              :min="0"
              :max="2147483647"
              :precision="0"
              controls-position="right"
              :disabled="readonly"
              ><template #suffix
                ><span class="dialog-input-unit">件</span></template
              ></AppNumberInput
            ></ElFormItem
          >
          <ElFormItem
            v-if="form.materialType !== 'sludge'"
            label="入库重量"
            :error="fieldErrors.weight"
            :class="importedClass('weight')"
            required
            ><template #label
              >入库重量<AutofillBadge
                :source="documentSource('weight')"
                kind="document"
                :modified="documentChanged('weight')" /></template
            ><WeightInput
              v-model="form.weight"
              ariaLabel="入库重量"
              :max="99999999999.999"
              :disabled="readonly"
          /></ElFormItem>
          <SludgeWeightFields
            v-else
            v-model:gross="form.gross"
            v-model:percent="form.percent"
            :disabled="readonly"
            :gross-error="fieldErrors.gross"
            :percent-error="fieldErrors.percent"
            @update:weight="form.weight = $event"
          />
          <ElFormItem
            label="入库仓位"
            :error="fieldErrors.warehouseLocation"
            class="form-field--long"
            ><WarehouseLocationSelect
              v-model="form.warehouseLocation"
              v-model:reservation-key="form.warehouseLocationKey"
              :team-id="teamId"
              :serial-no="sharedEntry ? '' : form.serialNo"
              :material-name="form.document.material_name"
              :material-type="form.materialType"
              :active="modelValue"
              :disabled="readonly"
              @busy-change="locationBusy = $event"
          /></ElFormItem>
        </CompactFormSection>
        <template v-for="section in visibleSections" :key="section.name">
          <CompactFormSection
            :title="section.label"
            :class="{
              'dialog-section-long': section.name !== 'document',
              'dialog-section-details': section.name === 'document',
            }"
          >
            <ElFormItem
              v-for="field in section.fields"
              :key="field.key"
              :label="field.label"
              :error="fieldErrors[field.key]"
              :class="[
                { 'form-field--long': specificationKeys.includes(field.key) || field.multiline },
                importedClass(field.key),
              ]"
              ><template #label
                >{{ field.label
                }}<AutofillBadge
                  :source="documentSource(field.key) || autofill.source(field.key)"
                  :kind="documentSource(field.key) ? 'document' : undefined"
                  :modified="documentChanged(field.key)" /></template
              ><SpecificationInput
                v-if="specificationKeys.includes(field.key)"
                v-model="form.document[field.key]"
                :label="field.label"
                :disabled="readonly"
                @validity-change="specificationValidity[field.key] = $event" /><MaterialInput
                v-else-if="suggestionFields.includes(field.key)"
                v-model="form.document[field.key]"
                :field="field.key as MaterialInputField"
                :label="field.label"
                :maxlength="field.maxLength"
                :disabled="readonly" /><ElInput
                v-else
                v-model="form.document[field.key]"
                :aria-label="field.label"
                :type="field.multiline ? 'textarea' : 'text'"
                :rows="2"
                :maxlength="field.maxLength"
                :show-word-limit="field.multiline"
                :disabled="readonly"
                placeholder="选填"
            /></ElFormItem>
            <ElFormItem
              v-if="section.name === 'document' && !weightOnly"
              label="成品件数"
              class="form-field--short"
              :error="fieldErrors.finishedQuantity"
              ><template #label
                >成品件数<AutofillBadge
                  :source="documentSource('finished_quantity')"
                  kind="document"
                  :modified="documentChanged('finished_quantity')" /></template
              ><AppNumberInput
                v-model="form.finishedQuantity"
                aria-label="成品件数"
                :min="0"
                :max="2147483647"
                :precision="0"
                controls-position="right"
                :disabled="readonly"
                placeholder="选填"
                ><template #suffix
                  ><span class="dialog-input-unit">件</span></template
                ></AppNumberInput
              ></ElFormItem
            >
            <template v-if="section.name === 'notes'">
              <ElFormItem label="入库说明" class="form-field--long" :error="fieldErrors.notes"
                ><ElInput
                  v-model="form.notes"
                  aria-label="入库说明"
                  type="textarea"
                  :rows="2"
                  maxlength="2000"
                  show-word-limit
                  :disabled="readonly"
                  placeholder="选填：说明来料来源及本次入库情况"
              /></ElFormItem>
            </template>
          </CompactFormSection>
          <section
            v-if="form.receiptKind === 'external' && section.name === 'specification'"
            class="shared-entry-section"
          >
            <div class="shared-entry-heading">
              <ElSwitch
                v-model="shared"
                :disabled="readonly"
                active-text="共投入库"
                aria-label="共投入库"
              /><span v-if="sharedEntry">先填写各流水号用料计划；整块料库存只记一次</span>
            </div>
            <div
              v-if="sharedEntry"
              class="shared-members"
              :class="{ 'dialog-field is-error': Boolean(fieldErrors.members) }"
              :aria-invalid="Boolean(fieldErrors.members)"
              data-validation-field="members"
              role="group"
              tabindex="-1"
              aria-label="共投流水号安排"
              aria-description="填写2至20个流水号"
            >
              <article v-for="(member, index) in members" :key="index" class="shared-member">
                <div class="shared-member-grid">
                  <ElFormItem
                    label="流水号"
                    required
                    class="shared-field-serial"
                    :error="fieldErrors[`member${index}serial`]"
                    :class="member.documentSerial ? importedClass('serial_no') : ''"
                  >
                    <template #label
                      >流水号
                      <small class="shared-member-index">{{
                        String(index + 1).padStart(2, '0')
                      }}</small
                      ><AutofillBadge
                        v-if="member.serialSource || member.documentSerial"
                        :source="member.serialSource?.filename || documentSource('serial_no')"
                        kind="document"
                        :modified="
                          member.serialSource
                            ? member.serial_no !== member.serialSource.value
                            : documentChanged('serial_no')
                        "
                    /></template>
                    <MaterialInput
                      v-model="member.serial_no"
                      field="serial_no"
                      :label="`共投流水号${index + 1}`"
                      :maxlength="80"
                      :disabled="readonly"
                    />
                  </ElFormItem>
                  <ElFormItem
                    label="计划用料 (kg)"
                    required
                    class="shared-field-weight"
                    :error="fieldErrors[`member${index}weight`]"
                  >
                    <AppNumberInput
                      v-model="member.planned_weight"
                      :aria-label="`共投计划重量${index + 1}`"
                      :disabled="readonly"
                      :min="0.000001"
                      :max="99999999999.999"
                      :controls="false"
                    />
                  </ElFormItem>
                  <ElFormItem
                    label="计划切出 (件)"
                    required
                    class="shared-field-quantity"
                    :error="fieldErrors[`member${index}quantity`]"
                  >
                    <AppNumberInput
                      v-model="member.planned_quantity"
                      :aria-label="`共投计划件数${index + 1}`"
                      :disabled="readonly"
                      :min="1"
                      :max="2147483647"
                      :precision="0"
                      :controls="false"
                    />
                  </ElFormItem>
                  <ElFormItem
                    label="客户代码"
                    class="shared-field-customer"
                    :error="fieldErrors[`member${index}customer`]"
                    :class="member.documentSerial ? importedClass('customer_code') : ''"
                  >
                    <template #label
                      >客户代码<AutofillBadge
                        v-if="member.documentSerial"
                        :source="documentSource('customer_code')"
                        kind="document"
                        :modified="documentChanged('customer_code')"
                    /></template>
                    <ElInput
                      v-model="member.customer_code"
                      :aria-label="`共投客户${index + 1}`"
                      :disabled="readonly"
                      maxlength="80"
                      placeholder="选填"
                    />
                  </ElFormItem>
                  <ElFormItem
                    label="成品规格"
                    class="shared-field-specification"
                    :error="fieldErrors[`member${index}specification`]"
                    :class="member.documentSerial ? importedClass('finished_specification') : ''"
                  >
                    <template #label
                      >成品规格<AutofillBadge
                        v-if="member.documentSerial"
                        :source="documentSource('finished_specification')"
                        kind="document"
                        :modified="documentChanged('finished_specification')"
                    /></template>
                    <ElInput
                      v-model="member.finished_specification"
                      :aria-label="`共投成品规格${index + 1}`"
                      :disabled="readonly"
                      maxlength="240"
                      placeholder="选填"
                    />
                  </ElFormItem>
                  <ElFormItem
                    label="要求发货日期"
                    class="shared-field-delivery"
                    :error="fieldErrors[`member${index}delivery`]"
                    :class="member.documentSerial ? importedClass('delivery_date') : ''"
                  >
                    <template #label
                      >要求发货日期<AutofillBadge
                        v-if="member.documentSerial"
                        :source="documentSource('delivery_date')"
                        kind="document"
                        :modified="documentChanged('delivery_date')"
                    /></template>
                    <ElDatePicker
                      v-model="member.delivery_date"
                      type="date"
                      value-format="YYYY-MM-DD"
                      :aria-label="`共投交期${index + 1}`"
                      :disabled="readonly"
                      placeholder="选填"
                    />
                  </ElFormItem>
                  <ElFormItem
                    label="应发件数"
                    class="shared-field-due"
                    :error="fieldErrors[`member${index}delivery`]"
                    :class="member.documentSerial ? importedClass('delivery_quantity') : ''"
                  >
                    <template #label
                      >应发件数<AutofillBadge
                        v-if="member.documentSerial"
                        :source="documentSource('delivery_quantity')"
                        kind="document"
                        :modified="documentChanged('delivery_quantity')"
                    /></template>
                    <AppNumberInput
                      v-model="member.delivery_quantity"
                      :aria-label="`共投应发件数${index + 1}`"
                      :disabled="readonly"
                      :min="1"
                      :max="2147483647"
                      :precision="0"
                      :controls="false"
                    />
                  </ElFormItem>
                  <ElFormItem
                    label="计划切割尺寸"
                    required
                    class="shared-field-cutting"
                    :error="fieldErrors[`member${index}cutting`]"
                  >
                    <template #label
                      ><span>计划切割尺寸</span
                      ><ElButton
                        text
                        :disabled="readonly || members.length <= 2"
                        :aria-label="`移除共投流水号${index + 1}`"
                        @click.stop="members.splice(index, 1)"
                        >移除</ElButton
                      ></template
                    >
                    <SpecificationInput
                      v-model="member.planned_specification"
                      :label="`共投计划切割尺寸${index + 1}`"
                      :disabled="readonly"
                      @validity-change="member.specificationValid = $event"
                    />
                  </ElFormItem>
                </div>
              </article>
              <div class="shared-plan-summary">
                <span
                  >计划合计 <b>{{ plannedWeight }} kg</b><b>{{ plannedQuantity }} 件</b></span
                ><span
                  v-if="form.weight && planWeightDifference !== 0"
                  :class="{ 'shared-plan-warning': planWeightDifference > 1 }"
                  >{{ planWeightDifference > 0 ? '计划超出入库重量' : '未规划重量' }}
                  {{ Math.abs(planWeightDifference) }} kg</span
                >
              </div>
              <ElButton
                class="action-cool"
                :disabled="readonly || members.length >= 20"
                @click="members.push(newMember())"
                >添加流水号</ElButton
              >
            </div>
          </section>
        </template>
        <ImportedDataConfirmation
          v-if="needsConfirmation"
          v-model="confirmedImports"
          class="receipt-import-confirmation"
          :disabled="readonly"
          :error="fieldErrors.confirmedImports"
          label="已核对文件带入的信息及本次入库数量"
        />
      </ElForm>
    </FormWorkspace>
    <PublishedProcessRoutePicker
      v-if="routePickerOpen && modelValue"
      :serial-no="sharedEntry ? members[0]?.serial_no : form.serialNo"
      @selected="selectRoute"
      @close="routePickerOpen = false"
    />
    <ProcessRouteEditor
      v-if="importedRoute && routeEditorOpen"
      :route="importedRoute"
      view-only
      @close="routeEditorOpen = false"
    />
    <template #footer
      ><ElButton :disabled="saving" @click="close">{{ attempt ? '稍后核对' : '取消' }}</ElButton
      ><ElButton
        type="primary"
        :loading="saving"
        :disabled="
          !canWrite ||
          saving ||
          importBusy ||
          documentsBusy ||
          routePickerOpen ||
          recoveryBlocked ||
          locationBusy
        "
        @click="submit"
        >{{ attempt ? '重试核对入库' : '确认入库' }}</ElButton
      ></template
    >
  </AppDialog>
</template>

<style scoped>
.receipt-heading {
  display: flex;
  align-items: center;
  gap: 12px;
}
.receipt-heading h2 {
  margin: 0;
  color: var(--text);
  font-size: var(--dialog-title-size);
  font-weight: var(--dialog-title-weight);
  letter-spacing: -0.5px;
}
.receipt-heading > span {
  padding-left: 16px;
  border-left: 1px solid var(--line);
  color: var(--muted);
  font-size: 12px;
}
.receipt-heading strong {
  color: var(--primary);
  font-weight: 600;
}
.receipt-document-panel {
  min-width: 0;
  display: grid;
  gap: 10px;
}
.receipt-route-choice-content {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  width: 100%;
}
.receipt-route-choice-content strong {
  color: var(--text);
  margin-right: auto;
  overflow-wrap: anywhere;
}
.receipt-route-choice-content :deep(.el-button > span) {
  gap: 6px;
}
.receipt-form {
  container: receipt-form / inline-size;
  min-width: 0;
}
.receipt-shared-summary {
  margin-left: 12px;
  color: var(--muted);
  font-size: 12px;
  font-weight: 400;
}
.receipt-identity-field :deep(.el-input__inner),
.shared-field-serial :deep(.el-input__inner) {
  color: var(--text);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.receipt-identity-field :deep(.el-input__inner) {
  font-size: 15px;
}
.document-field--imported:not(.is-error) :deep(.el-input__wrapper:not(.is-focus)),
.document-field--imported:not(.is-error) :deep(.el-textarea__inner:not(:focus)),
.document-field--edited:not(.is-error) :deep(.el-input__wrapper:not(.is-focus)),
.document-field--edited:not(.is-error) :deep(.el-textarea__inner:not(:focus)) {
  background: var(--surface);
  box-shadow: 0 0 0 1px var(--line) inset;
}
.shared-entry-section {
  padding: 16px 0 20px;
  border-bottom: 1px solid var(--line);
}
.shared-entry-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 16px;
  color: var(--muted);
  font-size: 12px;
}
.shared-members {
  margin-top: 12px;
}
.shared-member {
  padding: 12px 0 16px;
  border-top: 1px solid var(--line);
}
.shared-member-index {
  padding-right: 4px;
  color: var(--subtle);
  font-size: 10px;
  font-weight: 400;
  font-variant-numeric: tabular-nums;
}
.shared-field-cutting :deep(.el-form-item__label) {
  display: flex;
  width: 100%;
  justify-content: space-between;
}
.shared-field-cutting :deep(.el-form-item__label > span) {
  margin-right: auto;
}
.shared-field-cutting :deep(.el-button) {
  height: 20px;
  padding: 0 4px;
  color: var(--muted);
  font-size: 11px;
}
.shared-field-cutting :deep(.el-button:hover:not(:disabled)) {
  color: var(--danger);
}
.shared-member-grid {
  display: grid;
  grid-template-columns:
    minmax(140px, 1.1fr) repeat(2, minmax(100px, 0.8fr)) minmax(100px, 0.9fr)
    minmax(110px, 1fr) minmax(150px, 1.2fr) minmax(90px, 0.8fr);
  grid-template-areas: 'serial weight quantity customer specification delivery due' 'cutting cutting cutting cutting cutting cutting cutting';
  gap: 10px 12px;
  align-items: start;
}
.shared-member-grid :deep(.el-form-item) {
  min-width: 0;
  margin-bottom: 0;
}
.shared-member-grid :deep(.el-input-number),
.shared-member-grid :deep(.el-date-editor) {
  min-width: 0;
  width: 100%;
}
.shared-member-grid :deep(.el-input-number .el-input__inner) {
  text-align: left;
}
.shared-field-serial {
  grid-area: serial;
}
.shared-field-weight {
  grid-area: weight;
}
.shared-field-quantity {
  grid-area: quantity;
}
.shared-field-customer {
  grid-area: customer;
}
.shared-field-specification {
  grid-area: specification;
}
.shared-field-delivery {
  grid-area: delivery;
}
.shared-field-due {
  grid-area: due;
}
.shared-field-cutting {
  grid-area: cutting;
}
.shared-plan-summary,
.shared-plan-summary > span {
  display: flex;
  align-items: baseline;
  gap: 14px;
}
.shared-plan-summary {
  flex-wrap: wrap;
  justify-content: space-between;
  padding: 12px 0;
  border-top: 1px solid var(--line);
  color: var(--muted);
  font-size: 12px;
}
.shared-plan-summary b {
  color: var(--text);
  font-size: 14px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.shared-plan-warning {
  color: var(--el-color-warning);
}
.receipt-retry {
  margin-bottom: 12px;
}
@container receipt-form (max-width: 1020px) {
  .shared-member-grid {
    grid-template-columns: minmax(0, 1.2fr) repeat(2, minmax(0, 1fr));
    grid-template-areas: 'serial weight quantity' 'cutting cutting cutting' 'customer specification due' 'delivery delivery .';
  }
}
@container receipt-form (max-width: 760px) {
  .shared-field-delivery {
    max-width: 240px;
  }
}
</style>
