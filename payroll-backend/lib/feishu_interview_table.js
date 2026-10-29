import { randomUUID, createHash } from 'node:crypto'
import { isDate } from './periods.js'
import { failFeishu } from './feishu_client.js'

export function interviewTableFields(candidateTableId) {
  return [
    { field_name: '面试', type: 1 }, { field_name: '姓名', type: 1 },
    { field_name: '面试时间', type: 5, property: { date_formatter: 'yyyy/MM/dd', auto_fill: false } },
    { field_name: '轮次', type: 2 }, { field_name: '面试官', type: 1 },
    { field_name: '面试状态', type: 3, property: { options: ['待面试','面试中','已完成','已取消'].map(name => ({ name })) } },
    { field_name: '面试结论', type: 1 }, { field_name: '评分', type: 2 }, { field_name: '面评', type: 1 },
    { field_name: '本地状态', type: 1 },
    { field_name: '人选档案', type: 18, property: { table_id: candidateTableId, multiple: false } },
    { field_name: '本地面试标识', type: 1 }, { field_name: '本地同步时间', type: 5, property: { date_formatter: 'yyyy/MM/dd HH:mm' } }
  ]
}
export function interviewDateTimestamp(value) {
  if (!value) return null
  if (!isDate(value)) throw failFeishu('面试日期不合法，请在本地修正后重试')
  return Date.parse(`${value}T00:00:00+08:00`)
}
const labels = { scheduled: '待面试', in_progress: '面试中', completed: '已完成', cancelled: '已取消' }
const results = { strong_recommend: '强烈推荐', recommend: '推荐录用', pending: '待定', not_recommend: '不推荐', strong_not_recommend: '强烈不推荐', pass: '通过', fail: '未通过' }
export function interviewTableValues(row, candidate, sourceKey, parentRecordId) {
  return { '面试': `${candidate.name} · 第${row.round_no || 1}轮`, '姓名': candidate.name,
    '面试时间': interviewDateTimestamp(row.interview_date), '轮次': Number(row.round_no || 1),
    '面试官': row.interviewer || '', '面试状态': labels[row.status] || '待面试',
    '面试结论': row.status === 'completed' ? results[row.result] || row.result || '' : '',
    '评分': row.status === 'completed' ? row.score ?? null : null, '面评': row.notes || '',
    '本地状态': '有效', '人选档案': [parentRecordId], '本地面试标识': sourceKey }
}
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export async function syncCandidateInterviews(db, client, candidate, candidateKey, parentRecordId) {
  const target = `${client.config.app_token}:${client.config.table_id}`
  const prefix = `${candidateKey}:interview:`
  const rows = db.prepare('SELECT * FROM interviews WHERE candidate_id=? ORDER BY id').all(candidate.id)
  const rowIds = new Set(rows.map(row => prefix + row.id))
  for (const row of rows) {
    const key = prefix + row.id
    const fields = interviewTableValues(row, candidate, key, parentRecordId)
    const fingerprint = digest(fields)
    const remote = await client.find(key, '本地面试标识')
    db.prepare('INSERT OR IGNORE INTO feishu_sync_records(target_key,source_key,create_token,pending_time) VALUES(?,?,?,?)')
      .run(target,key,randomUUID(),new Date().toISOString())
    const link = db.prepare('SELECT * FROM feishu_sync_records WHERE target_key=? AND source_key=?').get(target,key)
    if ((!remote && link.record_id) || (remote && link.record_id && remote.record_id !== link.record_id)) throw failFeishu('飞书面试原记录已删除、不可见或标识冲突，请核对后重试',409)
    if (!remote && link.pending_hash && link.pending_hash !== fingerprint) throw failFeishu('上次面试新增结果未确认，请先核对原记录',409)
    if (digest(db.prepare('SELECT * FROM interviews WHERE id=? AND candidate_id=?').get(row.id,candidate.id)) !== digest(row)) throw failFeishu('同步期间面试已修改，请重新预览',409)
    if (!remote) db.prepare('UPDATE feishu_sync_records SET pending_hash=? WHERE target_key=? AND source_key=?').run(fingerprint,target,key)
    const stamp = Date.now()
    const recordId = await client.write({ ...fields, '本地同步时间': stamp },remote?.record_id,link.create_token)
    db.prepare('UPDATE feishu_sync_records SET record_id=?,synced_at=?,pending_hash=NULL,pending_time=NULL WHERE target_key=? AND source_key=?').run(recordId,new Date(stamp).toISOString(),target,key)
  }
  const stale = db.prepare('SELECT source_key,record_id FROM feishu_sync_records WHERE target_key=? AND substr(source_key,1,?)=?').all(target,prefix.length,prefix).filter(row => row.record_id && !rowIds.has(row.source_key))
  for (const link of stale) {
    const remote = await client.find(link.source_key,'本地面试标识')
    if (remote && remote.record_id === link.record_id) await client.write({ '本地状态': '本地已移除', '本地同步时间': Date.now() },link.record_id)
  }
  if (digest(db.prepare('SELECT * FROM interviews WHERE candidate_id=? ORDER BY id').all(candidate.id)) !== digest(rows)) throw failFeishu('同步期间面试已修改，请重新预览',409)
  return rows.length
}
