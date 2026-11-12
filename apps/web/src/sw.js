// Service worker (built by vite-plugin-pwa, injectManifest): shows Web Push notifications and opens the link on click.
/* global self, caches */

const manifest = self.__WB_MANIFEST
const CACHE = 'nomad-shell-v1'

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(manifest.map((e) => e.url).filter((u) => !u.endsWith('.map')))).catch(() => undefined))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('push', (event) => {
  let data
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title: 'Nomad', body: event.data ? event.data.text() : '' }
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Nomad', {
      body: data.body || '',
      tag: data.tag,
      renotify: Boolean(data.tag),
      requireInteraction: Boolean(data.urgent),
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      data: { url: data.url || '/me' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/me'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) if (c.url.startsWith(self.location.origin) && 'focus' in c) return c.navigate(url).then((w) => w?.focus())
      return self.clients.openWindow(url)
    }),
  )
})
