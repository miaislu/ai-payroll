import { db } from '../db.js'
import { currentPeriod, isPeriod } from './periods.js'

const TERM_FIELDS = [
  'grade', 'job_family', 'category', 'monthly_base', 'perf_ratio', 'city', 'department_id', 'employment_type',
  'supplemental_fund_rate', 'special_deduction', 'annual_option_value'
]

export function employeesForPeriod(period) {
  if (!isPeriod(period)) return []
  const employees = db.prepare('SELECT * FROM employees ORDER BY id').all()
  const terms = db.prepare(`SELECT t.* FROM employee_compensation_terms t
    JOIN (
      SELECT employee_id, MAX(effective_month) effective_month
      FROM employee_compensation_terms WHERE effective_month<=? GROUP BY employee_id
    ) latest ON latest.employee_id=t.employee_id AND latest.effective_month=t.effective_month`).all(period)
  const byEmployee = Object.fromEntries(terms.map(term => [term.employee_id, term]))
  const departments = Object.fromEntries(db.prepare('SELECT id,name FROM departments').all().map(row => [row.id, row.name]))
  return employees.map(employee => {
    const term = byEmployee[employee.id]
    const merged = { ...employee }
    if (term) for (const field of TERM_FIELDS) merged[field] = term[field]
    merged.compensation_effective_month = term?.effective_month || null
    merged.department = merged.department_id ? departments[merged.department_id] || null : null
    return merged
  })
}

export function upsertCompensationTerm(employee, effectiveMonth = currentPeriod(), { actor = 'system', sourceApprovalId = null } = {}) {
  if (!employee?.id) throw new Error('薪酬条款缺少员工')
  if (!isPeriod(effectiveMonth)) throw Object.assign(new Error('薪酬生效月份须为 YYYY-MM'), { statusCode: 400 })
  const values = {
    grade: String(employee.grade || ''),
    job_family: String(employee.job_family || ''),
    category: String(employee.category || 'tech'),
    monthly_base: Math.round(Number(employee.monthly_base) || 0),
    perf_ratio: Number(employee.perf_ratio) || 0,
    city: String(employee.city || ''),
    department_id: employee.department_id || null,
    employment_type: employee.employment_type || 'employee',
    supplemental_fund_rate: Number(employee.supplemental_fund_rate) || 0,
    special_deduction: Math.round(Number(employee.special_deduction) || 0),
    annual_option_value: Math.round(Number(employee.annual_option_value) || 0)
  }
  db.prepare(`INSERT INTO employee_compensation_terms(
      employee_id,effective_month,monthly_base,perf_ratio,city,department_id,employment_type,
      supplemental_fund_rate,special_deduction,annual_option_value,source_approval_id,created_by,created_at
      ,grade,job_family,category
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(employee_id,effective_month) DO UPDATE SET
      monthly_base=excluded.monthly_base,perf_ratio=excluded.perf_ratio,city=excluded.city,
      department_id=excluded.department_id,employment_type=excluded.employment_type,
      supplemental_fund_rate=excluded.supplemental_fund_rate,special_deduction=excluded.special_deduction,
      annual_option_value=excluded.annual_option_value,source_approval_id=excluded.source_approval_id,
      created_by=excluded.created_by,created_at=excluded.created_at,
      grade=excluded.grade,job_family=excluded.job_family,category=excluded.category`)
    .run(employee.id, effectiveMonth, values.monthly_base, values.perf_ratio, values.city, values.department_id,
      values.employment_type, values.supplemental_fund_rate, values.special_deduction, values.annual_option_value,
      sourceApprovalId, actor, new Date().toISOString(), values.grade, values.job_family, values.category)
  return { employee_id: employee.id, effective_month: effectiveMonth, ...values }
}

export function periodIsLocked(period) {
  return Boolean(isPeriod(period) && db.prepare('SELECT 1 FROM payroll_runs WHERE period=?').get(period))
}
