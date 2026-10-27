<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { Bell } from '@element-plus/icons-vue'
import { ElAlert, ElBadge, ElButton, ElPagination, ElTable, ElTableColumn } from 'element-plus'
import AppDialog from './AppDialog.vue'
import ProcessRouteEditor from './ProcessRouteEditor.vue'
import { reworkNoticeApi, type ReworkNotice } from '@/services/reworkNoticeApi'
import type { ProcessRoute } from '@/types/processRoute'
import { useLiveRefresh } from '@/composables/useLiveRefresh'
import { formatDateTime } from '@/utils/format'
const props = defineProps<{ teamId: number; engineering?: boolean }>()
const emit = defineEmits<{ changed: [] }>()
const visible = ref(false),
  page = ref(1),
  total = ref(0),
  unread = ref(0),
  loading = ref(false),
  error = ref('')
const items = ref<ReworkNotice[]>([]),
  selected = ref<ProcessRoute>()
let generation = 0,
  opening = false
async function load() {
  const token = ++generation
  loading.value = true
  try {
    const result = await reworkNoticeApi.list(props.teamId, page.value)
    if (token !== generation) return
    items.value = result.items
    total.value = result.total
    unread.value = result.unread
    error.value = ''
  } catch (e) {
    if (token === generation) error.value = e instanceof Error ? e.message : '消息读取失败'
  } finally {
    if (token === generation) loading.value = false
  }
}
function showInbox() {
  visible.value = true
  void load()
}
async function openMessage(id: number) {
  const item = items.value.find((row) => row.id === id)
  if (!item) return
  if (opening) return
  opening = true
  const teamId = props.teamId
  try {
    const route = await reworkNoticeApi.route(item.id)
    if (teamId !== props.teamId) return
    await reworkNoticeApi.read(item.id)
    selected.value = route
    visible.value = false
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : '消息打开失败'
  } finally {
    opening = false
  }
}
function changed() {
  void load()
  emit('changed')
}
watch(
  () => props.teamId,
  () => {
    page.value = 1
    items.value = []
    unread.value = 0
    selected.value = undefined
    visible.value = false
    void load()
  },
  { immediate: true },
)
useLiveRefresh(load, { teamId: () => props.teamId })
onBeforeUnmount(() => {
  ++generation
})
</script>
<template>
  <ElBadge :value="unread" :hidden="!unread" :max="99">
    <ElButton :icon="Bell" :aria-label="`返工消息，${unread} 条未读`" @click="showInbox"
      >返工消息<span v-if="error" aria-label="同步失败"> · !</span></ElButton
    >
  </ElBadge>
  <AppDialog v-model="visible" title="返工消息" width="min(980px, 94vw)" append-to-body>
    <ElAlert v-if="error" :title="error" type="error" :closable="false" />
    <ElTable
      :data="items"
      border
      class="business-table"
      :empty-text="loading ? '读取中' : '暂无返工消息'"
    >
      <ElTableColumn label="消息" width="120"
        ><template #default="{ row }"
          ><span v-if="!row.read_at" class="unread-dot" aria-label="未读" />{{
            row.kind === 'requested' ? '新返工问题' : '工艺已制定'
          }}</template
        ></ElTableColumn
      >
      <ElTableColumn prop="submitting_team" label="提交班组" width="100" />
      <ElTableColumn prop="serial_no" label="流水号" min-width="170" />
      <ElTableColumn prop="problem" label="问题" min-width="220" show-overflow-tooltip />
      <ElTableColumn label="时间" width="150"
        ><template #default="{ row }">{{ formatDateTime(row.created_at) }}</template></ElTableColumn
      >
      <ElTableColumn label="操作" width="100"
        ><template #default="{ row }"
          ><ElButton size="small" @click="openMessage(row.id)">{{
            engineering && row.state === 'draft' ? '制定工艺' : '查看工艺'
          }}</ElButton></template
        ></ElTableColumn
      >
    </ElTable>
    <template #footer
      ><ElPagination
        v-model:current-page="page"
        :total="total"
        :page-size="20"
        :disabled="loading"
        layout="total, prev, pager, next"
        @current-change="load"
    /></template>
  </AppDialog>
  <ProcessRouteEditor
    v-if="selected"
    :key="selected.id"
    :route="selected"
    :view-only="!engineering"
    :start-editing="engineering && selected.state === 'draft'"
    @close="selected = undefined"
    @saved="changed"
  />
</template>
<style scoped>
.unread-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #b8483b;
  margin-right: 6px;
  vertical-align: middle;
}
.el-pagination {
  justify-content: flex-end;
}
</style>
