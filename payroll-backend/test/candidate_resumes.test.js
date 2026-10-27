import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { resumeResultToken } from '../lib/resume_profile.js'
import { migrateCandidateResumes, candidateResumeRows, candidateSourceToken, candidateResumeToken, resolveCandidateResume, resumeMetadata } from '../lib/candidate_resumes.js'

test('single-file upgrade preserves attachment bytes, parsed content and confirmed personal info', () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'candidate-resumes-migration-'))
  const filePath = path.join(folder, 'legacy.txt'), bytes = '姓名：虚构测试人选\n旧版简历正文'
  writeFileSync(filePath, bytes)
  const db = new DatabaseSync(':memory:')
  try {
    db.exec(`CREATE TABLE candidates(id INTEGER PRIMARY KEY,resume_name TEXT,resume_path TEXT,resume_parsed TEXT,created_at TEXT,resume_applied_hash TEXT,resume_source_id INTEGER,resume_applied_id INTEGER,profile_json TEXT);
      CREATE TABLE candidate_resumes(id INTEGER PRIMARY KEY AUTOINCREMENT,candidate_id INTEGER,filename TEXT,original_name TEXT,file_path TEXT,content_type TEXT,size INTEGER,uploaded_at TEXT,parse_status TEXT,parse_engine TEXT,parsed_data TEXT);`)
    const parsed = JSON.stringify({ basic: { name: '虚构测试人选' }, education: [], work_experience: [], engine: 'local-llm' })
    const verified = JSON.stringify({ basic: { name: '已核对姓名' }, education: [], work_experience: [] })
    db.prepare('INSERT INTO candidates VALUES(1,?,?,?,?,?,NULL,NULL,?)').run('旧简历.txt', filePath, parsed, '2026-01-01T00:00:00.000Z', resumeResultToken(parsed), verified)
    migrateCandidateResumes(db)
    const candidate = db.prepare('SELECT * FROM candidates WHERE id=1').get(), [file] = candidateResumeRows(db, 1)
    assert.equal(file.original_name, '旧简历.txt')
    assert.equal(file.file_path, filePath)
    assert.equal(file.parsed_data, parsed)
    assert.equal(file.parse_status, 'applied')
    assert.equal(candidate.resume_source_id, file.id)
    assert.equal(candidate.resume_applied_id, file.id)
    assert.equal(candidate.resume_applied_hash, candidateSourceToken(candidate))
    assert.equal(candidate.profile_json, verified)
    assert.equal(readFileSync(filePath, 'utf8'), bytes)
    assert.equal(resolveCandidateResume(db, candidate).id, file.id)
    assert.equal(resumeMetadata(file).file_path, undefined)
    assert.equal(resumeMetadata(file).parsed_data, undefined)
    assert.notEqual(candidateResumeToken({ id: 1, parsed_data: parsed }), candidateResumeToken({ id: 2, parsed_data: parsed }))
    assert.throws(() => resolveCandidateResume(db, { id: 2 }, file.id), error => error.statusCode === 404)
  } finally { db.close(); rmSync(folder, { recursive: true, force: true }) }
})
