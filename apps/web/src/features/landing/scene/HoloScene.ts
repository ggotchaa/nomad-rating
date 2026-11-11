// WebGL scene of the landing: a hologram paddle juggling a ball above a projector, and a particle
// swarm that dissolves the paddle and re-forms it into a galaxy, a rating chart and a hall plan.
// The scroll timeline writes into `state`; the render loop only reads it.

import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { beamFragment, beamVertex, holoFragment, holoVertex, particleFragment, particleVertex } from './shaders.ts'
import { INITIAL_STATE } from './state.ts'
import type { SceneState } from './state.ts'
import { BLADE, HANDLE, chartCurve, chartPoints, galaxyPoints, hallPoints, hallTableCenter, mulberry, paddlePoints } from './shapes.ts'

export type { SceneState } from './state.ts'
export { INITIAL_STATE } from './state.ts'

const COLORS = {
  holo: new THREE.Color('#5ef2ff'),
  rubber: new THREE.Color('#ff3d62'),
  violet: new THREE.Color('#8a7dff'),
  ball: new THREE.Color('#ffb070'),
}

export type Quality = 'high' | 'low'

export function detectQuality(): Quality {
  const small = window.innerWidth < 820
  const cores = navigator.hardwareConcurrency ?? 4
  return small || cores < 4 ? 'low' : 'high'
}

function holoMaterial(color: THREE.Color, opacity = 1, scanDensity = 24) {
  return new THREE.ShaderMaterial({
    vertexShader: holoVertex,
    fragmentShader: holoFragment,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: color.clone() },
      uOpacity: { value: opacity },
      uScanDensity: { value: scanDensity },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  })
}

