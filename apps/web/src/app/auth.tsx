import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../api/client.ts'
import type { City, Me } from '../api/types.ts'
import { adoptUserLocale, switchLocale } from '../i18n/locale.ts'
import type { Locale } from '../i18n/locale.ts'
import { useStored } from './hooks.ts'

const GUEST: Me = { user: null, player: null, clubs: [] }

type Session = {
  me: Me
  ready: boolean
  cities: City[]
  city: string
  setCity: (slug: string) => void
  setMe: (me: Me) => void
  logout: () => Promise<void>
  setActiveClub: (clubId: number) => Promise<void>
  changeLocale: (next: Locale) => Promise<void>
}

const Ctx = createContext<Session | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me>(GUEST)
  const [ready, setReady] = useState(false)
  const [cities, setCities] = useState<City[]>([])
  const [city, setCity] = useStored('nomad.city', 'almaty')

  useEffect(() => {
    api<Me>('/auth/me')
      .then(setMe)
      .catch(() => {})
      .finally(() => setReady(true))
    api<City[]>('/cities')
      .then(setCities)
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (me.user) adoptUserLocale(me.user.locale)
  }, [me.user])

  const changeLocale = useCallback(
    async (next: Locale) => {
      if (me.user) await api('/my/locale', { method: 'PUT', json: { locale: next } }).catch(() => {})
      switchLocale(next)
    },
    [me.user],
  )

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' })
    setMe(GUEST)
  }, [])

  const setActiveClub = useCallback(async (clubId: number) => {
    await api('/my/active-club', { method: 'PUT', json: { clubId } })
    setMe((m) => ({ ...m, activeClubId: clubId }))
  }, [])

  const value = useMemo(() => ({ me, ready, cities, city, setCity, setMe, logout, setActiveClub, changeLocale }), [me, ready, cities, city, setCity, logout, setActiveClub, changeLocale])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSession(): Session {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('SessionProvider is missing')
  return ctx
}
