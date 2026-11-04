<script setup lang="ts">
import { inject, onBeforeUnmount, onMounted, ref, useSlots, watch } from 'vue'
import { Download, FullScreen, MoreFilled, Refresh, Setting } from '@element-plus/icons-vue'
import { ElPopover } from 'element-plus'
import ElButton from '@/components/AppButton.vue'
import { workspaceToolsKey } from '@/utils/workspaceTools'
import { useWatermelonAppearance } from '@/composables/useWorkspaceAppearance'
import WatermelonButton from './watermelon/WatermelonButton.vue'
import { IconDownload, IconColumns3, IconRefresh } from '@tabler/icons-vue'
const watermelon = useWatermelonAppearance()

const props = withDefaults(
  defineProps<{ refresh?: boolean; loading?: boolean; columns?: boolean; pageActions?: boolean }>(),
  { pageActions: true },
)
const emit = defineEmits<{ refresh: []; columns: [anchor: HTMLElement] }>()
const tools = inject(workspaceToolsKey, null)
const slots = useSlots()
const opened = ref(false)
const compact = ref(true)
const root = ref<HTMLElement>()
const moreButton = ref<InstanceType<typeof ElButton>>()
const columnsButton = ref<InstanceType<typeof ElButton>>()
const watermelonColumnsButton = ref<InstanceType<typeof WatermelonButton>>()
let observer: ResizeObserver | undefined
let toolbar: HTMLElement | null = null

function updateLayout() {
  const width = toolbar?.getBoundingClientRect().width || 0
  if (
    props.pageActions &&
    !props.refresh &&
    !props.columns &&
    !slots.actions &&
    (!width || width >= 820)
  ) {
    compact.value = false
    return
  }
  if (width)
    compact.value = width < (toolbar?.classList.contains('workspace-data-toolbar') ? 820 : 1200)
}

onMounted(() => {
  toolbar =
    root.value?.closest<HTMLElement>(
      '.workspace-data-toolbar, .wm-data-toolbar, .team-workspace__navigation-row',
    ) ||
    root.value?.parentElement ||
    null
  updateLayout()
  if (toolbar && typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(updateLayout)
    observer.observe(toolbar)
  } else {
    window.addEventListener('resize', updateLayout)
  }
})
onBeforeUnmount(() => {
  observer?.disconnect()
  window.removeEventListener('resize', updateLayout)
})
watch(compact, (value) => {
  if (!value) opened.value = false
})
</script>

