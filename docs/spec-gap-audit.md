# Spec gap audit (2026-11-13)

Implementation checked against «ТЗ Nomad — платформа любительских рейтинговых турниров по настольному теннису» section by section.
Only missing or partial items are listed; items already in section 8 of [the plan](plans/implementation-plan.md) are not repeated.
Effort: S ≈ hours, M ≈ 1–3 days, L ≈ a week or more.

**Online payments (4.3) are not implemented by decision.** The spec lists them as the first goal of version 1
(«получает оплату взносов онлайн за вычетом комиссии»). Everything is «оплата в клубе» for now. Everything that depends on payments is left out below:
commission ledger, payouts, receipts, refunds and the payment result screen.

## P0: before inviting real clubs

| # | Spec | Gap | Effort |
|---|---|---|---|
| 1 | 4.4 | Technical defeat is stored as 0:0 (`conduct.ts` no-show). It should be 3:0 / 11:0 (`walkoverScore()` exists but is unused) | S |
| 2 | 4.2 R-25 | The «Регистрация в день турнира» checkbox is saved but does nothing. QR check-in of an unregistered player returns `entry.not_found` | M |
| 3 | 4.2 R-26 | QR check-in does not work for pairs and teams. It only looks up `entries.player_id`. Staff can mark a whole entry manually | M |
| 4 | 4.12 | The season form is hard-coded: dates are today + 120 days, and only the name and divisions are set. Boundaries, points, best tours, transfer window and division size can't be set from the UI | M |
| 5 | 4.13 | Club settings UI lacks logo, cover, city, Telegram/Instagram/contacts and hall equipment. The API supports all of them | S |
| 6 | 4.13 | Tournament defaults UI lacks refund rules, format template, participant limit, who enters the score and day-of registration | S |
| 7 | 4.13 C-9 | There is no «Подписаться на клуб» button. The API and announcement job exist | S |
| 8 | 2 / 4.10 | The «Бухгалтер» helper role (the finance right) opens nothing. There is no club «Финансы» screen. Without online payments it can at least list at-club receipts from entries and bookings | M |
| 9 | 6 | Notification texts are Russian only (`notify/text.ts`), while the site defaults to Kazakh. The bot's `/lang` is stored but ignored | M |
| 10 | 4.10 | No account deletion in player settings (personal-data requirement) | S–M |
| 11 | 7 / ops | Backups stay on the same host, with no cron entry and no `uploads` volume. Certificates have no automatic renewal. There is no uptime or error monitoring | M |

## P1: first weeks of real use

**Tournament conduct and format (4.4, 4.6)**
- Setting the match format per stage or round, e.g. a final to 4 wins (M).
- Correcting a finished match is refused once a dependent match has been played. The spec says to keep played matches and rebuild only the unplayed ones (M).
- Withdrawal during the group stage: no organiser choice between annulling and walkovers (S–M).
- Retirement does not credit the unplayed games to the opponent (S).
- The group table does not show which tie-break decided a place. The engine returns `decidedBy` and `tiedWith` (S).
- No warning about group matches entered without game points (S).
- The «too few participants» rule cancels at the start time, not 2 h before, and the organiser is not warned (S–M).
- A player can check in to two running tournaments at once (M).
- No group and bracket size recalculation after registration closes or after check-in (M).
- No changes after start: replacing a player, or changing tables or format for unplayed matches (M).
- The offline score queue silently drops a 409 conflict. It should show both versions to the organiser (M).
- Organisers can't save their own format templates (M).
- The constructor can't reorder stages or edit points per win, rest time or tie-break on/off (M).
- Organisers can't set the rating coefficient per tournament, e.g. ×1.25 (S).

**Telegram and notifications (6)**
- Missing events: registration confirmation, «Вы следующий», «Стол изменён», cancelled call, and a notice when a new Telegram account is linked or an account moves (M).
- Call message lacks the stage, the opponent's rating, the profile link and «в течение N минут» (S).
- `/next` doesn't show the queue position; `/me` doesn't show the next tournament (S).
- Answering «Иду» on the site doesn't update the Telegram message (S).
- Search shows 6 results instead of 5, without rating (S).
- The site has no QR code for the bot link and no bot reminder when registering (S).
- `team_*`, `league_*`, `lineup_overdue` and `score_confirm` have no texts and can't be switched off (S, known).

**Leagues (4.12)**
- Division draft: no publish step; tour results apply at once; no «your division» notice (M).
- «Пропущу тур» button, no-show tracking, a warning after 2 no-shows, and a limit of one freeze per season (M).
- Default points (1st place = number of players) and points numbered through all divisions (M).
- Season-end promotion and relegation for round-robin and free-date formats (M).
- Promotion and relegation play-off matches (стыковые матчи) (M).
- The next-season draft has no confirmation deadline and no filling of freed places (M).
- Season tie-breaks, configurable points for round-robin and free dates, technical defeat after the window (S–M).
- League page: no calendar, tour results or best players of the season. Zones aren't highlighted. League results are missing from the player profile (M).
- League fixtures are not rated (M).

**Club, booking, admin (4.7, 4.8, 4.10, 4.13)**
- Club «Сегодня» dashboard (M).
- Admin dashboard with tournaments, players, bookings and turnover (M).
- Club documents: upload and review (M).
- Admin UI for per-club commission rates (S–M).
- Disputes can only be raised on a match, not on a payment or by a club (M).
- Clubs aren't notified when an address changes. When a table is removed, a move to another table isn't offered (S).
- Club page doesn't list leagues (S).
- Clubs can't see their own audit history (S).
- Teams: no captain transfer, no warning when the roster drops below the minimum, no share buttons or QR (S–M).
- Clubs can't correct a player's start level. «Разрядник» isn't confirmed by the organiser (S).

**Profile and home (4.5, 4.10)**
- Rating list has no age filter (S).
- No head-to-head lookup between any two players (S).
- Player cabinet has no «ближайший турнир» block (S).
- No player search on Home (S).
- Calendar has no month view (S–M).
- No «К» marker in brackets and the live view (S).
- Sharing has no Telegram/WhatsApp buttons and no short link (S).

## P2: later or large

- Per-point live scoring from a tablet (M-9) (L).
- Achievements and statistics by opponent style (S-8) (M–L).
- Double elimination, Swiss system, per-stage rating coefficient, public template library (F-8) (L each).
- Pair and team leagues (L-1) and inter-club leagues (L-12) (L).
- Repeat bookings, hour packages, partner search (B-14) (L).
- Table photos and price per zone (B-2) (M).
- Separate team rating for permanent teams (M).
- Admin switch for «new city» mode (S).
- Injury retirement excluded from the rating (S).
- Telegram channel autopost (T-8) (M).

## Production readiness (section 7)

- No load test of the live page with 32 players, and no p95 measurement of call delivery.
- No reference dataset for the Excel control calculation of Elo.
- No resource limits on Postgres and Redis.
- No dependency or image scanning outside the GitLab SAST template.
- Production database is empty: clubs, halls and players are created through the product. The first admin is created with `npm run admin:create` (see README).
