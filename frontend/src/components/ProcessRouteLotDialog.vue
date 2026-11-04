<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElAlert, ElForm, ElFormItem, ElOption, ElSelect } from 'element-plus'
import ElButton from '@/components/AppButton.vue'
import AppDialog from './AppDialog.vue'
import FormWorkspace from './FormWorkspace.vue'
import CompactFormSection from './CompactFormSection.vue'
import ProcessRouteAttachments from './ProcessRouteAttachments.vue'
import ProcessRouteSteps from './ProcessRouteSteps.vue'
import { processRouteApi } from '@/services/processRouteApi'
import type { ProcessRoute, ProcessRouteContext } from '@/types/processRoute'
const props = defineProps<{ lotId: number; canBind?: boolean }>()
const emit = defineEmits<{ close: []; changed: [] }>()
const visible = ref(true)
const route = ref<ProcessRoute | null>(null),
  current = ref<ProcessRouteContext | null>(null)
const options = ref<ProcessRoute[]>([]),
  selected = ref<number>(),
  loading = ref(true),
  busy = ref(false),
  error = ref(''),
  page = ref(1),
  total = ref(0),
  query = ref('')
let optionsVersion = 0
async function search(value: string) {
  query.value = value
  try {
    await loadOptions(true)
  } catch {
    error.value = '工艺读取失败'
  }
}
async function more() {
  page.value++
  try {
    await loadOptions()
  } catch {
    page.value--
    error.value = '工艺读取失败'
  }
}
async function loadOptions(reset = false) {
  const request = ++optionsVersion
  if (reset) {
    page.value = 1
    options.value = []
  }
  const result = await processRouteApi.list(query.value, page.value, 'published')
  if (request !== optionsVersion) return
  options.value = [...options.value, ...result.items]
  total.value = result.total
}
async function load() {
  error.value = ''
  loading.value = true
  try {
    const result = await processRouteApi.lot(props.lotId)
    route.value = result.route
    current.value = result.current
    if (!route.value && props.canBind) await loadOptions(true)
  } catch (e) {
    error.value = e instanceof Error ? e.message : '工艺读取失败'
  } finally {
    loading.value = false
  }
}
async function choose(id: number) {
  busy.value = true
  error.value = ''
  route.value = null
  try {
    route.value = await processRouteApi.detail(id)
  } catch (e) {
    selected.value = undefined
    error.value = e instanceof Error ? e.message : '工艺读取失败'
  } finally {
    busy.value = false
  }
}
async function bind() {
  if (loading.value || busy.value || !selected.value || route.value?.id !== selected.value) return
  busy.value = true
  error.value = ''
  try {
    await processRouteApi.bind(selected.value, props.lotId)
    emit('changed')
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : '关联失败'
  } finally {
    busy.value = false
  }
}
onMounted(load)
</script>
<template>
  <AppDialog
    v-model="visible"
    title="本批派工工艺"
    width="min(1240px, 96vw)"
    append-to-body
    :close-on-click-modal="!busy"
    :close-on-press-escape="!busy"
    :show-close="!busy"
    @closed="emit('close')"
  >
    <ElAlert v-if="error" :title="error" type="error" :closable="false" />
    <FormWorkspace>
      <template v-if="route" #documents>
        <ProcessRouteAttachments
          :route="route"
          :documents="['word', 'drawing']"
          :order-document="null"
        />
      </template>
      <ElForm v-if="!current && canBind" label-position="top">
        <CompactFormSection>
          <ElFormItem class="form-field--long" label="关联工艺" required>
            <ElSelect
              v-model="selected"
              placeholder="搜索并选择工艺"
              filterable
              remote
              :remote-method="search"
              :disabled="busy || loading"
              @change="choose"
            >
              <ElOption
                v-for="item in options"
                :key="item.id"
                :value="item.id"
                :label="`${item.title} · ${item.serial_nos.join('、')}`"
              />
              <template v-if="page * 20 < total" #footer
                ><ElButton link @click="more">加载更多</ElButton></template
              >
            </ElSelect>
          </ElFormItem>
          <p class="route-binding-hint form-field--full">
            须与本批流水号名单及起始库房一致；绑定后保留执行历史。
          </p>
        </CompactFormSection>
      </ElForm>
      <p v-if="loading">正在读取工艺…</p>
      <template v-else-if="route">
        <h3 class="route-preview-title">
          {{ route.title }} <small>工艺 #{{ route.id }}</small>
        </h3>
        <ProcessRouteSteps :route="route" :current="current" />
      </template>
      <p v-else-if="!loading">本批尚未关联工艺。请联系工艺班组录入并保存工艺。</p>
    </FormWorkspace>
    <template #footer
      ><ElButton :disabled="busy" @click="visible = false">关闭</ElButton
      ><ElButton
        v-if="!current && canBind"
        type="primary"
        :disabled="loading || busy || !selected || route?.id !== selected"
        :loading="busy"
        @click="bind"
        >关联本批次</ElButton
      ></template
    >
  </AppDialog>
</template>
<style scoped>
.route-binding-hint,
small {
  color: var(--muted);
  font-size: 12px;
  font-weight: 400;
}
.route-binding-hint {
  margin: 0;
}
.route-preview-title {
  margin: 12px 0;
  font-size: 15px;
  font-weight: 600;
}
</style>
