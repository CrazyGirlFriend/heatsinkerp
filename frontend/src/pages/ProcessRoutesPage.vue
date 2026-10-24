<script setup lang="ts">
import { onMounted, ref } from 'vue'
import {
  ElAlert,
  ElButton,
  ElInput,
  ElPagination,
  ElTable,
  ElTableColumn,
  ElTag,
} from 'element-plus'
import PageBackButton from '@/components/PageBackButton.vue'
import ProcessRouteEditor from '@/components/ProcessRouteEditor.vue'
import { processRouteApi } from '@/services/processRouteApi'
import type { ProcessRoute } from '@/types/processRoute'
import { formatDateTime } from '@/utils/format'
const items = ref<ProcessRoute[]>([]),
  total = ref(0),
  page = ref(1),
  query = ref(''),
  loading = ref(false),
  error = ref(''),
  selected = ref<ProcessRoute | null>(null),
  input = ref<HTMLInputElement>(),
  enforced = ref<string | null>(null)
let generation = 0
async function load() {
  const request = ++generation
  loading.value = true
  error.value = ''
  try {
    const result = await processRouteApi.list(query.value, page.value)
    if (request !== generation) return
    items.value = result.items
    total.value = result.total
    enforced.value = result.enforced_after
  } catch (e) {
    if (request === generation) error.value = e instanceof Error ? e.message : '工艺读取失败'
  } finally {
    if (request === generation) loading.value = false
  }
}
function search() {
  page.value = 1
  void load()
}
async function open(id: number) {
  error.value = ''
  try {
    selected.value = await processRouteApi.detail(id)
  } catch (e) {
    error.value = e instanceof Error ? e.message : '工艺读取失败'
  }
}
async function upload(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  loading.value = true
  error.value = ''
  try {
    selected.value = await processRouteApi.import(file)
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Word导入失败'
  } finally {
    loading.value = false
    if (input.value) input.value.value = ''
  }
}
onMounted(load)
</script>
<template>
  <section class="page reading-workspace process-routes-page">
    <header class="page-heading">
      <div class="page-heading-start">
        <PageBackButton />
        <div>
          <h1>工艺路线</h1>
          <p>Word 原文核对 · 派工发布 · 批次执行</p>
        </div>
      </div>
      <ElButton type="primary" :loading="loading" @click="input?.click()">上传 Word 工艺表</ElButton
      ><input
        ref="input"
        type="file"
        accept=".docx"
        hidden
        aria-label="上传Word工艺表"
        @change="upload"
      />
    </header>
    <ElAlert v-if="error" :title="error" type="error" :closable="false" />
    <p class="route-policy">
      {{
        enforced
          ? `自 ${formatDateTime(enforced)} 起新入库的正常产品，首次转出前须绑定已发布工艺；此前的在途库存保留原流程。`
          : '上传后生成待核对草稿；发布与绑定批次之后，正常产品按工序执行。'
      }}
    </p>
    <div class="route-toolbar">
      <ElInput
        v-model="query"
        clearable
        placeholder="搜索派工工艺名称"
        @keyup.enter="search"
      /><ElButton :disabled="loading" @click="search">查询</ElButton>
    </div>
    <ElTable :data="items" border class="route-list" aria-label="工艺路线列表">
      <ElTableColumn prop="title" label="派工工艺" min-width="230" />
      <ElTableColumn label="流水号" min-width="220"
        ><template #default="{ row }">{{
          row.serial_nos.join('、') || '待核对'
        }}</template></ElTableColumn
      >
      <ElTableColumn label="状态" width="110" align="center"
        ><template #default="{ row }"
          ><ElTag :type="row.state === 'published' ? 'success' : 'warning'">{{
            row.state === 'published' ? '已发布' : '待核对'
          }}</ElTag></template
        ></ElTableColumn
      >
      <ElTableColumn label="原始文件" prop="filename" min-width="240" show-overflow-tooltip />
      <ElTableColumn label="导入时间" width="180"
        ><template #default="{ row }">{{ formatDateTime(row.created_at) }}</template></ElTableColumn
      >
      <ElTableColumn label="操作" width="110" fixed="right"
        ><template #default="{ row }"
          ><ElButton type="primary" link @click="open(row.id)">{{
            row.state === 'published' ? '查看工艺' : '核对草稿'
          }}</ElButton></template
        ></ElTableColumn
      >
    </ElTable>
    <ElPagination
      v-model:current-page="page"
      :page-size="20"
      :total="total"
      layout="total, prev, pager, next"
      @current-change="load"
    />
    <ProcessRouteEditor v-if="selected" :route="selected" @close="selected = null" @saved="load" />
  </section>
</template>
<style scoped>
.process-routes-page {
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-height: 0;
}
.page-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}
h1 {
  margin: 0;
}
p {
  color: var(--muted);
  font-size: 13px;
  margin: 5px 0 0;
}
.route-policy {
  margin: 0;
}
.route-toolbar {
  display: flex;
  gap: 12px;
}
.route-toolbar .el-input {
  max-width: 560px;
}
.route-list {
  flex: 1;
  min-height: 200px;
  border-radius: 16px;
}
.el-pagination {
  justify-content: flex-end;
}
</style>
