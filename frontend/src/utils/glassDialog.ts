import { createGlassSystem } from '../../vendor/lens/index.js'

export type GlassSurfaceCleanup = (() => void) & { freeze?: () => void }

// Optical surfaces enhance the existing DOM form without replacing its controls.
function createLayer(dialog: HTMLElement, footer?: HTMLElement, buttons: HTMLElement[] = []) {
  const shell = document.createElement('div')
  shell.className = 'lens-shell'
  shell.dataset.glass = 'panel'
  shell.setAttribute('aria-hidden', 'true')
  dialog.prepend(shell)
  if (footer) footer.dataset.glass = 'panel'
  const media = matchMedia('(prefers-reduced-motion: reduce)')
  const opaque = matchMedia('(prefers-reduced-transparency: reduce), (prefers-contrast: more)')
  let system: ReturnType<typeof createGlassSystem> | undefined
  let disposed = false
  let frozen = false
  let canvas: HTMLCanvasElement | undefined

  function resetLayer() {
    system?.destroy()
    system = undefined
    canvas?.remove()
    canvas = undefined
    resetMotion()
    dialog.classList.remove('lg-stage', 'fallback', 'webgl-ready')
    delete dialog.dataset.scene
    delete dialog.dataset.lgInput
    dialog.style.removeProperty('--lg-fallback-blur')
  }

  function resetMotion() {
    for (const button of buttons) {
      button.style.removeProperty('--jelly-matrix')
      delete button.dataset.jelly
      delete button.dataset.held
      button.classList.remove('jelly-moving')
    }
  }

  function create() {
    if (disposed || frozen) return
    resetLayer()
    if (
      opaque.matches ||
      typeof ResizeObserver === 'undefined' ||
      typeof IntersectionObserver === 'undefined'
    )
      return
    canvas = document.createElement('canvas')
    dialog.prepend(canvas)
    try {
      system = createGlassSystem(dialog, {
        canvas,
        material: { refraction: 0.76, blur: 0.14, dispersion: 0.1 },
        motion: false,
        interactive: false,
        maxPixelRatio: 1,
        elasticity: 0.32,
        audio: { enabled: false, storage: null },
        artwork(ctx, { width, height, dpr }) {
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(0, 0, width, height)
          // These are sampled light fields, shared by shell and footer; never a DOM screenshot.
          const light = ctx.createLinearGradient(0, 0, width, height)
          light.addColorStop(0, '#e0eee5')
          light.addColorStop(0.17, '#f9fcfa')
          light.addColorStop(0.54, '#ffffff')
          light.addColorStop(0.84, '#f1f7f3')
          light.addColorStop(1, '#c8e1d3')
          ctx.fillStyle = light
          ctx.fillRect(0, 0, width, height)
          ctx.lineWidth = dpr * 1.5
          for (let i = 0; i < 3; i++) {
            ctx.beginPath()
            ctx.moveTo(width * 0.55, height + 30 * dpr + i * 25 * dpr)
            ctx.bezierCurveTo(
              width * 0.7,
              height * 0.9,
              width * 0.82,
              height * 0.99,
              width + 60 * dpr,
              height * 0.63 + i * 35 * dpr,
            )
            ctx.strokeStyle = i % 2 ? '#ffffffc7' : '#8ca3971c'
            ctx.stroke()
          }
        },
      })
      system.renderer?.set({ brightness: 1 })
      if (!media.matches) {
        for (const button of buttons) {
          system.jelly.register(button, { mode: 'press' })
        }
      }
    } catch {
      // A visual enhancement must never block entry or submission.
      resetLayer()
    }
  }
  create()
  media.addEventListener('change', create)
  opaque.addEventListener('change', create)
  const release = () => {
    if (disposed) return
    disposed = true
    media.removeEventListener('change', create)
    opaque.removeEventListener('change', create)
    resetLayer()
    shell.remove()
    if (footer) delete footer.dataset.glass
  }
  return Object.assign(release, {
    freeze() {
      if (disposed || frozen) return
      frozen = true
      system?.renderer?.freeze()
      system?.jelly.destroy()
    },
  })
}

const surfaceSelector = '.app-glass-surface, .el-dialog, .el-drawer, .el-message-box'

export function enhanceGlassDialog(dialog: HTMLElement): GlassSurfaceCleanup {
  const owns = (element: Element) => element.closest(surfaceSelector) === dialog
  const footer = [
    ...dialog.querySelectorAll<HTMLElement>(
      '.el-dialog__footer, .el-drawer__footer, .el-message-box__btns, [data-glass-footer]',
    ),
  ].find(owns)
  const buttons = footer
    ? [...footer.querySelectorAll<HTMLButtonElement>('button')].filter(owns)
    : []
  const releaseDialog = createLayer(dialog, footer, buttons)
  const menus = new Map<HTMLElement, ReturnType<typeof createLayer>>()
  let disposed = false
  let frozen = false
  // Keep Escape local to the open action menu, before the dialog's document handler.
  function menuKey(event: KeyboardEvent) {
    if (!(event.target instanceof Element) || !owns(event.target)) return
    const menu = [
      ...dialog.querySelectorAll<HTMLElement>('.stock-source-popover[aria-hidden="false"]'),
    ].find(owns)
    if (!menu) return
    const trigger = menu
      .closest('.source-actions')
      ?.querySelector<HTMLButtonElement>('button.el-tooltip__trigger')
    if (event.key === 'Escape' && trigger) {
      event.preventDefault()
      event.stopImmediatePropagation()
      trigger.click()
      trigger.focus()
    } else if (
      ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) &&
      (menu.contains(event.target as Node) || event.target === trigger)
    ) {
      const items = [
        ...menu.querySelectorAll<HTMLButtonElement>('.source-action-menu button:not(:disabled)'),
      ]
      if (!items.length) return
      const current = items.indexOf(document.activeElement as HTMLButtonElement)
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? items.length - 1
            : current < 0
              ? event.key === 'ArrowDown'
                ? 0
                : items.length - 1
              : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
      event.preventDefault()
      event.stopImmediatePropagation()
      items[next]?.focus()
    }
  }
  window.addEventListener('keydown', menuKey, true)
  function syncMenus() {
    if (disposed || frozen) return
    for (const [menu, release] of menus) {
      if (!menu.isConnected || !owns(menu) || menu.getAttribute('aria-hidden') === 'true') {
        release()
        menus.delete(menu)
      }
    }
    for (const menu of dialog.querySelectorAll<HTMLElement>('.stock-source-popover')) {
      if (
        owns(menu) &&
        menu.getAttribute('aria-hidden') !== 'true' &&
        menu.offsetWidth &&
        !menus.has(menu)
      ) {
        menus.set(menu, createLayer(menu))
      }
    }
  }
  const observer = new MutationObserver(syncMenus)
  observer.observe(dialog, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['aria-hidden'],
  })
  syncMenus()
  const release = () => {
    if (disposed) return
    disposed = true
    window.removeEventListener('keydown', menuKey, true)
    observer.disconnect()
    for (const release of menus.values()) release()
    menus.clear()
    releaseDialog()
  }
  return Object.assign(release, {
    freeze() {
      if (disposed || frozen) return
      frozen = true
      window.removeEventListener('keydown', menuKey, true)
      observer.disconnect()
      releaseDialog.freeze()
      for (const release of menus.values()) release.freeze()
    },
  })
}
