// Annual expectations are independent of monthly salary and Offer/fee calculations.
export function normalizeAnnualSalary(value) {
  if (value == null || value === '') return null
  if (!['number', 'string'].includes(typeof value) || (typeof value === 'string' && !value.trim())) {
    throw Object.assign(new Error('期望年薪须为非负整数，单位元/年'), { statusCode: 400 })
  }
  const amount = Number(value)
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw Object.assign(new Error('期望年薪须为非负整数，单位元/年'), { statusCode: 400 })
  }
  return amount
}

export function expectedAnnualSalaryLabel(candidate) {
  const value = candidate?.expected_salary_annual
  return value == null || value === '' ? '暂无' : `¥${Number(value).toLocaleString('zh-CN')}/年`
}
