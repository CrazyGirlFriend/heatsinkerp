// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { nextTick, reactive } from 'vue'
import { focusFirstInvalidField, useDialogValidation } from './useDialogValidation'

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
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

it('animates invalid fields once per failed submit, without moving valid fields or labels', async () => {
  document.body.innerHTML = `<form>
    <div class="el-form-item is-error"><label>流水号</label><div class="el-form-item__content"><div class="el-input is-error"><input></div></div></div>
    <div class="el-form-item"><div class="el-form-item__content"><input value="材料1"></div></div>
    <section class="processing-outputs is-error"><div class="dialog-field is-error"><button>选择员工</button></div></section>
  </form>`
  const root = document.querySelector('form')!
  const content = root.querySelector<HTMLElement>('.el-form-item__content')!
  const custom = root.querySelector<HTMLElement>('.dialog-field')!
  const group = root.querySelector<HTMLElement>('.processing-outputs')!
  group.animate = vi.fn()
  const animate = vi.fn()
  content.animate = animate
  custom.animate = animate
  const valid = root.querySelectorAll<HTMLElement>('.el-form-item__content')[1]!
  valid.animate = vi.fn()
  const nested = root.querySelector<HTMLElement>('.el-input')!
  nested.animate = vi.fn()
  const issues = reactive<Record<string, string>>({ serial: '请输入流水号' })
  const validation = useDialogValidation(() => ({ ...issues }))
  validation.formRef.value = { $el: root }
  expect(animate).not.toHaveBeenCalled()
  expect(validation.validate()).toBe(false)
  await nextTick()
  expect(animate).toHaveBeenCalledTimes(2)
  expect(animate).toHaveBeenCalledWith(
    expect.any(Array),
    expect.objectContaining({ id: 'invalid-field-feedback', duration: 320 }),
  )
  expect(valid.animate).not.toHaveBeenCalled()
  expect(nested.animate).not.toHaveBeenCalled()
  expect(group.animate).not.toHaveBeenCalled()
  delete issues.serial
  expect(validation.validate()).toBe(true)
  await nextTick()
  expect(animate).toHaveBeenCalledTimes(2)
})

it('restarts feedback on another submit without canceling unrelated animations', () => {
  document.body.innerHTML = '<form><div class="dialog-field is-error"><input></div></form>'
  const root = document.querySelector('form')!
  const field = root.querySelector<HTMLElement>('.is-error')!
  const feedback = { id: 'invalid-field-feedback', cancel: vi.fn() }
  const unrelated = { id: 'another-animation', cancel: vi.fn() }
  field.animate = vi.fn()
  field.getAnimations = vi.fn().mockReturnValue([feedback, unrelated])
  focusFirstInvalidField(root)
  focusFirstInvalidField(root)
  expect(feedback.cancel).toHaveBeenCalledTimes(2)
  expect(unrelated.cancel).not.toHaveBeenCalled()
  expect(field.animate).toHaveBeenCalledTimes(2)
})

it('keeps error focus and cancels motion when reduced motion is requested', () => {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))
  document.body.innerHTML = '<form><div class="dialog-field is-error"><input></div></form>'
  const root = document.querySelector('form')!
  const field = root.querySelector<HTMLElement>('.is-error')!
  const input = root.querySelector('input')!
  const feedback = { id: 'invalid-field-feedback', cancel: vi.fn() }
  field.getAnimations = vi.fn().mockReturnValue([feedback])
  field.animate = vi.fn()
  focusFirstInvalidField(root)
  expect(feedback.cancel).toHaveBeenCalledOnce()
  expect(field.animate).not.toHaveBeenCalled()
  expect(document.activeElement).toBe(input)
  expect(field.classList.contains('is-error')).toBe(true)
})

it('focuses and animates a custom invalid button without duplicating nested field feedback', () => {
  document.body.innerHTML = `<form>
    <button aria-invalid="true" aria-label="接收人">请选择接收人</button>
    <div class="el-form-item is-error"><div class="el-form-item__content"><input aria-invalid="true"></div></div>
  </form>`
  const root = document.querySelector('form')!
  const button = root.querySelector('button')!
  const content = root.querySelector<HTMLElement>('.el-form-item__content')!
  const nested = root.querySelector('input')!
  button.animate = vi.fn()
  button.scrollIntoView = vi.fn()
  content.animate = vi.fn()
  nested.animate = vi.fn()
  focusFirstInvalidField(root)
  expect(document.activeElement).toBe(button)
  expect(button.scrollIntoView).toHaveBeenCalledWith({ block: 'center', inline: 'nearest' })
  expect(button.animate).toHaveBeenCalledOnce()
  expect(content.animate).toHaveBeenCalledOnce()
  expect(nested.animate).not.toHaveBeenCalled()
})

it('keeps custom employee focus but skips its shake when reduced motion is requested', () => {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))
  document.body.innerHTML = '<form><button aria-invalid="true">接收人</button></form>'
  const button = document.querySelector('button')!
  button.animate = vi.fn()
  focusFirstInvalidField(document.querySelector('form')!)
  expect(document.activeElement).toBe(button)
  expect(button.animate).not.toHaveBeenCalled()
})
