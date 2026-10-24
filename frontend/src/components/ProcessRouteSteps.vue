<script setup lang="ts">
import { ElTable, ElTableColumn, ElTag } from 'element-plus'
import type { ProcessRoute, ProcessRouteContext } from '@/types/processRoute'
defineProps<{ route: ProcessRoute; current?: ProcessRouteContext | null }>()
</script>
<template>
  <ElTable
    :data="route.steps"
    border
    row-key="sequence_no"
    max-height="440"
    aria-label="派工工艺路线"
  >
    <ElTableColumn label="工序" width="170"
      ><template #default="{ row, $index }"
        ><strong>{{ row.sequence_no }} · {{ row.name }}</strong
        ><ElTag
          v-if="current?.step_index === $index"
          size="small"
          :type="current.complete ? 'success' : 'warning'"
          >{{ current.complete ? '本批已完成' : '本批当前工序' }}</ElTag
        ></template
      ></ElTableColumn
    >
    <ElTableColumn prop="team_name" label="执行班组" width="110" align="center" />
    <ElTableColumn label="工艺要求" min-width="330"
      ><template #default="{ row }"
        ><div class="process-instructions">{{ row.instructions }}</div></template
      ></ElTableColumn
    >
    <ElTableColumn label="适用流水号" min-width="160"
      ><template #default="{ row }"
        >{{ row.serial_nos.length ? row.serial_nos.join('、') : '公共工序'
        }}<ElTag v-if="row.split_here" size="small" type="warning">共投拆分点</ElTag></template
      ></ElTableColumn
    >
    <ElTableColumn prop="planned_days" label="参考天数" width="100" align="center" />
    <ElTableColumn prop="planned_quantity" label="原文计划数量" width="130" align="center" />
  </ElTable>
</template>
<style scoped>
.process-instructions {
  white-space: pre-wrap;
  line-height: 1.65;
}
strong {
  display: block;
  color: var(--text);
  margin-bottom: 5px;
}
</style>
