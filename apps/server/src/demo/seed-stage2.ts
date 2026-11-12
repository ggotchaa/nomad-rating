// Stage 2 demo additions: a tournament starting soon with check-in open (QR, seeding, «Старт»)
// and a series of the Smash Arena weekend tournaments.

import { db } from '../db/index.ts'
import { createTournament, publishTournament, registerPlayer } from '../modules/tournaments.ts'

export async function seedStage2(): Promise<void> {
  const club = await db.selectFrom('clubs').select(['id']).where('slug', '=', 'smash-arena').executeTakeFirst()
  if (!club) return
  const organizer = await db.selectFrom('club_members').select('user_id').where('club_id', '=', club.id).where('role', '=', 'organizer').executeTakeFirstOrThrow()
  const hall = await db.selectFrom('halls').select('id').where('club_id', '=', club.id).orderBy('id').executeTakeFirstOrThrow()
  const series = await db.insertInto('series').values({ club_id: club.id, name: 'Субботняя лига Smash Arena' }).returning('id').executeTakeFirstOrThrow()
  await db.updateTable('tournaments').set({ series_id: series.id }).where('club_id', '=', club.id).where('title', 'like', 'Субботний%').execute()

  const startsAt = new Date(Date.now() + 40 * 60000)
  await db.transaction().execute(async (trx) => {
    const t = await createTournament(trx, club.id, organizer.user_id, {
      hallId: hall.id,
      title: 'Вечерний турнир (чек-ин открыт)',
      startsAt: startsAt.toISOString(),
      template: 'gs2',
      templateParams: { advance: 4 },
      maxParticipants: 12,
      minParticipants: 4,
      fee: 0,
      restrictions: {},
      prizes: '',
      description: 'Отметьтесь по QR-коду у стола регистрации, затем организатор подтверждает посев и нажимает «Старт».',
      commentForPlayers: '',
      staffComment: '',
      isRated: true,
      settings: { checkinWindowMinutes: 90, restMinutes: 5 },
    })
    await publishTournament(trx, t.id, organizer.user_id)
    const busy = trx
      .selectFrom('entries as e')
      .innerJoin('tournaments as o', 'o.id', 'e.tournament_id')
      .select('e.player_id')
      .where('o.status', 'in', ['published', 'registration_closed', 'running'])
      .where('o.starts_at', '<', new Date(startsAt.getTime() + 4 * 3600000))
    const players = await trx.selectFrom('players').select('id').where('id', 'not in', busy).where('user_id', 'is', null).orderBy('id').limit(10).execute()
    for (const [i, p] of players.entries()) {
      const r = await registerPlayer(trx, t.id, p.id, organizer.user_id, { byClub: true })
      if (i < 6 && r.status === 'paid') await trx.updateTable('entries').set({ status: 'checked_in', checked_in_at: new Date() }).where('id', '=', r.entryId).execute()
    }
  })
}
