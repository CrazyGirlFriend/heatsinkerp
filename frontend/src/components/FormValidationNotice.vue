<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { ElAlert } from 'element-plus'
import ElButton from '@/components/AppButton.vue'
import WatermelonNotice from './watermelon/WatermelonNotice.vue'
import WatermelonButton from './watermelon/WatermelonButton.vue'
import { useWatermelonAppearance } from '@/composables/useWorkspaceAppearance'
const watermelon = useWatermelonAppearance()
const props = defineProps<{ message: string; page?: number | null; label?: string }>()
const emit = defineEmits<{ locate: [] }>()
const notice = ref<HTMLElement>()
watch(
  () => props.message,
  async (message) => {
    if (message) {
      await nextTick()
      notice.value?.scrollIntoView?.({ block: 'nearest' })
    }
  },
)
</script>

<template>
  <div v-if="message" ref="notice" class="form-validation-notice">
    <WatermelonNotice v-if="watermelon" :message="message" tone="error" role="alert">
      <WatermelonButton v-if="page != null" @click="emit('locate')">前往补填</WatermelonButton>
    </WatermelonNotice>
    <ElAlert
      v-else
      type="error"
      show-icon
      :closable="false"
      :title="page == null ? '提交未完成' : `第 ${page + 1} 页 · ${label}`"
    >
      <span class="validation-message">{{ message }}</span>
      <ElButton v-if="page != null" link type="danger" @click="emit('locate')">前往补填</ElButton>
    </ElAlert>
  </div>
</template>

<style scoped>
.form-validation-notice {
  margin-bottom: 16px;
  overflow-wrap: anywhere;
}
.validation-message {
  display: block;
  margin: 4px 0;
}
</style>
