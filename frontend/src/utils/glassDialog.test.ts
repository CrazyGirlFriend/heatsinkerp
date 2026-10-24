// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { enhanceGlassDialog } from './glassDialog'

const runtime = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('../../vendor/lens/index.js', () => ({ createGlassSystem: runtime.create }))

function preference() {
  const listeners = new Set<() => void>()
  return {
    matches: false,
    addEventListener: vi.fn((_type: string, listener: () => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_type: string, listener: () => void) => listeners.delete(listener)),
    change(matches: boolean) {
      this.matches = matches
      for (const listener of [...listeners]) listener()
    },
    listeners,
  }
}

const cleanups: Array<() => void> = []
let motion: ReturnType<typeof preference>
let transparency: ReturnType<typeof preference>
let systems: Array<{
  stage: HTMLElement
  destroy: ReturnType<typeof vi.fn>
  register: ReturnType<typeof vi.fn>
  freeze: ReturnType<typeof vi.fn>
  stopMotion: ReturnType<typeof vi.fn>
}>

beforeEach(() => {
  motion = preference()
  transparency = preference()
  systems = []
  vi.stubGlobal('ResizeObserver', class {})
  vi.stubGlobal('IntersectionObserver', class {})
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => (query.includes('reduced-motion') ? motion : transparency)),
  )
  runtime.create.mockReset()
  runtime.create.mockImplementation(
    (stage: HTMLElement, options: { canvas?: HTMLCanvasElement }) => {
      const canvas = options.canvas ?? document.createElement('canvas')
      if (!canvas.isConnected) stage.prepend(canvas)
      canvas.classList.add('lg-canvas')
      stage.classList.add('lg-stage', 'webgl-ready')
      stage.dataset.scene = 'test'
      const register = vi.fn((button: HTMLElement) => {
        button.dataset.jelly = 'press'
        button.dataset.held = 'true'
        button.style.setProperty('--jelly-matrix', 'matrix(1,0,0,1,0,0)')
        button.classList.add('jelly-moving')
      })
      const destroy = vi.fn(() => {
        if (!options.canvas) canvas.remove()
        stage.classList.remove('webgl-ready')
      })
      const freeze = vi.fn()
      const stopMotion = vi.fn()
      systems.push({ stage, destroy, register, freeze, stopMotion })
      return {
        destroy,
        renderer: { set: vi.fn(), freeze },
        jelly: { register, destroy: stopMotion },
      }
    },
  )
})

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function fixture() {
  document.body.innerHTML = `<section class="el-dialog">
    <button class="el-dialog__headerbtn">关闭</button>
    <main><input value="100"><button class="form-action">选择员工</button>
      <div class="source-actions"><button class="el-tooltip__trigger">更多</button>
        <div class="stock-source-popover" aria-hidden="true">
          <div class="source-action-menu"><button>拆分物料</button><button disabled>移除</button><button>登记加工</button></div>
        </div>
      </div>
    </main>
    <footer class="el-dialog__footer"><div class="action-footer"><button>取消</button><button>确认出库</button></div></footer>
  </section>`
  const dialog = document.querySelector<HTMLElement>('.el-dialog')!
  const menu = dialog.querySelector<HTMLElement>('.stock-source-popover')!
  const trigger = dialog.querySelector<HTMLButtonElement>('.el-tooltip__trigger')!
  Object.defineProperty(menu, 'offsetWidth', {
    get: () => (menu.getAttribute('aria-hidden') === 'true' ? 0 : 180),
  })
  trigger.addEventListener('click', () => {
    menu.setAttribute('aria-hidden', String(menu.getAttribute('aria-hidden') !== 'true'))
  })
  return { dialog, menu, trigger }
}

function enhance(dialog: HTMLElement) {
  const cleanup = enhanceGlassDialog(dialog)
  cleanups.push(cleanup)
  return cleanup
}

async function flushMenus() {
  // MutationObserver delivery includes a second turn for the inserted optical layer.
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

function key(element: HTMLElement, value: string) {
  const event = new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })
  element.dispatchEvent(event)
  return event
}

it('adds press feedback only to fixed footer buttons, without hijacking native form actions', () => {
  const { dialog } = fixture()
  const submit = dialog.querySelectorAll<HTMLButtonElement>('.action-footer button')[1]!
  const submitAction = vi.fn()
  submit.addEventListener('click', submitAction)
  enhance(dialog)

  expect(runtime.create).toHaveBeenCalledTimes(1)
  expect(runtime.create).toHaveBeenCalledWith(
    dialog,
    expect.objectContaining({ motion: false, audio: expect.objectContaining({ enabled: false }) }),
  )
  expect(systems[0]!.register.mock.calls.map(([button]) => button)).toEqual([
    ...dialog.querySelectorAll('.action-footer button'),
  ])
  expect(systems[0]!.register).toHaveBeenCalledWith(submit, { mode: 'press' })
  submit.click()
  expect(submitAction).toHaveBeenCalledOnce()
  expect(dialog.querySelector('input')!.value).toBe('100')
})

