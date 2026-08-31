// 公司薪酬成本引擎 v1（成本侧口径，与个人侧算薪分离）
// 公司月度成本 = 应发工资(gross=base+perf+ot)
//              + 公司社保(缴费基数 × 26%≈ 养老16+医疗9.5+失业0.5+工伤0.2)
//              + 公司公积金(缴费基数 × 7%，与个人同比例)
//              + 期权摊销(年度期权价值/12，可配置) + 招聘摊销(可配置)
// 说明：公司费率按常见口径简化（地区差异可在 CITY_POLICIES 中扩展 employer 字段）
import { socialFund } from './payroll.js'

export const EMPLOYER_SOCIAL_RATE = 0.26 // 养老16% + 医疗9.5% + 失业0.5% + 工伤0.2%（约）
export const EMPLOYER_FUND_RATE = 0.07 // 公积金公司比例（与个人 7% 匹配）

// 单员工单月公司成本
// grantsMap: { employee_id: [option_grants 行…] } 台账摊销优先；无台账时回退 annual_option_value/12
// 顾问：劳务报酬，公司成本 = 顾问费本身；实习生：工资薪金但无社保公积金
export function companyCostOf(employee, period, grantsMap = {}) {
  const type = employee.employment_type || 'employee'
  const base = employee.monthly_base || 0
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
  const ot = employee.ot_amount || 0
  const gross = base + perf + ot
  const isIntern = type === 'intern'
  const fundBase = socialFund(base, employee.city || '上海').base
  const social = isIntern ? 0 : Math.round(fundBase * EMPLOYER_SOCIAL_RATE)
  const fund = isIntern ? 0 : Math.round(fundBase * EMPLOYER_FUND_RATE)
  const supplemental_fund = isIntern ? 0 : Math.round(fundBase * (employee.supplemental_fund_rate || 0))
  // 期权摊销：台账（active grants 的月度摊销）优先，回退 annual_option_value/12
  const grants = grantsMap[employee.id] || []
  const optionAmort = grants.length
    ? grants.reduce((s, g) => s + (g.monthly_amort || 0), 0)
    : Math.round((employee.annual_option_value || 0) / 12)
  return {
    employee_id: employee.id, name: employee.name, department_id: employee.department_id || null,
    department: employee.department || null, city: employee.city || '上海', period,
    base, perf, ot, gross, social, fund, supplemental_fund, option_amort: optionAmort,
    option_source: grants.length ? 'ledger' : 'estimate', employment_type: type,
    total: gross + social + fund + supplemental_fund + optionAmort
  }
}

// 批量：按月聚合某期间的公司成本（按 payroll 表实际发放口径，仅 active/offer 入职的员工计成本）
export function companyCostForPeriod(period, employees, grantsMap = {}) {
  const [y, m] = period.split('-').map(Number)
  return employees
    .filter(e => {
      const hired = (e.hire_month || '2025-01').split('-').map(Number)
      const hiredBefore = hired[0] < y || (hired[0] === y && hired[1] <= m)
      const notDeparted = e.status !== 'departed' || e.leave_month !== period
      return hiredBefore && notDeparted
    })
    .map(e => companyCostOf(e, period, grantsMap))
}
