import { logger } from '../logger.ts'

/** Placeholder sender: swap for the mail module (stage 1) by replacing this function. */
export async function sendEmail(message: { to: string; subject: string; text: string }): Promise<void> {
  logger.info({ to: message.to, subject: message.subject }, `email (console): ${message.text}`)
}