it('removes owned optical resources and preference listeners exactly once on close', () => {
  const { dialog } = fixture()
  const cleanup = enhance(dialog)
  expect(dialog.querySelectorAll('canvas')).toHaveLength(1)
  cleanup()
  cleanup()

  expect(systems[0]!.destroy).toHaveBeenCalledOnce()
  expect(dialog.querySelector('canvas')).toBeNull()
  expect(dialog.querySelector('.lens-shell')).toBeNull()
  expect(dialog.querySelector('[data-jelly], [data-held], [data-glass]')).toBeNull()
  expect(dialog.querySelector('.jelly-moving')).toBeNull()
  expect(motion.listeners.size).toBe(0)
  expect(transparency.listeners.size).toBe(0)
  motion.change(true)
  transparency.change(true)
  expect(runtime.create).toHaveBeenCalledTimes(1)
})

it('freezes the surface and open menus until final cleanup without creating new optical layers', async () => {
  const { dialog, menu } = fixture()
  menu.setAttribute('aria-hidden', 'false')
  const cleanup = enhance(dialog)
  expect(systems).toHaveLength(2)
  cleanup.freeze?.()
  cleanup.freeze?.()
  for (const system of systems) {
    expect(system.freeze).toHaveBeenCalledOnce()
    expect(system.stopMotion).toHaveBeenCalledOnce()
    expect(system.destroy).not.toHaveBeenCalled()
  }
  expect(dialog.querySelectorAll('canvas')).toHaveLength(2)
  expect(dialog.classList.contains('webgl-ready')).toBe(true)
  motion.change(true)
  transparency.change(true)
  menu.setAttribute('aria-hidden', 'true')
  await flushMenus()
  expect(runtime.create).toHaveBeenCalledTimes(2)
  expect(systems.every((system) => system.destroy.mock.calls.length === 0)).toBe(true)

  cleanup()
  cleanup()
  expect(systems.every((system) => system.destroy.mock.calls.length === 1)).toBe(true)
  expect(dialog.querySelector('canvas')).toBeNull()
  expect(motion.listeners.size).toBe(0)
  expect(transparency.listeners.size).toBe(0)
})

it('allocates a menu layer only while visible and stops observing after close', async () => {
  const { dialog, menu } = fixture()
  const cleanup = enhance(dialog)
  expect(runtime.create).toHaveBeenCalledTimes(1)
  menu.setAttribute('aria-hidden', 'false')
  await flushMenus()
  expect(systems.filter((system) => system.stage === menu)).toHaveLength(1)
  expect(dialog.querySelectorAll('canvas')).toHaveLength(2)
  menu.setAttribute('aria-hidden', 'true')
  await flushMenus()
  expect(systems[1]!.destroy).toHaveBeenCalledOnce()
  expect(dialog.querySelectorAll('canvas')).toHaveLength(1)

  menu.setAttribute('aria-hidden', 'false')
  await flushMenus()
  menu.remove()
  await flushMenus()
  expect(systems[2]!.destroy).toHaveBeenCalledOnce()
  cleanup()
  dialog.append(menu)
  await flushMenus()
  expect(runtime.create).toHaveBeenCalledTimes(3)
  expect(dialog.querySelector('canvas')).toBeNull()
})

it('closes the open action menu with Escape before the dialog and returns focus to its trigger', async () => {
  const { dialog, menu, trigger } = fixture()
  enhance(dialog)
  const dialogEscape = vi.fn()
  document.addEventListener('keydown', dialogEscape)
  cleanups.push(() => document.removeEventListener('keydown', dialogEscape))
  trigger.click()
  await flushMenus()
  const action = menu.querySelector<HTMLButtonElement>('button')!
  action.focus()
  const event = key(action, 'Escape')
  await flushMenus()

  expect(event.defaultPrevented).toBe(true)
  expect(menu.getAttribute('aria-hidden')).toBe('true')
  expect(document.activeElement).toBe(trigger)
  expect(dialogEscape).not.toHaveBeenCalled()
  expect(dialog.isConnected).toBe(true)
  key(trigger, 'Escape')
  expect(dialogEscape).toHaveBeenCalledOnce()
})

it('supports menu navigation while skipping disabled actions and leaves form arrow keys alone', async () => {
  const { dialog, menu, trigger } = fixture()
  enhance(dialog)
  trigger.click()
  await flushMenus()
  const actions = menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
  trigger.focus()
  key(trigger, 'ArrowUp')
  expect(document.activeElement).toBe(actions[1])
  key(actions[1]!, 'ArrowDown')
  expect(document.activeElement).toBe(actions[0])
  key(actions[0]!, 'End')
  expect(document.activeElement).toBe(actions[1])
  key(actions[1]!, 'Home')
  expect(document.activeElement).toBe(actions[0])
  const input = dialog.querySelector('input')!
  input.focus()
  expect(key(input, 'ArrowUp').defaultPrevented).toBe(false)
  expect(document.activeElement).toBe(input)
})

