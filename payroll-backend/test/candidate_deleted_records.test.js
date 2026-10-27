import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { archiveCandidate, restoreCandidate } from '../lib/candidate_deleted_records.js'

test('删除恢复保留原附件、面评、年薪及飞书唯一标识，重复恢复不改写资料', t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'candidate-archive-'))
  const db = new DatabaseSync(':memory:')
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE candidates(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT,expected_salary_annual INTEGER);
    CREATE TABLE interviews(id INTEGER PRIMARY KEY AUTOINCREMENT,candidate_id INTEGER REFERENCES candidates(id),result TEXT);
    CREATE TABLE candidate_events(id INTEGER PRIMARY KEY AUTOINCREMENT,candidate_id INTEGER REFERENCES candidates(id),note TEXT);
    CREATE TABLE candidate_resumes(id INTEGER PRIMARY KEY AUTOINCREMENT,candidate_id INTEGER REFERENCES candidates(id) ON DELETE CASCADE,file_path TEXT,parsed_data TEXT);
    CREATE TABLE feishu_candidate_keys(candidate_id INTEGER PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,source_key TEXT UNIQUE);
    CREATE TABLE candidate_deleted_records(id INTEGER PRIMARY KEY AUTOINCREMENT,candidate_id INTEGER,name TEXT,snapshot_json TEXT,deleted_at TEXT,deleted_by TEXT,restored_at TEXT,restored_by TEXT);`)
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }) })
  const file = path.join(dir, 'resume.txt'); writeFileSync(file, '保留原始简历')
  db.prepare('INSERT INTO candidates(name,expected_salary_annual) VALUES(?,?)').run('合成候选人', 1200000)
  db.prepare('INSERT INTO interviews(candidate_id,result) VALUES(1,?)').run('recommend')
  db.prepare('INSERT INTO candidate_events(candidate_id,note) VALUES(1,?)').run('已有流转')
  db.prepare('INSERT INTO candidate_resumes(candidate_id,file_path,parsed_data) VALUES(1,?,?)').run(file, '{"basic":{"name":"合成候选人"}}')
  db.prepare('INSERT INTO feishu_candidate_keys VALUES(1,?)').run('hr_original_identity')
  const before = ['candidates','interviews','candidate_events','candidate_resumes','feishu_candidate_keys'].map(table => db.prepare(`SELECT * FROM ${table}`).all())
  db.exec('BEGIN'); const archive = archiveCandidate(db, before[0][0], '测试HR'); db.exec('COMMIT')
  assert.equal(db.prepare('SELECT COUNT(*) n FROM candidates').get().n, 0)
  assert.equal(readFileSync(file, 'utf8'), '保留原始简历')
  db.exec('BEGIN'); assert.equal(restoreCandidate(db, archive, '测试HR'), 1); db.exec('COMMIT')
  const after = ['candidates','interviews','candidate_events','candidate_resumes','feishu_candidate_keys'].map(table => db.prepare(`SELECT * FROM ${table}`).all())
  assert.deepEqual(after, before)
  assert.throws(() => restoreCandidate(db, archive, '测试HR'), /不存在或已经恢复/)
})
