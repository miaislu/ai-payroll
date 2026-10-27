import test from 'node:test'
import assert from 'node:assert/strict'
import { historicalCancellationRepairs } from '../lib/interview_cancellation_repair.js'

test('历史修复仅命中旧逻辑同次淘汰取消的已发生面试，保留手工取消和未来安排', () => {
  const rows = [1,2,3].map(id => ({ id, candidate_id: id, candidate_stage: 'rejected', round_no: 1, status: 'cancelled', result: 'pending', score: null, interview_date: id === 3 ? '2026-11-01' : '2026-10-20' }))
  const events = rows.flatMap(row => [
    { id: row.id*10, candidate_id: row.id, interview_id: row.id, type: 'interview_scheduled', snapshot_json: '{"status":"scheduled"}' },
    { id: row.id*10+1, candidate_id: row.id, interview_id: row.id, type: 'interview_cancelled', actor: 'HR', occurred_at: '2026-10-27T10:00:00.000Z', note: row.id === 2 ? '手工取消' : '人选状态变更，取消未完成的面试安排' },
    { id: row.id*10+2, candidate_id: row.id, type: 'stage_change', from_stage: 'interview', to_stage: 'rejected', actor: 'HR', occurred_at: '2026-10-27T10:00:00.001Z' }
  ])
  assert.deepEqual(historicalCancellationRepairs(rows, events), [{ id: 1, candidate_id: 1, status: 'completed', result: 'not_recommend', score: 2, rejection_event_id: 12 }])
  events.push({ id: 100, candidate_id: 1, interview_id: 1, type: 'interview_updated' })
  assert.deepEqual(historicalCancellationRepairs(rows, events), [])
})
