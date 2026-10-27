// The caller owns the transaction. Keep original file bytes and cloud identities for restore.
const fail = message => { throw Object.assign(new Error(message), { statusCode: 409 }) }
const relatedTables = ['interviews', 'candidate_events', 'candidate_resumes', 'feishu_candidate_keys']

export function archiveCandidate(connection, candidate, actor) {
  const snapshot = { version: 1, candidate }
  for (const table of relatedTables) snapshot[table] = connection.prepare(`SELECT * FROM ${table} WHERE candidate_id=?`).all(candidate.id)
  const now = new Date().toISOString()
  const row = connection.prepare('INSERT INTO candidate_deleted_records(candidate_id,name,snapshot_json,deleted_at,deleted_by) VALUES(?,?,?,?,?)')
    .run(candidate.id, candidate.name, JSON.stringify(snapshot), now, actor)
  connection.prepare('DELETE FROM interviews WHERE candidate_id=?').run(candidate.id)
  connection.prepare('DELETE FROM candidate_events WHERE candidate_id=?').run(candidate.id)
  connection.prepare('DELETE FROM candidates WHERE id=?').run(candidate.id)
  return Number(row.lastInsertRowid)
}

export function restoreCandidate(connection, archiveId, actor) {
  const record = connection.prepare('SELECT * FROM candidate_deleted_records WHERE id=? AND restored_at IS NULL').get(archiveId)
  if (!record) throw Object.assign(new Error('已删除记录不存在或已经恢复'), { statusCode: 404 })
  const snapshot = JSON.parse(record.snapshot_json)
  if (snapshot.version !== 1 || snapshot.candidate?.id !== record.candidate_id) fail('归档资料不完整，请联系管理员')
  if (connection.prepare('SELECT 1 FROM candidates WHERE id=?').get(record.candidate_id)) fail('原候选人编号已被占用，未覆盖现有档案')
  const insert = (table, row) => {
    const columns = connection.prepare(`PRAGMA table_info(${table})`).all().map(item => item.name).filter(key => Object.hasOwn(row, key))
    connection.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`).run(...columns.map(key => row[key]))
  }
  insert('candidates', snapshot.candidate)
  for (const table of relatedTables) for (const row of snapshot[table] || []) insert(table, row)
  connection.prepare('UPDATE candidate_deleted_records SET restored_at=?,restored_by=? WHERE id=?').run(new Date().toISOString(), actor, archiveId)
  return record.candidate_id
}
