import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import type { HoloScene } from './scene/HoloScene.ts'
import { INITIAL_STATE } from './scene/state.ts'
import { CHAPTERS, buildStory } from './story.ts'
import { LiveSection } from './LiveSection.tsx'
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
        <a className="hud__logo" href="#top" aria-label="Nomad — в начало">
          <span className="hud__mark" />
          NOMAD
        </a>
        <nav className="hud__nav" aria-label="Разделы">
          <Link to="/tournaments">Турниры</Link>
          <Link to="/rating">Рейтинг</Link>
          <Link to="/clubs">Клубы</Link>
          <Link to="/clubs">Бронь</Link>
        </nav>
        <Link className="btn btn--ghost hud__login" to="/login">
          Войти
        </Link>
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
                // Рейтинговый настольный теннис · Казахстан
              </p>
              <h1 className="hero__title" data-reveal aria-label="Nomad">
                {'NOMAD'.split('').map((letter, i) => (
                  <span key={i} style={{ ['--i' as string]: i }}>
                    {letter}
                  </span>
                ))}
              </h1>
              <p className="hero__lead" data-reveal>
                Любительские турниры, в которых считается каждая партия: запись за&nbsp;2&nbsp;минуты, рейтинг Эло после каждого турнира и вызов на стол — прямо в&nbsp;телефон.
              </p>
              <div className="hero__actions" data-reveal>
                <Link className="btn btn--primary" to="/tournaments">
                  Найти турнир
                </Link>
                <Link className="btn btn--ghost" to="/clubs">
                  Забронировать стол
                </Link>
              </div>
            </div>
            <a className="scroll-cue" href="#serve" aria-label="Листайте вниз">
              <span>Листайте — подача</span>
              <i />
            </a>
          </article>

          <article className="chapter chapter--right" id="serve" data-chapter>
            <div className="chapter__content">
              <p className="eyebrow" data-reveal>
                01 · Подача
              </p>
              <h2 data-reveal>
                Турнир рядом — <em>каждую неделю</em>
              </h2>
              <p data-reveal>Календарь клубов твоего города с фильтрами по рейтингу, дате и свободным местам. Видно, кто уже записался и какой средний рейтинг состава.</p>
              <ul className="chips" data-reveal>
                <li>Алматы</li>
                <li>до 1300</li>
                <li>есть места</li>
                <li>суббота</li>
              </ul>
            </div>
          </article>

          <article className="chapter" data-chapter>
            <div className="chapter__content">
              <p className="eyebrow" data-reveal>
                02 · Запись
              </p>
              <h2 data-reveal>
                От ссылки в чате до места в сетке — <em>2 минуты</em>
              </h2>
              <ol className="steps" data-reveal>
                <li>
                  <b>Открой ссылку</b>
                  <span>из Telegram-канала клуба или календаря</span>
                </li>
                <li>
                  <b>Войди</b>
                  <span>через Google или e-mail — и вернёшься к записи</span>
                </li>
                <li>
                  <b>Запишись</b>
                  <span>место держится 15 минут на оплату, нет мест — лист ожидания</span>
                </li>
              </ol>
            </div>
          </article>

          <article className="chapter chapter--top" id="rating" data-chapter>
            <div className="chapter__content">
              <p className="eyebrow" data-reveal>
                03 · Рейтинг
              </p>
              <h2 data-reveal>
                Эло после <em>каждого</em> турнира
              </h2>
              <p className="formula" data-reveal>
                E<sub>A</sub> = 1 / (1 + 10<sup>(R<sub>B</sub> − R<sub>A</sub>) / 400</sup>)
              </p>
              <div className="deltas" data-reveal>
                <div>
                  <b className="up">+6</b>
                  <span>обыграл слабее</span>
                </div>
                <div>
                  <b className="up up--big">+18</b>
                  <span>обыграл сильнее</span>
                </div>
                <div>
                  <b>3</b>
                  <span>турнира калибровки для новичка</span>
                </div>
              </div>
            </div>
          </article>

          <article className="chapter chapter--right" data-chapter>
            <div className="chapter__content">
              <p className="eyebrow" data-reveal>
                04 · Вызов
              </p>
              <h2 data-reveal>
                «Ваш матч на <em>5-м столе</em>»
              </h2>
              <p data-reveal>Уведомление на сайте, в Telegram и на заблокированном экране — не позже 10 секунд после нажатия «Вызвать». Очередь и live-счёт — на ТВ в зале.</p>
              <div className="notice" data-reveal role="img" aria-label="Пример уведомления о вызове на стол">
                <div className="notice__head">
                  <span className="dot" /> Вызов на стол · сейчас
                </div>
                <div className="notice__table">
                  Стол <b>5</b>
                </div>
                <dl>
                  <dt>Соперник</dt>
                  <dd>Арман С. · 1240</dd>
                  <dt>Этап</dt>
                  <dd>Основная сетка, 1/4 финала</dd>
                </dl>
                <div className="notice__actions">
                  <span className="btn btn--primary btn--sm">Иду</span>
                  <span className="btn btn--ghost btn--sm">Не могу</span>
                </div>
              </div>
            </div>
          </article>

          <article className="chapter" id="booking" data-chapter>
            <div className="chapter__content">
              <p className="eyebrow" data-reveal>
                05 · Бронь
              </p>
              <h2 data-reveal>
                Стол на вечер — <em>в пару касаний</em>
              </h2>
              <p data-reveal>План зала сверху, свободное время каждого стола и цена до оплаты. Двойная бронь невозможна — проверяет сама база данных.</p>
              <div className="slots" data-reveal aria-label="Пример расписания стола">
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
                06 · Игра
              </p>
              <h2 className="final__title" data-reveal>
                Следующая партия <em>начинается здесь</em>
              </h2>
              <div className="hero__actions hero__actions--center" data-reveal>
                <Link className="btn btn--primary" to="/tournaments">
                  Смотреть турниры
                </Link>
                <Link className="btn btn--ghost" to="/clubs">
                  Клубы и бронь
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
