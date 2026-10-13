// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { GlassRenderer } from '../../vendor/lens/index.js'

const gpu = vi.hoisted(() => ({ observe: vi.fn() }))
vi.mock('../../vendor/lens/internal/context-budget.js', () => ({ observeGPU: gpu.observe }))

let frames: Map<number, FrameRequestCallback>
let resize: () => void
let activate: () => void
let renderer: GlassRenderer | undefined
let time: number

beforeEach(() => {
  frames = new Map()
  time = 100
  let frameId = 0
  vi.spyOn(performance, 'now').mockImplementation(() => time)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback)
    return frameId
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  vi.stubGlobal('devicePixelRatio', 1)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback
      }
      observe() {}
      disconnect() {}
    },
  )
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  gpu.observe.mockImplementation((_stage, resume, suspend) => {
    activate = resume
    return { active: true, destroy: suspend }
  })
})

afterEach(() => {
  renderer?.destroy()
  renderer = undefined
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function nextFrame() {
  time += 16
  const pending = [...frames.values()]
  frames.clear()
  for (const callback of pending) callback(time)
}

function fixture() {
  const stage = document.createElement('section')
  const canvas = document.createElement('canvas')
  stage.append(canvas)
  document.body.append(stage)
  let width = 320
  vi.spyOn(stage, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 0, width, 240))
  let framebuffer: object | null = null
  let contextLost = false
  const displayDraws: Array<{ hidden: boolean; ready: boolean }> = []
  const extension = { loseContext: vi.fn(), restoreContext: vi.fn() }
  const gl = new Proxy(
    {
      FRAMEBUFFER: 1,
      FRAMEBUFFER_COMPLETE: 2,
      ACTIVE_UNIFORMS: 3,
      getProgramParameter: (_program: unknown, parameter: number) => parameter !== 3,
      getShaderParameter: () => true,
      getExtension: () => extension,
      isContextLost: () => contextLost,
      createFramebuffer: () => ({}),
      checkFramebufferStatus: () => 2,
      bindFramebuffer: (_target: unknown, target: object | null) => {
        framebuffer = target
      },
      drawArrays: () => {
        if (framebuffer === null) {
          displayDraws.push({
            hidden: canvas.hidden,
            ready: stage.classList.contains('webgl-ready'),
          })
        }
      },
    },
    // Shader setup and uniforms are irrelevant to presentation ordering.
    { get: (target, key) => Reflect.get(target, key) ?? (() => {}) },
  ) as unknown as WebGL2RenderingContext
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(gl)
  const onState = vi.fn()
  renderer = new GlassRenderer(canvas, stage, { artwork() {}, motion: false, onState })
  return {
    stage,
    canvas,
    displayDraws,
    onState,
    setWidth: (value: number) => (width = value),
    setContextLost: (value: boolean) => (contextLost = value),
  }
}

it('keeps the opaque canvas hidden until the first complete frame reaches the display buffer', () => {
  const { stage, canvas, displayDraws, onState } = fixture()
  activate()

  expect(displayDraws).toEqual([])
  expect(canvas.hidden).toBe(true)
  expect(stage.classList.contains('webgl-ready')).toBe(false)
  expect(onState).not.toHaveBeenCalledWith('ready')
  nextFrame()

  expect(displayDraws).toEqual([{ hidden: true, ready: false }])
  expect(canvas.hidden).toBe(false)
  expect(stage.classList.contains('webgl-ready')).toBe(true)
  expect(stage.classList.contains('fallback')).toBe(false)
  expect(onState).toHaveBeenCalledOnce()
  expect(onState).toHaveBeenCalledWith('ready')
  nextFrame()
  expect(onState).toHaveBeenCalledOnce()
})

it('lets a ready callback dispose the renderer without leaving an animation frame scheduled', () => {
  const { canvas, onState } = fixture()
  onState.mockImplementation((state) => {
    if (state === 'ready') renderer?.destroy()
  })
  activate()
  nextFrame()

  expect(onState).toHaveBeenCalledOnce()
  expect(canvas.hidden).toBe(true)
  expect(frames.size).toBe(0)
})

it('hides a cleared resize buffer until redraw while preserving the current surface chrome', () => {
  const { stage, canvas, displayDraws, onState, setWidth } = fixture()
  activate()
  nextFrame()
  setWidth(480)
  resize()

  expect(canvas.width).toBe(480)
  expect(canvas.hidden).toBe(true)
  expect(stage.classList.contains('webgl-ready')).toBe(true)
  nextFrame()

  expect(displayDraws.at(-1)).toEqual({ hidden: true, ready: true })
  expect(canvas.hidden).toBe(false)
  expect(onState).toHaveBeenCalledOnce()
})

it('keeps a completed frame visible when ResizeObserver reports unchanged dimensions', () => {
  const { canvas } = fixture()
  activate()
  nextFrame()
  resize()
  expect(canvas.hidden).toBe(false)
})

it('waits for a complete replacement frame after WebGL context restoration', () => {
  const { canvas, stage, displayDraws, onState, setContextLost } = fixture()
  activate()
  nextFrame()
  setContextLost(true)
  canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }))
  setContextLost(false)
  canvas.dispatchEvent(new Event('webglcontextrestored'))

  expect(canvas.hidden).toBe(true)
  expect(stage.classList.contains('webgl-ready')).toBe(false)
  expect(onState.mock.calls.map(([state]) => state)).toEqual(['ready', 'lost'])
  nextFrame()

  expect(displayDraws.at(-1)).toEqual({ hidden: true, ready: false })
  expect(canvas.hidden).toBe(false)
  expect(onState.mock.calls.map(([state]) => state)).toEqual(['ready', 'lost', 'ready'])
})
