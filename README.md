# Nomad Amateur

Platform for amateur rating table tennis tournaments in Kazakhstan: clubs, tournaments, Elo rating,
table booking. Plan: [docs/plans/implementation-plan.md](docs/plans/implementation-plan.md).

Current state: **stages 0, D, 1, 2, 3, 5, 6 implemented** (accounts and clubs with helper rights, RTTF, full tournament conduct with check-in and live page, Elo with calibration and replay, notifications with Web Push and Telegram, doubles, teams and leagues, booking with hall plan editor, platform admin, RU/KK/EN). **Stage 4 (payments) is not started** — registrations and bookings are «оплата в клубе». Production: https://rating.nomadtta.kz (no demo mode). Open items per stage: section 8 of the plan; gaps against the spec: [docs/spec-gap-audit.md](docs/spec-gap-audit.md).

## Layout

| Path | What |
|---|---|
| `packages/shared` | Status machines (spec 4.9), money and commission, time zones, name search, domain constants |
| `packages/engine` | Pure logic, no I/O: groups and tie-breaks, brackets (olympic, all places), formats and preview, tournament transitions, Elo with calibration, booking slots and prices |
| `apps/server` | Express API, PostgreSQL (Kysely), sessions, club rights, audit log, payment adapter, WebSocket `/ws`, dev seed (`src/dev-data`) |
| `apps/worker` | BullMQ jobs (hold expiry; later notifications, reminders, rating recalculation) |
| `apps/web` | React + Vite web app. `/` — scroll-driven landing (`src/features/landing`, three.js + GSAP). Product screens (`src/features/*`, shell in `src/app`): home, tournaments calendar and page (groups, bracket, results), rating list, player profile, clubs, table booking on the hall plan, sign-in / sign-up, player cabinet, club cabinet (tournaments, booking desk, players, club and hall settings). Texts live in `src/i18n/ru.ts`. `npm run dev:web` → http://localhost:5173 (proxies `/api` and `/ws` to the server) |

## Run locally

Requirements: Node.js 22.12+, Docker. Use npm 11 for installs (`npx npm@11 install`) — npm 10 crashes on this workspace tree.

```bash
npx npm@11 install
copy .env.example .env
docker compose up -d
npm run dev:reset
npm run dev
```

- API: `http://127.0.0.1:3010/api` (health: `/api/health`), WebSocket: `ws://127.0.0.1:3010/ws`
- Worker (optional, needs Redis): `npm run dev:worker`
- Tests: `npm test` · types: `npm run typecheck` · lint: `npm run lint`
- Acceptance tests (Playwright, own DB `nomad_e2e`, ports 3030/5190): `npm run e2e` (first time: `npx playwright install chromium`)
- API reference: `/api/docs` (`apps/server/openapi.yaml`) · user guides per role: [docs/guides](docs/guides)
- Production setup: `ops/` (Dockerfiles, `compose.prod.yaml`, nginx, `backup.sh`)
- First platform admin (production has no seeded accounts): `docker compose -f ops/compose.prod.yaml exec -e ADMIN_PASSWORD='...' app npm run admin:create -w @nomad/server -- you@example.kz`. An existing user is promoted instead. `/admin` then requires setting up 2FA (`ADMIN_2FA_REQUIRED=true`).

`npm run dev:reset` (refuses with `NODE_ENV=production`) wipes the database and creates development and e2e data through the real services: 5 clubs, ~180 players,
~57 finished tournaments played match by match and rated by Elo, one tournament running now, upcoming tournaments
with registrations and a waiting list, ~320 bookings. Dates are relative to the day it runs.

The site opens in Kazakh by default (switch RU/KZ/EN in the header). Cities come from the reference migration `0007_cities_locale` (36 cities, 20 regions), not from the dev seed.

Dev accounts (password `nomad-dev-2026`, local and e2e only):

| key | e-mail | who |
|---|---|---|
| `player` | player@dev.nomad.test | Арман Сейтов, rated player with history |
| `newbie` | newbie@dev.nomad.test | Дана Ермекова, calibration 2 of 3 |
| `organizer` | organizer@dev.nomad.test | organiser of Smash Arena |
| `hall_admin` | hall@dev.nomad.test | helper of Smash Arena with «Брони» and «Игроки» |
| `referee` | referee@dev.nomad.test | helper «Судья»: conduct of one tournament only |
| `manager` | manager@dev.nomad.test | helper «Менеджер турниров»: tournaments, conduct, score fix, players |
| `accountant` | accountant@dev.nomad.test | helper «Бухгалтер»: finance (view) only |
| `rttf` | rttf@dev.nomad.test | player without matches who can claim an RTTF profile |
| `new_club` | newclub@dev.nomad.test | organiser of Ping Pong Lab, club under review |
| `admin` | admin@dev.nomad.test | platform administrator — open `/admin` (2FA only when `ADMIN_2FA_REQUIRED=true`) |


## API

Full reference: `/api/docs`. Errors are `{ "error": "<code>", "details": ... }` with stable codes for translation (RU/KK/EN) in the web app.
Money is in tiyn (1 ₸ = 100), times are UTC (shown in the hall time zone).
