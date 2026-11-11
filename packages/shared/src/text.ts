// Name search and slugs. Search ignores case, «ё»/«е» and word order (spec R-15).

const TRANSLIT: Record<string, string> = {
  а: 'a', ә: 'a', б: 'b', в: 'v', г: 'g', ғ: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', қ: 'q', л: 'l', м: 'm', н: 'n', ң: 'n', о: 'o', ө: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u',
  ұ: 'u', ү: 'u', ф: 'f', х: 'kh', һ: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', і: 'i',
  ь: '', э: 'e', ю: 'yu', я: 'ya',
}

export function transliterate(value: string): string {
  return [...value.toLowerCase()].map((ch) => TRANSLIT[ch] ?? ch).join('')
}

/** Lower case, «ё» → «е», single spaces. */
export function normalizeText(value: string): string {
  return value.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim()
}

/** Stored in players.search_name: «фамилия имя отчество» normalised. */
export function searchName(parts: { lastName: string; firstName: string; middleName?: string | null }): string {
  return normalizeText([parts.lastName, parts.firstName, parts.middleName ?? ''].join(' '))
}

/** Query words for an order-independent search. */
export function searchWords(query: string): string[] {
  return normalizeText(query)
    .split(' ')
    .filter((w) => w.length > 0)
}

export function slugify(value: string, maxLength = 60): string {
  return transliterate(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '')
}
