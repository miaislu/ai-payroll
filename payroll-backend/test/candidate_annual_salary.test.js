import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeAnnualSalary, expectedAnnualSalaryLabel } from '../lib/candidate_annual_salary.js'
import { exactExpectedSalary } from '../lib/candidate_salary.js'

test('年薪原额保存，不推导月薪或猎头费用基数', () => {
  assert.equal(normalizeAnnualSalary('1200000'), 1200000)
  assert.equal(normalizeAnnualSalary(''), null)
  assert.equal(normalizeAnnualSalary(null), null)
  assert.equal(normalizeAnnualSalary(0), 0)
  for (const value of [-1, 1.5, NaN, Infinity, {}, true, ' ', Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => normalizeAnnualSalary(value))
  assert.equal(expectedAnnualSalaryLabel({ expected_salary_annual: 1200000 }), '¥1,200,000/年')
  assert.equal(expectedAnnualSalaryLabel({ expected_salary_annual: 0 }), '¥0/年')
  assert.equal(expectedAnnualSalaryLabel({}), '暂无')
  assert.equal(exactExpectedSalary({ expected_salary_annual: 1200000 }), 0)
  assert.equal(exactExpectedSalary({ expected_salary: 50000, expected_salary_annual: 1200000 }), 50000)
})
