import { computed, nextTick, ref } from 'vue'

function animateInvalidFields(root: HTMLElement) {
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const fieldSelector =
    '.el-form-item.is-error, .dialog-field.is-error, .el-input.is-error, [aria-invalid="true"]'
  for (const field of root.querySelectorAll<HTMLElement>(fieldSelector)) {
    // Composite controls may also carry is-error; move their containing field only once.
    if (field.parentElement?.closest(fieldSelector)) continue
    const content = field.querySelector<HTMLElement>('.el-form-item__content') || field
    content.getAnimations?.().forEach((animation) => {
      if (animation.id === 'invalid-field-feedback') animation.cancel()
    })
    if (!reducedMotion)
      content.animate?.(
        [0, -4, 4, -3, 3, 0].map((x) => ({ transform: `translateX(${x}px)` })),
        { id: 'invalid-field-feedback', duration: 320, easing: 'ease-in-out' },
      )
  }
}

/** Run after the invalid field classes have rendered. */
export function focusFirstInvalidField(root?: HTMLElement) {
  const field = root?.querySelector<HTMLElement>('.is-error, [aria-invalid="true"]')
  if (!field) return
  const controlSelector =
    'input:not([type="hidden"]), textarea, [role="combobox"][tabindex], button'
  const controls = [
    ...(field.matches(controlSelector) ? [field] : []),
    ...field.querySelectorAll<HTMLElement>(controlSelector),
  ].filter((control) => !control.matches(':disabled, [aria-disabled="true"]'))
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
  animateInvalidFields(root!)
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
