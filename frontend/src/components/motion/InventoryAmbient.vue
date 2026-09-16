<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Mesh, MeshBasicMaterial, OrthographicCamera, PlaneGeometry, Scene, Texture, WebGLRenderer } from 'three'

const props = defineProps<{ animate: boolean }>()
const root = ref<HTMLElement>()
const ready = ref(false)
let renderer: WebGLRenderer | undefined, scene: Scene, camera: OrthographicCamera
let plane: Mesh<PlaneGeometry, MeshBasicMaterial>, texture: Texture | undefined
let resizeObserver: ResizeObserver | undefined, frame = 0, last = 0, disposed = false, starting = false

function stop() { cancelAnimationFrame(frame); frame = 0 }
function draw(time: number) {
  if (!renderer || !ready.value || !props.animate || disposed) { stop(); return }
  // A very small, slow drift of the pale image; never move UI or business data.
  if (time - last >= 1000 / 24) {
    plane.position.set(Math.sin(time / 14000) * .006, Math.cos(time / 18000) * .004, 0)
    renderer.render(scene, camera); last = time
  }
  frame = requestAnimationFrame(draw)
}
function sync() {
  stop()
  if (props.animate && ready.value && !disposed) frame = requestAnimationFrame(draw)
}
function resize() {
  if (!root.value || !renderer) return
  const { width, height } = root.value.getBoundingClientRect()
  if (!width || !height) return
  renderer.setSize(width, height)
  const source = texture?.image as HTMLImageElement | undefined
  if (source && texture) {
    const imageRatio = source.width / source.height, ratio = width / height
    texture.repeat.set(Math.min(1, ratio / imageRatio), Math.min(1, imageRatio / ratio))
    texture.offset.set(1 - texture.repeat.x, 1 - texture.repeat.y)
  }
  renderer.render(scene, camera)
}
function lost(event: Event) { event.preventDefault(); ready.value = false; stop() }
async function start() {
  if (renderer || starting || disposed || !props.animate) return
  starting = true
  try {
    const THREE = await import('three')
    if (disposed || !root.value || !props.animate) return
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, powerPreference: 'low-power' })
    renderer.setPixelRatio(1)
    scene = new THREE.Scene()
    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2); camera.position.z = 1
    plane = new THREE.Mesh(new THREE.PlaneGeometry(2.04, 2.04), new THREE.MeshBasicMaterial({ toneMapped: false }))
    scene.add(plane)
    root.value.appendChild(renderer.domElement)
    renderer.domElement.addEventListener('webglcontextlost', lost)
    texture = new THREE.TextureLoader().load('/assets/factory-inventory/ambient-white-purple.png', loaded => {
      if (disposed) { loaded.dispose(); return }
      loaded.colorSpace = THREE.SRGBColorSpace
      plane.material.map = loaded; plane.material.needsUpdate = true
      ready.value = true; resize(); sync()
    }, undefined, () => { ready.value = false; stop() })
    resizeObserver = new ResizeObserver(resize); resizeObserver.observe(root.value)
    resize()
  } catch {
    // The decorative image stays visible when WebGL is not available.
    ready.value = false; stop()
  } finally { starting = false }
}
watch(() => props.animate, () => { if (!renderer) void start(); else sync() })
onMounted(() => { void start() })
onBeforeUnmount(() => {
  disposed = true; stop(); resizeObserver?.disconnect()
  texture?.dispose(); plane?.geometry.dispose(); plane?.material.dispose()
  if (renderer) {
    renderer.domElement.removeEventListener('webglcontextlost', lost)
    renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove()
  }
})
</script>
<template><div ref="root" class="inventory-ambient" :class="{ 'inventory-ambient--ready': ready }" aria-hidden="true" /></template>
<style scoped>
.inventory-ambient { position: absolute; top: 0; left: 0; width: 100%; height: 860px; pointer-events: none; opacity: .546; background: url('/assets/factory-inventory/ambient-white-purple.png') right top / cover no-repeat; -webkit-mask-image: linear-gradient(#000 50%, transparent); mask-image: linear-gradient(#000 50%, transparent); }
.inventory-ambient :deep(canvas) { display: block; width: 100%; height: 100%; opacity: 0; }
.inventory-ambient--ready :deep(canvas) { opacity: 1; }
@media print { .inventory-ambient { display: none; } }
</style>
