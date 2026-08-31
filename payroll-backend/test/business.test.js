import test from 'node:test'
import assert from 'node:assert/strict'
import { computeCumulative, consultantTax, severanceTax } from '../lib/payroll.js'
import { employedInPeriod, grantActiveInPeriod } from '../lib/company_cost.js'
import { nextAdvanceStatus, nextClaimStatus } from '../lib/workflows.js'
import { validateResumeFile } from '../lib/uploads.js'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

test('劳务报酬使用三级预扣率', () => {
  assert.equal(consultantTax(30000), 5200)
  assert.equal(consultantTax(100000), 25000)
})

test('离职补偿按年平均工资三倍免税', () => {
  assert.equal(severanceTax(12434 * 12 * 3, '上海'), 0)
  assert.ok(severanceTax(12434 * 12 * 3 + 100000, '上海') > 0)
})

test('离职员工从入职月连续计算到离职月', () => {
  const employee = { id: 1, name: '测试', grade: 'P5', city: '上海', monthly_base: 30000, perf_ratio: 0, hire_month: '2025-01', leave_month: '2025-03', status: 'departed', employment_type: 'employee' }
  assert.deepEqual(computeCumulative(['2025-01', '2025-02', '2025-03', '2025-04'], [employee]).map(x => x.period), ['2025-01', '2025-02', '2025-03'])
  assert.equal(employedInPeriod(employee, '2025-02'), true)
  assert.equal(employedInPeriod(employee, '2025-04'), false)
})

test('期权只在授予后的归属期内摊销', () => {
  const grant = { grant_date: '2025-06-15', vesting_months: 2, status: 'granted' }
  assert.equal(grantActiveInPeriod(grant, '2025-05'), false)
  assert.equal(grantActiveInPeriod(grant, '2025-06'), true)
  assert.equal(grantActiveInPeriod(grant, '2025-07'), true)
  assert.equal(grantActiveInPeriod(grant, '2025-08'), false)
})

test('报销和预支拒绝重复或越级动作', () => {
  assert.equal(nextClaimStatus('submitted', 'approve'), 'approved')
  assert.equal(nextClaimStatus('submitted', 'pay'), null)
  assert.equal(nextClaimStatus('paid', 'reject'), null)
  assert.equal(nextAdvanceStatus('submitted', 'approve'), 'approved')
  assert.equal(nextAdvanceStatus('approved', 'approve'), null)
  assert.equal(nextAdvanceStatus('approved', 'repay'), 'repaid')
})

test('简历文件头必须与扩展名匹配', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'payroll-upload-test-'))
  try {
    const good = path.join(dir, 'good.pdf')
    const bad = path.join(dir, 'bad.pdf')
    writeFileSync(good, '%PDF-1.7\n')
    writeFileSync(bad, '<script>alert(1)</script>')
    assert.equal(validateResumeFile({ path: good, originalname: 'resume.pdf' }), true)
    assert.equal(validateResumeFile({ path: bad, originalname: 'resume.pdf' }), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
