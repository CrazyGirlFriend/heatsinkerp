import { AnimationMixer, LoopOnce, Quaternion, Vector3, type AnimationClip, type AnimationAction, type Object3D } from 'three'

export type RobotGesture = 'handoff' | 'wave' | 'nod'

/** Imported skeleton supplies the joints; two-bone IK keeps both palms under the tray. */
export function createFactoryRobotMotion(model: Object3D, clips: AnimationClip[]) {
  const mixer = new AnimationMixer(model)
  const actions = new Map(clips.map(clip => [clip.name, mixer.clipAction(clip)]))
  const arms = ['UpperArmL', 'LowerArmL', 'UpperArmR', 'LowerArmR'].map(name => model.getObjectByName(name)!)
  const rest = arms.map(bone => bone.quaternion.clone())
  let active: AnimationAction | undefined, kind: RobotGesture | null = null, age = 0, direction = 0
  const point = (name: string) => model.getObjectByName(name)!.getWorldPosition(new Vector3())
  function play(name: string) {
    const next = actions.get(name)!
    active?.fadeOut(0.35)
    next.reset().setEffectiveWeight(1).fadeIn(0.35).play()
    if (name !== 'Idle') { next.setLoop(LoopOnce, 1); next.clampWhenFinished = true }
    active = next
  }
  function aim(bone: Object3D, end: Object3D, target: Vector3) {
    model.updateMatrixWorld(true)
    const origin = bone.getWorldPosition(new Vector3())
    const from = end.getWorldPosition(new Vector3()).sub(origin).normalize()
    const to = target.clone().sub(origin).normalize()
    const world = bone.getWorldQuaternion(new Quaternion()).premultiply(new Quaternion().setFromUnitVectors(from, to))
    bone.quaternion.copy(bone.parent!.getWorldQuaternion(new Quaternion()).invert().multiply(world))
    model.updateMatrixWorld(true)
  }
  function reach(side: 'L' | 'R', lift: number, blend = 1) {
    const upper = model.getObjectByName(`UpperArm${side}`)!, lower = model.getObjectByName(`LowerArm${side}`)!, wrist = model.getObjectByName(`Palm2${side}`)!
    const a = upper.getWorldPosition(new Vector3()), b = lower.getWorldPosition(new Vector3()), c = wrist.getWorldPosition(new Vector3())
    const target = c.clone().lerp(model.localToWorld(new Vector3(side === 'L' ? 0.88 : -0.88, 1.62 + lift * 0.24, 1.02 + lift * 0.4)), blend)
    const l1 = a.distanceTo(b), l2 = b.distanceTo(c), d = Math.min(a.distanceTo(target), l1 + l2 - 0.001)
    const axis = target.clone().sub(a).normalize()
    const bend = new Vector3(0, -1, 0).addScaledVector(axis, axis.y).normalize()
    const along = (l1 * l1 - l2 * l2 + d * d) / (2 * Math.max(d, 0.001))
    const elbow = a.clone().addScaledVector(axis, along).addScaledVector(bend, Math.sqrt(Math.max(0, l1 * l1 - along * along)))
    aim(upper, lower, elbow); aim(lower, wrist, target)
  }
  function gesture(value: RobotGesture) { kind = value; age = 0; play(value === 'wave' ? 'Wave' : value === 'nod' ? 'Yes' : 'Idle') }
  const finished = () => play('Idle')
  mixer.addEventListener('finished', finished)
  play('Idle')
  return {
    gesture,
    look(value: 'left' | 'right' | 'center') { direction = value === 'left' ? -0.2 : value === 'right' ? 0.2 : 0 },
    update(dt: number) {
      age += dt
      arms.forEach((bone, i) => bone.quaternion.copy(rest[i]!))
      mixer.update(dt)
      model.rotation.y += (direction - model.rotation.y) * Math.min(1, dt * 2.5)
      model.updateMatrixWorld(true)
      // Eased travel starts and ends at rest; the tray never appears/disappears mid-motion.
      const lift = kind === 'handoff' && age < 5 ? (1 - Math.cos(Math.PI * 2 * age / 5)) / 2 : 0
      const wave = kind === 'wave' ? Math.max(0, Math.min(1, age / 0.25, (2.25 - age) / 0.5)) : 0
      reach('L', lift); reach('R', lift, 1 - wave)
      const tray = model.localToWorld(new Vector3(0, 1.73 + lift * 0.24, 1.02 + lift * 0.4))
      return { time: mixer.time, lift, wave, tray, left: point('Palm2L'), right: point('Palm2R') }
    },
    dispose() { mixer.removeEventListener('finished', finished); mixer.stopAllAction(); mixer.uncacheRoot(model) },
  }
}
