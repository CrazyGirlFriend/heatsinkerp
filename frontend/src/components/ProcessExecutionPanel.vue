<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElAlert, ElButton, ElOption, ElSelect } from 'element-plus'
import { FullScreen } from '@element-plus/icons-vue'
import { processRouteApi } from '@/services/processRouteApi'
import type { ProcessRoute, ProcessRouteContext } from '@/types/processRoute'
import WordDocumentPreview from './WordDocumentPreview.vue'
import ProcessRouteDrawingPreview from './ProcessRouteDrawingPreview.vue'

const props = defineProps<{
  context?: ProcessRouteContext | null
  serial?: string
  shared?: boolean
}>()
const route = ref<ProcessRoute>(),
  error = ref(''),
  loading = ref(false)
const tab = ref('route'),
  selected = ref(0),
  drawingId = ref<number>()
const word = ref<InstanceType<typeof WordDocumentPreview>>()
const drawing = ref<InstanceType<typeof ProcessRouteDrawingPreview>>()
const preview = computed(() => (tab.value === 'word' ? word.value : drawing.value))
const steps = computed(() =>
  (route.value?.steps || [])
    .map((step, index) => ({ ...step, index }))
    .filter(
      (step) =>
        props.shared || !step.serial_nos.length || step.serial_nos.includes(props.serial || ''),
    ),
)
const selectedStep = computed(() => route.value?.steps[selected.value])
const selectedDrawing = computed(() =>
  route.value?.drawings?.find((item) => item.id === drawingId.value),
)
let generation = 0
async function load() {
  const current = ++generation
  route.value = undefined
  error.value = ''
  tab.value = 'route'
  selected.value = props.context?.step_index ?? 0
  if (!props.context) {
    loading.value = false
    return
  }
  loading.value = true
  try {
    const result = await processRouteApi.detail(props.context.id)
    if (current !== generation) return
    route.value = result
    drawingId.value = result.drawings?.[0]?.id
  } catch (e) {
    if (current === generation) error.value = e instanceof Error ? e.message : '工艺读取失败'
  } finally {
    if (current === generation) loading.value = false
  }
}
watch(() => [props.context?.id, props.context?.step_index], load, { immediate: true })
onBeforeUnmount(() => ++generation)
</script>

<template>
  <aside class="process-execution-panel" aria-label="工艺只读查看">
    <header>
      <div class="execution-tabs" role="tablist" aria-label="工艺资料">
        <button
          v-for="item in [
            { id: 'route', label: '工艺节点' },
            { id: 'word', label: '工艺原稿' },
            { id: 'drawing', label: '图纸' },
          ]"
          :key="item.id"
          type="button"
          role="tab"
          :aria-selected="tab === item.id"
          @click="tab = item.id"
        >
          {{ item.label }}
        </button>
      </div>
      <ElButton
        v-if="tab !== 'route'"
        text
        :icon="FullScreen"
        :disabled="!preview?.ready"
        @click="preview?.open()"
        >放大</ElButton
      >
      <span v-else class="execution-readonly">只读</span>
    </header>
    <ElAlert v-if="error" :title="error" type="error" :closable="false" />
    <ElButton v-if="error" @click="load">重试</ElButton>
    <div v-if="loading" class="execution-empty" role="status">正在读取工艺…</div>
    <div v-else-if="!context" class="execution-empty">未关联工艺</div>
    <template v-else-if="route">
      <template v-if="tab === 'route'">
        <div class="execution-route-heading">
          <strong>{{ route.route_kind === 'rework' ? '返工路线' : '工艺路线' }}</strong
          ><span>{{ steps.length }} 道工序 · v{{ context.version }}</span>
        </div>
        <ol class="execution-nodes">
          <li
            v-for="step in steps"
            :key="step.index"
            :class="{
              'is-current': step.index === context.step_index,
              'is-selected': step.index === selected,
              'is-before': step.index < context.step_index,
            }"
          >
            <button
              type="button"
              :aria-pressed="step.index === selected"
              @click="selected = step.index"
            >
              <span class="execution-node-number">{{ step.sequence_no }}</span>
              <span class="execution-node-name"
                >{{ step.name
                }}<small v-if="step.team_name && step.team_name !== step.name">{{
                  step.team_name
                }}</small></span
              >
              <span v-if="step.index === context.step_index" class="execution-current">{{
                context.available === false ? '已加工' : '当前工序'
              }}</span>
              <span v-else class="execution-position">{{
                step.index < context.step_index ? '前序' : '后序'
              }}</span>
            </button>
          </li>
        </ol>
        <section
          v-if="selectedStep && selected !== context.step_index"
          class="execution-requirements"
        >
          <header>
            <strong>{{ selectedStep.name }}</strong
            ><span>计划 {{ selectedStep.planned_quantity || '—' }}</span>
          </header>
          <p>{{ selectedStep.instructions || '未填写工艺要求' }}</p>
          <ElButton v-if="route.filename" text @click="tab = 'word'">查看原稿</ElButton>
        </section>
        <p v-if="route.rework_request?.resume_step_name" class="execution-resume">
          返工后接回：{{ route.rework_request.resume_step_name }}
        </p>
      </template>
      <template v-else-if="tab === 'word'">
        <WordDocumentPreview
          v-if="route.filename"
          ref="word"
          :route="route"
          :source-row="selectedStep?.source_row || undefined"
          compact
        />
        <div v-else class="execution-empty">暂无原稿</div>
      </template>
      <template v-else>
        <ElSelect v-if="route.drawings?.length" v-model="drawingId" aria-label="选择图纸"
          ><ElOption
            v-for="item in route.drawings"
            :key="item.id"
            :value="item.id"
            :label="item.filename"
        /></ElSelect>
        <ProcessRouteDrawingPreview
          v-if="selectedDrawing"
          ref="drawing"
          :route-id="route.id"
          :drawing="selectedDrawing"
        />
        <div v-else class="execution-empty">暂无图纸</div>
      </template>
    </template>
  </aside>
