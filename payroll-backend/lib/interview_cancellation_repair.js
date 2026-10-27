import { shanghaiToday } from './interview_stats.js'
import { rejectionInterviewChanges } from './interview_closure.js'

// Only repair the old automatic cancellation when the audit trail ties it to rejection.
export function historicalCancellationRepairs(interviews, events) {
  const groups = new Map()
  for (const interview of interviews) {
    if (interview.status !== 'cancelled' || interview.candidate_stage !== 'rejected') continue
    const history = events.filter(e => e.interview_id === interview.id).sort((a, b) => a.id - b.id)
    const cancellation = history.at(-1)
    if (cancellation?.type !== 'interview_cancelled' || cancellation.note !== '人选状态变更，取消未完成的面试安排') continue
    const rejection = events.find(e => e.candidate_id === interview.candidate_id && e.type === 'stage_change'
      && e.to_stage === 'rejected' && e.from_stage === 'interview' && e.actor === cancellation.actor
      && e.id > cancellation.id && Date.parse(e.occurred_at) - Date.parse(cancellation.occurred_at) >= 0
      && Date.parse(e.occurred_at) - Date.parse(cancellation.occurred_at) <= 1000)
    if (!rejection) continue
    let original
    try { original = JSON.parse(history.at(-2)?.snapshot_json || '{}') } catch { continue }
    if (!['scheduled', 'in_progress'].includes(original.status)) continue
    const today = shanghaiToday(new Date(rejection.occurred_at))
    if (original.status === 'scheduled' && interview.interview_date > today) continue
    const group = groups.get(rejection.id) || { rejection, today, rows: [] }
    group.rows.push({ ...interview, status: original.status })
    groups.set(rejection.id, group)
  }
  const repairs = []
  for (const group of groups.values()) {
    const completed = interviews.filter(row => row.candidate_id === group.rejection.candidate_id && row.status === 'completed')
    for (const row of rejectionInterviewChanges([...completed, ...group.rows], group.today)) {
      if (row.status === 'completed') repairs.push({ id: row.id, candidate_id: row.candidate_id, status: row.status, result: row.result, score: row.score, rejection_event_id: group.rejection.id })
    }
  }
  return repairs
}
