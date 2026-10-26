export const EXPECTED_SALARY_RANGES = [
  { key: 'none', label: '暂无' },
  { key: 'below_20k', label: '2万以下' },
  { key: '20k_30k', label: '2-3万' },
  { key: '30k_50k', label: '3-5万' },
  { key: 'above_50k', label: '5万以上' }
]

export function expectedSalaryRange(candidate) {
  if (candidate?.expected_salary_range != null) return candidate.expected_salary_range
  const salary = Number(candidate?.expected_salary || 0)
  return salary <= 0 ? 'none' : salary < 20000 ? 'below_20k' : salary < 30000 ? '20k_30k' : salary < 50000 ? '30k_50k' : 'above_50k'
}

export const expectedSalaryLabel = candidate => EXPECTED_SALARY_RANGES.find(item => item.key === expectedSalaryRange(candidate))?.label || '暂无'
export const exactExpectedSalary = candidate => candidate?.expected_salary_range == null ? Number(candidate?.expected_salary || 0) : 0
