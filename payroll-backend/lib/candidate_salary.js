export const EXPECTED_SALARY_RANGES = {
  none: '暂无', below_20k: '2万以下', '20k_30k': '2-3万', '30k_50k': '3-5万', above_50k: '5万以上'
}

export function expectedSalaryLabel(candidate) {
  if (candidate.expected_salary_range != null) return EXPECTED_SALARY_RANGES[candidate.expected_salary_range] || '暂无'
  const salary = Number(candidate.expected_salary)
  return salary > 0 ? `¥${salary.toLocaleString('zh-CN')}/月` : '暂无'
}

// A range is not an exact amount and must never be used as a fee or Offer calculation base.
export function exactExpectedSalary(candidate) {
  return candidate?.expected_salary_range == null ? Number(candidate?.expected_salary || 0) : 0
}
