import test from 'node:test'
import assert from 'node:assert/strict'
import { rejectionInterviewChanges } from '../lib/interview_closure.js'

test('淘汰完成已发生的当前面试，未来安排取消，已有面评不改写', () => {
  const rows = [
    { id: 1, round_no: 1, interview_date: '2026-10-01', status: 'completed', result: 'recommend', score: 4, notes: '原面评' },
    { id: 2, round_no: 2, interview_date: '2026-10-26', status: 'in_progress', result: 'pending', score: null, notes: '已有笔记' },
    { id: 3, round_no: 3, interview_date: '2026-11-01', status: 'scheduled', result: 'pending', score: null }
  ]
  const changes = rejectionInterviewChanges(rows, '2026-10-27')
  assert.equal(changes.find(r => r.id === 2).status, 'completed')
  assert.equal(changes.find(r => r.id === 2).result, 'not_recommend')
  assert.equal(changes.find(r => r.id === 2).notes, '已有笔记')
  assert.equal(changes.find(r => r.id === 3).status, 'cancelled')
  assert.equal(changes.some(r => r.id === 1), false)
  assert.equal(rows[1].status, 'in_progress')
})

test('补录的多轮面试仅当前轮次记未通过，已有评价和真正取消的记录保留', () => {
  const rows = [
    { id: 1, round_no: 1, interview_date: '2026-10-20', status: 'scheduled', result: 'pending', score: null },
    { id: 2, round_no: 2, interview_date: '2026-10-27', status: 'scheduled', result: 'pending', score: null },
    { id: 3, round_no: 3, interview_date: '2026-11-03', status: 'cancelled', result: 'pending', score: null }
  ]
  const changes = rejectionInterviewChanges(rows, '2026-10-27')
  assert.equal(changes[0].status, 'completed')
  assert.equal(changes[0].result, 'pending')
  assert.equal(changes[1].result, 'not_recommend')
  assert.equal(changes.some(row => row.id === 3), false)
  assert.deepEqual(rejectionInterviewChanges([], '2026-10-27'), [])
})
