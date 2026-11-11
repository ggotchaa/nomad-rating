# Nomad Amateur — implementation plan

Source: «ТЗ Nomad — платформа любительских рейтинговых турниров по настольному теннису» (decisions of 2026-11-07).
Status: plan only, stack approved. **UI work waits for the design concept**; backend engines and data model can start before it.
This is a standalone project: no code, data or dependencies are shared with other repositories.

---

## 1. What we are building (one paragraph)

A web platform + PWA for paid amateur rating tournaments in Kazakhstan (analogue of rttf.ru):
clubs announce tournaments → players register and pay online → the club runs the tournament
(groups/brackets, tables, calls, score) → Elo is recalculated → players get a public profile with history.
Plus leagues with seasons/divisions, doubles and team events, online table booking with a hall plan,
platform commission (8% default) and payouts to clubs, Telegram bot + Web Push.
Languages RU/KK/EN, time stored in UTC and shown in the hall's time zone (Asia/Almaty), money in KZT.

## 2. Stack (approved 2026-11-09)

| Layer | Choice | Why |
|---|---|---|
| Frontend | React + Vite, React Router, **TypeScript** | Fast dev server; TS pays off with money, statuses and the format constructor |
| PWA | `vite-plugin-pwa` (service worker) | Web Push, offline score queue for helpers, “Add to Home Screen” |
| Charts | Recharts (or lightweight alternative) | Rating graph S-2 |
| Backend | Node 22+ / Express, TypeScript | One language across web, API and workers |
| DB | PostgreSQL 16 + `btree_gist` | `EXCLUDE` on table bookings (B-10), transactions for money, JSONB for formats |
| Query / migrations | Kysely (typed SQL) + its migrator — or Drizzle | Typed SQL, explicit migrations |
| Queue / timers | Redis + BullMQ | Hold expiry (15/30/10 min), notification retries, rating recalculation, payout holds, reminders |
| Realtime | `ws` (or Socket.IO) with Redis pub/sub | Live page, tables screen, call popups, booking slot statuses |
| Auth | HttpOnly cookie sessions + Google OAuth (`arctic`/`openid-client`) + TOTP (`otplib`) for platform admin | Spec R-1, R-30, 4.8 (django-allauth in the spec is only an example) |
| Telegram | grammY | Bot with /start, /me, /next, /stop, /lang, message edits |
| Web Push | `web-push` (VAPID) | iOS 16.4+ via home-screen PWA |
| Email | Nodemailer over SMTP provider | Email confirmation, password reset, receipts |
| Files | Excel: `exceljs`, PDF: `pdfkit`, QR: `qrcode` | Imports, finance exports, protocols, QR codes |
| Payments | `PaymentProvider` adapter + **mock provider**; real provider (Kaspi / Freedom Pay / Halyk ePay / ioka) in stage 4 | Spec P-1, provider not chosen yet |
| Tests | Vitest (engines, services), Playwright (e2e scenario tests against an isolated DB) | Constructor and rating must be covered first (risk table) |
| Deploy | Docker Compose: app, worker, postgres, redis, nginx/traefik | Simple VPS deployment |

Money is stored as **integer tiyn** (KZT × 100); timestamps as `timestamptz`.

## 3. Project layout

```
nomad-amateur/
  apps/
    web/            React + Vite PWA (public, player, club, admin zones)
    server/         Express API + WebSocket gateway
    worker/         BullMQ workers (notifications, holds, rating, payouts, reminders, telegram)
  packages/
    engine/         PURE logic, no DB: format constructor, draws, standings/tie-breaks,
                    brackets (olympic, all-places, double-elim, swiss), queue/table assignment,
                    Elo + calibration, commission, league transitions, check-in codes
    shared/         Types, status enums + allowed transitions, validation schemas (zod), i18n keys
  db/migrations/
  ops/              docker, nginx, backups, e2e scenario tests
  docs/plans/
```

`packages/engine` is written test-first and has no I/O, so the hardest logic is tested in isolation.

## 4. Core data model (first cut)

