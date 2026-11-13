# Nomad Amateur

Platform for amateur rating table tennis tournaments in Kazakhstan: clubs, tournaments, Elo rating,
table booking. Plan: [docs/plans/implementation-plan.md](docs/plans/implementation-plan.md).

Current state: **stages 0, D, 1, 2, 3, 5, 6 implemented** (accounts and clubs with helper rights, RTTF, full tournament conduct with check-in and live page, Elo with calibration and replay, notifications with Web Push and Telegram, doubles, teams and leagues, booking with hall plan editor, platform admin, RU/KK/EN). **Stage 4 (payments) is not started** — registrations and bookings are «оплата в клубе». Not deployed yet. Open items per stage: section 8 of the plan.
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
- Acceptance tests (Playwright, own DB `nomad_e2e`, ports 3030/5190): `npm run e2e` (first time: `npx playwright install chromium`)
- API reference: `/api/docs` (`apps/server/openapi.yaml`) · user guides per role: [docs/guides](docs/guides)
- Production setup: `ops/` (Dockerfiles, `compose.prod.yaml`, nginx, `backup.sh`)
- First platform admin (production has no demo accounts): `docker compose -f ops/compose.prod.yaml exec -e ADMIN_PASSWORD='...' app npm run admin:create -w @nomad/server -- you@example.kz`. An existing user is promoted instead. `/admin` then requires setting up 2FA (`ADMIN_2FA_REQUIRED=true`).

`npm run demo:reset` wipes the database and creates demo data through the real services: 5 clubs, ~180 players,
~57 finished tournaments played match by match and rated by Elo, one tournament running now, upcoming tournaments
with registrations and a waiting list, ~320 bookings. Run it again right before a presentation
(the «running now» tournament and bookings are relative to today).

The site opens in Kazakh by default (switch RU/KZ/EN in the header). Cities come from the reference migration `0007_cities_locale` (36 cities, 20 regions), not from the demo seed.

Demo accounts (password `nomad-demo-2026`), or `POST /api/demo/login-as {"key": "..."}` in demo mode:

| key | e-mail | who |
|---|---|---|
| `player` | player@demo.nomad.kz | Арман Сейтов, rated player with history |
| `newbie` | newbie@demo.nomad.kz | Дана Ермекова, calibration 2 of 3 |
| `organizer` | organizer@demo.nomad.kz | organiser of Smash Arena |
| `hall_admin` | hall@demo.nomad.kz | helper of Smash Arena with «Брони» and «Игроки» |
| `referee` | referee@demo.nomad.kz | helper «Судья»: conduct of one tournament only |
| `manager` | manager@demo.nomad.kz | helper «Менеджер турниров»: tournaments, conduct, score fix, players |
| `accountant` | accountant@demo.nomad.kz | helper «Бухгалтер»: finance (view) only |
| `rttf` | rttf@demo.nomad.kz | player without matches who can claim an RTTF profile |
| `new_club` | newclub@demo.nomad.kz | organiser of Ping Pong Lab, club under review |
| `admin` | admin@demo.nomad.kz | platform administrator — open `/admin` (2FA only when `ADMIN_2FA_REQUIRED=true`) |

`DEMO_MODE=true` enables `/api/demo/*` only; the server refuses to start with it in production.
Demo-only code lives in `apps/server/src/demo/`.

## API

Full reference: `/api/docs`. Errors are `{ "error": "<code>", "details": ... }` with stable codes for translation (RU/KK/EN) in the web app.
Money is in tiyn (1 ₸ = 100), times are UTC (shown in the hall time zone).
