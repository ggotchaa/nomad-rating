// Development and e2e accounts created by `npm run dev:reset` (password for all: DEV_PASSWORD).

export const DEV_PASSWORD = 'nomad-dev-2026'

export const DEV_ACCOUNTS = [
  {
    key: 'player',
    role: 'player',
    title: 'Игрок',
    description: 'Любитель из Алматы с рейтингом и историей турниров',
    email: 'player@dev.nomad.test',
  },
  {
    key: 'newbie',
    role: 'player',
    title: 'Новичок',
    description: 'Только зарегистрировался, проходит калибровку',
    email: 'newbie@dev.nomad.test',
  },
  {
    key: 'organizer',
    role: 'organizer',
    title: 'Организатор клуба',
    description: 'Организатор клуба «Smash Arena» (Алматы)',
    email: 'organizer@dev.nomad.test',
  },
  {
    key: 'hall_admin',
    role: 'helper',
    title: 'Администратор зала',
    description: 'Помощник с правами «Брони» и «Игроки»',
    email: 'hall@dev.nomad.test',
  },
  {
    key: 'referee',
    role: 'helper',
    title: 'Судья',
    description: 'Помощник с правом «Проведение» только на ближайший турнир',
    email: 'referee@dev.nomad.test',
  },
  {
    key: 'manager',
    role: 'helper',
    title: 'Менеджер турниров',
    description: 'Помощник по шаблону «Менеджер турниров»: турниры, проведение, исправление счёта, игроки',
    email: 'manager@dev.nomad.test',
  },
  {
    key: 'accountant',
    role: 'helper',
    title: 'Бухгалтер клуба',
    description: 'Помощник по шаблону «Бухгалтер»: только просмотр финансов',
    email: 'accountant@dev.nomad.test',
  },
  {
    key: 'rttf',
    role: 'player',
    title: 'Игрок с профилем RTTF',
    description: 'Без матчей, может перенести рейтинг RTTF («Это я»)',
    email: 'rttf@dev.nomad.test',
  },
  {
    key: 'new_club',
    role: 'organizer',
    title: 'Новый клуб на проверке',
    description: 'Организатор клуба «Ping Pong Lab» (статус «На проверке»)',
    email: 'newclub@dev.nomad.test',
  },
  {
    key: 'admin',
    role: 'admin',
    title: 'Администратор платформы',
    description: 'Владелец сервиса',
    email: 'admin@dev.nomad.test',
  },
] as const
