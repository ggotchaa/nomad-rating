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
import { BookingIndex } from './features/booking/BookingIndex.tsx'
import { ClubPage } from './features/clubs/ClubPage.tsx'
import { Clubs } from './features/clubs/Clubs.tsx'
import { Home } from './features/home/Home.tsx'
import { BookingDesk } from './features/manage/BookingDesk.tsx'
import { HallSettings } from './features/manage/HallSettings.tsx'
import { Guard, ManageIndex, ManageLayout } from './features/manage/ManageLayout.tsx'
import { ManagePlayers } from './features/manage/ManagePlayers.tsx'
import { ManageTournamentPage, ManageTournaments, NewTournament } from './features/manage/ManageTournaments.tsx'
import { Profile } from './features/players/Profile.tsx'
import { RatingList } from './features/players/RatingList.tsx'
import { Calendar } from './features/tournaments/Calendar.tsx'
import { TournamentPage } from './features/tournaments/TournamentPage.tsx'
import { Notifications } from './features/notifications/Notifications.tsx'
import { MyTournament } from './features/rating/MyTournament.tsx'
import { ConductPage } from './features/conduct/ConductPage.tsx'
import { CheckinPage, CheckinQrScreen } from './features/conduct/Checkin.tsx'
import { LivePage } from './features/live/LivePage.tsx'
import { t } from './i18n/index.ts'
import { AcceptInvitation, ConfirmEmail, ForgotPassword, MfaVerify, ProfileEdit, ResetPassword, Security, Welcome } from './features/account/AccountFlows.tsx'
import { RttfClaim } from './features/account/Rttf.tsx'
import { RegisterClub } from './features/clubs/RegisterClub.tsx'
import { ClubSettings } from './features/manage/ClubSettings.tsx'
import { Helpers, ManageAudit } from './features/manage/Helpers.tsx'
import { ImportPlayers } from './features/manage/ImportPlayers.tsx'
import { AdminIndex, AdminLayout } from './features/admin/AdminLayout.tsx'
import { AdminClubs, AdminMerges, AdminRttf } from './features/admin/AdminQueues.tsx'
import { AdminAudit, AdminDisputes, AdminPlayers, AdminSettings, AdminViewAs } from './features/admin/AdminTools.tsx'
import { CancelBooking } from './features/booking/CancelBooking.tsx'
import { JoinTeam, MyTeams } from './features/teams/Teams.tsx'
import { MeetingPage } from './features/teams/Meeting.tsx'
import { LeaguePage, LeaguesList } from './features/leagues/Leagues.tsx'
import { ManageLeagues } from './features/leagues/ManageLeagues.tsx'

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
      { path: 't/:slug/live', element: <LivePage /> },
      { path: 't/:slug/checkin', element: <CheckinPage /> },
      { path: 'rating', element: <RatingList /> },
      { path: 'players/:id', element: <Profile /> },
      { path: 'clubs', element: <Clubs /> },
      { path: 'booking', element: <BookingIndex /> },
      { path: 'clubs/new', element: <RegisterClub /> },
      { path: 'club/:slug', element: <ClubPage /> },
      { path: 'club/:slug/booking', element: <Booking /> },
      { path: 'booking/:token', element: <CancelBooking /> },
      { path: 'bookings/:id', element: <Navigate to="/me" replace /> },
      { path: 'login', element: <Login /> },
      { path: 'register', element: <Register /> },
      { path: 'me', element: <Cabinet /> },
      { path: 'me/t/:slug', element: <MyTournament /> },
      { path: 'notifications', element: <Notifications /> },
      { path: 'me/profile', element: <ProfileEdit /> },
      { path: 'me/security', element: <Security /> },
      { path: 'me/rttf', element: <RttfClaim /> },
      { path: 'confirm-email', element: <ConfirmEmail /> },
      { path: 'forgot-password', element: <ForgotPassword /> },
      { path: 'reset-password', element: <ResetPassword /> },
      { path: 'welcome', element: <Welcome /> },
      { path: 'mfa', element: <MfaVerify /> },
      { path: 'invite/:token', element: <AcceptInvitation /> },
      { path: 'me/teams', element: <MyTeams /> },
      { path: 'teams/join/:token', element: <JoinTeam /> },
      { path: 'meeting/:tournamentId/:matchId', element: <MeetingPage /> },
      { path: 'leagues', element: <LeaguesList /> },
      { path: 'leagues/:slug', element: <LeaguePage /> },
      {
        path: 'admin',
        element: <AdminLayout />,
        children: [
          { index: true, element: <AdminIndex /> },
          { path: 'clubs', element: <AdminClubs /> },
          { path: 'merges', element: <AdminMerges /> },
          { path: 'rttf', element: <AdminRttf /> },
          { path: 'players', element: <AdminPlayers /> },
          { path: 'disputes', element: <AdminDisputes /> },
          { path: 'audit', element: <AdminAudit /> },
          { path: 'settings', element: <AdminSettings /> },
          { path: 'view-as', element: <AdminViewAs /> },
        ],
      },
      {
        path: 'manage',
        element: <ManageLayout />,
        children: [
          { index: true, element: <ManageIndex /> },
          { path: 'tournaments', element: <Guard right="tournaments"><ManageTournaments /></Guard> },
          { path: 'tournaments/new', element: <Guard right="tournaments"><NewTournament /></Guard> },
          { path: 'tournaments/:id', element: <Guard right="tournaments"><ManageTournamentPage /></Guard> },
          { path: 'tournaments/:id/conduct', element: <Guard right="conduct"><ConductPage /></Guard> },
          { path: 'tournaments/:id/qr', element: <Guard right="conduct"><CheckinQrScreen /></Guard> },
          { path: 'bookings', element: <Guard right="bookings"><BookingDesk /></Guard> },
          { path: 'players', element: <Guard right="players"><ManagePlayers /></Guard> },
          { path: 'settings', element: <Guard right="club"><HallSettings /></Guard> },
          { path: 'club', element: <ClubSettings /> },
          { path: 'import', element: <Guard right="players"><ImportPlayers /></Guard> },
          { path: 'helpers', element: <Guard right="organizer"><Helpers /></Guard> },
          { path: 'audit', element: <Guard right="organizer"><ManageAudit /></Guard> },
          { path: 'leagues', element: <Guard right="tournaments"><ManageLeagues /></Guard> },
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
