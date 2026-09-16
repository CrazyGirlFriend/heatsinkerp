<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ACESFilmicToneMapping, DirectionalLight, HemisphereLight, Mesh, PerspectiveCamera, PMREMGenerator, Scene, WebGLRenderer, type Object3D, type WebGLRenderTarget } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { createFactoryRobotMotion } from '@/utils/factoryRobotMotion'
import { createFactoryRobotSurface } from '@/utils/factoryRobotSurface'
import { factoryCanvasRatio } from '@/utils/factoryScreen'

const props = withDefaults(defineProps<{ paused: boolean; look: 'left' | 'right' | 'center'; activityKey: string; displayScale?: number; deviceRatio?: number }>(), { displayScale: 1, deviceRatio: 1 })
const root = ref<HTMLElement>(), ready = ref(false), failed = ref(false)
let renderer: WebGLRenderer | undefined, scene: Scene, camera: PerspectiveCamera, model: Object3D | undefined
let rig: ReturnType<typeof createFactoryRobotMotion> | undefined, surface: ReturnType<typeof createFactoryRobotSurface> | undefined
let environment: WebGLRenderTarget | undefined, observer: ResizeObserver | undefined, frame = 0, last = 0, disposed = false
function disposeModel(value: Object3D) {
  value.traverse(object => { if (object instanceof Mesh) { object.geometry.dispose(); (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => material.dispose()) } })
}
function stop() { cancelAnimationFrame(frame); frame = 0; last = 0 }
function tick(now: number) {
  if (disposed || props.paused || !ready.value) return
  frame = requestAnimationFrame(tick)
  if (!last) last = now
  const elapsed = now - last
  if (elapsed < 1000 / 30) return
  last = now
  const state = rig!.update(Math.min(elapsed / 1000, 0.06))
  surface!.update(state)
  if (root.value) root.value.dataset.motionTime = state.time.toFixed(3)
  renderer!.render(scene, camera)
}
function resume() { stop(); if (ready.value && !props.paused) frame = requestAnimationFrame(tick) }
function resize() {
  if (!root.value || !renderer) return
  const { clientWidth: width, clientHeight: height } = root.value
  if (!width || !height) return
  camera.aspect = width / height; camera.updateProjectionMatrix()
  renderer.setPixelRatio(factoryCanvasRatio(width, height, props.displayScale, props.deviceRatio, 2_250_000))
  renderer.setSize(width, height, false); renderer.render(scene, camera)
}
function handoff() { if (props.activityKey) rig?.gesture('handoff') }
function contextLost(event: Event) { event.preventDefault(); stop(); failed.value = true; ready.value = false }
watch(() => props.paused, resume)
watch(() => props.look, value => rig?.look(value))
watch(() => props.activityKey, handoff)
watch(() => [props.displayScale, props.deviceRatio], resize, { flush: 'post' })
onMounted(async () => {
  try {
    scene = new Scene()
    camera = new PerspectiveCamera(32, 1, 0.1, 30)
    camera.position.set(0.18, 2.75, 9.4); camera.lookAt(0, 2.26, 0)
    renderer = new WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' })
    renderer.setClearColor(0x000000, 0)
    renderer.toneMapping = ACESFilmicToneMapping; renderer.toneMappingExposure = 0.92
    renderer.domElement.setAttribute('role', 'img'); renderer.domElement.setAttribute('aria-label', '三维物料机器人：关节抬手、转头和托盘递料')
    renderer.domElement.addEventListener('webglcontextlost', contextLost)
    root.value!.prepend(renderer.domElement)
    const generator = new PMREMGenerator(renderer), room = new RoomEnvironment()
    environment = generator.fromScene(room, 0.04); scene.environment = environment.texture
    room.dispose(); generator.dispose(); scene.environmentIntensity = 0.65
    scene.add(new HemisphereLight(0xd4eeff, 0x143045, 1.6))
    const key = new DirectionalLight(0xf2f6ff, 2.8); key.position.set(-3, 6, 5); scene.add(key)
    const rim = new DirectionalLight(0x31aacc, 3.5); rim.position.set(4, 3, -3); scene.add(rim)
    const gltf = await new GLTFLoader().loadAsync('/assets/factory-live/robot-expressive.glb')
    if (disposed) { disposeModel(gltf.scene); return }
    model = gltf.scene; scene.add(model)
    rig = createFactoryRobotMotion(model, gltf.animations); rig.look(props.look)
    surface = createFactoryRobotSurface(model, environment.texture); scene.add(surface.root)
    handoff(); surface.update(rig.update(0)); ready.value = true
    observer = new ResizeObserver(resize); observer.observe(root.value!); resize(); resume()
  } catch { if (!disposed) { failed.value = true; ready.value = false; stop() } }
})
onBeforeUnmount(() => {
  disposed = true; stop(); observer?.disconnect(); rig?.dispose(); surface?.dispose(); if (model) disposeModel(model)
  environment?.dispose()
  if (renderer) { renderer.domElement.removeEventListener('webglcontextlost', contextLost); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove() }
})
</script>
<template>
  <div ref="root" class="flow-robot" :data-ready="ready" :data-paused="paused" :data-activity-key="activityKey">
    <p v-if="!ready" class="robot-message" role="status">{{ failed ? '三维机器人加载失败' : '加载三维机器人' }}</p>
  </div>
</template>
<style scoped>
.flow-robot { position: relative; width: 100%; height: 100%; }
.flow-robot :deep(canvas) { display: block; width: 100%; height: 100%; }
.robot-message { position: absolute; inset: 45% 0 auto; text-align: center; font-size: 13px; color: #a6cad9; }
</style>
