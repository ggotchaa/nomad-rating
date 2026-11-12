// Reading uploaded CSV / XLSX files into rows of strings (player import, RTTF base).

import express from 'express'
import ExcelJS from 'exceljs'
import { badRequest } from '../http/errors.ts'
import { parseCsv } from './table-text.ts'

export { headerIndex } from './table-text.ts'

export const TABLE_UPLOAD_TYPES = ['text/csv', 'text/plain', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream']

export const tableUpload = express.raw({ type: TABLE_UPLOAD_TYPES, limit: '10mb' })

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
