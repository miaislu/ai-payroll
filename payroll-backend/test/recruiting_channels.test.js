import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { candidateChannel, migrateRecruitingChannels } from '../lib/recruiting_channels.js'

test('渠道升级补齐平台来源并关联历史文字来源；已有猎头、费用和重复名称不被重写', () => {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE recruiting_channels(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT,type TEXT,fee_rate REAL);
  CREATE TABLE candidates(id INTEGER PRIMARY KEY,name TEXT,source_channel TEXT,source_channel_id INTEGER);
  INSERT INTO recruiting_channels VALUES(1,'测试猎头','headhunter',20),(2,'猎聘','job_board',NULL);
  INSERT INTO candidates VALUES(1,'平台人选','猎聘',NULL),(2,'猎头人选','测试猎头',1),(3,'无来源','其他',NULL);`)
  migrateRecruitingChannels(db); migrateRecruitingChannels(db)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM recruiting_channels').get().n,5)
  assert.equal(db.prepare('SELECT source_channel_id FROM candidates WHERE id=1').get().source_channel_id,2)
  assert.equal(db.prepare('SELECT fee_rate FROM recruiting_channels WHERE id=1').get().fee_rate,20)
  assert.equal(db.prepare('SELECT source_channel_id FROM candidates WHERE id=2').get().source_channel_id,1)
  assert.ok(db.prepare('SELECT source_channel_id FROM candidates WHERE id=3').get().source_channel_id)
  db.close()
})

test('按明确编号优先归属；历史文字只匹配唯一同名渠道，避免重复计数', () => {
  const channels=[{id:1,name:'猎聘'},{id:2,name:'测试猎头'}]
  assert.equal(candidateChannel({source_channel:'猎聘',source_channel_id:2},channels).id,2)
  assert.equal(candidateChannel({source_channel:'猎聘',source_channel_id:null},channels).id,1)
  assert.equal(candidateChannel({source_channel:'未知'},channels),null)
  assert.equal(candidateChannel({source_channel:'猎聘'},[...channels,{id:3,name:'猎聘'}]),null)
})