- **Identity**: `users` (email, password hash, google id, 2FA secret), `sessions`, `players` (profile: name, gender, birth year, region/city, hand, photo, `added_by_club`, claim code, start level, calibration state), `player_ratings` (singles/doubles current + provisional flag), `telegram_links` (≤5 per player), `push_subscriptions`, `notification_prefs`.
- **Clubs**: `clubs` (status draft→review→active/rejected/blocked, requisites, commission override), `halls` (address, geo, timezone, schedule, comments), `hall_tables` (number, bookable, price, x/y/rotation), `hall_landmarks`, `club_members` (organiser/helper), `helper_grants` (rights[] + scope club/hall/tournament/league + tables[]), `right_templates`.
- **RTTF**: `rttf_profiles` (name, birth year, city, rating, games, url, updated_at, linked_player_id), `rttf_claims`.
- **Tournaments**: `tournaments` (type singles/doubles/team, status, hall, tables used, fee, limits, refund rules, settings JSONB, format JSONB, address snapshot, series id, season/division/round link), `entries` (player/pair/team, status machine 4.9, hold_until, waitlist position), `pairs_teams` + `team_members` + `invitations` + `join_links`, `checkins`, `stages`, `groups`, `brackets`, `matches` (number, stage/round, table, status, set score, game points, called_at, response), `match_events` (live points), `lineups`, `score_corrections`.
- **Rating**: `rating_events` (match, player, kind, before, E, K, delta, tournament), `rating_snapshots` (per player per tournament), `calibrations`.
- **Leagues**: `leagues`, `seasons` (format, payment mode, prices, transfer window), `divisions`, `season_entries`, `rounds` (tours), `fixtures` (free-dates proposals), `season_points_tables`.
- **Booking**: `bookings` (table, `tstzrange`, status, hold_until) with `EXCLUDE USING gist (table_id WITH =, period WITH &&) WHERE status IN (held, confirmed)`, `blocks` (one-off/recurring), `tariffs`.
- **Money**: `payments` (provider, external id, status, idempotency key), `refunds`, `ledger_entries` (double-entry style: fee, commission, acquiring, refund, payout), `club_balances` (derived), `payouts`, `invoices` (monthly for hall-paid bookings).
- **Platform**: `platform_settings` (Elo K values, levels, RTTF a/b, commission, hold days), `notification_templates`, `notification_log` (channel, attempt, status), `audit_log` (actor, club, entity, before/after, reason), `disputes`.

Every status column gets an explicit transition table in `packages/shared` (spec 4.9: invalid transitions are rejected, every change is audited and broadcast).

---

## 5. Stages

Estimates are for 2–3 developers; the spec’s total is 14–21 weeks to the end of stage 6, plus ≈2–3 weeks for the client demo (stage D).
Stage numbers match the spec’s references (“provider chosen by end of stage 2”, “accountant before stage 4”).
Order: 0 → **D (demo)** → 1 → 2 → 3 → 4 → 5 → 6. Stages 1, 2, 3 and 6 start from the demo code and extend it
(accounts and clubs → stage 1, tournaments and engine → stage 2, rating and profile → stage 3, booking → stage 6).

### Stage 0 — Foundation (≈1 week)

1. Create repo (monorepo with npm workspaces), TypeScript, ESLint/Prettier, Vitest, Playwright.
2. Docker Compose for dev: postgres + redis; `.env.example`; health endpoint.
3. Express skeleton: error handling, request validation (zod), helmet, rate limiting, structured logs.
4. Migrations tool + first migration (users, sessions, audit_log, platform_settings).
5. Worker process with BullMQ; WebSocket gateway with Redis pub/sub and room subscriptions (`tournament:{id}`, `user:{id}`, `hall:{id}`).
6. i18n framework (RU/KK/EN) on web and server; timezone helpers (UTC ↔ hall TZ).
7. Status-machine helper + audit helper (`audit(actor, entity, before, after, reason)`) used by all later code.
8. CI: lint, type-check, unit tests on every push.
9. **When the design concept arrives**: design tokens, base components (buttons, inputs, tables, cards, modals, toasts, bell), layout shells for the 4 zones, mobile-first breakpoints.