function glowTexture(): THREE.Texture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.2, 'rgba(255,190,120,0.75)')
  g.addColorStop(0.55, 'rgba(255,120,60,0.18)')
  g.addColorStop(1, 'rgba(255,120,60,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

export class HoloScene {
  readonly state: SceneState
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private composer: EffectComposer | null = null
  private startedAt = performance.now()
  private frame = 0
  private running = false
  private holoMaterials: THREE.ShaderMaterial[] = []
  private paddle = new THREE.Group()
  private ball = new THREE.Group()
  private ballGlow: THREE.Sprite
  private trail: THREE.Points
  private trailHistory: THREE.Vector3[] = []
  private swarm: THREE.Points
  private swarmMaterial: THREE.ShaderMaterial
  private dust: THREE.Points
  private projector = new THREE.Group()
  private beamMaterial: THREE.ShaderMaterial
  private disposed = false

  constructor(
    private canvas: HTMLCanvasElement,
    state: SceneState = { ...INITIAL_STATE },
    private quality: Quality = detectQuality(),
  ) {
    this.state = state
    // With bloom the scene renders opaque (post-processing over a transparent canvas loses the image);
    // the CSS background glows are recreated by the projector and the dust.
    const opaque = quality === 'high'
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: !opaque, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'high' ? 1.75 : 1.5))
    this.renderer.setClearColor(0x03050b, opaque ? 1 : 0)
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100)
    this.camera.position.set(0, 0.1, 7.2)

    this.buildPaddle()
    this.ballGlow = this.buildBall()
    this.trail = this.buildTrail()
    const swarm = this.buildSwarm(quality === 'high' ? 16000 : 7000)
    this.swarm = swarm.points
    this.swarmMaterial = swarm.material
    this.dust = this.buildDust(quality === 'high' ? 1600 : 700)
    this.beamMaterial = this.buildProjector()

    if (quality === 'high') {
      // The composer renders into its own target, where the canvas «antialias» flag does not apply:
      // without multisampling the hologram edges get stair-steps that crawl (blink) when anything moves.
      const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.UnsignedByteType, samples: 4 })
      this.composer = new EffectComposer(this.renderer, target)
      this.composer.addPass(new RenderPass(this.scene, this.camera))
      this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(512, 512), 0.45, 0.45, 0.2))
      this.composer.addPass(new OutputPass())
    }
    this.resize()
  }

  // --- Build -------------------------------------------------------------------------

  private buildPaddle() {
    const bladeShape = new THREE.Shape()
    bladeShape.absellipse(BLADE.cx, BLADE.cy, BLADE.rx, BLADE.ry, 0, Math.PI * 2, false, 0)
    const blade = new THREE.ExtrudeGeometry(bladeShape, { depth: BLADE.thickness, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.012, bevelSegments: 2, curveSegments: 64 })
    blade.translate(0, 0, -BLADE.thickness / 2)
    const bladeMaterial = holoMaterial(COLORS.holo, 0.9)
    this.paddle.add(new THREE.Mesh(blade, bladeMaterial))

    // Red rubber in front, black (here: deep cyan) at the back.
    const rubberShape = new THREE.Shape()
    rubberShape.absellipse(BLADE.cx, BLADE.cy, BLADE.rx - 0.03, BLADE.ry - 0.03, 0, Math.PI * 2, false, 0)
    const rubber = new THREE.ShapeGeometry(rubberShape, 64)
    const front = new THREE.Mesh(rubber, holoMaterial(COLORS.rubber, 0.75, 36))
    front.position.z = BLADE.thickness / 2 + 0.014
    const back = new THREE.Mesh(rubber, holoMaterial(COLORS.violet, 0.55, 36))
    back.position.z = -BLADE.thickness / 2 - 0.014
    this.paddle.add(front, back)

    const handleShape = new THREE.Shape()
    const { top, bottom, halfWidth: w, flare: f } = HANDLE
    handleShape.moveTo(-w, top)
    handleShape.lineTo(-w, bottom + 0.35)
    handleShape.quadraticCurveTo(-f, bottom + 0.1, -f, bottom)
    handleShape.lineTo(f, bottom)
    handleShape.quadraticCurveTo(f, bottom + 0.1, w, bottom + 0.35)
    handleShape.lineTo(w, top)
    handleShape.lineTo(-w, top)
    const handle = new THREE.ExtrudeGeometry(handleShape, { depth: HANDLE.thickness, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 3 })
    handle.translate(0, 0, -HANDLE.thickness / 2)
    this.paddle.add(new THREE.Mesh(handle, holoMaterial(COLORS.holo, 0.9)))

    // Wireframe edges: the «blueprint» outline of the hologram.
    const edgeMaterial = new THREE.LineBasicMaterial({ color: COLORS.holo, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false })
    for (const geometry of [blade, handle]) this.paddle.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 25), edgeMaterial))
    this.paddle.userData.edgeMaterial = edgeMaterial
    this.scene.add(this.paddle)
  }

  private buildBall(): THREE.Sprite {
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.15, 40, 24), holoMaterial(COLORS.ball, 1, 30))
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.1, 24, 16), new THREE.MeshBasicMaterial({ color: '#ffd9b0', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }))
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }))
    glow.scale.setScalar(1.1)
    this.ball.add(sphere, core, glow)
    this.scene.add(this.ball)
    return glow
  }

  private buildTrail(): THREE.Points {
    const n = 46
    for (let i = 0; i < n; i++) this.trailHistory.push(new THREE.Vector3())
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3))
    const fade = new Float32Array(n)
    for (let i = 0; i < n; i++) fade[i] = 1 - i / n
    geometry.setAttribute('aFade', new THREE.BufferAttribute(fade, 1))
    const material = new THREE.ShaderMaterial({
      uniforms: { uPixelRatio: { value: this.renderer.getPixelRatio() }, uOpacity: { value: 1 }, uColor: { value: COLORS.ball.clone() } },
      vertexShader: /* glsl */ `
        attribute float aFade;
        uniform float uPixelRatio;
        varying float vFade;
        void main() {
          vFade = aFade;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = (14.0 + 60.0 * aFade * aFade) * uPixelRatio / -mv.z;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uOpacity;
        varying float vFade;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;
          gl_FragColor = vec4(uColor, smoothstep(0.5, 0.0, d) * vFade * vFade * 0.5 * uOpacity);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    const points = new THREE.Points(geometry, material)
    points.frustumCulled = false
    this.scene.add(points)
    return points
  }

  private buildSwarm(count: number) {
    const rand = mulberry(7)
    const geometry = new THREE.BufferGeometry()
    const p1 = galaxyPoints(count, rand)
    const hall = hallPoints(count, rand)
    geometry.setAttribute('position', new THREE.BufferAttribute(p1, 3))
    geometry.setAttribute('aPos0', new THREE.BufferAttribute(paddlePoints(count, rand), 3))
    geometry.setAttribute('aPos1', new THREE.BufferAttribute(p1, 3))
    geometry.setAttribute('aPos2', new THREE.BufferAttribute(chartPoints(count, rand), 3))
    geometry.setAttribute('aPos3', new THREE.BufferAttribute(hall.positions, 3))
    geometry.setAttribute('aGroup', new THREE.BufferAttribute(hall.groups, 1))
    const randoms = new Float32Array(count * 4)
    for (let i = 0; i < randoms.length; i++) randoms[i] = rand()
    geometry.setAttribute('aRand', new THREE.BufferAttribute(randoms, 4))
    const material = new THREE.ShaderMaterial({
      vertexShader: particleVertex,
      fragmentShader: particleFragment,
      uniforms: {
        uTime: { value: 0 },
        uShape: { value: 0 },
        uPaddleMatrix: { value: new THREE.Matrix4() },
        uPixelRatio: { value: this.renderer.getPixelRatio() },
        uSize: { value: this.quality === 'high' ? 19 : 24 },
        uHiCall: { value: 0 },
        uHiBook: { value: 0 },
        uOpacity: { value: 1 },
        uColorA: { value: COLORS.holo.clone() },
        uColorB: { value: COLORS.rubber.clone() },
        uColorC: { value: COLORS.violet.clone() },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    const points = new THREE.Points(geometry, material)
    points.frustumCulled = false
    this.scene.add(points)
    return { points, material }
  }

  private buildDust(count: number): THREE.Points {
    const rand = mulberry(11)
    const positions = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) positions.set([(rand() - 0.5) * 26, (rand() - 0.5) * 16, -2 - rand() * 14], i * 3)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const dust = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({ color: '#7fd8ff', size: 0.035, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }),
    )
    this.scene.add(dust)
    return dust
  }

  private buildProjector(): THREE.ShaderMaterial {
    const emitterMaterial = holoMaterial(COLORS.holo, 1, 20)
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.02, 12, 128), emitterMaterial)
    ring.rotation.x = Math.PI / 2
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.014, 12, 128), emitterMaterial)
    ring2.rotation.x = Math.PI / 2
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(0.6, 64),
      new THREE.MeshBasicMaterial({ color: COLORS.holo, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false }),
    )
    disc.rotation.x = -Math.PI / 2
    const beamMaterial = new THREE.ShaderMaterial({
      vertexShader: beamVertex,
      fragmentShader: beamFragment,
      uniforms: { uTime: { value: 0 }, uColor: { value: COLORS.holo.clone() }, uOpacity: { value: 1 } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    })
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 0.6, 3.6, 64, 1, true), beamMaterial)
    beam.position.y = 1.8
    this.projector.add(ring, ring2, disc, beam)
    this.projector.position.set(0.9, -2.35, -0.4)
    this.holoMaterials.push(emitterMaterial)
    this.scene.add(this.projector)
    return beamMaterial
  }

  // --- Runtime -------------------------------------------------------------------------

  resize() {
    const width = this.canvas.clientWidth || window.innerWidth
    const height = this.canvas.clientHeight || window.innerHeight
    this.renderer.setSize(width, height, false)
    this.composer?.setSize(width, height)
    this.camera.aspect = width / height
    // Keep the scene framed on portrait phones.
    this.camera.fov = width < height ? 52 : 38
    this.camera.updateProjectionMatrix()
  }

  start() {
    if (this.running || this.disposed) return
    this.running = true
    const loop = () => {
      if (!this.running) return
      this.frame = requestAnimationFrame(loop)
      this.render()
    }
    loop()
  }

  stop() {
    this.running = false
    cancelAnimationFrame(this.frame)
  }

  /** One frame without the loop (reduced motion). */
  renderOnce() {
    this.render()
  }

  private ballPosition(time: number, out: THREE.Vector3): THREE.Vector3 {
    const s = this.state
    const key = new THREE.Vector3(s.ballX, s.ballY, s.ballZ)
    // Juggling: a parabola above the blade centre, along the world «up».
    const anchor = new THREE.Vector3(BLADE.cx, BLADE.cy, BLADE.thickness / 2 + 0.16).applyMatrix4(this.paddle.matrixWorld)
    const f = (time * 0.9) % 1
    const bounce = anchor.clone().add(new THREE.Vector3(0, 4 * 1.05 * f * (1 - f), 0))
    const angle = time * 0.75
    const orbit = new THREE.Vector3(Math.cos(angle) * 2.5, 0.25 + Math.sin(angle) * 0.9, Math.sin(angle) * 1.4)
    const [cx, cy, cz] = chartCurve(Math.min(Math.max(s.curveT, 0), 1))
    const curve = new THREE.Vector3(cx, cy + 0.16, cz + 0.1)
    const [tx, ty, tz] = hallTableCenter(4)
    const g = (time * 1.25) % 1
    const table = new THREE.Vector3(tx + 0.25, ty + 0.12 + 4 * 0.75 * g * (1 - g), tz)
    const weights = s.ballBounce + s.ballOrbit + s.ballCurve + s.ballTable
    const base = Math.max(0, 1 - weights)
    out.copy(key).multiplyScalar(base)
    out.addScaledVector(bounce, s.ballBounce).addScaledVector(orbit, s.ballOrbit).addScaledVector(curve, s.ballCurve).addScaledVector(table, s.ballTable)
    if (weights > 1) out.multiplyScalar(1 / weights)
    return out
  }

  private render() {
    const s = this.state
    const time = (performance.now() - this.startedAt) / 1000

    // The camera moves only with the scroll story: pointer parallax made the thin hologram
    // lines re-rasterise at shifting sub-pixel positions, which read as blinking.
    this.camera.position.set(s.camX, s.camY, s.camZ)
    this.camera.lookAt(s.camX * 0.6, s.camY * 0.5, 0)

    // Paddle: no idle sway (slow sub-pixel motion of thin hologram details reads as blinking).
    this.paddle.position.set(s.paddleX, s.paddleY, s.paddleZ)
    this.paddle.rotation.set(s.paddleRotX, s.paddleRotY, s.paddleRotZ)
    this.paddle.scale.setScalar(s.paddleScale)
    this.paddle.updateMatrixWorld(true)
    this.paddle.visible = s.paddleOpacity > 0.01
    this.paddle.traverse((child) => {
      const material = (child as THREE.Mesh).material as THREE.ShaderMaterial | undefined
      if (material?.uniforms?.uOpacity) {
        material.uniforms.uOpacity.value = s.paddleOpacity * (material.userData.baseOpacity ?? (material.userData.baseOpacity = material.uniforms.uOpacity.value as number))
        material.uniforms.uTime!.value = time
      }
    })
    ;(this.paddle.userData.edgeMaterial as THREE.LineBasicMaterial).opacity = 0.3 * s.paddleOpacity

    // Ball and its trail.
    this.ballPosition(time, this.ball.position)
    this.ball.rotation.set(time * 2.1, time * 1.4, 0)
    this.ball.visible = s.ballOpacity > 0.01
    this.ball.traverse((child) => {
      const material = (child as THREE.Mesh).material as (THREE.Material & { uniforms?: Record<string, THREE.IUniform> }) | undefined
      if (!material) return
      if (material.uniforms?.uTime) {
        material.uniforms.uTime.value = time
        material.uniforms.uOpacity!.value = s.ballOpacity
      } else material.opacity = s.ballOpacity * (child === this.ballGlow ? 1 : 0.85)
    })
    this.trailHistory.pop()
    this.trailHistory.unshift(this.ball.position.clone())
    const trailPositions = this.trail.geometry.getAttribute('position') as THREE.BufferAttribute
    this.trailHistory.forEach((p, i) => trailPositions.setXYZ(i, p.x, p.y, p.z))
    trailPositions.needsUpdate = true
    ;(this.trail.material as THREE.ShaderMaterial).uniforms.uOpacity!.value = s.ballOpacity

    // Swarm.
    const u = this.swarmMaterial.uniforms
    u.uTime!.value = time
    u.uShape!.value = s.shape
    ;(u.uPaddleMatrix!.value as THREE.Matrix4).copy(this.paddle.matrixWorld)
    u.uHiCall!.value = s.hiCall
    u.uHiBook!.value = s.hiBook
    u.uOpacity!.value = s.particles
    this.swarm.rotation.y = s.swarmRotY + Math.sin(time * 0.15) * 0.06

    this.dust.rotation.y = time * 0.01
    this.dust.position.y = Math.sin(time * 0.1) * 0.2

    // Projector beam.
    this.projector.position.x = s.paddleX
    this.projector.visible = s.beam > 0.01
    this.beamMaterial.uniforms.uTime!.value = time
    this.beamMaterial.uniforms.uOpacity!.value = s.beam
    for (const m of this.holoMaterials) {
      m.uniforms.uTime!.value = time
      m.uniforms.uOpacity!.value = s.beam
    }

    if (this.composer) this.composer.render()
    else this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    this.disposed = true
    this.stop()
    this.scene.traverse((object) => {
      const mesh = object as THREE.Mesh
      mesh.geometry?.dispose()
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(material)) material.forEach((m) => m.dispose())
      else material?.dispose()
    })
    this.composer?.dispose()
    this.renderer.dispose()
  }
}
