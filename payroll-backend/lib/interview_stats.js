import { isDate, isPeriod, monthBounds } from './periods.js'

export function shanghaiToday(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date).map(part => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

const PASSED = new Set(['strong_recommend', 'recommend', 'pass'])
const FAILED = new Set(['not_recommend', 'strong_not_recommend', 'fail'])

export function monthlyInterviewStats(interviews, month, asOf = shanghaiToday(), events = []) {
  if (!isPeriod(month) || !isDate(asOf)) throw new Error('面试统计月份或日期不合法')
  const rounds = interviews.filter(item => (item.status || 'completed') === 'completed' && isDate(item.interview_date)
    && item.interview_date.startsWith(month + '-') && item.interview_date <= asOf)
    .sort((a, b) => a.interview_date.localeCompare(b.interview_date)
      || Number(a.round_no) - Number(b.round_no) || Number(a.id) - Number(b.id))
  const people = new Map()
  for (const round of rounds) {
    const previous = people.get(round.candidate_id)
    people.set(round.candidate_id, {
      candidate_id: round.candidate_id, candidate_name: round.candidate_name,
      requisition_title: round.requisition_title, interview_date: round.interview_date,
      interviewer: round.interviewer, round_no: round.round_no, result: round.result,
      rounds: (previous?.rounds || 0) + 1
    })
  }
  const candidates = [...people.values()]
  const interviewed = candidates.length
  const passed = candidates.filter(item => PASSED.has(item.result)).length
  const failed = candidates.filter(item => FAILED.has(item.result)).length
  const cutoff = Date.parse(`${monthBounds(month).end < asOf ? monthBounds(month).end : asOf}T23:59:59.999+08:00`)
  const byId = new Map(interviews.map(item => [item.id, item]))
  const withEvents = new Set(events.map(item => item.interview_id))
  const scheduledStates = new Map(interviews.filter(item => !withEvents.has(item.id)).map(item => [item.id, item]))
  for (const event of [...events].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at) || a.id - b.id)) {
    if (Date.parse(event.occurred_at) > cutoff) continue
    let snapshot
    try { snapshot = JSON.parse(event.snapshot_json || '{}') } catch { continue }
    if (snapshot.id) scheduledStates.set(snapshot.id, { ...byId.get(snapshot.id), candidate_name: event.candidate_name, ...snapshot })
  }
  const awaitingPeople = new Map()
  for (const item of [...scheduledStates.values()].sort((a, b) => (b.interview_date || '').localeCompare(a.interview_date || ''))) {
    if (item.status === 'scheduled' && item.interview_date?.startsWith(month + '-')) awaitingPeople.set(item.candidate_id, item)
  }
  return {
    month, asOf, interviewed, passed, failed, pending: interviewed - passed - failed,
    awaiting: awaitingPeople.size,
    awaitingCandidates: [...awaitingPeople.values()].map(item => ({ candidate_id: item.candidate_id, candidate_name: item.candidate_name,
      interview_date: item.interview_date, round_no: item.round_no, requisition_title: item.requisition_title })),
    rounds: rounds.length, passRate: interviewed ? Math.round(passed / interviewed * 1000) / 10 : null,
    candidates
  }
}
