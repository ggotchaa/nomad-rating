// Demo accounts created by `npm run demo:reset` (password for all: DEMO_PASSWORD).

export const DEMO_PASSWORD = 'nomad-demo-2026'

export const DEMO_ACCOUNTS = [
  {
    key: 'player',
    role: 'player',
    title: 'Игрок',
    description: 'Любитель из Алматы с рейтингом и историей турниров',
    email: 'player@demo.nomad.kz',
  },
  {
    key: 'newbie',
    role: 'player',
    title: 'Новичок',
    description: 'Только зарегистрировался, проходит калибровку',
    email: 'newbie@demo.nomad.kz',
  },
  {
    key: 'organizer',
    role: 'organizer',
    title: 'Организатор клуба',
    description: 'Организатор клуба «Smash Arena» (Алматы)',
    email: 'organizer@demo.nomad.kz',
  },
  {
    key: 'hall_admin',
    role: 'helper',
    title: 'Администратор зала',
    description: 'Помощник с правами «Брони» и «Игроки»',
    email: 'hall@demo.nomad.kz',
  },
  {
    key: 'admin',
    role: 'admin',
    title: 'Администратор платформы',
    description: 'Владелец сервиса',
    email: 'admin@demo.nomad.kz',
  },
] as const
