import test from 'node:test'
import assert from 'node:assert/strict'
import { computeCumulative, computeMonthForPeriod, consultantTax, severanceTax, socialFund, employedInPeriod, overtimePay, unpaidLeaveAdjustedBase, proratedMonthlyBase, taxAnnual } from '../lib/payroll.js'
import { grantActiveInPeriod, grantAmortizationForPeriod, companyCostOf } from '../lib/company_cost.js'
import { nextAdvanceStatus, nextClaimStatus } from '../lib/workflows.js'
import { validateResumeFile } from '../lib/uploads.js'
import { canReadEmployeeEvents, canApprove, canStaff } from '../lib/access.js'
import { missingExportFields, isMaskedOrEmpty, redactForExternalLlm } from '../lib/pii.js'
import { percentiles, parseCsv, normalizeSample, bandFromSamples } from '../lib/market.js'
import { suggestRaise } from '../lib/performance.js'
import { blockingPayrollIssues } from '../lib/payroll_store.js'
import { normalizeOptionInput, optionMetrics } from '../lib/calc.js'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const zhang = {
  id: 1, name: '张三', grade: 'P5', city: '上海', monthly_base: 25000, perf_ratio: 0.32,
  special_deduction: 3000, hire_month: '2025-01', status: 'active', employment_type: 'employee'
}

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

test('Offer 状态不进入算薪和公司成本', () => {
  const offer = { ...zhang, id: 99, name: '周OFFER', status: 'offer', hire_month: '2025-01' }
  assert.equal(employedInPeriod(offer, '2025-06'), false)
  assert.equal(computeMonthForPeriod('2025-06', [offer]).length, 0)
})

test('张三 2025-01 黄金工资单（上海累计预扣）', () => {
  const row = computeMonthForPeriod('2025-01', [zhang])[0]
  assert.equal(row.base, 25000)
  assert.equal(row.perf, 8000)
  assert.equal(row.social, 2575)
  assert.equal(row.fund, 1750)
  assert.equal(row.tax, 620)
  assert.equal(row.net, 28055)
})

test('累计预扣在自然年一月重置', () => {
  const emp = { id: 2, name: '高薪', grade: 'P6', city: '上海', monthly_base: 80000, perf_ratio: 0, hire_month: '2025-01', status: 'active', employment_type: 'employee' }
  const janNew = computeMonthForPeriod('2026-01', [emp])[0]
  const crossed = computeCumulative(['2025-12', '2026-01'], [emp]).find(r => r.period === '2026-01')
  assert.equal(crossed.tax, janNew.tax)
  assert.equal(crossed.net, janNew.net)
})

test('累计预扣逐月使用当月生效的薪酬条款', () => {
  const rows = computeCumulative(['2025-01', '2025-02'], period => [{
    ...zhang,
    perf_ratio: 0,
    monthly_base: period === '2025-01' ? 10000 : 20000
  }])
  assert.deepEqual(rows.map(row => row.base), [10000, 20000])
})

test('已锁定工资快照作为后续累计预扣基线', () => {
  const periods = ['2025-01', '2025-02']
  const original = computeCumulative(periods, period => [{
    ...zhang,
    perf_ratio: 0,
    monthly_base: period === '2025-01' ? 10000 : 20000
  }])
  const replayed = computeCumulative(periods, period => [{
    ...zhang,
    perf_ratio: 0,
    monthly_base: period === '2025-01' ? 99999 : 20000
  }], [original[0]])
  assert.equal(replayed[0].gross, original[0].gross)
  assert.equal(replayed[1].tax, original[1].tax)
  assert.equal(replayed[1].net, original[1].net)
})

test('累计税额下降时不倒减历史已实扣税额', () => {
  const rows = computeCumulative(['2025-01', '2025-02', '2025-03'], period => [{
    ...zhang,
    perf_ratio: 0,
    special_deduction: 0,
    monthly_base: period === '2025-02' ? 2000 : 100000
  }])
  assert.equal(rows[1].regular_tax, 0)
  const cumulativeTaxable = rows.reduce((sum, row) => (
    sum + row.gross - 5000 - row.social - row.fund - (row.supplemental_fund || 0) - row.special
  ), 0)
  const expectedMarchTax = Math.max(0, taxAnnual(cumulativeTaxable) - rows[0].regular_tax - rows[1].regular_tax)
  assert.equal(rows[2].regular_tax, expectedMarchTax)
})

test('上海公积金与社保分基数封顶', () => {
  const low = socialFund(2000, '上海', 0, '2025-06')
  assert.equal(low.social_base, 7460)
  assert.equal(low.fund_base, 2690)
  assert.ok(low.social > low.fund)
})

