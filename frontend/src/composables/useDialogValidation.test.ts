// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { nextTick, reactive } from 'vue'
import { focusFirstInvalidField, useDialogValidation } from './useDialogValidation'

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

it('locates the missing dimension instead of the shape selector or a disabled input', () => {
  document.body.innerHTML = `<form><div class="dialog-field is-error">
    <input type="hidden"><input disabled><input aria-label="shape" value="rectangle">
    <div class="specification-dimensions"><input value="30"><input aria-label="width"></div>
  </div></form>`
  const target = document.querySelector<HTMLInputElement>('[aria-label="width"]')!
  target.scrollIntoView = vi.fn()
  focusFirstInvalidField(document.querySelector('form')!)
  expect(document.activeElement).toBe(target)
  expect(target.scrollIntoView).toHaveBeenCalledWith({ block: 'center', inline: 'nearest' })
})

it('reveals all errors after submitting, focuses the employee control, and clears corrected fields', async () => {
  document.body.innerHTML = `<form><div class="el-form-item is-error"><button aria-label="person">选择</button></div></form>`
  const issues = reactive<Record<string, string>>({ person: '请选择员工', serial: '请输入流水号' })
  const validation = useDialogValidation(() => ({ ...issues }))
  validation.formRef.value = { $el: document.querySelector('form')! }
  expect(validation.fieldErrors.value).toEqual({})
  expect(validation.validate()).toBe(false)
  await nextTick()
  expect(document.activeElement).toBe(document.querySelector('button'))
  expect(validation.fieldErrors.value).toEqual(issues)
  delete issues.person
  expect(validation.fieldErrors.value).toEqual({ serial: '请输入流水号' })
  delete issues.serial
  expect(validation.validate()).toBe(true)
  issues.serial = '请输入流水号'
  validation.reset()
  expect(validation.fieldErrors.value).toEqual({})
})