Done when: `docker compose up` runs api + worker + web; a test WebSocket message reaches the browser; CI is green.

### Stage D — Client demo: players, tournaments, clubs, booking without payment (≈2–3 weeks)

> **Status 2026-11-11:** steps 1–7 are done: foundation, backend (engine with tests, PostgreSQL schema, API, WebSocket, worker, demo seed) and the web screens of D.1 with the `DEMO_MODE` switcher and banner. The screens use the landing's visual language (no separate design concept arrived). Open: step 8 (staging deploy), step 9 (rehearsal — script in `docs/demo-presenter-guide.md`), CI, Playwright, KK/EN texts.

Goal: a working website the client can click through at a presentation. Client’s request:
«игроки, турниры, клубы и бронь без оплаты (пока что)».

**Rule: the demo is the first slice of the real product, not a throwaway prototype.**
It runs on the stage 0 foundation (same monorepo, PostgreSQL schema, migrations, API, engine, status machines,
i18n, audit). Everything built here stays; later stages *extend* it. Anything demo-only is isolated behind
`DEMO_MODE=true` and lives in clearly named files so it can be deleted in one step.

#### D.1 Scope — what the client sees

| Area | Public / player screens | Club screens | Spec |
|---|---|---|---|
| **Players** | Rating list (country / city, gender, search, 30-day change), public profile: photo, city, rating, place, max rating, tournaments/matches/win %, rating graph, tournament history with match scores, best matches, head-to-head | Club players list, add player (club-added profile) | S-1…S-6, R-8 |
| **Tournaments** | Home (city picker, upcoming, top-10, clubs), calendar with filters, tournament page (description, fee, limits, participants with ratings, «занято N из M», format scheme), finished tournament: groups, bracket, final places, rating changes; «Записаться» without payment | Tournaments list, create tournament from a ready format with preview (matches count, duration), participants list | T-1…T-6, F-2, F-4, R-3, R-19 |
| **Clubs** | Clubs list / map by city, club page `/club/{slug}`: description, address, tables, hours, comments, upcoming tournaments, «Забронировать стол» | Club settings: profile, hall, tables, hours, booking settings | C-1…C-7 |
| **Booking** | Hall plan (SVG, top view) with table statuses for date/time, table timeline with free slots, choose start + duration, price, confirmation «оплата в клубе», my bookings, cancel | Tables × time grid for the day, phone booking for a player, arrived / no-show | B-5, B-8, B-10, B-11, B-13 |
| **Accounts** | Email + password sign-in / sign-up, player cabinet (my registrations, my bookings) | Organiser account of a demo club | R-1 (no Google yet) |

Out of the demo (shown, if asked, as «в разработке»): payments, Telegram/Web Push, QR check-in, running a tournament live
(tables screen, calls, score entry), helpers and rights, doubles/teams, leagues, RTTF transfer, finances, platform admin.

#### D.2 Target architecture kept from day one

