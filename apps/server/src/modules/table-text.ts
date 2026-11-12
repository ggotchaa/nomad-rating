// Pure helpers for tabular uploads.

export function parseCsv(text: string): string[][] {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const firstLine = clean.slice(0, clean.indexOf('\n') >>> 0)
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ','
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]!
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === sep) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell || row.length) rows.push([...row, cell])
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c))
}

/** Maps header names (any case, RU/EN aliases) to column indexes. */
export function headerIndex<K extends string>(header: string[], aliases: Record<K, string[]>): Partial<Record<K, number>> {
  const norm = header.map((h) => h.toLowerCase().replace(/ё/g, 'е').replace(/[\s_\-.]+/g, ''))
  const out: Partial<Record<K, number>> = {}
  for (const [key, names] of Object.entries(aliases) as [K, string[]][]) {
    const i = norm.findIndex((h) => names.includes(h))
    if (i >= 0) out[key] = i
  }
  return out
}
