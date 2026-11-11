# Nomad demo — presenter guide

For the person who shows the demo to the client. No technical background is needed for sections 1 and 3–6;
section 2 is done once by a developer before the meeting.

## 1. What the demo is

A working website for amateur table tennis rating tournaments: **players, tournaments, clubs and table booking
without online payment** (this is what the client asked to see first).

- The interface is in Russian. Button names below are given exactly as on the screen.
- All data is fictional: 5 clubs, about 180 players, about 57 finished tournaments, one tournament running «now»,
  several upcoming tournaments, about 320 table bookings. Results and ratings are calculated by the real engine, not typed in by hand.
- Payment is switched off. Everywhere the site says «оплата в клубе».
- An orange strip at the top says «Демо-версия». It contains the **«Войти как…»** switcher — your main tool:
  it changes the role in one click, no passwords.

## 2. Before the meeting (developer, about 5 minutes)

Docker Desktop must be running. In the project folder:

```bash
docker compose up -d
```

```bash
npm run demo:reset
```

```bash
npm run dev
```

```bash
npm run dev:web
```

Open <http://localhost:5173/home>. The last two commands stay running in two terminal windows.

- **Run `npm run demo:reset` on the day of the meeting.** Dates of upcoming tournaments, the «running now» tournament
  and bookings are created relative to today. It takes about a minute and deletes everything done in earlier rehearsals.
- The demo currently runs **only on this computer**. It is not deployed to a public address, so it cannot be opened
  from the client's phone. To show the phone view, narrow the browser window or use the browser's device mode (F12 → phone icon).

## 3. Roles in the «Войти как…» switcher

| Entry in the list | Who it is | Use it to show |
|---|---|---|
| (empty) «Гость (выйти)» | Visitor without an account | Everything public: tournaments, rating, profiles, clubs |
| «Игрок» | Арман Сейтов, Almaty, has a rating and history | Booking a table, registering for a tournament, player cabinet |
| «Новичок» | Дана Ермекова, rating not yet calculated | Calibration («К» mark), rating limits of a tournament |
| «Организатор клуба» | Organiser of Smash Arena | Creating a tournament, booking desk, club players, club settings |
| «Администратор зала» | Helper with only «Брони» and «Игроки» rights | That a helper sees only what the organiser allowed |
| «Администратор платформы» | Service owner | Nothing yet — the admin area is not in the demo |

Regular sign-in also works: button «Войти», any e-mail from the README table, password `nomad-demo-2026`.

## 4. Presentation script (15–20 minutes)

### Act 1 — Guest: «what a player sees before registering» (5 min)

1. Open <http://localhost:5173/>. This is the animated landing page; scroll a little, then press **«Найти турнир»**.
2. **«Турниры»**: upcoming tournaments with date, club, fee, rating limits and the «Занято N из M» bar.
   Switch **«Предстоящие / Идут сейчас / Завершённые»** and the city list.
3. Open any tournament under **«Завершённые»**. Show from top to bottom:
   - place, time, number of tables, format scheme with the number of matches;
   - **«Итоги»** — final places and the rating change of every player;
   - **«Группы»** — group tables;
   - **«Сетка на все места»** — bracket, then matches for places 3–4, 5–8 and so on.
4. Click a player's name. On the **profile**: rating, maximum, place in Kazakhstan and in the city, win percentage;
   **«График рейтинга»** (move the mouse over it; switch «3 месяца / Год / Всё время»);
   **«История турниров»** (click a row — the matches with set scores open); **«Лучшие победы»**.
5. **«Рейтинг»**: the single rating list for Kazakhstan. Filter by city and by «Мужчины / Женщины», search by surname,
   show the «30 дней» column.
6. **«Клубы»** → **Smash Arena**: description, address, opening hours, hall plan, upcoming and past tournaments.

What to say: one rating for the whole country, every tournament of every club feeds it, and a player's whole history is public.

### Act 2 — Player: «book a table and register in a minute» (5 min)

1. In the orange strip choose **«Игрок»**. The **player cabinet** opens: «Мои турниры» and «Мои брони».
2. **«Клубы»** → **Smash Arena** → **«Забронировать стол»**.
   - Pick a day in the row of dates.
   - On the hall plan: green — free all day, blue — some slots free, red — fully booked, dashed — not for booking.
   - Click a table, pick a start time, pick a duration. The price is calculated at once.
   - Press **«Забронировать»** → «Бронь подтверждена», payment at the club.
