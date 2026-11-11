// WebSocket gateway on /ws. Clients send {"type":"subscribe","room":"hall:3"}; the server forwards
// bus events of subscribed rooms. Public rooms: tournament:*, hall:*. Private: user:{own id}, club:{member}.

import type { IncomingMessage, Server } from 'node:http'
import { WebSocketServer } from 'ws'
import type { WebSocket } from 'ws'
import { db } from '../db/index.ts'
import { logger } from '../logger.ts'
import { SESSION_COOKIE, userFromToken } from '../auth/sessions.ts'
import type { SessionUser } from '../auth/sessions.ts'
import { bus } from './bus.ts'

const PUBLIC_ROOM = /^(tournament|hall):\d+$/

function cookieValue(req: IncomingMessage, name: string): string | undefined {
  const header = req.headers.cookie ?? ''
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return undefined
}

async function mayJoin(user: SessionUser | undefined, room: string): Promise<boolean> {
  if (PUBLIC_ROOM.test(room)) return true
  if (!user) return false
  if (room === `user:${user.id}`) return true
  const club = /^club:(\d+)$/.exec(room)
  if (club) {
    const member = await db
      .selectFrom('club_members')
      .select('user_id')
      .where('club_id', '=', Number(club[1]))
      .where('user_id', '=', user.id)
      .executeTakeFirst()
    return Boolean(member)
  }
  return false
}

export function attachGateway(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws' })
  const rooms = new Map<WebSocket, Set<string>>()

  bus.subscribe((event) => {
    const payload = JSON.stringify({ type: event.type, room: event.room, data: event.data })
    for (const [socket, joined] of rooms) if (joined.has(event.room) && socket.readyState === socket.OPEN) socket.send(payload)
  })

  wss.on('connection', async (socket, req) => {
    rooms.set(socket, new Set())
    const user = await userFromToken(cookieValue(req, SESSION_COOKIE)).catch(() => undefined)
    if (user) rooms.get(socket)?.add(`user:${user.id}`)
    socket.on('message', async (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as { type?: string; room?: string }
        if (typeof msg.room !== 'string') return
        if (msg.type === 'subscribe') {
          if (await mayJoin(user, msg.room)) {
            rooms.get(socket)?.add(msg.room)
            socket.send(JSON.stringify({ type: 'subscribed', room: msg.room }))
          } else socket.send(JSON.stringify({ type: 'error', error: 'room.forbidden', room: msg.room }))
        } else if (msg.type === 'unsubscribe') rooms.get(socket)?.delete(msg.room)
      } catch {
        socket.send(JSON.stringify({ type: 'error', error: 'message.invalid' }))
      }
    })
    socket.on('close', () => rooms.delete(socket))
    socket.on('error', (err) => logger.debug({ err }, 'ws error'))
  })
  return wss
}
