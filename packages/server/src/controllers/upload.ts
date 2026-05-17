import { randomBytes } from 'crypto'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import { config } from '../config'

const MAX_UPLOAD_SIZE = 50 * 1024 * 1024 // 50MB

export async function handleUpload(ctx: any) {
  const contentType = ctx.get('content-type') || ''
  if (!contentType.startsWith('multipart/form-data')) {
    ctx.status = 400; ctx.body = { error: 'Expected multipart/form-data' }; return
  }
  const boundary = '--' + contentType.split('boundary=')[1]
  if (!boundary || boundary === '--undefined') {
    ctx.status = 400; ctx.body = { error: 'Missing boundary' }; return
  }
  const chunks: Buffer[] = []
  let totalSize = 0
  for await (const chunk of ctx.req) {
    totalSize += chunk.length
    if (totalSize > MAX_UPLOAD_SIZE) {
      ctx.status = 413; ctx.body = { error: `File too large (max ${MAX_UPLOAD_SIZE / 1024 / 1024}MB)` }; return
    }
    chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks)
  const boundaryBuf = Buffer.from(boundary)
  const parts = splitMultipart(raw, boundaryBuf)
  const results: { name: string; path: string }[] = []
  for (const part of parts) {
    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'))
    if (headerEnd === -1) continue
    const headerBuf = part.subarray(0, headerEnd)
    const header = headerBuf.toString('utf-8')
    const data = part.subarray(headerEnd + 4, part.length - 2)
    let filename = ''
    const filenameStarMatch = header.match(/filename\*=UTF-8''(.+)/i)
    if (filenameStarMatch) { filename = decodeURIComponent(filenameStarMatch[1]) }
    else {
      const filenameMatch = header.match(/filename="([^"]+)"/)
      if (!filenameMatch) continue
      filename = filenameMatch[1]
    }
    const ext = filename.includes('.') ? '.' + filename.split('.').pop() : ''
    const savedName = randomBytes(8).toString('hex') + ext
    const savedPath = join(config.uploadDir, savedName)
    await writeFile(savedPath, data)
    results.push({ name: filename, path: savedPath })
  }
  ctx.body = { files: results }
}

const ALLOWED_ANIMATION_EXTS = new Set(['.gif', '.mp4', '.webm', '.png', '.jpg', '.jpeg', '.webp'])

export async function handleThinkingAnimationUpload(ctx: any) {
  const contentType = ctx.get('content-type') || ''
  if (!contentType.startsWith('multipart/form-data')) {
    ctx.status = 400; ctx.body = { error: 'Expected multipart/form-data' }; return
  }
  const boundary = '--' + contentType.split('boundary=')[1]
  if (!boundary || boundary === '--undefined') {
    ctx.status = 400; ctx.body = { error: 'Missing boundary' }; return
  }
  const chunks: Buffer[] = []
  let totalSize = 0
  for await (const chunk of ctx.req) {
    totalSize += chunk.length
    if (totalSize > MAX_UPLOAD_SIZE) {
      ctx.status = 413; ctx.body = { error: `File too large (max ${MAX_UPLOAD_SIZE / 1024 / 1024}MB)` }; return
    }
    chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks)
  const boundaryBuf = Buffer.from(boundary)
  const parts = splitMultipart(raw, boundaryBuf)
  for (const part of parts) {
    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'))
    if (headerEnd === -1) continue
    const header = part.subarray(0, headerEnd).toString('utf-8')
    const data = part.subarray(headerEnd + 4, part.length - 2)
    let filename = ''
    const filenameStarMatch = header.match(/filename\*=UTF-8''(.+)/i)
    if (filenameStarMatch) { filename = decodeURIComponent(filenameStarMatch[1]) }
    else {
      const filenameMatch = header.match(/filename="([^"]+)"/)
      if (!filenameMatch) continue
      filename = filenameMatch[1]
    }
    const ext = (filename.includes('.') ? '.' + filename.split('.').pop()! : '').toLowerCase()
    if (!ALLOWED_ANIMATION_EXTS.has(ext)) {
      ctx.status = 400; ctx.body = { error: `Unsupported file type: ${ext}. Allowed: gif, mp4, webm, png, jpg, webp` }; return
    }
    const savedName = randomBytes(8).toString('hex') + ext
    await writeFile(join(config.uploadDir, savedName), data)
    ctx.body = { url: `/user-uploads/${savedName}` }
    return
  }
  ctx.status = 400; ctx.body = { error: 'No file found in request' }
}

function splitMultipart(raw: Buffer, boundary: Buffer): Buffer[] {
  const parts: Buffer[] = []
  let start = 0
  while (true) {
    const idx = raw.indexOf(boundary, start)
    if (idx === -1) break
    if (start > 0) { parts.push(raw.subarray(start + 2, idx)) }
    start = idx + boundary.length
  }
  return parts
}
