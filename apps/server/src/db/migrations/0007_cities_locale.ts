import { sql } from 'kysely'
import type { Kysely } from 'kysely'

// Reference list of Kazakhstan cities (cities of republican significance, regional centres, large towns)
// and users.locale = explicit choice only (NULL → the site default, Kazakh).

type City = [slug: string, ru: string, kk: string, en: string, region: string, tz?: string]
type Region = [ru: string, kk: string, en: string]

const REGIONS: Record<string, Region> = {
  astana: ['г. Астана', 'Астана қ.', 'Astana city'],
  almaty_city: ['г. Алматы', 'Алматы қ.', 'Almaty city'],
  shymkent_city: ['г. Шымкент', 'Шымкент қ.', 'Shymkent city'],
  abai: ['область Абай', 'Абай облысы', 'Abai Region'],
  akmola: ['Акмолинская область', 'Ақмола облысы', 'Akmola Region'],
  aktobe: ['Актюбинская область', 'Ақтөбе облысы', 'Aktobe Region'],
  almaty: ['Алматинская область', 'Алматы облысы', 'Almaty Region'],
  atyrau: ['Атырауская область', 'Атырау облысы', 'Atyrau Region'],
  east: ['Восточно-Казахстанская область', 'Шығыс Қазақстан облысы', 'East Kazakhstan Region'],
  zhambyl: ['Жамбылская область', 'Жамбыл облысы', 'Zhambyl Region'],
  zhetysu: ['область Жетісу', 'Жетісу облысы', 'Zhetysu Region'],
  west: ['Западно-Казахстанская область', 'Батыс Қазақстан облысы', 'West Kazakhstan Region'],
  karaganda: ['Карагандинская область', 'Қарағанды облысы', 'Karaganda Region'],
  kostanay: ['Костанайская область', 'Қостанай облысы', 'Kostanay Region'],
  kyzylorda: ['Кызылординская область', 'Қызылорда облысы', 'Kyzylorda Region'],
  mangystau: ['Мангистауская область', 'Маңғыстау облысы', 'Mangystau Region'],
  pavlodar: ['Павлодарская область', 'Павлодар облысы', 'Pavlodar Region'],
  north: ['Северо-Казахстанская область', 'Солтүстік Қазақстан облысы', 'North Kazakhstan Region'],
  turkistan: ['Туркестанская область', 'Түркістан облысы', 'Turkistan Region'],
  ulytau: ['область Ұлытау', 'Ұлытау облысы', 'Ulytau Region'],
}

