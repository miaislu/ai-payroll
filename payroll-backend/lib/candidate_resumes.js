import path from 'node:path'
import { statSync } from 'node:fs'
import { readProfile, resumeResultToken } from './resume_profile.js'

const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }) }
export const candidateResumeToken = row => row?.id && row.parsed_data ? resumeResultToken(`${row.id}:${row.parsed_data}`) : null
export const candidateSourceToken = candidate => candidateResumeToken({ id: candidate.resume_source_id, parsed_data: candidate.resume_parsed })
export const candidateResumeRows = (connection, candidateId) => connection.prepare('SELECT * FROM candidate_resumes WHERE candidate_id=? ORDER BY id DESC').all(candidateId)
export function resumeMetadata(row) {
  return { id: row.id, candidate_id: row.candidate_id, original_name: row.original_name, size: row.size,
    uploaded_at: row.uploaded_at, parse_status: row.parse_status, parse_engine: row.parse_engine,
    has_parsed: Boolean(row.parsed_data), result_token: candidateResumeToken(row) }
}

export function resolveCandidateResume(connection, candidate, resumeId, { explicitWhenMultiple = false } = {}) {
  if (resumeId != null && resumeId !== '') {
    const id = Number(resumeId)
    if (!Number.isInteger(id) || id <= 0) fail('请选择有效的简历文件')
    const row = connection.prepare('SELECT * FROM candidate_resumes WHERE id=? AND candidate_id=?').get(id, candidate.id)
    if (!row) fail('该人选下不存在此简历文件', 404)
    return row
  }
  const rows = candidateResumeRows(connection, candidate.id)
  if (!rows.length) fail('请先上传简历')
  if (explicitWhenMultiple && rows.length > 1) fail('已保存多份简历，请先选择要操作的文件')
  return rows.find(row => row.id === candidate.resume_source_id) || rows[0]
}

export function insertCandidateResume(connection, candidateId, file, parsed = null) {
  const result = connection.prepare(`INSERT INTO candidate_resumes(candidate_id,filename,original_name,file_path,content_type,size,uploaded_at,parse_status,parse_engine,parsed_data)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run(candidateId, file.filename, file.originalname, file.path, file.mimetype || '', file.size || 0,
      new Date().toISOString(), parsed ? 'parsed' : 'pending', parsed?.engine || null, parsed ? JSON.stringify(parsed) : null)
  return connection.prepare('SELECT * FROM candidate_resumes WHERE id=?').get(result.lastInsertRowid)
}

// Keep the legacy summary fields as the selected parse source; adding a file never replaces it.
export function selectCandidateResume(connection, candidateId, row) {
  connection.prepare('UPDATE candidates SET resume_source_id=?,resume_name=?,resume_path=?,resume_parsed=? WHERE id=?')
    .run(row?.id ?? null, row?.original_name ?? null, row?.file_path ?? null, row?.parsed_data ?? null, candidateId)
  if (row?.parsed_data) {
    const parsed = readProfile(row.parsed_data)
    connection.prepare('UPDATE candidates SET skills=?,tags=?,experience_years=? WHERE id=?')
      .run(parsed.basic?.skills || null, JSON.stringify(parsed.tags || []), parsed.experience_years ?? null, candidateId)
  }
}

// Preserve paths and bytes while turning each former single attachment into the first file record.
export function migrateCandidateResumes(connection) {
  for (const candidate of connection.prepare("SELECT * FROM candidates WHERE resume_path IS NOT NULL AND resume_path<>''").all()) {
    let size = 0
    try { size = statSync(candidate.resume_path).size } catch { /* retain missing attachment metadata too */ }
    const parsed = readProfile(candidate.resume_parsed)
    const result = connection.prepare(`INSERT INTO candidate_resumes(candidate_id,filename,original_name,file_path,content_type,size,uploaded_at,parse_status,parse_engine,parsed_data)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(candidate.id, path.basename(candidate.resume_path), candidate.resume_name || path.basename(candidate.resume_path), candidate.resume_path, '', size,
        candidate.created_at || new Date().toISOString(), candidate.resume_parsed ? 'parsed' : 'pending', parsed.engine || null, candidate.resume_parsed)
    const id = Number(result.lastInsertRowid)
    connection.prepare('UPDATE candidates SET resume_source_id=? WHERE id=?').run(id, candidate.id)
    if (candidate.resume_parsed && candidate.resume_applied_hash === resumeResultToken(candidate.resume_parsed)) {
      connection.prepare('UPDATE candidates SET resume_applied_id=?,resume_applied_hash=? WHERE id=?')
        .run(id, candidateResumeToken({ id, parsed_data: candidate.resume_parsed }), candidate.id)
      connection.prepare("UPDATE candidate_resumes SET parse_status='applied' WHERE id=?").run(id)
    }
  }
}
