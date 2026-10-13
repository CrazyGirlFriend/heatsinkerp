import { computed, nextTick, ref } from 'vue'

/** Run after the invalid field classes have rendered. */
export function focusFirstInvalidField(root?: HTMLElement) {
  const field = root?.querySelector<HTMLElement>('.is-error')
  if (!field) return
  const controls = Array.from(
    field.querySelectorAll<HTMLElement>(
      'input:not([type="hidden"]), textarea, [role="combobox"][tabindex], button',
    ),
  ).filter((control) => !control.matches(':disabled, [aria-disabled="true"]'))
  // Dimensions share one field: focus the missing dimension, not the shape selector.
  const target =
    controls.find(
      (control) =>
        control instanceof HTMLInputElement &&
        control.closest('.specification-dimensions') &&
        !control.value,
    ) || controls[0]
  const anchor = target || field
  anchor.scrollIntoView?.({ block: 'center', inline: 'nearest' })
  target?.focus({ preventScroll: true })
}

/** Keep field errors visible until corrected, without replacing operational errors. */
export function useDialogValidation(issues: () => Record<string, string>) {
  const attempted = ref(false)
  const formRef = ref<{ $el: HTMLElement }>()
  const fieldErrors = computed(() => (attempted.value ? issues() : {}))

  function validate() {
    attempted.value = true
    if (!Object.keys(fieldErrors.value).length) return true
    void nextTick(() => {
      focusFirstInvalidField(formRef.value?.$el)
    })
    return false
  }

  return {
    formRef,
    fieldErrors,
    validate,
    reset: () => {
      attempted.value = false
    },
  }
}
