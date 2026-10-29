import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { interviewDateTimestamp, interviewTableValues, syncCandidateInterviews, interviewTableFields } from '../lib/feishu_interview_table.js'

test('日期字段写入上海日历日毫秒值，不猜测时刻；日期、数字和关联均保留原生类型', () => {
  assert.equal(interviewDateTimestamp('2026-11-01'), Date.parse('2026-10-31T16:00:00Z'))
  assert.equal(interviewDateTimestamp('2024-02-29'), Date.parse('2024-02-28T16:00:00Z'))
  assert.throws(() => interviewDateTimestamp('2026-02-29'))
  assert.equal(interviewDateTimestamp(''), null)
  const row = { id:1, round_no:2, interview_date:'2026-11-01', interviewer:'面试官',status:'scheduled',result:'pending',score:3,notes:'说明' }
  const values = interviewTableValues(row,{name:'虚构人选'},'key','recParent')
  assert.equal(typeof values['面试时间'],'number')
  assert.equal(values['轮次'],2); assert.equal(values['面试结论'],''); assert.equal(values['评分'],null)
  assert.deepEqual(values['人选档案'],['recParent'])
  assert.equal(interviewTableFields('tblParent').find(f=>f.field_name==='面试时间').type,5)
})

test('每轮单独一行；更新和响应丢失重试不重复，移除记录保留为失效，远端缺失不重建', async t => {
  const db=new DatabaseSync(':memory:'); t.after(()=>db.close())
  db.exec(`CREATE TABLE interviews(id INTEGER PRIMARY KEY,candidate_id INTEGER,round_no INTEGER,interview_date TEXT,interviewer TEXT,status TEXT,result TEXT,score REAL,notes TEXT);
  CREATE TABLE feishu_sync_records(target_key TEXT,source_key TEXT,record_id TEXT,create_token TEXT,pending_hash TEXT,pending_time TEXT,synced_at TEXT,PRIMARY KEY(target_key,source_key));
  INSERT INTO interviews VALUES(1,1,1,'2026-10-29','甲','completed','not_recommend',2,'一面原文'),(2,1,2,'2026-11-01','乙','scheduled','pending',NULL,''),(3,2,1,'2026-11-02','丙','scheduled','pending',NULL,'其他人');`)
  const remote=new Map(); let lose=false; const tokens=[]
  const client={config:{app_token:'base',table_id:'interviews'},find:async(key,field)=>{assert.equal(field,'本地面试标识');return structuredClone(remote.get(key)||null)},write:async(fields,id,token)=>{
    const old=[...remote.entries()].find(([,r])=>r.record_id===id)
    const key=fields['本地面试标识']||old?.[0]
    const record={record_id:id||'rec'+remote.size,fields:{...(old?.[1].fields||{}),...fields}}
    remote.set(key,record);tokens.push(token)
    if(lose){lose=false;throw Error('lost response')};return record.record_id
  }}
  const candidate={id:1,name:'测试人选'}
  assert.equal(await syncCandidateInterviews(db,client,candidate,'candidate1','parent1'),2)
  assert.equal(remote.size,2)
  assert.equal(remote.get('candidate1:interview:1').fields['面试状态'],'已完成')
  assert.equal(remote.get('candidate1:interview:1').fields['面试结论'],'不推荐')
  db.prepare('UPDATE interviews SET notes=? WHERE id=1').run('面评更新')
  await syncCandidateInterviews(db,client,candidate,'candidate1','parent1');assert.equal(remote.size,2)
  assert.equal(remote.get('candidate1:interview:1').fields['面评'],'面评更新')
  db.exec('DELETE FROM interviews WHERE id=2')
  await syncCandidateInterviews(db,client,candidate,'candidate1','parent1')
  assert.equal(remote.get('candidate1:interview:2').fields['本地状态'],'本地已移除')
  lose=true
  await assert.rejects(syncCandidateInterviews(db,client,{id:2,name:'另一人选'},'candidate2','parent2'))
  await syncCandidateInterviews(db,client,{id:2,name:'另一人选'},'candidate2','parent2')
  assert.equal(remote.size,3)
  assert.ok(tokens.filter(Boolean).every(t=>typeof t==='string'))
  remote.delete('candidate1:interview:1')
  await assert.rejects(syncCandidateInterviews(db,client,candidate,'candidate1','parent1'),/原记录/)
})