const CITIES: City[] = [
  ['almaty', 'Алматы', 'Алматы', 'Almaty', 'almaty_city'],
  ['astana', 'Астана', 'Астана', 'Astana', 'astana'],
  ['shymkent', 'Шымкент', 'Шымкент', 'Shymkent', 'shymkent_city'],
  ['karaganda', 'Караганда', 'Қарағанды', 'Karaganda', 'karaganda'],
  ['aktobe', 'Актобе', 'Ақтөбе', 'Aktobe', 'aktobe', 'Asia/Aqtobe'],
  ['taraz', 'Тараз', 'Тараз', 'Taraz', 'zhambyl'],
  ['pavlodar', 'Павлодар', 'Павлодар', 'Pavlodar', 'pavlodar'],
  ['oskemen', 'Усть-Каменогорск', 'Өскемен', 'Oskemen', 'east'],
  ['semey', 'Семей', 'Семей', 'Semey', 'abai'],
  ['atyrau', 'Атырау', 'Атырау', 'Atyrau', 'atyrau', 'Asia/Atyrau'],
  ['kostanay', 'Костанай', 'Қостанай', 'Kostanay', 'kostanay', 'Asia/Qostanay'],
  ['kyzylorda', 'Кызылорда', 'Қызылорда', 'Kyzylorda', 'kyzylorda', 'Asia/Qyzylorda'],
  ['oral', 'Уральск', 'Орал', 'Oral', 'west', 'Asia/Oral'],
  ['petropavl', 'Петропавловск', 'Петропавл', 'Petropavl', 'north'],
  ['aktau', 'Актау', 'Ақтау', 'Aktau', 'mangystau', 'Asia/Aqtau'],
  ['turkistan', 'Туркестан', 'Түркістан', 'Turkistan', 'turkistan'],
  ['kokshetau', 'Кокшетау', 'Көкшетау', 'Kokshetau', 'akmola'],
  ['taldykorgan', 'Талдыкорган', 'Талдықорған', 'Taldykorgan', 'zhetysu'],
  ['konaev', 'Конаев', 'Қонаев', 'Konaev', 'almaty'],
  ['zhezkazgan', 'Жезказган', 'Жезқазған', 'Zhezkazgan', 'ulytau'],
  ['temirtau', 'Темиртау', 'Теміртау', 'Temirtau', 'karaganda'],
  ['ekibastuz', 'Экибастуз', 'Екібастұз', 'Ekibastuz', 'pavlodar'],
  ['rudny', 'Рудный', 'Рудный', 'Rudny', 'kostanay', 'Asia/Qostanay'],
  ['zhanaozen', 'Жанаозен', 'Жаңаөзен', 'Zhanaozen', 'mangystau', 'Asia/Aqtau'],
  ['balkhash', 'Балхаш', 'Балқаш', 'Balkhash', 'karaganda'],
  ['satpayev', 'Сатпаев', 'Сәтбаев', 'Satpayev', 'ulytau'],
  ['kaskelen', 'Каскелен', 'Қаскелең', 'Kaskelen', 'almaty'],
  ['kentau', 'Кентау', 'Кентау', 'Kentau', 'turkistan'],
  ['saryagash', 'Сарыагаш', 'Сарыағаш', 'Saryagash', 'turkistan'],
  ['ridder', 'Риддер', 'Риддер', 'Ridder', 'east'],
  ['stepnogorsk', 'Степногорск', 'Степногорск', 'Stepnogorsk', 'akmola'],
  ['shchuchinsk', 'Щучинск', 'Щучинск', 'Shchuchinsk', 'akmola'],
  ['zharkent', 'Жаркент', 'Жаркент', 'Zharkent', 'zhetysu'],
  ['aksu', 'Аксу', 'Ақсу', 'Aksu', 'pavlodar'],
  ['kulsary', 'Кульсары', 'Құлсары', 'Kulsary', 'atyrau', 'Asia/Atyrau'],
  ['aksay', 'Аксай', 'Ақсай', 'Aksay', 'west', 'Asia/Oral'],
]

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE cities ADD COLUMN region_kk text NOT NULL DEFAULT '', ADD COLUMN region_en text NOT NULL DEFAULT '';
    ALTER TABLE users ALTER COLUMN locale DROP NOT NULL, ALTER COLUMN locale DROP DEFAULT;
    UPDATE users SET locale = NULL;
  `.execute(db)
  for (const [i, [slug, ru, kk, en, region, tz]] of CITIES.entries()) {
    const [rru, rkk, ren] = REGIONS[region]!
    await sql`
      INSERT INTO cities (slug, name_ru, name_kk, name_en, region_ru, region_kk, region_en, timezone, sort_order)
      VALUES (${slug}, ${ru}, ${kk}, ${en}, ${rru}, ${rkk}, ${ren}, ${tz ?? 'Asia/Almaty'}, ${i + 1})
      ON CONFLICT (slug) DO UPDATE SET name_ru = EXCLUDED.name_ru, name_kk = EXCLUDED.name_kk, name_en = EXCLUDED.name_en,
        region_ru = EXCLUDED.region_ru, region_kk = EXCLUDED.region_kk, region_en = EXCLUDED.region_en,
        timezone = EXCLUDED.timezone, sort_order = EXCLUDED.sort_order
    `.execute(db)
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    UPDATE users SET locale = 'ru' WHERE locale IS NULL;
    ALTER TABLE users ALTER COLUMN locale SET DEFAULT 'ru', ALTER COLUMN locale SET NOT NULL;
    ALTER TABLE cities DROP COLUMN region_kk, DROP COLUMN region_en;
  `.execute(db)
}