| Concern | How it is done in the demo (= final design) | What later stages add |
|---|---|---|
| Data model | Final tables for `users`, `players`, `player_ratings`, `clubs`, `halls`, `hall_tables`, `tournaments`, `entries`, `stages`, `groups`, `brackets`, `matches`, `rating_events`, `rating_snapshots`, `bookings` (with the `EXCLUDE` constraint), `booking_settings`, `audit_log` | New tables and columns via migrations; nothing renamed |
| Status machines | Tournament, entry and booking statuses with the full transition tables from spec 4.9, defined in `packages/shared` | Demo only *uses* a subset of transitions |
| Payments | `PaymentProvider` interface exists; demo registers `PayAtClubProvider` (no money moves): entry → «Оплачена/в зале», booking → «Подтверждена (оплата в зале)». Holds (`hold_until`) are written but a hold is confirmed immediately | Stage 2: mock provider with 15/10-min holds; stage 4: real provider. Callers do not change |
| Engine | `packages/engine` real code: groups (snake seeding), standings with tie-break list, all-places and olympic brackets, ready formats ГС-1/ГС-2/Круговая, duration estimate, Elo (frozen rating, K tiers, floor 100) | Stage 2 adds the constructor UI and remaining stage types; stage 3 adds calibration and replay |
| Demo data | `apps/server/src/demo/seed.ts`: 3–4 clubs (Almaty, Astana, Shymkent), halls with plans, ~150 players, ~20 finished tournaments **played through the real engine and Elo** (random but rating-weighted results), upcoming tournaments with registrations, bookings for the week. `npm run demo:reset` rebuilds the DB | Seed stays as the dev/staging fixture |
| Auth | Real sessions, password hashing, roles (player, organiser, platform admin) | Google, email confirmation, 2FA, helpers with rights |
| Demo-only helpers | `DEMO_MODE` adds a «Войти как…» switcher (player / organiser / admin demo accounts) and a demo banner. Lives in `apps/*/src/demo/` only | Removed (flag off) in production |
| Realtime | Booking table statuses and «занято N из M» update over the stage 0 WebSocket gateway | Live page, calls, notifications reuse the same rooms |
| i18n / time | All texts through i18n keys (RU filled, KK/EN keys ready); times in UTC shown in the hall’s TZ | KK/EN translations |
| Hall plan | One SVG `HallPlan` component with `mode="booking"`; plans for demo halls come from seed coordinates | Stage 6 adds `mode="editor"` and `mode="tournament"` |

#### D.3 Steps

1. Stage 0 foundation (repo, DB, API skeleton, WebSocket, i18n, status/audit helpers) — prerequisite.
2. Migrations for the D.2 tables; status-machine definitions; `PaymentProvider` interface + `PayAtClubProvider`.
3. `packages/engine`: groups, standings + tie-breaks, olympic and all-places brackets, ready formats, duration estimate, Elo — with unit tests for the spec examples (ГС-1 for 32 → 80 matches; triangle example).
4. API: players (list, profile, stats, head-to-head, rating list), clubs/halls/tables, tournaments (list/filter, page, create from format, register/cancel), bookings (availability, create, cancel, club grid, arrived/no-show).
5. Demo seed generator using the real engine + Elo; `demo:reset` script.
6. Web: design system from the design concept → public screens (home, calendar, tournament, rating list, profile, clubs, club page, booking) → player cabinet → club screens (tournaments, create tournament, participants, hall settings, booking grid). Mobile-first.
7. `DEMO_MODE` extras: role switcher, demo banner, «в разработке» placeholders for out-of-scope sections.
8. Deploy to a public staging URL (Docker Compose on a VPS, HTTPS), reset data before each presentation.
9. Rehearse the presentation script: guest browses tournaments and a player profile → player books a table and registers for a tournament → organiser creates a tournament and sees the booking grid.

Done when: the presentation script runs on the staging URL from a phone and a laptop without errors; two simultaneous bookings of the same slot → only one succeeds; ratings shown in profiles match the seeded results.

### Stage 1 — Accounts, clubs, players, rights (2–3 weeks)

1. **Auth** (R-1, R-30): email + password, email confirmation, password reset, Google sign-in with account linking by email, “one sign-in method must remain”, return-to-URL after login (R-21). Questionnaire on first login + consent.
2. **Player profile**: required fields before first registration, start level (R-2), photo upload.
3. **Platform admin 2FA** (TOTP) and admin shell.
4. **Clubs** (3.2, 4.13, C-1…C-10): registration, requisites (BIN/IIN, IBAN — organiser only), verification queue (A-1), statuses; halls with address/map/timezone/opening hours; table numbers (simple list now, SVG plan in stage 6); club and hall comments; tournament defaults; public club page `/club/{slug}`; club switcher in the header.
5. **Helpers and rights** (section 2): invite by email/link, checkbox rights, scope (club / halls / tournaments / tables), templates (Судья, Администратор зала, Менеджер турниров, Бухгалтер), instant revoke, auto-revoke on tournament close; server-side `requireClubRight(right, scope)` on every route; club audit log screen.
6. **Club-added players** (R-8…R-13): create profile, duplicate check (name + birth year + city), claim by same email (auto) or one-time code, Excel/CSV import with preview and error report, merge request → admin.
7. **RTTF base** (R-14…R-18): admin import/update from CSV/XLSX, manual edit, search (case/ё/word order insensitive, best match first by name + birth year), “Это я” → transferred rating `round(2·RTTF + 700)`, min 100, K=40 for first 5 matches, claim conflicts → admin, “add my RTTF profile” request.