<template>
  <div ref="root" class="workspace-tools" role="group" aria-label="页面工具">
    <template v-if="watermelon">
      <WatermelonButton
        v-if="pageActions && (tools?.tableExport?.value || tools?.exportable.value)"
        class="team-workspace__export table-export-button"
        :disabled="tools?.tableExport?.value?.disabled"
        @click="tools?.tableExport?.value ? tools.tableExport.value.open() : tools?.export()"
        ><IconDownload :size="17" />导出</WatermelonButton
      >
      <WatermelonButton
        v-if="columns"
        ref="watermelonColumnsButton"
        @click="emit('columns', watermelonColumnsButton!.$el)"
        ><IconColumns3 :size="17" />显示列</WatermelonButton
      >
      <WatermelonButton
        v-if="refresh"
        :loading="loading"
        aria-label="刷新工作台"
        @click="emit('refresh')"
        ><IconRefresh :size="17"
      /></WatermelonButton>
      <slot name="actions" />
    </template>
    <template v-else>
      <ElButton
        v-if="
          pageActions &&
          (tools?.tableExport?.value || tools?.exportable.value) &&
          !tools?.fullscreen.value
        "
        class="team-workspace__export table-export-button action-warm"
        text
        :icon="Download"
        :disabled="tools?.tableExport?.value?.disabled"
        @click="tools?.tableExport?.value ? tools.tableExport.value.open() : tools?.export()"
        >导出</ElButton
      >
      <ElButton
        v-if="pageActions && tools?.canFullscreen.value && !tools.fullscreen.value"
        class="team-workspace__fullscreen"
        text
        :icon="FullScreen"
        :disabled="tools.fullscreenBusy.value"
        :aria-pressed="false"
        @click="tools.toggleFullscreen"
        >全屏</ElButton
      >
      <div v-if="!compact" class="workspace-tools__inline">
        <ElButton
          v-if="columns"
          ref="columnsButton"
          text
          :icon="Setting"
          @click="emit('columns', columnsButton!.$el)"
          >显示列</ElButton
        >
        <ElButton
          v-if="refresh"
          text
          :icon="Refresh"
          :loading="loading"
          aria-label="刷新工作台"
          @click="emit('refresh')"
        />
        <ElButton
          v-if="pageActions && tools?.settings.value && !tools.fullscreen.value"
          text
          :icon="Setting"
          aria-label="班组设置"
          @click="tools.openSettings"
          >班组设置</ElButton
        >
        <slot name="actions" />
      </div>
      <ElPopover
        v-if="
          compact &&
          (refresh ||
            columns ||
            (pageActions && tools?.settings.value && !tools.fullscreen.value) ||
            $slots.actions)
        "
        v-model:visible="opened"
        trigger="click"
        placement="bottom-end"
        :width="200"
        popper-class="workspace-more-popover"
      >
        <template #reference
          ><ElButton
            ref="moreButton"
            text
            :icon="MoreFilled"
            :aria-expanded="opened"
            aria-label="更多操作"
            >更多</ElButton
          ></template
        >
        <div class="workspace-more-menu" @click="opened = false">
          <ElButton v-if="columns" text :icon="Setting" @click="emit('columns', moreButton!.$el)"
            >显示列</ElButton
          >
          <ElButton
            v-if="refresh"
            text
            :icon="Refresh"
            :loading="loading"
            aria-label="刷新工作台"
            @click="emit('refresh')"
            >刷新</ElButton
          >
          <ElButton
            v-if="pageActions && tools?.settings.value && !tools.fullscreen.value"
            text
            :icon="Setting"
            aria-label="班组设置"
            @click="tools.openSettings"
            >班组设置</ElButton
          >
          <div v-if="$slots.actions" class="workspace-more-menu__actions">
            <slot name="actions" />
          </div>
        </div>
      </ElPopover>
    </template>
  </div>
</template>

<style scoped>
.workspace-tools {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 4px;
}
.wm-scope .workspace-tools {
  gap: 8px;
  flex-wrap: wrap;
}
.workspace-tools__inline {
  display: flex;
  align-items: center;
  gap: 8px;
}
.workspace-tools__inline :deep(.workspace-toolbar-actions) {
  margin: 0;
  padding: 0;
  border: 0;
}
.workspace-tools :deep(.el-button) {
  height: 32px;
  margin: 0;
  padding-inline: 10px;
  font-size: 13px;
}
.workspace-more-menu,
.workspace-more-menu__actions {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.workspace-more-menu__actions:not(:has(button)) {
  display: none;
}
.workspace-more-menu__actions:not(:first-child) {
  border-top: 1px solid var(--line);
  margin-top: 4px;
  padding-top: 8px;
}
.workspace-more-menu :deep(.workspace-actions),
.workspace-more-menu :deep(.workspace-toolbar-actions) {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  margin: 0;
  padding: 0;
  border: 0;
  gap: 4px;
}
.workspace-more-menu :deep(.el-button),
.workspace-more-menu :deep(.el-button.el-button--primary:not(.is-plain)) {
  justify-content: flex-start;
  width: 100%;
  height: 34px;
  margin: 0;
  padding-inline: 10px;
  border: 0;
  color: var(--text);
  background: transparent;
  box-shadow: none;
  font-size: 13px;
}
.workspace-more-menu :deep(.el-button:hover:not(:disabled)),
.workspace-more-menu :deep(.el-button.el-button--primary:not(.is-plain):hover:not(:disabled)) {
  color: var(--primary);
  background: var(--primary-soft);
}
</style>
