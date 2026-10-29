const statuses = { scheduled: '待面试', in_progress: '面试中', completed: '已完成', cancelled: '已取消' }
const results = { strong_recommend: '强烈推荐', recommend: '推荐录用', pending: '待定', not_recommend: '不推荐', strong_not_recommend: '强烈不推荐', pass: '通过', fail: '未通过' }

// Preserve the saved calendar date; no time-of-day is inferred from a date-only record.
export function interviewSyncValues(rows) {
  const interviews = [...rows].sort((a, b) => String(a.interview_date || '').localeCompare(String(b.interview_date || ''))
    || Number(a.round_no || 1) - Number(b.round_no || 1) || Number(a.id) - Number(b.id))
  const heading = row => `第 ${row.round_no || 1} 轮 · ${row.interview_date || '日期未填写'}`
  const status = row => {
    const label = statuses[row.status] || row.status || '状态未填写'
    if (row.status !== 'completed') return label
    const outcome = ['not_recommend', 'strong_not_recommend', 'fail'].includes(row.result) ? '未通过'
      : ['recommend', 'strong_recommend', 'pass'].includes(row.result) ? '通过' : '待定'
    return `${label} · ${outcome}`
  }
  return {
    interview_dates: interviews.map(row => `${heading(row)} · ${status(row)}`).join('\n'),
    interview_records: interviews.map(row => [
      heading(row), `面试官：${row.interviewer || '未填写'}`, `状态：${status(row)}`,
      ...(row.status === 'completed' ? [`结论：${results[row.result] || row.result || '未填写'}`,
        ...(row.score != null ? [`评分：${row.score}`] : [])] : []),
      ...(row.notes ? [`面评：${row.notes}`] : [])
    ].join('\n')).join('\n\n')
  }
}