</template>

<style scoped>
.process-execution-panel {
  min-width: 0;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: linear-gradient(135deg, #ffffffd9, #eef7f3a6);
  box-shadow: inset 0 1px #fff;
}
.process-execution-panel > header,
.execution-requirements header,
.execution-route-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.execution-tabs {
  display: flex;
  padding: 3px;
  border-radius: 9px;
  background: #eaf0ed;
}
.execution-tabs button {
  border: 0;
  border-radius: 7px;
  padding: 8px 12px;
  color: var(--muted);
  background: transparent;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.execution-tabs button[aria-selected='true'] {
  color: #205e4b;
  background: #fff;
  box-shadow: 0 1px 4px #16362b12;
}
.execution-readonly,
.execution-route-heading > span,
.execution-position,
.execution-requirements header > span {
  font-size: 12px;
  color: var(--muted);
}
.execution-route-heading {
  margin: 18px 0 10px;
  font-size: 14px;
}
.execution-nodes {
  list-style: none;
  padding: 0;
  margin: 0;
}
.execution-nodes li {
  position: relative;
  padding-bottom: 8px;
}
.execution-nodes li:not(:last-child)::after {
  content: '';
  position: absolute;
  width: 1px;
  height: 8px;
  left: 24px;
  bottom: 0;
  background: #b9cdc4;
}
.execution-nodes button {
  display: flex;
  width: 100%;
  min-height: 46px;
  gap: 12px;
  align-items: center;
  padding: 7px 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #ffffffa8;
  color: var(--text);
  text-align: left;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  transition:
    background 160ms,
    border-color 160ms;
}
.execution-nodes button:hover,
.execution-nodes .is-selected button {
  border-color: #6f9c8a;
  background: #f3faf7;
}
.execution-nodes .is-current button {
  border-color: #3e7a64;
  box-shadow: inset 3px 0 #28664f;
}
.execution-node-number {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border: 1px solid #cad9d2;
  border-radius: 50%;
  flex-shrink: 0;
  color: #527565;
  font-variant-numeric: tabular-nums;
}
.is-current .execution-node-number {
  color: #fff;
  background: #28664f;
  border-color: #28664f;
}
.execution-node-name {
  flex: 1;
  font-weight: 600;
}
.execution-node-name small {
  margin-left: 8px;
  font-weight: 400;
  color: var(--muted);
}
.execution-current {
  font-size: 12px;
  color: #205e4b;
}
.execution-requirements {
  margin-top: 12px;
  border: 1px solid var(--line);
  background: #fff;
  border-radius: 10px;
  padding: 12px;
  font-size: 13px;
}
.execution-requirements p {
  white-space: pre-wrap;
  line-height: 1.7;
  margin: 10px 0 0;
}
.execution-resume {
  border-top: 1px solid var(--line);
  margin: 14px 0 0;
  padding-top: 12px;
  font-size: 13px;
}
.execution-empty {
  display: grid;
  min-height: 240px;
  place-items: center;
  color: var(--muted);
  font-size: 13px;
}
.process-execution-panel > .el-select {
  width: 100%;
  margin-top: 12px;
}
.execution-tabs button:focus-visible,
.execution-nodes button:focus-visible {
  outline: 2px solid #28664f;
  outline-offset: 2px;
}
</style>
