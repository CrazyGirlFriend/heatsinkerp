import { ElMessageBox, type ElMessageBoxOptions } from 'element-plus'

function options(value: ElMessageBoxOptions = {}): ElMessageBoxOptions {
  if (!document.documentElement.classList.contains('wm-app')) return value
  return {
    ...value,
    customClass: ['wm-scope wm-confirm-dialog', value.customClass].filter(Boolean).join(' '),
  }
}

export const AppMessageBox = {
  confirm: (
    message: Parameters<typeof ElMessageBox.confirm>[0],
    title: string,
    value?: ElMessageBoxOptions,
  ) => ElMessageBox.confirm(message, title, options(value)),
  prompt: (
    message: Parameters<typeof ElMessageBox.prompt>[0],
    title: string,
    value?: ElMessageBoxOptions,
  ) => ElMessageBox.prompt(message, title, options(value)),
}
