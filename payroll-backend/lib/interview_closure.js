// Rejecting a person finishes an interview that has already taken place; it is not a cancellation.
export function rejectionInterviewChanges(interviews, today) {
  const occurred = interviews.filter(row => ['scheduled', 'in_progress', 'completed'].includes(row.status)
    && (row.status === 'in_progress' || row.interview_date <= today))
  const latest = [...occurred].sort((a, b) => b.round_no - a.round_no || b.interview_date.localeCompare(a.interview_date) || b.id - a.id)[0]
  return interviews.filter(row => ['scheduled', 'in_progress'].includes(row.status)).map(row => {
    if (row.status === 'scheduled' && row.interview_date > today) return { ...row, status: 'cancelled' }
    // Earlier rounds have no invented failure; preserve their existing evaluation.
    const failed = row.id === latest?.id && (!row.result || row.result === 'pending')
    return { ...row, status: 'completed', result: failed ? 'not_recommend' : row.result || 'pending', score: failed ? 2 : row.score }
  })
}
