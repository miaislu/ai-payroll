import test from 'node:test'
import assert from 'node:assert/strict'
import { monthlyInterviewStats, shanghaiToday } from '../lib/interview_stats.js'

test('月度面试按人去重，以当月最后一轮判断，跨月独立且不含未来记录', () => {
  const rows = [
    { id: 1, candidate_id: 1, interview_date: '2026-09-30', round_no: 1, result: 'recommend' },
    { id: 2, candidate_id: 1, interview_date: '2026-10-02', round_no: 2, result: 'strong_recommend' },
    { id: 3, candidate_id: 1, interview_date: '2026-10-08', round_no: 3, result: 'not_recommend' },
    { id: 4, candidate_id: 2, interview_date: '2026-10-03', round_no: 1, result: 'recommend' },
    { id: 5, candidate_id: 3, interview_date: '2026-10-04', round_no: 1, result: 'pending' },
    { id: 6, candidate_id: 3, interview_date: '2026-10-04', round_no: 2, result: 'strong_recommend' },
    { id: 7, candidate_id: 4, interview_date: '2026-10-26', round_no: 1, result: 'pending' },
    { id: 8, candidate_id: 5, interview_date: '2026-10-27', round_no: 1, result: 'recommend' }
  ]
  const summary = monthlyInterviewStats(rows, '2026-10', '2026-10-26')
  assert.equal(summary.interviewed, 4)
  assert.equal(summary.passed, 2)
  assert.equal(summary.failed, 1)
  assert.equal(summary.pending, 1)
  assert.equal(summary.rounds, 6)
  assert.equal(summary.passRate, 50)
  assert.equal(summary.candidates.find(item => item.candidate_id === 1).result, 'not_recommend')
  const previous = monthlyInterviewStats(rows, '2026-09', '2026-10-26')
  assert.equal(previous.interviewed, 1)
  assert.equal(previous.passRate, 100)
  assert.equal(monthlyInterviewStats(rows, '2026-08', '2026-10-26').passRate, null)
})

test('面试统计使用上海日历日期，兼容历史通过结果', () => {
  assert.equal(shanghaiToday(new Date('2026-10-25T16:30:00Z')), '2026-10-26')
  const legacy = monthlyInterviewStats([{ id: 1, candidate_id: 1, interview_date: '2025-01-01', round_no: 1, result: 'pass' }], '2025-01', '2026-10-26')
  assert.equal(legacy.passed, 1)
  assert.throws(() => monthlyInterviewStats([], '2026-13'), /不合法/)
})

test('待面试按人去重，与已面试待定分开，历史月份按月末状态还原', () => {
  const rows = [
    { id: 1, candidate_id: 1, interview_date: '2026-09-29', round_no: 1, result: 'recommend', status: 'completed' },
    { id: 2, candidate_id: 2, interview_date: '2026-10-27', round_no: 1, result: 'pending', status: 'scheduled' },
    { id: 3, candidate_id: 2, interview_date: '2026-10-28', round_no: 2, result: 'pending', status: 'scheduled' },
    { id: 4, candidate_id: 3, interview_date: '2026-10-25', round_no: 1, result: 'pending', status: 'completed' },
    { id: 5, candidate_id: 4, interview_date: '2026-10-28', round_no: 1, result: 'pending', status: 'cancelled' }
  ]
  const events = [
    { id: 1, interview_id: 1, occurred_at: '2026-09-20T01:00:00Z', snapshot_json: JSON.stringify({ ...rows[0], status: 'scheduled' }) },
    { id: 2, interview_id: 1, occurred_at: '2026-10-01T01:00:00Z', snapshot_json: JSON.stringify(rows[0]) }
  ]
  const current = monthlyInterviewStats(rows, '2026-10', '2026-10-26', events)
  assert.equal(current.awaiting, 1)
  assert.equal(current.interviewed, 1)
  assert.equal(current.pending, 1)
  assert.equal(current.awaitingCandidates[0].candidate_id, 2)
  const history = monthlyInterviewStats(rows, '2026-09', '2026-10-26', events)
  assert.equal(history.awaiting, 1, '次月补录完成不能抹掉上月月末的待面试状态')
})