Done when: acceptance items “two helpers with different rights” and “club adds a player without an account, the player claims it” pass as e2e tests.

### Stage 2 — Singles tournaments end-to-end (4–5 weeks) — the core

Write `packages/engine` **first** (risk: “constructor harder than estimated”).

1. **Engine: format constructor** (4.6, F-1…F-7):
   - Stage types: groups (3–8, snake/random/manual seeding, separate same-club), olympic (+3rd place match or shared 3rd), all-places bracket (sub-brackets 3..4, 5..8 … with match numbers and “−13” sources), round robin. (Double-elimination and Swiss → F-8, stage 6 or later.)
   - Transitions “who → where → how to seed” (by places, best of equal places, by rounds); final places for non-qualifiers.
   - Ready formats: Круговая, Олимпийка, ГС-1, ГС-2, ГС-3, “Группы по 4 → основная + утешительная”.
   - Validation (F-5), match count and duration estimate `T ≈ M·t̄/N` (F-4), recalculation for the actual player count incl. uneven groups and byes to top seeds (F-6).
   - Group tie-breaks: ordered, configurable list incl. the “triangle” by points ratio; explanation of which rule decided each place; lots / organiser decision with reason.
   - Set/score validation (11, win by 2, no extra sets), quick-entry rule (winner + loser points).
   - Unit tests reproduce every example of the spec: 30 players → 6×4 + 2×3; ГС-1 for 32 → 80 matches, places 1–16, 16-seed first round `1–16, 9–8, 5–12, 13–4, 3–14, 11–6, 7–10, 15–2`; triangle table B 1.076 / C 0.969 / A 0.959.
2. **Tournament CRUD** (T-1…T-4, T-7, C-2…C-5): editor with defaults from club, constructor UI with preview, limits (rating/gender/age), refund rules, tables subset, settings (who enters score, game points mode, check-in window, rest time, same-day registration, min participants), statuses, copy tournament, series. Address snapshot on completion.
3. **Public side**: home, calendar with filters (T-5), tournament page with participants list live-updated (T-6, R-19), share link + QR + OG preview (R-20, T-8).
4. **Registration** (R-3…R-7, R-28): eligibility checks, 15-min hold, **mock payment** through the `PaymentProvider` adapter, waiting list with 30-min invitation, cancellation with refund rule, manual add by club (commission still accrues), time-overlap rule R-28 using planned start/end.
5. **Check-in** (R-22…R-26): rotating signed QR (30 s TOTP-style per tournament, accept current + previous), window, “Я в зале”, “Показать QR” screen, manual check-in fallback, day-of registration.
6. **Running** (M-1…M-8, 3.3): seeding confirmation, “Старт”, tables screen with match queue (rest time, player busy elsewhere), call to table, statuses, score entry screen (big buttons, offline queue in service worker, conflict resolution for two helpers), no-show / retirement / withdrawal flows from the “особые ситуации” table, automatic advancement between stages, score correction with reason and re-build of not-started dependent matches, early finish, auto-cancel for too few participants, close tournament → final places.
7. **Live / TV page** (M-6): tables with current matches, “next” queue, group tables, brackets, auto-scroll, WebSocket updates.
8. **In-site notifications**: bell, popup on call with “Иду / Не могу (reason)”, re-call after 3 min, organiser sees delivered / Иду / no answer.
9. **Players-enter-score mode** (M-5): one player enters, opponent confirms.

Done when: acceptance items for the 32-player tournament (“группы по 4 → основная и утешительная”), ГС-1 numbering/“−13” labels and the triangle example pass end-to-end on mock payments.
Parallel non-code task: **choose payment provider and apply for acquiring** before the end of this stage.

### Stage 3 — Rating, profile, notifications channels (2–3 weeks)