it('reacts to accessibility preferences without keeping old renderers or motion registrations', () => {
  const { dialog } = fixture()
  motion.matches = true
  enhance(dialog)
  expect(systems[0]!.register).not.toHaveBeenCalled()
  motion.change(false)
  expect(systems[0]!.destroy).toHaveBeenCalledOnce()
  expect(systems[1]!.register).toHaveBeenCalledTimes(2)
  expect(dialog.querySelectorAll('canvas')).toHaveLength(1)
  transparency.change(true)
  expect(systems[1]!.destroy).toHaveBeenCalledOnce()
  expect(dialog.querySelector('canvas')).toBeNull()
  expect(dialog.querySelector('[data-jelly]')).toBeNull()
  transparency.change(false)
  expect(runtime.create).toHaveBeenCalledTimes(3)
  expect(dialog.querySelectorAll('canvas')).toHaveLength(1)
})

it('keeps a readable, usable form when transparency is disabled from the start', () => {
  transparency.matches = true
  const { dialog } = fixture()
  enhance(dialog)
  expect(runtime.create).not.toHaveBeenCalled()
  expect(dialog.querySelector('canvas')).toBeNull()
  expect(dialog.querySelector('input')!.value).toBe('100')
  expect(dialog.querySelector('.action-footer button')).not.toBeNull()
})

it('falls back safely when the runtime cannot initialize and still permits idempotent cleanup', () => {
  runtime.create.mockImplementation(() => {
    throw new Error('WebGL unavailable')
  })
  const { dialog } = fixture()
  const cleanup = enhance(dialog)
  expect(dialog.querySelector('canvas')).toBeNull()
  expect(dialog.querySelector('input')!.value).toBe('100')
  expect(() => {
    cleanup()
    cleanup()
  }).not.toThrow()
  expect(motion.listeners.size).toBe(0)
  expect(transparency.listeners.size).toBe(0)
})

it('keeps nested dialogs, their menus and footer motion owned by the nearest surface', async () => {
  const { dialog, menu: outerMenu } = fixture()
  const inner = document.createElement('section')
  inner.className = 'el-dialog'
  inner.innerHTML = `<main><div class="source-actions">
    <button class="el-tooltip__trigger">内层更多</button>
    <div class="stock-source-popover" aria-hidden="false"><div class="source-action-menu"><button>内层操作</button></div></div>
  </div></main><footer class="el-dialog__footer"><button>内层确认</button></footer>`
  dialog.querySelector('main')!.append(inner)
  const innerMenu = inner.querySelector<HTMLElement>('.stock-source-popover')!
  const innerTrigger = inner.querySelector<HTMLButtonElement>('.el-tooltip__trigger')!
  const innerFooter = inner.querySelector<HTMLButtonElement>('footer button')!
  Object.defineProperty(innerMenu, 'offsetWidth', { get: () => 180 })
  innerTrigger.addEventListener('click', () => innerMenu.setAttribute('aria-hidden', 'true'))
  outerMenu.setAttribute('aria-hidden', 'false')
  const closeOuter = enhance(dialog)
  expect(systems.map((system) => system.stage)).toEqual([dialog, outerMenu])
  const closeInner = enhance(inner)
  expect(systems.map((system) => system.stage)).toEqual([dialog, outerMenu, inner, innerMenu])
  expect(systems[0]!.register.mock.calls.map(([button]) => button)).not.toContain(innerFooter)
  expect(systems[2]!.register).toHaveBeenCalledWith(innerFooter, { mode: 'press' })

  const action = innerMenu.querySelector<HTMLButtonElement>('button')!
  action.focus()
  key(action, 'Escape')
  await flushMenus()
  expect(innerMenu.getAttribute('aria-hidden')).toBe('true')
  expect(outerMenu.getAttribute('aria-hidden')).toBe('false')
  expect(document.activeElement).toBe(innerTrigger)
  closeOuter.freeze?.()
  expect(systems[0]!.freeze).toHaveBeenCalledOnce()
  expect(systems[1]!.freeze).toHaveBeenCalledOnce()
  expect(systems[2]!.freeze).not.toHaveBeenCalled()
  expect(systems[3]!.freeze).not.toHaveBeenCalled()
  closeOuter()
  expect(innerFooter.dataset.jelly).toBe('press')
  expect(inner.querySelector('canvas')).not.toBeNull()
  closeInner()
  expect(dialog.querySelector('canvas')).toBeNull()
})

it('enhances an ordinary drawer footer without requiring batch-action markup', () => {
  document.body.innerHTML = `<aside class="el-drawer"><header><button>关闭</button></header>
    <main><button>明细</button></main><footer class="el-drawer__footer"><button>确认</button></footer></aside>`
  const drawer = document.querySelector<HTMLElement>('.el-drawer')!
  const footer = drawer.querySelector<HTMLElement>('footer')!
  const button = footer.querySelector('button')!
  const cleanup = enhance(drawer)
  expect(footer.dataset.glass).toBe('panel')
  expect(systems[0]!.register.mock.calls.map(([registered]) => registered)).toEqual([button])
  cleanup()
  expect(footer.hasAttribute('data-glass')).toBe(false)
  expect(button.hasAttribute('data-jelly')).toBe(false)
})
