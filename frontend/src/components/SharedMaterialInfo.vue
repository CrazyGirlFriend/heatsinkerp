<script setup lang="ts">
import type { SharedMaterialFields } from '@/types/sharedMaterial'
defineProps<{ item: SharedMaterialFields & { serial_no?: string } }>()
</script>
<template>
  <section v-if="item.shared_group_id" class="shared-material-info" aria-label="共投关联资料">
    <header><strong>{{ item.shared_unallocated ? '共投未分配' : `共投分配 · ${item.serial_no}` }}</strong><span>来源 {{ item.shared_origin_batch_no }}</span></header>
    <div v-if="item.shared_unallocated" class="shared-info-scroll"><table><thead><tr><th>关联流水号</th><th>客户</th><th>成品规格</th><th>要求发货日期</th><th>应发件数</th></tr></thead><tbody><tr v-for="member in item.shared_serials" :key="member.serial_no"><td>{{ member.serial_no }}</td><td>{{ member.customer_code || '—' }}</td><td>{{ member.finished_specification || '—' }}</td><td>{{ member.delivery_date || '—' }}</td><td>{{ member.delivery_quantity ?? '—' }}</td></tr></tbody></table></div>
  </section>
</template>
<style scoped>
.shared-material-info { padding: 12px; margin-block: 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface-soft); font-size: 12px; }
header { display: flex; gap: 16px; flex-wrap: wrap; align-items: baseline; } header strong { color: var(--primary); font-weight: 550; } header span { color: var(--muted); }
.shared-info-scroll { overflow-x: auto; margin-top: 8px; } table { width: 100%; min-width: 500px; border-collapse: collapse; } th, td { padding: 7px 10px; text-align: left; border-top: 1px solid var(--line); } th { color: var(--muted); font-weight: 500; } td { overflow-wrap: anywhere; }
</style>
