# Nomad Amateur

Platform for amateur rating table tennis tournaments in Kazakhstan: clubs, tournaments, Elo rating,
table booking. Plan: [docs/plans/implementation-plan.md](docs/plans/implementation-plan.md).

Current state: **stage 0 + stage D (client demo)** — players, tournaments, clubs, booking without payment; backend and web screens are done, staging deploy is not.
Presenter script: [docs/demo-presenter-guide.md](docs/demo-presenter-guide.md).

## Layout

| Path | What |
|---|---|
| `packages/shared` | Status machines (spec 4.9), money and commission, time zones, name search, domain constants |
| `packages/engine` | Pure logic, no I/O: groups and tie-breaks, brackets (olympic, all places), formats and preview, tournament transitions, Elo with calibration, booking slots and prices |
| `apps/server` | Express API, PostgreSQL (Kysely), sessions, club rights, audit log, payment adapter, WebSocket `/ws`, demo seed |
| `apps/worker` | BullMQ jobs (hold expiry; later notifications, reminders, rating recalculation) |
| `apps/web` | React + Vite web app. `/` — scroll-driven landing (`src/features/landing`, three.js + GSAP). Product screens (`src/features/*`, shell in `src/app`): home, tournaments calendar and page (groups, bracket, results), rating list, player profile, clubs, table booking on the hall plan, sign-in / sign-up, player cabinet, club cabinet (tournaments, booking desk, players, club and hall settings). Texts live in `src/i18n/ru.ts`; demo-only UI in `src/demo`. `npm run dev:web` → http://localhost:5173 (proxies `/api` and `/ws` to the server) |

## Run locally

Requirements: Node.js 22.12+, Docker. Use npm 11 for installs (`npx npm@11 install`) — npm 10 crashes on this workspace tree.

```bash
npx npm@11 install
copy .env.example .env
docker compose up -d
npm run demo:reset
npm run dev
```

- API: `http://127.0.0.1:3010/api` (health: `/api/health`), WebSocket: `ws://127.0.0.1:3010/ws`
- Worker (optional, needs Redis): `npm run dev:worker`
- Tests: `npm test` · types: `npm run typecheck` · lint: `npm run lint`

`npm run demo:reset` wipes the database and creates demo data through the real services: 5 clubs, ~180 players,
~57 finished tournaments played match by match and rated by Elo, one tournament running now, upcoming tournaments
with registrations and a waiting list, ~320 bookings. Run it again right before a presentation
(the «running now» tournament and bookings are relative to today).

Demo accounts (password `nomad-demo-2026`), or `POST /api/demo/login-as {"key": "..."}` in demo mode:

| key | e-mail | who |
|---|---|---|
| `player` | player@demo.nomad.kz | Арман Сейтов, rated player with history |
| `newbie` | newbie@demo.nomad.kz | Дана Ермекова, calibration 2 of 3 |
| `organizer` | organizer@demo.nomad.kz | organiser of Smash Arena |
| `hall_admin` | hall@demo.nomad.kz | helper of Smash Arena with «Брони» and «Игроки» |
| `admin` | admin@demo.nomad.kz | platform administrator |

`DEMO_MODE=true` enables `/api/demo/*` only; the server refuses to start with it in production.
Demo-only code lives in `apps/server/src/demo/`.

## API (stage D)

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/register`, `/auth/login`, `/auth/logout`, `GET /auth/me` |
| Catalog | `GET /cities`, `GET /home?city=` |
| Players | `GET /players` (rating list: city, gender, age, q), `/players/search?q=`, `/players/:id`, `/:id/rating-history?period=3m\|1y\|all`, `/:id/tournaments`, `/:id/tournaments/:tid/matches`, `/:id/best-matches`, `/:id/h2h/:otherId` |
| Clubs | `GET /clubs?city=`, `/clubs/:slug`, `PATCH /clubs/:id`, `GET/POST /clubs/:id/players`, `GET /my/clubs` |
| Halls | `GET/PATCH /halls/:id`, `PUT /halls/:id/tables`, `PUT /halls/:id/booking-settings` |
| Tournaments | `GET /formats`, `POST /formats/preview`, `GET /tournaments?when=&city=&club=&fitsMe=&hasSpots=`, `GET /tournaments/:slug`, `GET/POST /clubs/:clubId/tournaments`, `POST /tournaments/:id/publish`, `GET /tournaments/:id/participants`, `POST /tournaments/:id/entries`, `POST /tournaments/:id/entries/manual`, `DELETE /tournaments/:id/entries/me`, `POST /tournaments/:id/start`, `POST /tournaments/:id/matches/:mid/result`, `POST /tournaments/:id/finish` |
| Booking | `GET /halls/:id/availability?date=`, `POST /bookings`, `DELETE /bookings/:id`, `GET /my/bookings`, `GET /my/entries`; club desk: `GET/POST /halls/:id/bookings`, `POST /bookings/:id/status`, `POST /halls/:id/blocks` |

Errors are `{ "error": "<code>", "details": ... }` with stable codes for translation (RU/KK/EN) in the web app.
Money is in tiyn (1 ₸ = 100), times are UTC (shown in the hall time zone).