1. **Elo engine** (section 5): frozen ratings at tournament start, K 40/24/16 tiers (admin settings), floor 100, per-tournament rounding, rating-tournament rule (verified club, ≥4 participants), tournament coefficient, excluded results (forfeits, no-shows, injury).
2. **Calibration**: 3 tournaments, `(best win + worst loss)/2`, ±100 fallbacks, extension when no rated opponents, “new city” bootstrap mode, notification with the calculation; “К” marker in lists.
3. **Event log + replay**: `rating_events` → snapshots; background recalculation from a corrected tournament forward; “обновляется” flag; performance test 100 000 matches ≤ 5 min. 72-hour correction window for clubs, later only via admin; “Счёт неверный” button.
4. **Preliminary delta** during a tournament (“+12”).
5. **Profile & stats** (S-1…S-7): public profile, rating graph with 3m/1y/all, tournament history with drill-down to sets, top-5 best matches, head-to-head, rating list (country / city, gender, age, search, 30-day change, inactive filter, provisional marker), player cabinet, “Мой турнир” page (group/bracket position, queue number, next match).
6. **Web Push** (PWA): subscription prompt at first registration, iOS home-screen hint.
7. **Telegram bot**: deep-link binding from profile, /start name search binding, ≤5 accounts per player, moving a Telegram account between profiles with notice, /me /next /stop /lang, call message with required fields + “Открыть на сайте”, editing the message on table change / response, blocked-bot status for organiser.
8. **Delivery pipeline**: BullMQ, 3 retries, per-attempt log, ≤10 s for calls (measure p95), user preferences per event type (call cannot be disabled during an active tournament), reminders 24 h / 2 h, results message, “new tournament for your rating” subscriptions, club subscription (C-9).

Done when: “rating after the tournament matches the Excel control calculation”, “retroactive correction recalculates and is audited”, “profile shows history, best matches and both graphs” (doubles graph empty until stage 5).

### Stage 4 — Real payments, commission, finances (2–3 weeks)

Prerequisite: accountant consultation on legal entity and fiscal receipts (open question in the spec).

1. Real provider adapter: redirect/hosted page, webhook signature check, idempotency, status polling fallback, refunds (full/partial). No card data on our server (P-4).
2. Ledger: fee, commission `max(fee·p/100, C_min)`, acquiring (who pays — platform setting), club-specific rates (separately for tournaments and bookings), commission on hall-paid entries/bookings charged from club balance or monthly invoice; debt > 30 days → disable hall payment.
3. Payout cycle: accrued → available after N days → requested → paid (payment order number) / rejected; club cannot request with unverified requisites.
4. Refund flows wired to all cases: player cancel by rules, club removal (100%), tournament cancelled by club (100%, no commission), waitlist expiry, early finish partial refunds.
5. Club finance screen (P-2): incoming by tournament, commission, refunds, balance, payout request, Excel export.
6. Admin finance (P-3, A-2, A-7): revenue by month, payout queue, reconciliation with provider registry, dashboard.
7. Receipts/emails after payment.

Done when: “player pays with a real card and Kaspi”, “tournament cancellation refunds everyone, sums match the provider statement”.

### Stage 5 — Doubles, teams, leagues (3–4 weeks)

1. **Doubles & teams** (4.11, D-1…D-10): create pair/team, invitations by name search (region + birth year shown) and by share link (with optional captain approval), statuses, 48-hour expiry, minimum roster → payment (captain for all / each own share with 2-hour hold), roster changes before/after registration close, “повторить состав”, no refund for leaving a fully paid team, eligibility per member and by rating sums, seeding by pair/top-3 sum.
2. **Team meeting**: ready schemes (Формат ЧМ, Олимпийская, Свэтлинг) + custom, “first to N” with optional play-all, one or two tables, blind line-up with 10-min fallback to organiser, per-game calls, team group tie-breaks.
3. **Doubles rating**: separate doubles Elo (start = singles), pair average, per-partner K, doubles calibration; team-meeting singles → singles rating, doubles → doubles rating; doubles rating list and graph.
4. **Leagues** (4.12, L-1…L-15): league → season → divisions → tours; formats “дивизионы с переходами после тура”, “общий тур”, “круговой на сезон”, “свободные даты” (needs booking — finish in stage 6); a tour = a normal tournament linked to season/division (reuse stage 2 as-is); distribution by rating or manual draft with drag-and-drop; promotion/relegation per boundary, missed-tour rules, freeze, merging small divisions, newcomers mid-season, season points tables, N best tours, play-offs (L-11), season payment modes (season / per tour / combined with top-up), deadlines and reminders, reschedule & confirm-result (L-7), transfer window (L-8), next-season draft and participation confirmation (L-5), public league page.
5. R-29: multiple seasons allowed, conflict warnings.