3. **«Мои брони»**: the new booking is in the list; show the **«Отменить»** button.
4. **«Турниры»** → open an upcoming tournament where the player is not registered yet
   (for example «Кубок Smash Arena (открытый)») → **«Записаться»**. The counter grows by one and the status becomes «Вы записаны».
   **«Отменить запись»** returns the place.
5. Open another player's profile from the rating list: the block **«Личные встречи со мной»** appears
   (score of personal meetings, if they have played).
6. Optional: switch to **«Новичок»** and try to register for «Турнир 1100–1400» — the site explains that the rating is below the limit.

What to say: two players cannot book the same table for the same time — the second one gets a message that the slot was just taken
(this is checked in the database, not only on the screen).

### Act 3 — Organiser: «what the club gets» (7 min)

1. Choose **«Организатор клуба»**. The **club cabinet** of Smash Arena opens.
2. **«Турниры»** → **«+ Создать турнир»**:
   - type a name, keep the date and time, choose a format in **«Формат»**;
   - change **«Макс. участников»** (for example 16 → 30) — the **«Предпросмотр»** on the right recalculates
     groups, bracket size, number of matches and duration;
   - **«Создать черновик»** → **«Опубликовать»**. The tournament appears on the public site, and its tables are
     closed for booking for the time of the tournament.
   - On the tournament page use **«Записать вручную»**: type a surname, click the player — they are in the list.
3. **«Брони»** — tables × hours grid for the day:
   - blocks are bookings; dashed blocks are tournaments and trainings;
   - click an **empty cell** → **«Бронь по звонку»**: type the guest's name (or find a player) → «Забронировать»;
   - click a **booking** → **«Пришёл»** / **«Не пришёл»** / **«Отменить бронь»**;
   - arrows next to the date move to another day.
4. **«Игроки»**: everyone who played or booked at the club. **«+ Новый игрок»** creates a profile for a person
   without an account; the site gives a code with which the player later takes the profile.
5. **«Клуб и зал»**: club description, address, opening hours by weekday, tables (which are bookable, price per hour),
   booking rules (slot length, minimum and maximum duration, free cancellation).
6. Switch to **«Администратор зала»**: only «Брони» and «Игроки» are left in the menu. This is the helper-rights idea.

## 5. What is not in the demo — and how to answer

These sections are planned for the next stages. In the club cabinet they are listed under **«В разработке»**.

| If the client asks about | Answer |
|---|---|
| Online payment, commission, payouts to clubs | Payment goes through a replaceable adapter; in the demo it is «оплата в клубе». The provider is connected at stage 4 |
| Running a tournament live: tables screen, calls to the table, score entry, TV page | Stage 2. The engine that builds groups, brackets and places already works — the finished tournaments in the demo were played through it |
| Telegram bot and push notifications | Stage 3 |
| QR check-in at the hall | Stage 2 |
| Doubles, team tournaments, leagues and seasons | Stage 5 |
| Transfer of rating from RTTF | Stage 1 |
| Helpers: inviting and ticking rights | Stage 1. The demo already shows a helper with limited rights |
| Hall plan editor (drawing the hall) | Stage 6. In the demo the plan is ready-made |
| Platform administrator area, finance reports | Stages 4 and 6 |
| Sign-in with Google, Kazakh and English interface | Stage 1; the texts are already separated for translation |

## 6. Things to know before you start

- **Do not use the browser «Back» button to change the role** — use the «Войти как…» switcher.
- The **«Идут сейчас»** tournament shows the participants and the group tables; its bracket is empty until the groups finish,
  and the score cannot be entered from the site yet. For a full bracket open a finished tournament.
- A player with the **«К»** mark has a rating that is still being calibrated (few rated matches).
- The city selector in the top bar affects the home page and is the starting filter for tournaments and clubs.
- If a page shows «Не удалось загрузить данные», the API window (`npm run dev`) was closed — start it again and press «Повторить».
- If dates look old or the «running now» tournament is missing, `npm run demo:reset` was not run today.
- After a rehearsal run `npm run demo:reset` again, otherwise the client will see your test tournaments and bookings.
