// Reading uploaded CSV / XLSX files into rows of strings (player import, RTTF base).

import express from 'express'
import ExcelJS from 'exceljs'
import { badRequest } from '../http/errors.ts'

export const TABLE_UPLOAD_TYPES = ['text/csv', 'text/plain', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream']

export const tableUpload = express.raw({ type: TABLE_UPLOAD_TYPES, limit: '10mb' })

export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, '')
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

const isZip = (buf: Buffer) => buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b

/** Rows of the first sheet (XLSX) or of the CSV, as trimmed strings. */
export async function readTable(body: unknown): Promise<string[][]> {
  if (!Buffer.isBuffer(body) || body.length === 0) throw badRequest('import.empty_file')
  if (!isZip(body)) return parseCsv(body.toString('utf8'))
  const book = new ExcelJS.Workbook()
  try {
    await book.xlsx.load(body as unknown as ArrayBuffer)
  } catch {
    throw badRequest('import.bad_file')
  }
  const sheet = book.worksheets[0]
  if (!sheet) throw badRequest('import.empty_file')
  const rows: string[][] = []
  sheet.eachRow((r) => {
    const values = (r.values as unknown[]).slice(1)
    rows.push(values.map((v) => cellText(v)))
  })
  return rows.filter((r) => r.some((c) => c))
}

function cellText(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'object') {
    const o = v as { text?: string; result?: unknown; richText?: { text: string }[] }
    if (o.richText) return o.richText.map((t) => t.text).join('').trim()
    if (o.text != null) return String(o.text).trim()
    if (o.result != null) return String(o.result).trim()
    if (v instanceof Date) return v.toISOString().slice(0, 10)
  }
  return String(v).trim()
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
