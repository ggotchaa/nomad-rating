// Transactional e-mail: SMTP when SMTP_URL is set, otherwise printed to the console (development).

import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
import { config } from '../config.ts'
import { logger } from '../logger.ts'

export type Mail = { to: string; subject: string; text: string }

let transport: Transporter | null = null

export async function sendMail(mail: Mail): Promise<void> {
  if (!config.SMTP_URL) {
    console.log(`\n--- e-mail to ${mail.to} ---\nSubject: ${mail.subject}\n\n${mail.text}\n--- end ---\n`)
    return
  }
  transport ??= nodemailer.createTransport(config.SMTP_URL)
  try {
    await transport.sendMail({ from: config.MAIL_FROM, ...mail })
  } catch (err) {
    logger.error({ err, to: mail.to }, 'mail failed')
  }
}

export const siteLink = (path: string) => `${config.SITE_URL.replace(/\/$/, '')}${path}`

export const mails = {
  confirmEmail: (to: string, token: string): Mail => ({
    to,
    subject: 'Nomad: подтвердите e-mail',
    text: `Подтвердите адрес, перейдя по ссылке:\n${siteLink(`/confirm-email?token=${token}`)}\n\nСсылка действует 48 часов.`,
  }),
  resetPassword: (to: string, token: string): Mail => ({
    to,
    subject: 'Nomad: восстановление пароля',
    text: `Чтобы задать новый пароль, перейдите по ссылке:\n${siteLink(`/reset-password?token=${token}`)}\n\nСсылка действует 1 час. Если вы не запрашивали сброс, просто проигнорируйте письмо.`,
  }),
  invitation: (to: string, club: string, token: string): Mail => ({
    to,
    subject: `Nomad: приглашение в клуб «${club}»`,
    text: `Вас пригласили помощником в клуб «${club}».\nПринять приглашение:\n${siteLink(`/invite/${token}`)}`,
  }),
}
