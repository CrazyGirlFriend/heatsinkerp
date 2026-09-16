// @vitest-environment node
import { readFileSync } from 'node:fs'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { Quaternion, Vector3, type Object3D } from 'three'
import { createFactoryRobotMotion } from './factoryRobotMotion'
import { createFactoryRobotSurface } from './factoryRobotSurface'

let model: Object3D, rig: ReturnType<typeof createFactoryRobotMotion>
beforeEach(async () => {
  const bytes = readFileSync(new URL('../../public/assets/factory-live/robot-expressive.glb', import.meta.url))
  const asset = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')
  model = asset.scene; rig = createFactoryRobotMotion(model, asset.animations)
})
afterEach(() => rig.dispose())
describe('articulated material robot', () => {
  it('only delivers on an explicit first-row trigger, never on an unrelated timer', () => {
    for (let i = 0; i < 300; i++) expect(rig.update(0.04).lift).toBe(0)
    rig.gesture('handoff')
    let raised = false
    for (let i = 0; i < 300; i++) {
      const state = rig.update(0.04)
      if (i < 100 && state.lift > 0.5) raised = true
      if (i > 125) expect(state.lift).toBe(0)
    }
    expect(raised).toBe(true)
    rig.gesture('handoff')
    expect(rig.update(1).lift).toBeGreaterThan(0)
  })
  it('keeps both palms under the tray throughout a complete eased delivery', () => {
    rig.gesture('handoff')
    const start = rig.update(0)
    let maxLift = 0, previous = start.tray
    for (let i = 0; i < 125; i++) {
      const state = rig.update(0.04)
      maxLift = Math.max(maxLift, state.lift)
      expect(state.tray.distanceTo(previous)).toBeLessThan(0.025)
      for (const [point, side] of [[state.left, 1], [state.right, -1]] as const) {
        expect(point.distanceTo(state.tray.clone().add(new Vector3(side * 0.88, -0.11, 0)))).toBeLessThan(0.002)
      }
      previous = state.tray
    }
    expect(maxLift).toBeGreaterThan(0.99)
    expect(previous.distanceTo(start.tray)).toBeLessThan(0.002)
  })
  it('uses actual arm and head joint animations for waving and nodding', () => {
    rig.gesture('wave'); rig.update(0.01)
    const shoulder = model.getObjectByName('ShoulderR')!
    const initial = shoulder.quaternion.clone()
    for (let i = 0; i < 12; i++) rig.update(0.04)
    expect(shoulder.quaternion.angleTo(initial)).toBeGreaterThan(0.1)
    rig.gesture('nod'); rig.update(0.01)
    const head = model.getObjectByName('Head')!, before = head.quaternion.clone()
    for (let i = 0; i < 18; i++) rig.update(0.04)
    expect(head.quaternion.angleTo(before)).toBeGreaterThan(0.05)
  })
  it('turns the skeleton, cladding and tray together without invalid transforms', () => {
    const surface = createFactoryRobotSurface(model)
    rig.look('left')
    for (let i = 0; i < 100; i++) surface.update(rig.update(0.04))
    expect(model.rotation.y).toBeCloseTo(-0.2, 3)
    surface.root.traverse(object => {
      expect(object.position.toArray().every(Number.isFinite)).toBe(true)
      expect(object.quaternion.angleTo(new Quaternion())).toBeLessThanOrEqual(Math.PI)
    })
    surface.dispose()
  })
})
