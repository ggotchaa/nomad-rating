import { api } from '../../api/client.ts'

export const pushSupported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
export const isIos = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent)
export const isStandalone =
  typeof window !== 'undefined' && (window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true)

const keyBytes = (base64: string) => {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
}

const registration = () => navigator.serviceWorker.register('/sw.js')

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported) return null
  const reg = await navigator.serviceWorker.getRegistration('/sw.js')
  return (await reg?.pushManager.getSubscription()) ?? null
}

export async function enablePush(publicKey: string): Promise<'ok' | 'denied'> {
  if ((await Notification.requestPermission()) !== 'granted') return 'denied'
  const reg = await registration()
  await navigator.serviceWorker.ready
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }))
  await api('/notifications/push', { method: 'POST', json: sub.toJSON() })
  return 'ok'
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription()
  if (!sub) return
  await api('/notifications/push', { method: 'DELETE', json: { endpoint: sub.endpoint } })
  await sub.unsubscribe()
}
