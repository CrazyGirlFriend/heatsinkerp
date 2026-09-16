import { defineStore } from 'pinia'
import { ElMessage } from 'element-plus'
import { appPinia } from '@/stores/access'

export type ToastTone = 'success' | 'error' | 'info'

export const useToastStore = defineStore('toast', () => {
  function showToast(nextMessage: string, nextTone: ToastTone = 'info'): void {
    if (typeof document === 'undefined') return
    ElMessage({
      message: nextMessage,
      type: nextTone,
      duration: 3200,
      grouping: true,
      showClose: nextTone === 'error',
      offset: 76,
    })
  }

  return { showToast }
})

const defaultToastStore = useToastStore(appPinia)

export function showToast(message: string, tone: ToastTone = 'info'): void {
  defaultToastStore.showToast(message, tone)
}
