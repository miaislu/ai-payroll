import { db } from '../db.js'
import { attachAttendance, computeCumulative, monthRange, taxYearStart } from './payroll.js'
import { employeesForPeriod } from './employee_terms.js'

function parseFlags(raw) {
  try { return JSON.parse(raw || '[]') } catch { return [] }
}

export function blockingPayrollIssues(rows) {
  const issues = []
  for (const row of rows || []) {
    const flags = Array.isArray(row.flags) ? row.flags : parseFlags(row.flags)
    for (const flag of flags) {
      if (flag?.kind === 'bad') issues.push({ employee_id: row.employee_id, name: row.name, text: flag.text || '未解决的阻断项' })
    }
  }
  return issues
}

export function livePayrollRows(period) {
  const start = taxYearStart(period) || period
  let records = []
  try {
    records = db.prepare('SELECT * FROM attendance_days WHERE period BETWEEN ? AND ?').all(start, period)
  } catch { /* 迁移前库 */ }
  const frozenRows = db.prepare(`SELECT p.* FROM payroll p
    JOIN payroll_runs r ON r.period=p.period
    WHERE p.period BETWEEN ? AND ?`).all(start, period)
  return computeCumulative(
    monthRange(start, period),
    payrollPeriod => attachAttendance(employeesForPeriod(payrollPeriod), records),
    frozenRows
  ).filter(row => row.period === period)
}

export function persistPayrollRows(period, rows) {
  const ins = db.prepare('INSERT INTO payroll(period,employee_id,name,grade,status,base,perf,ot,gross,social,fund,supplemental_fund,severance,regular_tax,severance_tax,tax,net,flags,city,category,employment_type,special_deduction,supplemental_fund_rate,social_base,fund_base,id_number,bank_account,personal_pension_rate,personal_medical_rate,personal_unemployment_rate) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
  db.prepare('DELETE FROM payroll WHERE period=?').run(period)
  for (const r of rows) {
    ins.run(r.period, r.employee_id, r.name, r.grade, r.status, r.base, r.perf, r.ot, r.gross, r.social, r.fund, r.supplemental_fund || 0, r.severance || 0, r.regular_tax ?? r.tax, r.severance_tax || 0, r.tax, r.net, JSON.stringify(r.flags || []), r.city || null, r.category || null, r.employment_type || null, r.special_deduction ?? r.special ?? 0, r.supplemental_fund_rate || 0, r.social_base || 0, r.fund_base || 0, r.id_number || null, r.bank_account || null, r.personal_pension_rate ?? null, r.personal_medical_rate ?? null, r.personal_unemployment_rate ?? null)
  }
}

export function payrollForPeriod(period) {
  const run = db.prepare('SELECT * FROM payroll_runs WHERE period=?').get(period) || null
  if (run) {
    return { rows: db.prepare('SELECT * FROM payroll WHERE period=? ORDER BY employee_id').all(period), run, live: false }
  }
  return { rows: livePayrollRows(period), run: null, live: true }
}

export function presentPayroll(rows) {
  const cats = db.prepare('SELECT id, category FROM employees').all()
  const catMap = Object.fromEntries(cats.map(c => [c.id, c.category]))
  return rows.map(r => ({
    name: r.name, grade: r.grade, status: r.status, category: r.category || catMap[r.employee_id] || 'tech',
    employee_id: r.employee_id,
    base: r.status === 'departed' ? '离职结算' : r.base.toLocaleString('zh-CN'),
    perf: r.perf ? r.perf.toLocaleString('zh-CN') : '', ot: r.ot ? r.ot.toLocaleString('zh-CN') : '',
    sf: (-(r.social + r.fund)).toLocaleString('zh-CN'),
    supplemental_fund: (-(r.supplemental_fund || 0)).toLocaleString('zh-CN'),
    tax: (-r.tax).toLocaleString('zh-CN'),
    net: r.net.toLocaleString('zh-CN'),
    flags: parseFlags(typeof r.flags === 'string' ? r.flags : JSON.stringify(r.flags || []))
  }))
}

export function grantCliffPassed(grant, period) {
  const start = String(grant.grant_date || '').slice(0, 7)
  if (!/^\d{4}-\d{2}$/.test(start) || !period) return false
  const [sy, sm] = start.split('-').map(Number)
  const [py, pm] = period.split('-').map(Number)
  const elapsed = (py - sy) * 12 + (pm - sm)
  return elapsed >= (Number(grant.cliff_months) || 0)
}

export function fmtCsv(rows) {
  const esc = v => {
    let text = String(v ?? '')
    if (/^[=+\-@]/.test(text)) text = "'" + text
    return `"${text.replace(/"/g, '""')}"`
  }
  return '\uFEFF' + rows.map(r => r.map(esc).join(',')).join('\r\n')
}
