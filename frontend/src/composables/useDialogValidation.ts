import { computed, nextTick, ref } from 'vue'

/** Keep field errors visible until corrected, without replacing operational errors. */
export function useDialogValidation(issues: () => Record<string, string>) {
  const attempted = ref(false)
  const formRef = ref<{ $el: HTMLElement }>()
  const fieldErrors = computed(() => attempted.value ? issues() : {})

  function validate() {
    attempted.value = true
    if (!Object.keys(fieldErrors.value).length) return true
    void nextTick(() => {
      const field = formRef.value?.$el.querySelector<HTMLElement>('.is-error')
      field?.scrollIntoView?.({ block: 'nearest' })
      field?.querySelector<HTMLElement>('input, textarea, [role="combobox"]')?.focus({ preventScroll: true })
    })
    return false
  }

  return { formRef, fieldErrors, validate, reset: () => { attempted.value = false } }
}
