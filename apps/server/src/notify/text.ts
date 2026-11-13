// Message texts for push / Telegram / e-mail in ru, kk, en.

import { config } from '../config.ts'

export type Lang = 'ru' | 'kk' | 'en'
export const LANGS: readonly Lang[] = ['ru', 'kk', 'en']
export const DEFAULT_LANG: Lang = 'kk'
export const toLang = (v: unknown, fallback: Lang = DEFAULT_LANG): Lang => (LANGS.includes(v as Lang) ? (v as Lang) : fallback)

export type Rendered = { title: string; body: string; url: string; open: string; bodyHtml?: string }

const s = (v: unknown) => (v == null ? '' : String(v))
const lines = (...xs: unknown[]) => xs.map(s).filter(Boolean).join('\n')

/** Admin-edited templates (platform setting `notify_templates`, Russian): `{field}` is replaced by the event data. */
let overrides: Record<string, { title?: string; body?: string }> = {}
export const setTemplateOverrides = (value: typeof overrides) => void (overrides = value ?? {})
const fill = (tpl: string, data: Record<string, unknown>) => tpl.replace(/\{(\w+)\}/g, (_, k: string) => s(data[k]))

type D = Record<string, unknown>
type Msg = { title: string; body: string }
type Phrases = {
  open: string
  call: (d: D) => Msg
  matchNo: (n: unknown) => string
  waitlist: (d: D) => Msg
  cancelled: string
  reminder: (d: D) => Msg
  results: (d: D) => Msg
  calibration: (d: D) => Msg
  newTournament: string
  dispute: string
  bookingConfirmed: (d: D) => Msg
  bookingReminder: (d: D) => string
  bookingMoved: string
  bookingCancelled: string
  tableAt: (d: D) => string
  teamInvitation: (d: D) => Msg
  teamRequest: (d: D) => Msg
  teamAnswer: (d: D) => Msg
  teamCaptain: (d: D) => Msg
  teamShort: (d: D) => Msg
  leagueMove: string
  leagueMoveBody: (d: D) => string
  leagueConfirm: (d: D) => Msg
  leagueFixture: string
  leagueFixtureBody: (d: D) => string
  leagueReminder: (d: D) => Msg
  leagueLineup: (d: D) => Msg
  leagueTourResults: (d: D) => Msg
  leagueNoShows: (d: D) => Msg
  lineupOverdue: (d: D) => Msg
  scoreConfirm: (d: D) => Msg
  round: (r: string) => string
  group: (code: unknown, tour: unknown) => string
  stage: string
  answer: (a: unknown) => string
  next: Msg
  tableChanged: (d: D) => string
  callCancelled: Msg
  registered: (d: D) => Msg
  tgLinked: (d: D) => Msg
  tgMoved: (d: D) => Msg
  venue: string
  changed: string
  playerBusy: (d: D) => Msg
  underfilled: (d: D) => Msg
}

const time = (v: unknown) => new Date(s(v)).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Almaty' })
const tg = (v: unknown) => Math.round(Number(v ?? 0) / 100)
const delta = (v: unknown) => (v == null ? '' : `${Number(v) > 0 ? '+' : ''}${s(v)}`)
const sets = (d: D) => (d.setsHome != null && d.setsAway != null ? `${s(d.setsHome)}:${s(d.setsAway)}` : '')
const formula = (d: D, best: string, worst: string) =>
  d.bestWin != null && d.worstLoss != null
    ? `(${best} ${s(d.bestWin)} + ${worst} ${s(d.worstLoss)}) / 2 = ${s(d.rating)}`
    : d.bestWin != null
      ? `${best} ${s(d.bestWin)} + 100 = ${s(d.rating)}`
      : `${worst} ${s(d.worstLoss)} − 100 = ${s(d.rating)}`
