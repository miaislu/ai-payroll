import path from 'node:path'
import { readFileSync } from 'node:fs'

export const RESUME_EXTENSIONS = new Set(['.txt', '.text', '.md', '.docx', '.pdf', '.xlsx', '.xls'])

export function resumeOriginalName(value) {
  const name = repairResumeText(value)
  return path.basename(name.replace(/\\/g, '/')).replace(/[\x00-\x1f\x7f]/g, '')
}

export function repairResumeText(value) {
  let name = String(value || '')
  // Multipart headers commonly carry UTF-8 bytes interpreted as Latin-1 by Busboy.
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!/[^\x00-\x7f]/.test(name) || ![...name].every(char => char.codePointAt(0) <= 255)) break
    try { name = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(name, 'latin1')) } catch { break /* already a Latin-1 name */ }
  }
  return name
}

export function repairLegacyResumeNames(connection) {
  let changed = 0
  for (const [table, field] of [['candidates', 'resume_name'], ['employee_resumes', 'original_name']]) {
    for (const row of connection.prepare(`SELECT id,${field} AS value FROM ${table} WHERE ${field} IS NOT NULL`).all()) {
      const repaired = resumeOriginalName(row.value)
      if (repaired !== row.value) { connection.prepare(`UPDATE ${table} SET ${field}=? WHERE id=?`).run(repaired, row.id); changed++ }
    }
  }
  return changed
}

export function resumeFileFilter(req, file, cb) {
  file.originalname = resumeOriginalName(file.originalname)
  const ext = path.extname(file.originalname || '').toLowerCase()
  if (!RESUME_EXTENSIONS.has(ext)) return cb(Object.assign(new Error('仅支持 txt/md/docx/pdf/xlsx/xls 简历'), { statusCode: 400 }))
  cb(null, true)
}

export function validateResumeFile(file) {
  const ext = path.extname(file.originalname || '').toLowerCase()
  const head = readFileSync(file.path).subarray(0, 512)
  if (ext === '.pdf' && !head.subarray(0, 5).equals(Buffer.from('%PDF-'))) return false
  if (['.docx', '.xlsx'].includes(ext) && !(head[0] === 0x50 && head[1] === 0x4b)) return false
  if (ext === '.xls' && !head.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex'))) return false
  if (['.txt', '.text', '.md'].includes(ext) && head.includes(0)) return false
  return true
}
