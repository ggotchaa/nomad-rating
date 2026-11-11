import { createServer } from 'node:http'
import { config } from './config.ts'
import { db } from './db/index.ts'
import { migrateToLatest } from './db/migrate.ts'
import { createApp } from './http/app.ts'
import { logger } from './logger.ts'
import { bus } from './realtime/bus.ts'
import { attachGateway } from './realtime/gateway.ts'

await migrateToLatest()

const server = createServer(createApp())
const wss = attachGateway(server)

server.listen(config.PORT, config.HOST, () => {
  logger.info(`API on http://${config.HOST}:${config.PORT}/api  (WebSocket /ws, demo mode: ${config.DEMO_MODE})`)
})

async function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down')
  wss.close()
  server.close()
  await bus.close()
  await db.destroy()
  process.exit(0)
}
process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