const when = (v: unknown) => new Date(s(v)).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Almaty' })
const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1)
const rated = (d: D, word: string) => (d.opponentRating != null ? ` (${word} ${s(d.opponentRating)})` : '')
const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const ordinal = (r: string, final: string, third: string, places: string, part: (n: string) => string) =>
  r === 'final' ? final : r === 'third_place' ? third : r === 'places' ? places : r.startsWith('1/') ? part(r) : r

const P: Record<Lang, Phrases> = {
  ru: {
    open: 'Открыть на сайте',
    call: (d) => ({
      title: `Вызов на матч${d.table ? ` · стол ${s(d.table)}` : ''}`,
      body: lines(d.table && `Стол: ${s(d.table)}`, d.opponent && `Соперник: ${s(d.opponent)}${rated(d, 'рейтинг')}`, d.respondBy ? `Подойдите до ${time(d.respondBy)}` : d.minutes && `Подойдите к столу в течение ${s(d.minutes)} мин.`),
    }),
    matchNo: (n) => `Матч №${s(n)}`,
    waitlist: (d) => ({ title: 'Освободилось место', body: `Подтвердите участие в течение ${s(d.minutes || 30)} мин.` }),
    cancelled: 'Турнир отменён',
    reminder: (d) => ({ title: `Турнир через ${s(d.hours)} ч`, body: `Начало: ${s(d.startsAtText)}` }),
    results: (d) => ({ title: 'Итоги турнира', body: `Место: ${s(d.place) || '—'}${d.delta != null ? ` · рейтинг ${delta(d.delta)}` : ''}` }),
    calibration: (d) => ({ title: `Калибровка завершена: рейтинг ${s(d.rating)}`, body: cap(formula(d, 'лучшая победа', 'худшее поражение')) }),
    newTournament: 'Новый турнир для вас',
    dispute: 'Ответ по спорному счёту',
    bookingConfirmed: (d) => ({ title: `Бронь подтверждена · стол ${s(d.table)}`, body: `Оплата в клубе: ${tg(d.price)} ₸\nОтменить: ${s(d.cancelUrl)}` }),
    bookingReminder: (d) => `Через час: стол ${s(d.table)}`,
    bookingMoved: 'Бронь перенесена',
    bookingCancelled: 'Бронь отменена клубом',
    tableAt: (d) => `${s(d.club)}: стол ${s(d.table)}, ${s(d.startsAtText)}`,
    teamInvitation: (d) => ({ title: 'Приглашение в команду', body: `Вас приглашают в «${s(d.title)}»` }),
    teamRequest: (d) => ({ title: 'Заявка в команду', body: `Заявка на вступление в «${s(d.title)}»` }),
    teamAnswer: (d) => ({
      title: 'Ответ на приглашение',
      body: `«${s(d.title)}»: ${d.status === 'accepted' ? 'принято' : d.status === 'declined' ? 'отклонено' : 'истекло'}`,
    }),
    teamCaptain: (d) => ({ title: 'Вы капитан', body: `Вам передано капитанство в «${s(d.title)}»` }),
    teamShort: (d) => ({ title: 'Состав меньше минимума', body: `В «${s(d.title)}» осталось ${s(d.count)} из ${s(d.min)} игроков — пригласите замену` }),
    leagueMove: 'Переход в другой дивизион',
    leagueMoveBody: (d) => `${s(d.title)}: ${d.reason === 'promotion' ? 'повышение' : 'понижение'} — ${s(d.division)}`,
    leagueConfirm: (d) => ({ title: 'Подтвердите участие в лиге', body: `${s(d.title)}: подтвердите участие в новом сезоне` }),
    leagueFixture: 'Матч лиги',
    leagueFixtureBody: (d) =>
      d.event === 'proposed' ? `Соперник предлагает время матча: ${when(d.startsAt)}` : d.event === 'confirmed' ? `Матч подтверждён, стол ${s(d.table)} забронирован` : 'Соперник внёс счёт матча — подтвердите',
    leagueReminder: (d) => ({ title: 'Напоминание лиги', body: d.fixtureId ? 'Завтра дедлайн матча лиги — договоритесь о времени' : `${s(d.title)}: скоро тур` }),
    leagueLineup: (d) => ({ title: 'Составы дивизионов опубликованы', body: `${s(d.title)}: ваш дивизион — ${s(d.division)}${d.startsAt ? `, следующий тур ${when(d.startsAt)}` : ''}` }),
    leagueTourResults: (d) => ({ title: `Итоги тура ${s(d.tour)}`, body: d.place ? `${s(d.title)}: место ${s(d.place)}, очков +${s(d.points)}` : `${s(d.title)}: тур пропущен, 0 очков` }),
    leagueNoShows: (d) => ({ title: 'Неявки в лиге', body: `${s(d.title)}: ${s(d.player)} — неявок ${s(d.count)}, можно снять с сезона` }),
    lineupOverdue: (d) => ({ title: 'Расстановка не подана', body: `${s(d.title)}: расстановка не подана вовремя, решает организатор` }),
    round: (r) => ordinal(r, 'финал', 'матч за 3-е место', 'матч за места', (x) => `${x} финала`),
    group: (c, tour) => `группа ${s(c)}${tour ? `, ${s(tour)}-й тур` : ''}`,
    stage: 'Этап',
    answer: (a) => `Ваш ответ: ${a === 'going' ? 'Иду' : a === 'cannot' ? 'Не могу' : 'доставлено'}`,
    next: { title: 'Вы следующий', body: 'Ваш матч следующий в очереди, разомнитесь.' },
    tableChanged: (d) => `Стол изменён: теперь ${s(d.table)}`,
    callCancelled: { title: 'Вызов отменён', body: 'Организатор отменил вызов. Ждите нового вызова.' },
    registered: (d) => ({ title: 'Вы записаны на турнир', body: lines(d.startsAt && `Начало: ${when(d.startsAt)}`, d.address && `Адрес: ${s(d.address)}`) }),
    tgLinked: (d) => ({ title: 'Подключён новый Telegram', body: `К вашему профилю привязан аккаунт${d.username ? ` @${s(d.username)}` : ''}. Если это не вы — отключите его в настройках уведомлений.` }),
    tgMoved: (d) => ({ title: 'Telegram отвязан от профиля', body: `Аккаунт${d.username ? ` @${s(d.username)}` : ''} теперь привязан к профилю ${s(d.to)}.` }),
    scoreConfirm: (d) => ({ title: 'Подтвердите счёт', body: `Соперник внёс счёт матча${sets(d) ? ` ${sets(d)}` : ''} — подтвердите или оспорьте` }),
    venue: 'Изменилось место турнира',
    changed: 'Изменения в турнире',
    playerBusy: (d) => ({ title: 'Игрок ещё в другом турнире', body: `${s(d.player)} не может отметиться: идёт «${s(d.other)}». Подождите или снимите с полным возвратом` }),
    underfilled: (d) => ({ title: 'Мало участников', body: `Записалось ${s(d.taken)} при минимуме ${s(d.min)}. Подтвердите проведение, иначе за 2 часа до старта турнир отменится` }),
  },
  kk: {
    open: 'Сайтта ашу',
    call: (d) => ({
      title: `Матчқа шақыру${d.table ? ` · ${s(d.table)}-үстел` : ''}`,
      body: lines(d.table && `Үстел: ${s(d.table)}`, d.opponent && `Қарсылас: ${s(d.opponent)}${rated(d, 'рейтинг')}`, d.respondBy ? `${time(d.respondBy)} дейін келіңіз` : d.minutes && `Үстелге ${s(d.minutes)} мин ішінде келіңіз.`),
    }),
    matchNo: (n) => `№${s(n)} матч`,
    waitlist: (d) => ({ title: 'Орын босады', body: `Қатысуыңызды ${s(d.minutes || 30)} мин ішінде растаңыз.` }),
    cancelled: 'Турнир тоқтатылды',
    reminder: (d) => ({ title: `Турнирге ${s(d.hours)} сағ қалды`, body: `Басталуы: ${s(d.startsAtText)}` }),
    results: (d) => ({ title: 'Турнир қорытындысы', body: `Орын: ${s(d.place) || '—'}${d.delta != null ? ` · рейтинг ${delta(d.delta)}` : ''}` }),
    calibration: (d) => ({ title: `Калибрлеу аяқталды: рейтинг ${s(d.rating)}`, body: cap(formula(d, 'ең жақсы жеңіс', 'ең нашар жеңіліс')) }),
    newTournament: 'Сізге жаңа турнир',
    dispute: 'Дауланған есеп бойынша жауап',
    bookingConfirmed: (d) => ({ title: `Брондау расталды · ${s(d.table)}-үстел`, body: `Клубта төлеу: ${tg(d.price)} ₸\nБас тарту: ${s(d.cancelUrl)}` }),
    bookingReminder: (d) => `Бір сағаттан кейін: ${s(d.table)}-үстел`,
    bookingMoved: 'Брондау ауыстырылды',
    bookingCancelled: 'Клуб брондауды болдырмады',
    tableAt: (d) => `${s(d.club)}: ${s(d.table)}-үстел, ${s(d.startsAtText)}`,
    teamInvitation: (d) => ({ title: 'Командаға шақыру', body: `Сізді «${s(d.title)}» құрамына шақырады` }),
    teamRequest: (d) => ({ title: 'Командаға өтінім', body: `«${s(d.title)}» құрамына кіруге өтінім` }),
    teamAnswer: (d) => ({
      title: 'Шақыруға жауап',
      body: `«${s(d.title)}»: ${d.status === 'accepted' ? 'қабылданды' : d.status === 'declined' ? 'қабылданбады' : 'мерзімі өтті'}`,
    }),
    teamCaptain: (d) => ({ title: 'Сіз капитансыз', body: `«${s(d.title)}» капитандығы сізге берілді` }),
    teamShort: (d) => ({ title: 'Құрам минимумнан аз', body: `«${s(d.title)}» құрамында ${s(d.count)}/${s(d.min)} ойыншы қалды — ауыстырушы шақырыңыз` }),
    leagueMove: 'Басқа дивизионға ауысу',
    leagueMoveBody: (d) => `${s(d.title)}: ${d.reason === 'promotion' ? 'жоғарылау' : 'төмендеу'} — ${s(d.division)}`,
    leagueConfirm: (d) => ({ title: 'Лигаға қатысуды растаңыз', body: `${s(d.title)}: жаңа маусымға қатысуыңызды растаңыз` }),
    leagueFixture: 'Лига матчы',
    leagueFixtureBody: (d) =>
      d.event === 'proposed' ? `Қарсылас матч уақытын ұсынады: ${when(d.startsAt)}` : d.event === 'confirmed' ? `Матч расталды, ${s(d.table)}-үстел брондалды` : 'Қарсылас матч есебін енгізді — растаңыз',
    leagueReminder: (d) => ({ title: 'Лига туралы еске салу', body: d.fixtureId ? 'Ертең лига матчының соңғы мерзімі — уақытты келісіңіз' : `${s(d.title)}: тур жақында` }),
    leagueLineup: (d) => ({ title: 'Дивизион құрамдары жарияланды', body: `${s(d.title)}: сіздің дивизион — ${s(d.division)}${d.startsAt ? `, келесі тур ${when(d.startsAt)}` : ''}` }),
    leagueTourResults: (d) => ({ title: `${s(d.tour)}-тур қорытындысы`, body: d.place ? `${s(d.title)}: орын ${s(d.place)}, ұпай +${s(d.points)}` : `${s(d.title)}: тур өткізілді, 0 ұпай` }),
    leagueNoShows: (d) => ({ title: 'Лигаға келмеу', body: `${s(d.title)}: ${s(d.player)} — ${s(d.count)} рет келмеді, маусымнан шығаруға болады` }),
    lineupOverdue: (d) => ({ title: 'Құрам берілмеді', body: `${s(d.title)}: құрам уақытында берілмеді, шешімді ұйымдастырушы қабылдайды` }),
    round: (r) => ordinal(r, 'финал', '3-орын үшін матч', 'орындар үшін матч', (x) => `${x} финал`),
    group: (c, tour) => `${s(c)} тобы${tour ? `, ${s(tour)}-тур` : ''}`,
    stage: 'Кезең',
    answer: (a) => `Сіздің жауабыңыз: ${a === 'going' ? 'Барамын' : a === 'cannot' ? 'Бара алмаймын' : 'жеткізілді'}`,
    next: { title: 'Келесі сіз', body: 'Сіздің матчыңыз кезекте келесі, дайындалыңыз.' },
    tableChanged: (d) => `Үстел өзгерді: енді ${s(d.table)}`,
    callCancelled: { title: 'Шақыру тоқтатылды', body: 'Ұйымдастырушы шақыруды тоқтатты. Жаңа шақыруды күтіңіз.' },
    registered: (d) => ({ title: 'Сіз турнирге жазылдыңыз', body: lines(d.startsAt && `Басталуы: ${when(d.startsAt)}`, d.address && `Мекенжай: ${s(d.address)}`) }),
    tgLinked: (d) => ({ title: 'Жаңа Telegram қосылды', body: `Профиліңізге${d.username ? ` @${s(d.username)}` : ''} аккаунты байланды. Бұл сіз болмасаңыз — хабарлама баптауларында өшіріңіз.` }),
    tgMoved: (d) => ({ title: 'Telegram профильден ажыратылды', body: `${d.username ? `@${s(d.username)} ` : ''}аккаунты енді ${s(d.to)} профиліне байланған.` }),
    scoreConfirm: (d) => ({ title: 'Есепті растаңыз', body: `Қарсылас матч есебін енгізді${sets(d) ? ` ${sets(d)}` : ''} — растаңыз немесе дауласыңыз` }),
    venue: 'Турнир өтетін орын өзгерді',
    changed: 'Турнирдегі өзгерістер',
    playerBusy: (d) => ({ title: 'Ойыншы әлі басқа турнирде', body: `${s(d.player)} белгілене алмайды: «${s(d.other)}» жүріп жатыр. Күтіңіз немесе толық қайтарыммен шығарыңыз` }),
    underfilled: (d) => ({ title: 'Қатысушылар аз', body: `${s(d.taken)} жазылды, ең азы ${s(d.min)}. Өткізуді растаңыз, әйтпесе басталуға 2 сағат қалғанда турнир тоқтатылады` }),
  },
  en: {
    open: 'Open on the site',
    call: (d) => ({
      title: `Match call${d.table ? ` · table ${s(d.table)}` : ''}`,
      body: lines(d.table && `Table: ${s(d.table)}`, d.opponent && `Opponent: ${s(d.opponent)}${rated(d, 'rating')}`, d.respondBy ? `Please come by ${time(d.respondBy)}` : d.minutes && `Please come to the table within ${s(d.minutes)} min.`),
    }),
    matchNo: (n) => `Match #${s(n)}`,
    waitlist: (d) => ({ title: 'A spot opened up', body: `Confirm your entry within ${s(d.minutes || 30)} min.` }),
    cancelled: 'Tournament cancelled',
    reminder: (d) => ({ title: `Tournament in ${s(d.hours)} h`, body: `Starts: ${s(d.startsAtText)}` }),
    results: (d) => ({ title: 'Tournament results', body: `Place: ${s(d.place) || '—'}${d.delta != null ? ` · rating ${delta(d.delta)}` : ''}` }),
    calibration: (d) => ({ title: `Calibration complete: rating ${s(d.rating)}`, body: cap(formula(d, 'best win', 'worst loss')) }),
    newTournament: 'A new tournament for you',
    dispute: 'Reply on a disputed score',
    bookingConfirmed: (d) => ({ title: `Booking confirmed · table ${s(d.table)}`, body: `Pay at the club: ${tg(d.price)} ₸\nCancel: ${s(d.cancelUrl)}` }),
    bookingReminder: (d) => `In an hour: table ${s(d.table)}`,
    bookingMoved: 'Booking moved',
    bookingCancelled: 'Booking cancelled by the club',
    tableAt: (d) => `${s(d.club)}: table ${s(d.table)}, ${s(d.startsAtText)}`,
    teamInvitation: (d) => ({ title: 'Team invitation', body: `You are invited to join “${s(d.title)}”` }),
    teamRequest: (d) => ({ title: 'Request to join', body: `Request to join “${s(d.title)}”` }),
    teamAnswer: (d) => ({
      title: 'Invitation answer',
      body: `“${s(d.title)}”: ${d.status === 'accepted' ? 'accepted' : d.status === 'declined' ? 'declined' : 'expired'}`,
    }),
    teamCaptain: (d) => ({ title: 'You are the captain', body: `You are now the captain of “${s(d.title)}”` }),
    teamShort: (d) => ({ title: 'Roster below minimum', body: `“${s(d.title)}” has ${s(d.count)} of ${s(d.min)} players — invite a replacement` }),
    leagueMove: 'Division change',
    leagueMoveBody: (d) => `${s(d.title)}: ${d.reason === 'promotion' ? 'promoted' : 'relegated'} to ${s(d.division)}`,
    leagueConfirm: (d) => ({ title: 'Confirm your league entry', body: `${s(d.title)}: confirm your entry for the new season` }),
    leagueFixture: 'League match',
    leagueFixtureBody: (d) =>
      d.event === 'proposed' ? `Your opponent proposes a match time: ${when(d.startsAt)}` : d.event === 'confirmed' ? `Match confirmed, table ${s(d.table)} is booked` : 'Your opponent entered the match score — please confirm',
    leagueReminder: (d) => ({ title: 'League reminder', body: d.fixtureId ? 'The league match deadline is tomorrow — agree on a time' : `${s(d.title)}: a round is coming up` }),
    leagueLineup: (d) => ({ title: 'Division line-ups published', body: `${s(d.title)}: your division is ${s(d.division)}${d.startsAt ? `, next round ${when(d.startsAt)}` : ''}` }),
    leagueTourResults: (d) => ({ title: `Round ${s(d.tour)} results`, body: d.place ? `${s(d.title)}: place ${s(d.place)}, +${s(d.points)} points` : `${s(d.title)}: round skipped, 0 points` }),
    leagueNoShows: (d) => ({ title: 'League no-shows', body: `${s(d.title)}: ${s(d.player)} has ${s(d.count)} no-shows and can be removed from the season` }),
    lineupOverdue: (d) => ({ title: 'Lineup not submitted', body: `${s(d.title)}: the lineup was not submitted in time, the organizer decides` }),
    round: (r) => ordinal(r, 'final', 'third-place match', 'placement match', (x) => `${x} final`),
    group: (c, tour) => `group ${s(c)}${tour ? `, round ${s(tour)}` : ''}`,
    stage: 'Stage',
    answer: (a) => `Your answer: ${a === 'going' ? 'Coming' : a === 'cannot' ? 'Cannot come' : 'delivered'}`,
    next: { title: 'You are next', body: 'Your match is next in the queue, warm up.' },
    tableChanged: (d) => `Table changed: now ${s(d.table)}`,
    callCancelled: { title: 'Call cancelled', body: 'The organizer cancelled the call. Wait for a new call.' },
    registered: (d) => ({ title: 'You are registered', body: lines(d.startsAt && `Starts: ${when(d.startsAt)}`, d.address && `Address: ${s(d.address)}`) }),
    tgLinked: (d) => ({ title: 'New Telegram linked', body: `The account${d.username ? ` @${s(d.username)}` : ''} was linked to your profile. If it was not you, remove it in notification settings.` }),
    tgMoved: (d) => ({ title: 'Telegram unlinked from your profile', body: `The account${d.username ? ` @${s(d.username)}` : ''} is now linked to the profile ${s(d.to)}.` }),
    scoreConfirm: (d) => ({ title: 'Confirm the score', body: `Your opponent entered the match score${sets(d)? ` ${sets(d)}` : ''} — confirm or dispute it` }),
    venue: 'Tournament venue changed',
    changed: 'Tournament update',
    playerBusy: (d) => ({ title: 'Player still in another tournament', body: `${s(d.player)} cannot check in: «${s(d.other)}» is still running. Wait or remove them with a full refund` }),
    underfilled: (d) => ({ title: 'Too few participants', body: `${s(d.taken)} registered, minimum ${s(d.min)}. Confirm the tournament, or it is cancelled 2 hours before the start` }),
  },
}

