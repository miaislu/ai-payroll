export function interviewOutcomeLabel(interview) {
  if (interview.status !== 'completed') return { scheduled: '待面试', in_progress: '面试中', cancelled: '已取消' }[interview.status] || '—'
  if (['not_recommend', 'strong_not_recommend', 'fail'].includes(interview.result)) return '已完成 · 未通过'
  if (['recommend', 'strong_recommend', 'pass'].includes(interview.result)) return '已完成 · 通过'
  return '已完成 · 待定'
}
