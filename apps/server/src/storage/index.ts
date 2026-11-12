// File storage behind one function so S3 can replace the local disk later.

import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { config } from '../config.ts'

export const UPLOADS_ROOT = path.resolve(config.UPLOADS_DIR)
export const UPLOADS_URL = '/api/uploads'

export const IMAGE_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024

/** Stores the file and returns its public URL. */
export async function saveFile(folder: string, data: Buffer, ext: string): Promise<string> {
  const name = `${Date.now().toString(36)}-${randomBytes(6).toString('hex')}.${ext}`
  await mkdir(path.join(UPLOADS_ROOT, folder), { recursive: true })
  await writeFile(path.join(UPLOADS_ROOT, folder, name), data)
  return `${UPLOADS_URL}/${folder}/${name}`
}
