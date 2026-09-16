import { CatmullRomCurve3, CylinderGeometry, Group, Mesh, MeshPhysicalMaterial, Quaternion, SphereGeometry, TorusGeometry, TubeGeometry, Vector3, type BufferGeometry, type Object3D, type Texture } from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'

/** Smooth hard-surface cladding on the original animated rig, in world-size units. */
export function createFactoryRobotSurface(model: Object3D, environmentMap: Texture | null = null) {
  const root = new Group(), geometries = new Set<BufferGeometry>()
  const ceramic = new MeshPhysicalMaterial({ color: '#dce8ef', metalness: 0.32, roughness: 0.26, clearcoat: 0.7, clearcoatRoughness: 0.2 })
  const metal = new MeshPhysicalMaterial({ color: '#668b9e', metalness: 0.85, roughness: 0.27 })
  const dark = new MeshPhysicalMaterial({ color: '#122e3d', metalness: 0.65, roughness: 0.32 })
  const glass = new MeshPhysicalMaterial({ color: '#03111c', metalness: 0.15, roughness: 0.18, clearcoat: 0.45, clearcoatRoughness: 0.2, envMap: environmentMap, envMapIntensity: 0.15 })
  const light = new MeshPhysicalMaterial({ color: '#52daf0', emissive: '#18bddb', emissiveIntensity: 1.3, metalness: 0.2, roughness: 0.3 })
  const materials = [ceramic, metal, dark, glass, light]
  const sphere = new SphereGeometry(1, 48, 32)
  const box = (x: number, y: number, z: number, r = 0.08) => new RoundedBoxGeometry(x, y, z, 4, r)
  function mesh(geometry: BufferGeometry, material = ceramic, parent: Object3D = root) {
    geometries.add(geometry); const item = new Mesh(geometry, material); parent.add(item); return item
  }
  function orb(parent: Object3D, scale: number[], position = [0, 0, 0], material = ceramic) {
    const item = mesh(sphere, material, parent); item.scale.set(...scale as [number, number, number]); item.position.set(...position as [number, number, number]); return item
  }
  model.updateMatrixWorld(true)
  model.traverse(object => { if (object instanceof Mesh) object.visible = false })
  const followers: (() => void)[] = []
  function attached(name: string, offset: Vector3) {
    const bone = model.getObjectByName(name)!, inverse = bone.getWorldQuaternion(new Quaternion()).invert()
    const group = new Group(); root.add(group)
    followers.push(() => {
      group.quaternion.copy(bone.getWorldQuaternion(new Quaternion()).multiply(inverse))
      group.position.copy(bone.getWorldPosition(new Vector3())).add(offset.clone().applyQuaternion(group.quaternion))
    })
    return group
  }
  const helmet = attached('Head', new Vector3(0, 0.56, 0))
  orb(helmet, [1.07, 0.93, 0.85])
  orb(helmet, [0.976, 0.706, 0.25], [0, -0.018, 0.65], metal)
  orb(helmet, [0.947, 0.675, 0.26], [0, -0.014, 0.673], glass)
  const eyes = new Group(); helmet.add(eyes)
  for (const side of [-1, 1]) {
    const ear = mesh(new CylinderGeometry(0.31, 0.31, 0.17, 48), metal, helmet)
    ear.rotation.z = Math.PI / 2; ear.position.set(side * 1.07, 0, 0)
    const cap = mesh(new CylinderGeometry(0.253, 0.253, 0.18, 48), dark, helmet)
    cap.rotation.z = Math.PI / 2; cap.position.set(side * 1.1, 0, 0)
    const ring = mesh(new TorusGeometry(0.234, 0.014, 10, 48), light, helmet)
    ring.rotation.y = Math.PI / 2; ring.position.set(side * 1.199, 0, 0)
    const center = mesh(new CylinderGeometry(0.157, 0.157, 0.018, 48), ceramic, helmet)
    center.rotation.z = Math.PI / 2; center.position.set(side * 1.2, 0, 0)
    const points = Array.from({ length: 21 }, (_, i) => new Vector3(side * 0.34 - 0.18 + i * 0.018, 0.065 + Math.sin(i / 20 * Math.PI) * 0.16, 0.933))
    mesh(new TubeGeometry(new CatmullRomCurve3(points), 32, 0.023, 10, false), light, eyes)
    orb(helmet, [0.045, 0.013, 0.012], [side * 0.53, -0.18, 0.913], light)
  }
  const neck = attached('Neck', new Vector3(0, 0.12, 0))
  mesh(new CylinderGeometry(0.25, 0.29, 0.28, 40), metal, neck)
  const body = attached('Torso_1', new Vector3(0, 0.03, 0.04))
  mesh(box(1.26, 1.22, 0.94, 0.24), ceramic, body)
  const chest = mesh(box(0.91, 0.73, 0.08, 0.17), metal, body); chest.position.set(0, 0.03, 0.48)
  const inset = mesh(box(0.84, 0.66, 0.05, 0.15), dark, body); inset.position.set(0, 0.03, 0.53)
  const badge = mesh(new TorusGeometry(0.125, 0.018, 12, 48), light, body); badge.position.set(0, 0.08, 0.566)
  for (let i = 0; i < 3; i++) { const vent = mesh(box(0.22, 0.022, 0.012, 0.008), metal, body); vent.position.set(0, -0.14 - i * 0.055, 0.56) }
  for (const side of [-1, 1]) for (const y of [-0.47, 0.47]) orb(body, [0.024, 0.024, 0.012], [side * 0.44, y, 0.439], metal)
  const waist = attached('Body', new Vector3(0, 0.025, -0.08))
  mesh(box(1.02, 0.27, 0.75, 0.1), dark, waist)
  const hands: Group[] = []
  for (const side of ['L', 'R']) {
    const shoulder = attached(`Shoulder${side}`, new Vector3())
    orb(shoulder, [0.285, 0.285, 0.28], [0, 0, 0], ceramic)
    for (const [start, end, width] of [[`UpperArm${side}`, `LowerArm${side}`, 0.26], [`LowerArm${side}`, `Palm2${side}`, 0.32], [`UpperLeg${side}`, `LowerLeg${side}`, 0.22], [`LowerLeg${side}`, `Foot${side}`, 0.29]] as const) {
      const a = model.getObjectByName(start)!, b = model.getObjectByName(end)!
      const length = a.getWorldPosition(new Vector3()).distanceTo(b.getWorldPosition(new Vector3()))
      const limb = mesh(box(width * 1.5, Math.max(0.15, length - 0.16), width * 1.6, width * 0.58))
      const joint = mesh(sphere, metal); joint.scale.setScalar(width * 0.8)
      followers.push(() => {
        const p = a.getWorldPosition(new Vector3()), q = b.getWorldPosition(new Vector3())
        limb.position.copy(p).lerp(q, 0.5)
        limb.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), q.sub(p).normalize())
        joint.position.copy(p)
      })
    }
    const foot = attached(`Foot${side}`, new Vector3(0, 0.14, 0.32))
    mesh(box(0.58, 0.28, 0.93, 0.12), ceramic, foot)
    const sole = mesh(box(0.6, 0.085, 0.94, 0.04), dark, foot); sole.position.y = -0.1
    const strip = mesh(box(0.34, 0.025, 0.016, 0.007), light, foot); strip.position.set(0, 0.015, 0.469)
    const hand = new Group(); root.add(hand); hands.push(hand)
    mesh(box(0.3, 0.2, 0.4, 0.08), dark, hand)
    for (const finger of [-1, 0, 1]) { const pad = mesh(box(0.07, 0.12, 0.23, 0.034), ceramic, hand); pad.position.set(finger * 0.085, 0.02, 0.15) }
  }
  const tray = new Group(); root.add(tray)
  mesh(box(1.91, 0.085, 0.88, 0.04), metal, tray)
  for (const side of [-1, 1]) {
    const edge = mesh(box(1.91, 0.16, 0.04, 0.017), ceramic, tray); edge.position.set(0, 0.065, side * 0.43)
    const handle = mesh(box(0.045, 0.16, 0.86, 0.019), metal, tray); handle.position.set(side * 0.93, 0.065, 0)
  }
  for (const x of [-0.52, 0, 0.52]) for (const z of [-0.19, 0.19]) {
    const part = mesh(new CylinderGeometry(0.15, 0.15, 0.17, 32), metal, tray); part.position.set(x, 0.12, z)
    const bore = mesh(new TorusGeometry(0.082, 0.02, 8, 32), dark, tray); bore.rotation.x = Math.PI / 2; bore.position.set(x, 0.212, z)
  }
  const wrist = model.getObjectByName('Palm2R')!, wristRest = wrist.getWorldQuaternion(new Quaternion()).invert()
  return {
    root,
    update(state: { time: number; wave: number; tray: Vector3; left: Vector3; right: Vector3 }) {
      followers.forEach(update => update())
      const blink = state.time % 4.8
      eyes.scale.y = blink < 0.18 ? 0.16 + Math.abs(blink / 0.09 - 1) * 0.84 : 1
      tray.position.copy(state.tray); tray.rotation.y = model.rotation.y
      hands[0]!.position.copy(state.left); hands[1]!.position.copy(state.right)
      hands.forEach(hand => hand.rotation.set(0, model.rotation.y, 0))
      hands[1]!.quaternion.slerp(wrist.getWorldQuaternion(new Quaternion()).multiply(wristRest), state.wave)
    },
    dispose() { geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose()) },
  }
}