test('期权从授予月按服务期摊销，cliff 不推迟成本确认', () => {
  const grant = { grant_date: '2025-01-15', vesting_months: 48, cliff_months: 12, status: 'granted', monthly_amort: 5104, total_value: 244992 }
  assert.equal(grantActiveInPeriod(grant, '2025-01'), true)
  assert.equal(grantActiveInPeriod(grant, '2025-12'), true)
  assert.equal(grantActiveInPeriod(grant, '2026-01'), true)
  const emp = { id: 1, name: '张三', monthly_base: 25000, perf_ratio: 0, city: '上海', employment_type: 'employee' }
  const duringCliff = companyCostOf(emp, '2025-06', { 1: [grant] })
  assert.equal(duringCliff.option_amort, 5104)
  assert.equal(duringCliff.option_source, 'ledger')
  const afterCliff = companyCostOf(emp, '2026-01', { 1: [grant] })
  assert.equal(afterCliff.option_amort, 5104)
})

test('期权整个归属期确认金额与授予总价值一致', () => {
  const grant = { grant_date: '2025-01-15', vesting_months: 3, cliff_months: 1, status: 'granted', monthly_amort: 33, total_value: 100 }
  assert.equal(['2025-01', '2025-02', '2025-03'].reduce((sum, period) => sum + grantAmortizationForPeriod(grant, period), 0), 100)
})

test('期权只在授予后的归属期内摊销', () => {
  const grant = { grant_date: '2025-06-15', vesting_months: 2, status: 'granted' }
  assert.equal(grantActiveInPeriod(grant, '2025-05'), false)
  assert.equal(grantActiveInPeriod(grant, '2025-06'), true)
  assert.equal(grantActiveInPeriod(grant, '2025-07'), true)
  assert.equal(grantActiveInPeriod(grant, '2025-08'), false)
})

test('员工只能读本人入转调离事件', () => {
  const emp = { role: 'emp', employee_id: 1 }
  assert.equal(canReadEmployeeEvents(emp, 1), true)
  assert.equal(canReadEmployeeEvents(emp, 2), false)
  assert.equal(canReadEmployeeEvents({ role: 'hr' }, 2), true)
  assert.equal(canReadEmployeeEvents({ role: 'founder' }, 9), true)
  assert.equal(canReadEmployeeEvents({ role: 'finance' }, 9), true)
  assert.equal(canReadEmployeeEvents(null, 1), false)
})

test('审批分工：带宽 HR/CEO，发钱类财务/CEO', () => {
  assert.equal(canApprove({ role: 'hr' }, 'band'), true)
  assert.equal(canApprove({ role: 'hr' }, 'raise'), false)
  assert.equal(canApprove({ role: 'finance' }, 'raise'), true)
  assert.equal(canApprove({ role: 'finance' }, 'offer'), true)
  assert.equal(canApprove({ role: 'finance' }, 'band'), false)
  assert.equal(canApprove({ role: 'founder' }, 'raise'), true)
  assert.equal(canApprove({ role: 'founder' }, 'band'), true)
  assert.equal(canApprove({ role: 'emp' }, 'raise'), false)
  assert.equal(canApprove(null, 'raise'), false)
  assert.equal(canStaff({ role: 'hr' }), true)
  assert.equal(canStaff({ role: 'finance' }), false)
})

test('脱敏证件号和空卡号会阻断申报导出', () => {
  assert.equal(isMaskedOrEmpty('3101***********1234'), true)
  assert.equal(isMaskedOrEmpty('310101199104121234'), false)
  const missing = missingExportFields([
    { name: '张三', id_number: '3101***********1234' },
    { name: '李四', id_number: '310101199408231234' }
  ], 'tax')
  assert.deepEqual(missing, ['张三'])
})

test('外部 LLM 文本会脱敏联系方式、证件号、银行卡与凭证', () => {
  const value = redactForExternalLlm('姓名：张三 手机 13812345678 邮箱 a@test.com 身份证 310101199104121234 卡号 6222021234567890123 token sk-test_123456789012')
  assert.equal(value.text.includes('张三'), false)
  assert.equal(value.text.includes('13812345678'), false)
  assert.equal(value.text.includes('a@test.com'), false)
  assert.equal(value.text.includes('310101199104121234'), false)
  assert.equal(value.text.includes('6222021234567890123'), false)
  assert.equal(value.text.includes('sk-test_123456789012'), false)
  assert.ok(value.kinds.length >= 5)
})

