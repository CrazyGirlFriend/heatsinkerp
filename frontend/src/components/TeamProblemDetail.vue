<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, ref, watch } from 'vue'
import { ElDescriptions, ElDescriptionsItem, ElTag } from 'element-plus'
import AppDialog from './AppDialog.vue'
import AppButton from './AppButton.vue'
import StatePanel from './StatePanel.vue'
import { qualityFeedbackApi, type TeamProblem } from '@/services/qualityFeedbackApi'
import { processRouteApi } from '@/services/processRouteApi'
import { reworkProgressLabels, type ProcessRoute } from '@/types/processRoute'
import { useAuthStore } from '@/stores/auth'
import { canMaintainProcessRoute } from '@/utils/processRoutePermissions'
import { formatDateTime } from '@/utils/format'

const ProcessRouteEditor = defineAsyncComponent(() => import('./ProcessRouteEditor.vue'))
const props = defineProps<{ routeId: number }>()
const emit = defineEmits<{ close: []; changed: [] }>()
const auth = useAuthStore()
const visible = ref(true),
  loading = ref(false),
  error = ref('')
const detail = ref<TeamProblem>(),
  route = ref<ProcessRoute>()
const canEdit = computed(() => canMaintainProcessRoute(auth.currentUser))
let generation = 0
async function load() {
  const token = ++generation
  loading.value = true
  error.value = ''
  try {
    const result = await qualityFeedbackApi.teamProblem(props.routeId)
    if (token === generation) detail.value = result
  } catch (e) {
    if (token === generation) error.value = e instanceof Error ? e.message : '问题读取失败'
  } finally {
    if (token === generation) loading.value = false
  }
}
async function openRoute() {
  const token = ++generation
  loading.value = true
  error.value = ''
  try {
    const result = await processRouteApi.detail(props.routeId)
    if (token === generation) route.value = result
  } catch (e) {
    if (token === generation) error.value = e instanceof Error ? e.message : '工艺读取失败'
  } finally {
    if (token === generation) loading.value = false
  }
}
function closeRoute() {
  route.value = undefined
  void load()
}
function routeSaved() {
  closeRoute()
  emit('changed')
}
watch(
  () => props.routeId,
  () => {
    detail.value = undefined
    route.value = undefined
    void load()
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  ++generation
})
</script>

<template>
  <AppDialog
    v-model="visible"
    title="班组反馈"
    width="min(760px, calc(100vw - 24px))"
    align-center
    append-to-body
    @closed="emit('close')"
  >
    <StatePanel v-if="error" state="error" :description="error" @retry="load" />
    <StatePanel v-else-if="!detail" state="loading" title="正在读取问题" />
    <template v-if="detail">
      <div class="team-problem-heading">
        <strong>{{ detail.serial_no }}</strong
        ><ElTag :type="detail.route_state === 'published' ? 'success' : 'info'">{{
          detail.route_state === 'published' ? '返工工艺已制定' : '返工工艺未填写'
        }}</ElTag>
      </div>
      <p class="team-problem-description">{{ detail.notes }}</p>
      <ElDescriptions :column="2" border>
        <ElDescriptionsItem label="反馈班组">{{ detail.team_name }}</ElDescriptionsItem>
        <ElDescriptionsItem label="提交人">{{ detail.created_by }}</ElDescriptionsItem>
        <ElDescriptionsItem label="疑似涉及班组" :span="2">{{
          detail.involved_teams.map((team) => team.name).join('、')
        }}</ElDescriptionsItem>
        <ElDescriptionsItem label="问题件数">{{ detail.failed_quantity }} 件</ElDescriptionsItem>
        <ElDescriptionsItem label="返工轮次">第 {{ detail.rework_round }} 轮</ElDescriptionsItem>
        <ElDescriptionsItem label="返工批次" :span="2">{{ detail.batch_no }}</ElDescriptionsItem>
        <ElDescriptionsItem label="提交时间" :span="2">{{
          formatDateTime(detail.checked_at)
        }}</ElDescriptionsItem>
        <ElDescriptionsItem label="返工进度">{{
          detail.route_state === 'draft'
            ? '等待工艺填写'
            : reworkProgressLabels[detail.rework_progress.state]
        }}</ElDescriptionsItem>
        <ElDescriptionsItem label="已返工"
          >{{ detail.rework_progress.completed_quantity }} /
          {{ detail.failed_quantity }} 件</ElDescriptionsItem
        >
      </ElDescriptions>
    </template>
    <template #footer>
      <AppButton @click="visible = false">关闭</AppButton>
      <AppButton
        v-if="detail && (canEdit || detail.route_state === 'published')"
        type="primary"
        :loading="loading"
        @click="openRoute"
        >{{
          canEdit && detail.route_state === 'draft' ? '填写返工工艺' : '查看返工工艺'
        }}</AppButton
      >
    </template>
    <ProcessRouteEditor
      v-if="route"
      :route="route"
      :view-only="!canEdit"
      :start-editing="canEdit && route.state === 'draft'"
      @close="closeRoute"
      @saved="routeSaved"
    />
  </AppDialog>
</template>

<style scoped>
.team-problem-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}
.team-problem-heading strong {
  font-size: 20px;
}
.team-problem-description {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  margin: 18px 0;
}
</style>
