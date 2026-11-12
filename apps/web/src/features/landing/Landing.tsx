import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import type { HoloScene } from './scene/HoloScene.ts'
import { INITIAL_STATE } from './scene/state.ts'
import { t } from '../../i18n/index.ts'
import { CHAPTERS, buildStory } from './story.ts'
import { LiveSection } from './LiveSection.tsx'
import { LangSelect } from '../../ui/Lang.tsx'
import './landing.css'

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function Landing() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const canvasWrapRef = useRef<HTMLDivElement>(null)
  const storyRef = useRef<HTMLElement>(null)
  const progressRef = useRef<HTMLDivElement>(null)
  const liveRef = useRef<HTMLElement>(null)
  const [chapter, setChapter] = useState(0)
  const [webgl, setWebgl] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [inLive, setInLive] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    const story = storyRef.current
    if (!canvas || !story) return
    // The scroll story drives a plain state object; three.js (the heavy part) loads in its own chunk.
    const state = { ...INITIAL_STATE }
    let scene: HoloScene | null = null
    let disposed = false
    const reduced = reducedMotion()
    const cleanupStory = reduced
      ? () => {}
      : buildStory(state, {
          story,
          chapters: [...story.querySelectorAll<HTMLElement>('[data-chapter]')],
          progress: progressRef.current,
          onChapter: setChapter,
          onLive: setInLive,
          live: liveRef.current,
          canvasWrap: canvasWrapRef.current,
        })
    import('./scene/HoloScene.ts')
      .then(({ HoloScene }) => {
        if (disposed) return
        scene = new HoloScene(canvas, state)
        if (reduced) scene.renderOnce()
        else scene.start()
        setLoaded(true)
      })
      .catch(() => {
        setWebgl(false)
        setLoaded(true)
      })
    const onResize = () => scene?.resize()
    const onVisibility = () => (document.hidden ? scene?.stop() : !reduced && scene?.start())
    window.addEventListener('resize', onResize)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      disposed = true
      window.removeEventListener('resize', onResize)
      document.removeEventListener('visibilitychange', onVisibility)
      cleanupStory()
      scene?.dispose()
    }
  }, [])

  return (
    <div className={`landing${loaded ? ' is-loaded' : ''}${webgl ? '' : ' no-webgl'}`}>
      <div className="landing__canvas" ref={canvasWrapRef} aria-hidden="true">
        <canvas ref={canvasRef} />
      </div>
      <div className="landing__fx" aria-hidden="true" />

      <header className="hud">
        <a className="hud__logo" href="#top" aria-label={t.landing.toStart}>
          <span className="hud__mark" />
          NOMAD
        </a>
        <nav className="hud__nav" aria-label={t.common.sections}>
          <Link to="/tournaments">{t.nav.tournaments}</Link>
          <Link to="/rating">{t.nav.rating}</Link>
          <Link to="/clubs">{t.nav.clubs}</Link>
          <Link to="/booking">{t.landing.navBooking}</Link>
        </nav>
        <Link className="btn btn--ghost hud__login" to="/login">
          {t.landing.login}
        </Link>
        <div className="hud__lang">
          <LangSelect />
        </div>
        <div className="hud__progress">
          <div ref={progressRef} />
        </div>
      </header>

      <aside className={`hud__chapter${inLive ? ' is-hidden' : ''}`} aria-hidden="true">
        <span className="hud__index">{String(chapter).padStart(2, '0')}</span>
        <span className="hud__total">/ {String(CHAPTERS.length - 1).padStart(2, '0')}</span>
        <span className="hud__name">{CHAPTERS[chapter]}</span>
      </aside>
      <div className="hud__corners" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </div>

      <main>
        <section className="story" ref={storyRef} id="top">
          <article className="chapter chapter--hero" data-chapter>
            <div className="chapter__content">
              <p className="eyebrow" data-reveal>
                {t.landing.kicker}
              </p>
              <h1 className="hero__title" data-reveal aria-label="Nomad">
                {'NOMAD'.split('').map((letter, i) => (
                  <span key={i} style={{ ['--i' as string]: i }}>
                    {letter}
                  </span>
                ))}
              </h1>
              <p className="hero__lead" data-reveal>
                {t.landing.lead}
              </p>
              <div className="hero__actions" data-reveal>
                <Link className="btn btn--primary" to="/tournaments">
                  {t.landing.findTournament}
                </Link>
                <Link className="btn btn--ghost" to="/clubs">
                  {t.landing.bookTable}
                </Link>
              </div>
            </div>
            <a className="scroll-cue" href="#serve" aria-label={t.landing.scrollDown}>
              <span>{t.landing.scrollCue}</span>
              <i />
            </a>
          </article>

          <article className="chapter chapter--right" id="serve" data-chapter>
            <div className="chapter__content">
              <p className="eyebrow" data-reveal>
                {t.landing.s1Eyebrow}
              </p>
              <h2 data-reveal>
                {t.landing.s1TitleA}<em>{t.landing.s1TitleB}</em>
              </h2>
              <p data-reveal>{t.landing.s1Text}</p>
              <ul className="chips" data-reveal>
                {t.landing.s1Chips.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          </article>

          <article className="chapter" data-chapter>
            <div className="chapter__content">
              <p className="eyebrow" data-reveal>
                {t.landing.s2Eyebrow}
              </p>
              <h2 data-reveal>
                {t.landing.s2TitleA}<em>{t.landing.s2TitleB}</em>
              </h2>
              <ol className="steps" data-reveal>
                {t.landing.s2Steps.map(([b, d]) => (
                  <li key={b}>
                    <b>{b}</b>
                    <span>{d}</span>
                  </li>
                ))}
              </ol>
            </div>
          </article>

          <article className="chapter chapter--top" id="rating" data-chapter>
            <div className="chapter__content">
              <p className="eyebrow" data-reveal>
                {t.landing.s3Eyebrow}
              </p>
              <h2 data-reveal>
                {t.landing.s3TitleA}<em>{t.landing.s3TitleB}</em>{t.landing.s3TitleC}
              </h2>
              <p className="formula" data-reveal>
                E<sub>A</sub> = 1 / (1 + 10<sup>(R<sub>B</sub> − R<sub>A</sub>) / 400</sup>)
              </p>
              <div className="deltas" data-reveal>
                <div>
                  <b className="up">+6</b>
                  <span>{t.landing.s3Weaker}</span>
                </div>
                <div>
                  <b className="up up--big">+18</b>
                  <span>{t.landing.s3Stronger}</span>
                </div>
                <div>
                  <b>3</b>
                  <span>{t.landing.s3Calibration}</span>
                </div>
              </div>
            </div>
          </article>

          <article className="chapter chapter--right" data-chapter>
            <div className="chapter__content">
              <p className="eyebrow" data-reveal>
                {t.landing.s4Eyebrow}
              </p>
              <h2 data-reveal>
                {t.landing.s4TitleA}<em>{t.landing.s4TitleB}</em>{t.landing.s4TitleC}
              </h2>
              <p data-reveal>{t.landing.s4Text}</p>
              <div className="notice" data-reveal role="img" aria-label={t.landing.s4Aria}>
                <div className="notice__head">
                  <span className="dot" /> {t.landing.s4Head}
                </div>
                <div className="notice__table">
                  {t.landing.s4Table} <b>5</b>
                </div>
                <dl>
                  <dt>{t.landing.s4Opponent}</dt>
                  <dd>{t.landing.s4OpponentValue}</dd>
                  <dt>{t.landing.s4Stage}</dt>
                  <dd>{t.landing.s4StageValue}</dd>
                </dl>
                <div className="notice__actions">
                  <span className="btn btn--primary btn--sm">{t.landing.s4Coming}</span>
                  <span className="btn btn--ghost btn--sm">{t.landing.s4Cant}</span>
                </div>
              </div>
            </div>
          </article>

          <article className="chapter" id="booking" data-chapter>
            <div className="chapter__content">
              <p className="eyebrow" data-reveal>
                {t.landing.s5Eyebrow}
              </p>
              <h2 data-reveal>
                {t.landing.s5TitleA}<em>{t.landing.s5TitleB}</em>
              </h2>
              <p data-reveal>{t.landing.s5Text}</p>
              <div className="slots" data-reveal aria-label={t.landing.s5Aria}>
                {[
                  ['18:00', 'busy'],
                  ['19:00', 'free'],
                  ['20:00', 'picked'],
                  ['21:00', 'free'],
                  ['22:00', 'busy'],
                ].map(([time, kind]) => (
                  <span key={time} className={`slot slot--${kind}`}>
                    {time}
                  </span>
                ))}
              </div>
            </div>
          </article>

          <article className="chapter chapter--center" id="final" data-chapter>
            <div className="chapter__content">
              <p className="eyebrow" data-reveal>
                {t.landing.s6Eyebrow}
              </p>
              <h2 className="final__title" data-reveal>
                {t.landing.s6TitleA}<em>{t.landing.s6TitleB}</em>
              </h2>
              <div className="hero__actions hero__actions--center" data-reveal>
                <Link className="btn btn--primary" to="/tournaments">
                  {t.landing.s6Tournaments}
                </Link>
                <Link className="btn btn--ghost" to="/clubs">
                  {t.landing.s6Clubs}
                </Link>
              </div>
            </div>
          </article>
        </section>

        <LiveSection ref={liveRef} />
      </main>
    </div>
  )
}