export const phrases = (lang: Lang) => P[lang]

export function render(type: string, data: D, lang: Lang = DEFAULT_LANG): Rendered {
  const base = renderDefault(type, data, lang)
  const o = lang === 'ru' ? overrides[type] : undefined
  return o ? { ...base, title: o.title ? fill(o.title, data) : base.title, body: o.body ? fill(o.body, data) : base.body } : base
}

function renderDefault(type: string, d: D, lang: Lang): Rendered {
  const p = P[lang]
  const site = config.SITE_URL.replace(/\/$/, '')
  const me = `${site}/me`
  const tUrl = d.slug ? `${site}/t/${s(d.slug)}` : me
  const lUrl = d.leagueSlug ? `${site}/leagues/${s(d.leagueSlug)}` : me
  const title = s(d.tournamentTitle || d.title)
  const bUrl = s(d.cancelUrl) || me
  const myT = d.slug ? `${site}/me/t/${s(d.slug)}` : tUrl
  const out = (m: Msg, url: string): Rendered => ({ ...m, url, open: p.open })
  // Server-composed `text` is Russian: shown as extra detail in ru only.
  const ruText = lang === 'ru' ? s(d.text) : ''
  switch (type) {
    case 'match_call': {
      const m = p.call(d)
      const part = d.group ? p.group(d.group, d.tour) : d.round ? p.round(s(d.round)) : ''
      const stage = cap([s(d.stage), part].filter(Boolean).join(', '))
      const body = lines(m.body, stage && `${p.stage}: ${stage}`, title, d.matchNumber && p.matchNo(d.matchNumber), d.answer && p.answer(d.answer))
      const opp = s(d.opponent)
      const bodyHtml = d.opponentId && opp ? esc(body).replace(esc(opp), `<a href="${site}/players/${s(d.opponentId)}">${esc(opp)}</a>`) : undefined
      return { ...out({ title: m.title, body }, myT), bodyHtml }
    }
    case 'match_next':
      return out({ title: p.next.title, body: lines(p.next.body, title, d.matchNumber && p.matchNo(d.matchNumber)) }, myT)
    case 'match_table_changed':
      return out({ title: p.tableChanged(d), body: lines(title, d.matchNumber && p.matchNo(d.matchNumber)) }, myT)
    case 'match_call_cancelled':
      return out({ title: p.callCancelled.title, body: lines(p.callCancelled.body, title, d.matchNumber && p.matchNo(d.matchNumber)) }, myT)
    case 'registration_confirmed': {
      const m = p.registered(d)
      return out({ title: m.title, body: lines(title, m.body) }, tUrl)
    }
    case 'telegram_linked':
      return out(p.tgLinked(d), `${site}/notifications`)
    case 'telegram_moved':
      return out(p.tgMoved(d), `${site}/notifications`)
    case 'waitlist_invited': {
      const m = p.waitlist(d)
      return out({ title: m.title, body: lines(title, m.body) }, tUrl)
    }
    case 'tournament_changed':
      return out({ title: p.changed, body: lines(title, ruText, d.reason) }, tUrl)
    case 'tournament_cancelled':
      return out({ title: p.cancelled, body: lines(title, d.reason) }, tUrl)
    case 'tournament_reminder': {
      const m = p.reminder(d)
      return out({ title: m.title, body: lines(title, m.body) }, tUrl)
    }
    case 'tournament_results': {
      const m = p.results(d)
      return out({ title: m.title, body: lines(title, m.body) }, tUrl)
    }
    case 'calibration_done':
      return out(p.calibration(d), d.playerId ? `${site}/players/${s(d.playerId)}` : me)
    case 'new_tournament':
      return out({ title: p.newTournament, body: lines(title, `${s(d.club)} · ${s(d.startsAtText)}`) }, tUrl)
    case 'dispute_update':
      return out({ title: p.dispute, body: s(d.resolution) || s(d.status) }, me)
    case 'booking_confirmed': {
      const m = p.bookingConfirmed(d)
      return out({ title: m.title, body: lines(`${s(d.club)}, ${s(d.startsAtText)}`, m.body) }, bUrl)
    }
    case 'booking_reminder':
      return out({ title: p.bookingReminder(d), body: lines(`${s(d.club)}, ${s(d.address)}`, d.startsAtText) }, bUrl)
    case 'booking_moved':
      return out({ title: p.bookingMoved, body: p.tableAt(d) }, bUrl)
    case 'booking_cancelled':
      return out({ title: p.bookingCancelled, body: lines(p.tableAt(d), d.reason) }, me)
    case 'team_invitation':
      return out(p.teamInvitation(d), me)
    case 'team_request':
      return out(p.teamRequest(d), me)
    case 'team_invitation_answer':
      return out(p.teamAnswer(d), me)
    case 'team_captain':
      return out(p.teamCaptain(d), me)
    case 'team_roster_short':
      return out(p.teamShort(d), me)
    case 'league_move':
      return out({ title: p.leagueMove, body: d.reason ? p.leagueMoveBody(d) : ruText || title }, lUrl)
    case 'league_confirm':
      return out(p.leagueConfirm(d), lUrl)
    case 'league_fixture':
      return out({ title: p.leagueFixture, body: d.event ? p.leagueFixtureBody(d) : ruText || title }, lUrl)
    case 'league_reminder':
      return out(p.leagueReminder(d), lUrl)
    case 'league_lineup':
      return out(p.leagueLineup(d), lUrl)
    case 'league_tour_results':
      return out(p.leagueTourResults(d), lUrl)
    case 'league_no_shows':
      return out(p.leagueNoShows(d), lUrl)
    case 'lineup_overdue':
      return out(p.lineupOverdue(d), tUrl)
    case 'tournament_venue_changed':
      return out({ title: p.venue, body: lines(title, [d.hall, d.address].filter(Boolean).join(', ')) }, tUrl)
    case 'score_confirm':
      return out(p.scoreConfirm(d), d.slug ? `${site}/me/t/${s(d.slug)}` : tUrl)
    case 'player_busy':
    case 'tournament_underfilled': {
      const m = type === 'player_busy' ? p.playerBusy(d) : p.underfilled(d)
      return out({ title: m.title, body: lines(title, m.body) }, `${site}/manage/tournaments/${s(d.tournamentId)}/conduct`)
    }
    default:
      return out({ title: 'Nomad', body: ruText || title || type }, me)
  }
}
