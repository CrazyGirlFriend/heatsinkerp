<script setup lang="ts">
import {
  IconArrowAutofitHeight,
  IconBuildingFactory2,
  IconBuildingWarehouse,
  IconChartBar,
  IconChisel,
  IconClipboardCheck,
  IconCut,
  IconDisc,
  IconDropletBolt,
  IconFileText,
  IconFlame,
  IconGitBranch,
  IconLayoutDashboard,
  IconPlug,
  IconRoute,
  IconSettings,
  IconTable,
  IconUsers,
} from '@tabler/icons-vue'

const icons = {
  overview: IconLayoutDashboard,
  workspaces: IconBuildingFactory2,
  flow: IconRoute,
  settings: IconSettings,
  analysis: IconChartBar,
  inventory: IconTable,
  warehouse: IconBuildingWarehouse,
  rolling: IconArrowAutofitHeight,
  annealing: IconFlame,
  grinding: IconDisc,
  cutting: IconCut,
  engraving: IconChisel,
  plating: IconDropletBolt,
  inspection: IconClipboardCheck,
  records: IconFileText,
  trace: IconGitBranch,
  accounts: IconUsers,
  integration: IconPlug,
} as const

defineProps<{ name: keyof typeof icons }>()
</script>

<template>
  <component :is="icons[name]" :size="20" stroke="2" aria-hidden="true" focusable="false" />
</template>

<style scoped>
.tabler-icon {
  display: block;
  flex-shrink: 0;
  width: 20px;
  height: 20px;
}
</style>
