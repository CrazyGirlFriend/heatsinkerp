<script setup lang="ts">
import { inject, ref } from 'vue'
import { FullScreen, MoreFilled, Refresh, Setting, Upload } from '@element-plus/icons-vue'
import { ElButton, ElPopover } from 'element-plus'
import { workspaceToolsKey } from '@/utils/workspaceTools'

defineProps<{ refresh?: boolean; loading?: boolean; columns?: boolean }>()
const emit = defineEmits<{ refresh: []; columns: [anchor: HTMLElement] }>()
const tools = inject(workspaceToolsKey, null)
const opened = ref(false)
const moreButton = ref<InstanceType<typeof ElButton>>()
</script>

<template>
  <div class="workspace-tools" role="group" aria-label="页面工具">
    <ElButton
      v-if="tools?.exportable.value && !tools.fullscreen.value"
      class="team-workspace__export action-warm"
      text
      :icon="Upload"
      @click="tools.export"
      >导出</ElButton
    >
    <ElButton
      v-if="tools?.canFullscreen.value && !tools.fullscreen.value"
      class="team-workspace__fullscreen"
      text
      :icon="FullScreen"
      :disabled="tools.fullscreenBusy.value"
      :aria-pressed="false"
      @click="tools.toggleFullscreen"
      >全屏</ElButton
    >
    <ElPopover
      v-if="
        refresh || columns || (tools?.settings.value && !tools.fullscreen.value) || $slots.actions
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
          v-if="tools?.settings.value && !tools.fullscreen.value"
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
  </div>
</template>

<style scoped>
.workspace-tools {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 4px;
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
