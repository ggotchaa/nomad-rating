// Scroll story: one keyframe of the scene per chapter, scrubbed by scroll (GSAP ScrollTrigger
// + Lenis smooth scrolling). Chapter k is centred on the screen at timeline position k.

import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'
import { INITIAL_STATE } from './scene/state.ts'
import type { SceneState } from './scene/state.ts'

gsap.registerPlugin(ScrollTrigger)

export const CHAPTERS = ['Старт', 'Подача', 'Запись', 'Рейтинг', 'Вызов', 'Бронь', 'Игра'] as const

type Key = Partial<SceneState>

/** Scene keyframes. `portrait` keeps objects centred under the text on phones. */
function keyframes(portrait: boolean): Key[] {
  const side = (x: number) => (portrait ? 0 : x)
  return [
    // 0 — hero: the paddle juggles the ball over the projector.
    { ...INITIAL_STATE, paddleX: side(1.95), paddleY: portrait ? -1.05 : -0.45, camZ: portrait ? 8.2 : 7.2 },
    // 1 — «Подача»: a forehand swing sends the ball away; the projector dims.
    {
      shape: 0, particles: 1, paddleOpacity: 1, paddleX: side(-1.25), paddleY: portrait ? -0.9 : -0.1, paddleZ: 0.3,
      paddleRotX: -0.2, paddleRotY: 1.2, paddleRotZ: 0.55, paddleScale: 1.05,
      ballX: side(2.9), ballY: 1.5, ballZ: 1.6, ballBounce: 0, ballOrbit: 0, ballCurve: 0, ballTable: 0, ballOpacity: 1,
      camX: 0, camY: 0, camZ: portrait ? 8 : 6.8, beam: 0.25, hiCall: 0, hiBook: 0, swarmRotY: 0, curveT: 0,
    },
    // 2 — «Запись»: the paddle dissolves into a galaxy of players, the ball orbits it.
    {
      shape: 1, paddleOpacity: 0, paddleX: side(-1.0), paddleRotY: 3.2, paddleScale: 0.7,
      ballOrbit: 1, beam: 0, swarmRotY: 0.5, camX: side(-1.5), camY: portrait ? 4.2 : 0.3, camZ: portrait ? 11.5 : 7.8, curveT: 0,
    },
    // 3 — «Рейтинг»: the swarm draws a rating curve, the ball rides it.
    { shape: 2, ballOrbit: 0, ballCurve: 1, curveT: 0.62, swarmRotY: 0, camX: 0, camY: portrait ? 5 : -0.15, camZ: portrait ? 13 : 7.6 },
    // 4 — «Вызов»: a hall plan, table 5 lights up and the ball bounces on it.
    { shape: 3, ballCurve: 0, curveT: 1, ballTable: 1, hiCall: 1, swarmRotY: -0.15, camX: side(2.1), camY: portrait ? 5.2 : 0.25, camZ: portrait ? 12.5 : 7.3 },
    // 5 — «Бронь»: booked tables glow, the ball orbits the hall.
    { shape: 3, ballTable: 0, ballOrbit: 1, hiCall: 0, hiBook: 1, swarmRotY: 0.25, camX: side(-2.2), camY: portrait ? 5.2 : 0.35, camZ: portrait ? 12.5 : 7.5 },
    // 6 — final: the paddle re-forms and juggles again.
    {
      shape: 0, paddleOpacity: 1, paddleX: 0, paddleY: portrait ? -1.25 : -1.15, paddleZ: 0, paddleRotX: -0.62, paddleRotY: -0.35 + Math.PI * 2,
      paddleRotZ: -0.15, paddleScale: 0.85, ballOrbit: 0, ballBounce: 1, hiBook: 0, beam: 1, swarmRotY: 0, camX: 0, camY: 0.1, camZ: portrait ? 8.6 : 7.4,
    },
  ]
}

export type StoryHandles = {
  story: HTMLElement
  chapters: HTMLElement[]
  progress: HTMLElement | null
  onChapter: (index: number) => void
  /** True while the live section (below the story) is on screen. */
  onLive: (active: boolean) => void
  live: HTMLElement | null
  canvasWrap: HTMLElement | null
}

export function buildStory(state: SceneState, h: StoryHandles): () => void {
  const portrait = window.innerWidth < window.innerHeight
  const lenis = new Lenis({ lerp: 0.085, wheelMultiplier: 0.9 })
  lenis.on('scroll', ScrollTrigger.update)
  const tick = (time: number) => lenis.raf(time * 1000)
  gsap.ticker.add(tick)
  gsap.ticker.lagSmoothing(0)

  const keys = keyframes(portrait)
  Object.assign(state, keys[0])
  const timeline = gsap.timeline({
    defaults: { ease: 'sine.inOut', duration: 1 },
    scrollTrigger: {
      trigger: h.story,
      start: 'top top',
      end: 'bottom bottom',
      scrub: 0.9,
      onUpdate: (self) => {
        if (h.progress) h.progress.style.transform = `scaleX(${self.progress})`
        h.onChapter(Math.round(self.progress * (keys.length - 1)))
      },
    },
  })
  for (let i = 1; i < keys.length; i++) timeline.to(state, { ...keys[i] }, i - 1)

  // Text of every chapter: rises in from blur, then leaves.
  const triggers: ScrollTrigger[] = []
  h.chapters.forEach((chapter, index) => {
    const content = chapter.querySelectorAll<HTMLElement>('[data-reveal]')
    if (!content.length) return
    if (index > 0) {
      const tween = gsap.fromTo(
        content,
        { autoAlpha: 0, y: 70, filter: 'blur(10px)' },
        { autoAlpha: 1, y: 0, filter: 'blur(0px)', stagger: 0.08, ease: 'power2.out', scrollTrigger: { trigger: chapter, start: 'top 78%', end: 'top 30%', scrub: true } },
      )
      triggers.push(tween.scrollTrigger!)
    }
    if (index < h.chapters.length - 1) {
      const tween = gsap.to(content, {
        autoAlpha: 0,
        y: -60,
        filter: 'blur(8px)',
        stagger: 0.04,
        ease: 'power1.in',
        immediateRender: false,
        scrollTrigger: { trigger: chapter, start: 'bottom 62%', end: 'bottom 18%', scrub: true },
      })
      triggers.push(tween.scrollTrigger!)
    }
  })

  // After the story the scene stays as a dimmed background behind the live data.
  if (h.live) triggers.push(ScrollTrigger.create({ trigger: h.live, start: 'top 55%', onToggle: (self) => h.onLive(self.isActive) }))
  if (h.live && h.canvasWrap) {
    const tween = gsap.to(h.canvasWrap, { opacity: 0.28, ease: 'none', scrollTrigger: { trigger: h.live, start: 'top bottom', end: 'top 30%', scrub: true } })
    triggers.push(tween.scrollTrigger!)
  }

  const onAnchor = (event: MouseEvent) => {
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#"]')
    if (!link) return
    const target = document.querySelector(link.getAttribute('href')!)
    if (!target) return
    event.preventDefault()
    lenis.scrollTo(target as HTMLElement, { duration: 1.6 })
  }
  document.addEventListener('click', onAnchor)

  return () => {
    document.removeEventListener('click', onAnchor)
    timeline.scrollTrigger?.kill()
    timeline.kill()
    triggers.forEach((t) => t.kill())
    gsap.ticker.remove(tick)
    lenis.destroy()
  }
}
