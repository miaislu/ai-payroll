// 公司薪酬成本引擎 v1（成本侧口径，与个人侧算薪分离）
// 公司月度成本 = 应发工资(gross=base+perf+ot)
//              + 公司社保(缴费基数 × 城市 employer_social_rate)
//              + 公司公积金(公积金基数 × 城市 employer_fund_rate)
//              + 期权摊销（台账优先，自授予月起按服务期直线确认）
import { socialFund, employedInPeriod, overtimePay, proratedMonthlyBase } from './payroll.js'
import { DEFAULT_RATES } from './city_policies.js'

export { employedInPeriod }
export const EMPLOYER_SOCIAL_RATE = DEFAULT_RATES.employer_social_rate
export const EMPLOYER_FUND_RATE = DEFAULT_RATES.employer_fund_rate

/** 服务期自授予月开始直线摊销；cliff 只影响可归属状态，不推迟成本确认。 */
export function grantActiveInPeriod(grant, period) {
  const start = String(grant.grant_date || '').slice(0, 7)
  if (!/^\d{4}-\d{2}$/.test(start) || period < start || grant.status !== 'granted') return false
  const [sy, sm] = start.split('-').map(Number)
  const [py, pm] = period.split('-').map(Number)
  const elapsed = (py - sy) * 12 + (pm - sm)
  return elapsed >= 0 && elapsed < (Number(grant.vesting_months) || 48)
}

export function grantAmortizationForPeriod(grant, period) {
  if (!grantActiveInPeriod(grant, period)) return 0
  const start = String(grant.grant_date).slice(0, 7)
  const [sy, sm] = start.split('-').map(Number)
  const [py, pm] = period.split('-').map(Number)
  const elapsed = (py - sy) * 12 + (pm - sm)
  const vesting = Number(grant.vesting_months) || 48
  const monthly = Number(grant.monthly_amort) || Math.round((Number(grant.total_value) || 0) / vesting)
  return elapsed === vesting - 1 ? Math.max(0, (Number(grant.total_value) || monthly * vesting) - monthly * (vesting - 1)) : monthly
}

// 单员工单月公司成本
// grantsMap 应传入该员工全部 status=granted 台账（含 cliff 中的）；无台账才回退 annual_option_value/12
export function companyCostOf(employee, period, grantsMap = {}) {
  const type = employee.employment_type || 'employee'
  const rec = employee.attendanceByPeriod?.[period]
  const origBase = employee.monthly_base || 0
  const base = proratedMonthlyBase(origBase, employee, period, rec)
  if (type === 'consultant') {
    return {
      employee_id: employee.id, name: employee.name, department_id: employee.department_id || null,
      department: employee.department || null, city: employee.city || '上海', period,
      base, perf: 0, ot: 0, gross: base, social: 0, fund: 0, option_amort: 0,
      option_source: 'none', employment_type: 'consultant',
      total: base
    }
  }
  const perf = Math.round(base * (employee.perf_ratio ?? 0.32))
  const ot = rec ? overtimePay(origBase, rec) : (employee.ot_amount || 0)
  const severance = employee.leave_month === period ? Math.max(0, Number(employee.severance_amount) || 0) : 0
  const gross = base + perf + ot + severance
  const isIntern = type === 'intern'
  const sf = socialFund(base, employee.city || '上海', employee.supplemental_fund_rate, period)
  const social = isIntern ? 0 : Math.round(sf.social_base * sf.rates.employer_social)
  const fund = isIntern ? 0 : Math.round(sf.fund_base * sf.rates.employer_fund)
  const supplemental_fund = isIntern ? 0 : Math.round(sf.fund_base * (employee.supplemental_fund_rate || 0))
  const ledger = grantsMap[employee.id] || []
  const activeGrants = ledger.filter(g => grantActiveInPeriod(g, period))
  const optionAmort = ledger.length
    ? activeGrants.reduce((s, g) => s + grantAmortizationForPeriod(g, period), 0)
    : Math.round((employee.annual_option_value || 0) / 12)
  return {
    employee_id: employee.id, name: employee.name, department_id: employee.department_id || null,
    department: employee.department || null, city: employee.city || '上海', period,
    base, perf, ot, severance, gross, social, fund, supplemental_fund, option_amort: optionAmort,
    option_source: ledger.length ? 'ledger' : 'estimate', employment_type: type,
    total: gross + social + fund + supplemental_fund + optionAmort
  }
}

export function companyCostForPeriod(period, employees, grantsMap = {}) {
  return employees
    .filter(e => employedInPeriod(e, period))
    .map(e => companyCostOf(e, period, grantsMap))
}