test('工资预检 bad 标记是月结阻断项', () => {
  assert.deepEqual(blockingPayrollIssues([
    { employee_id: 1, name: '正常', flags: [{ kind: 'ok', text: '通过' }] },
    { employee_id: 2, name: '异常', flags: JSON.stringify([{ kind: 'bad', text: '加班费存疑' }]) }
  ]), [{ employee_id: 2, name: '异常', text: '加班费存疑' }])
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

test('加班费按月薪/21.75/8 与 1.5/2/3 倍', () => {
  assert.equal(overtimePay(21750, { ot_weekday_hours: 8, ot_rest_hours: 0, ot_holiday_hours: 0 }), 1500)
  assert.equal(overtimePay(21750, { ot_weekday_hours: 0, ot_rest_hours: 8, ot_holiday_hours: 0 }), 2000)
  assert.equal(overtimePay(21750, { ot_weekday_hours: 0, ot_rest_hours: 0, ot_holiday_hours: 8 }), 3000)
  assert.equal(unpaidLeaveAdjustedBase(21750, 21.75 / 2), 10875)
})

test('有考勤记录时加班覆盖静态 ot_amount', () => {
  const emp = {
    ...zhang, ot_amount: 9999,
    attendanceByPeriod: { '2025-01': { ot_weekday_hours: 8, ot_rest_hours: 0, ot_holiday_hours: 0, unpaid_leave_days: 0 } }
  }
  const row = computeMonthForPeriod('2025-01', [emp])[0]
  assert.equal(row.ot, Math.round(25000 / 21.75 / 8 * 8 * 1.5))
  assert.notEqual(row.ot, 9999)
})

test('无考勤时加班仍用 ot_amount，黄金工资单不受影响', () => {
  const emp = { ...zhang, ot_amount: 1000 }
  assert.equal(computeMonthForPeriod('2025-01', [emp])[0].ot, 1000)
  const golden = computeMonthForPeriod('2025-01', [zhang])[0]
  assert.equal(golden.ot, 0)
  assert.equal(golden.tax, 620)
})

test('考勤加班进入公司成本', () => {
  const emp = { id: 1, name: '张三', monthly_base: 25000, perf_ratio: 0, city: '上海', employment_type: 'employee', attendanceByPeriod: { '2025-06': { ot_weekday_hours: 8 } } }
  const cost = companyCostOf(emp, '2025-06', {})
  assert.equal(cost.ot, Math.round(25000 / 21.75 / 8 * 8 * 1.5))
})

test('计薪天数和精确入职日期会折算基本工资', () => {
  assert.equal(proratedMonthlyBase(22000, {}, '2026-09', { scheduled_work_days: 22, work_days: 11 }), 11000)
  const partial = proratedMonthlyBase(22000, { hire_date: '2026-09-16' }, '2026-09', null)
  assert.ok(partial > 0 && partial < 22000)
})

test('样本分位与 CSV 解析', () => {
  assert.deepEqual(percentiles([10, 20, 30, 40, 50]), { p25: 20, p50: 30, p75: 40, n: 5 })
  const rows = parseCsv('direction,city,annual_cash_wan\n模拟IC设计,上海,55\n"数字前端(RTL)",北京,60')
  assert.equal(rows.length, 2)
  assert.equal(normalizeSample(rows[0]).annual_cash_wan, 55)
  const band = bandFromSamples([
    { annual_cash_wan: 50, city: '上海', exp_band: '3-5年', company_type: 'Fabless' },
    { annual_cash_wan: 40, city: '上海', exp_band: '3-5年', company_type: 'Fabless' },
    { annual_cash_wan: 60, city: '上海', exp_band: '3-5年', company_type: 'Fabless' }
  ])
  assert.equal(band.p50, 50)
})

test('绩效评级映射调薪比例', () => {
  assert.equal(suggestRaise(10000, 'S').to_monthly, 11200)
  assert.equal(suggestRaise(10000, 'A').pct, 0.08)
  assert.equal(suggestRaise(10000, 'C').pct, 0)
  assert.equal(suggestRaise(10000, 'X'), null)
})

test('期权模拟校验真实 p 字段并拒绝 NaN/零概率', () => {
  const input = normalizeOptionInput({ n: '10', k: 0.5, v0yi: 20, shares: 2500, dil: 30, vest: 4, lq: 0.7, p: { ipo: 10, acq: 15, hold: 45, fail: 30 }, mI: 3, mA: 1.8 })
  assert.ok(Number.isFinite(optionMetrics(input, true).mid))
  assert.throws(() => normalizeOptionInput({ ...input, p: { ipo: 0, acq: 0, hold: 0, fail: 0 } }), /概率之和/)
  assert.throws(() => normalizeOptionInput({ ...input, shares: 'not-a-number' }), /shares/)
})