Done when: acceptance items for the 3-player team with one decline, the pair formed by link with doubles-only rating change, and the 3-division league season with combined payment.

### Stage 6 — Booking, hall plan, admin, pilot (2–3 weeks)

1. **Hall plan editor** (B-1…B-4): SVG, metres grid with snapping, drag, rotate 90°, labels, landmarks and zones; one component in modes editor / booking / tournament; retrofit to the tables screen and the live page.
2. **Booking settings** (B-5…B-9): hours per weekday, slot step, min/max duration, blocks (one-off / recurring, hall / tables), tournament auto-block with conflict resolution (move or refund), horizon, cancellation rule, tariffs.
3. **Player booking**: plan with table statuses (WebSocket), timeline, price, 10-min hold, payment or “pay at the club”, Telegram confirmation, 1-hour reminder, cancel link; pinch-zoom and list mode on mobile (B-13). DB `EXCLUDE` constraint test with concurrent requests.
4. **Club booking desk** (B-11, 3.4): tables × time grid for day/week, phone bookings incl. players without account, payment link, arrived / no-show, drag to move, close hall with move/refund.
5. League “свободные даты” format: propose date + table → opponent confirms → table booked.
6. **Platform admin completion** (4.8): players search/merge/manual rating correction with recalculation/block, settings (Elo, levels, RTTF a/b, commission, templates, texts in 3 languages, hold days), audit log with filters, disputes, “view as club” read-only.
7. **Hardening**: load test of live page and calls, caching of public pages, backups, monitoring, security review, OpenAPI docs, user guides per role.
8. **Pilot**: run the full acceptance checklist (section 7 of the spec) as automated e2e scenarios + one real club tournament.

Done when: “club draws a plan and schedule; player books and pays from a phone in under a minute”, “two players book the same table at the same time — only one succeeds”, plus the whole checklist.

Later / optional (marked as extensions in the spec): double-elimination and Swiss stages, public template library (F-8), achievements (S-8), recurring bookings & subscriptions & partner search (B-14), inter-club leagues (L-12), stage rating coefficient.

---

## 6. What depends on the design concept

| Can start now | Waits for the design |
|---|---|
| Repo, infra, DB schema, migrations | Design tokens, component library |
| `packages/engine` (constructor, Elo, brackets, queue) with tests | All screens of the 4 zones (33 screens, spec 4.10) |
| API endpoints, status machines, audit | Bracket/group visual layout (spec references a sample bracket image) |
| Payment adapter + mock, queues, WebSocket, Telegram bot | Hall plan visual style, live/TV page |

Suggested order once the design arrives: demo screens first (stage D: home, calendar, tournament page, rating list, profile, clubs, booking, club booking grid) → player mobile flows (register, “Мой турнир”) → club tables/score screens → the rest.
For the demo, the design concept only needs to cover the stage D screens; the rest can follow later.

## 7. Open decisions

1. **Repo**: initialise git in `nomad-amateur` (monorepo as in section 3) at the start of stage 0.
2. **RTTF base**: who fills it before the pilot and how often it is refreshed (open in the spec, needed by stage 1–2).
3. **Payment provider** and legal entity/receipts (open in the spec, needed by stage 4; mock until then).
4. Domain name, email sender, Google Cloud OAuth project, Telegram bot token, hosting (VPS).
5. **Demo**: presentation date, staging domain, real club names/photos for the seed or fictional ones, RU only or RU + KK for the demo.
