import '@fontsource/unbounded/400.css'
import '@fontsource/unbounded/700.css'
import '@fontsource/unbounded/900.css'
import '@fontsource-variable/manrope'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import './styles/global.css'

import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router'
import { AppShell } from './app/AppShell.tsx'
import { SessionProvider } from './app/auth.tsx'
import { Login, Register } from './features/account/Auth.tsx'
import { Cabinet } from './features/account/Cabinet.tsx'
import { Booking } from './features/booking/Booking.tsx'
import { ClubPage } from './features/clubs/ClubPage.tsx'
import { Clubs } from './features/clubs/Clubs.tsx'
import { Home } from './features/home/Home.tsx'
import { BookingDesk } from './features/manage/BookingDesk.tsx'
import { HallSettings } from './features/manage/HallSettings.tsx'
import { Guard, ManageIndex, ManageLayout, ManageMore } from './features/manage/ManageLayout.tsx'
import { ManagePlayers } from './features/manage/ManagePlayers.tsx'
import { ManageTournamentPage, ManageTournaments, NewTournament } from './features/manage/ManageTournaments.tsx'
import { Profile } from './features/players/Profile.tsx'
import { RatingList } from './features/players/RatingList.tsx'
import { Calendar } from './features/tournaments/Calendar.tsx'
import { TournamentPage } from './features/tournaments/TournamentPage.tsx'
import { Notifications } from './features/notifications/Notifications.tsx'
import { MyTournament } from './features/rating/MyTournament.tsx'
import { t } from './i18n/index.ts'

const Landing = lazy(() => import('./features/landing/Landing.tsx').then((m) => ({ default: m.Landing })))

const router = createBrowserRouter([
  {
    path: '/',
    element: (
      <Suspense fallback={null}>
        <Landing />
      </Suspense>
    ),
  },
  {
    element: <AppShell />,
    children: [
      { path: 'home', element: <Home /> },
      { path: 'tournaments', element: <Calendar /> },
      { path: 't/:slug', element: <TournamentPage /> },
      { path: 'rating', element: <RatingList /> },
      { path: 'players/:id', element: <Profile /> },
      { path: 'clubs', element: <Clubs /> },
      { path: 'club/:slug', element: <ClubPage /> },
      { path: 'club/:slug/booking', element: <Booking /> },
      { path: 'bookings/:id', element: <Navigate to="/me" replace /> },
      { path: 'login', element: <Login /> },
      { path: 'register', element: <Register /> },
      { path: 'me', element: <Cabinet /> },
      { path: 'me/t/:slug', element: <MyTournament /> },
      { path: 'notifications', element: <Notifications /> },
      {
        path: 'manage',
        element: <ManageLayout />,
        children: [
          { index: true, element: <ManageIndex /> },
          { path: 'tournaments', element: <Guard right="tournaments"><ManageTournaments /></Guard> },
          { path: 'tournaments/new', element: <Guard right="tournaments"><NewTournament /></Guard> },
          { path: 'tournaments/:id', element: <Guard right="tournaments"><ManageTournamentPage /></Guard> },
          { path: 'bookings', element: <Guard right="bookings"><BookingDesk /></Guard> },
          { path: 'players', element: <Guard right="players"><ManagePlayers /></Guard> },
          { path: 'settings', element: <Guard right="club"><HallSettings /></Guard> },
          { path: 'more', element: <ManageMore /> },
        ],
      },
      { path: '*', element: <main className="page"><p className="empty">{t.common.notFound}</p></main> },
    ],
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SessionProvider>
      <RouterProvider router={router} />
    </SessionProvider>
  </StrictMode>,
)
