import path from 'node:path'
import { readFileSync } from 'node:fs'

export const RESUME_EXTENSIONS = new Set(['.txt', '.text', '.md', '.docx', '.pdf'])

export function resumeFileFilter(req, file, cb) {
  const ext = path.extname(file.originalname || '').toLowerCase()
  if (!RESUME_EXTENSIONS.has(ext)) return cb(Object.assign(new Error('仅支持 txt/md/docx/pdf 简历'), { statusCode: 400 }))
  cb(null, true)
}

export function validateResumeFile(file) {
  const ext = path.extname(file.originalname || '').toLowerCase()
  const head = readFileSync(file.path).subarray(0, 512)
  if (ext === '.pdf' && !head.subarray(0, 5).equals(Buffer.from('%PDF-'))) return false
  if (ext === '.docx' && !(head[0] === 0x50 && head[1] === 0x4b)) return false
  if (['.txt', '.text', '.md'].includes(ext) && head.includes(0)) return false
  return true
}
