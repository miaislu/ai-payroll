import { Router } from 'express'
import { rmSync } from 'node:fs'
import { audit, db, inTransaction } from '../db.js'
import { auth } from '../lib/auth.js'
import { validateEmployee } from '../lib/validators.js'
import { employeesForPeriod, periodIsLocked, upsertCompensationTerm } from '../lib/employee_terms.js'
import { currentPeriod, isDate, isPeriod, monthBounds } from '../lib/periods.js'

export const staff = Router()

const EMP_SENSITIVE = ['monthly_base', 'perf_ratio', 'special_deduction', 'annual_option_value', 'severance_amount', 'id_number', 'bank_account', 'social_security_no', 'housing_fund_no', 'mobile', 'personal_email', 'alternate_mobile', 'current_address', 'permanent_address']
const FINANCE_EMPLOYEE_FIELDS = ['id', 'name', 'grade', 'job_family', 'city', 'category', 'status', 'employment_type', 'department_id', 'hire_month', 'leave_month']

staff.get('/employees', auth(), (req, res) => {
  const rows = employeesForPeriod(currentPeriod())
  if (req.user.role === 'emp') {
    const me = rows.filter(e => e.id === req.user.employee_id).map(e => {
      const o = {}
      for (const k of Object.keys(e)) if (!EMP_SENSITIVE.includes(k)) o[k] = e[k]
      return o
    })
    return res.json(me)
  }
  if (req.user.role === 'finance') {
    return res.json(rows.map(employee => Object.fromEntries(FINANCE_EMPLOYEE_FIELDS.map(key => [key, employee[key]]))))
  }
  res.json(rows)
})

staff.post('/employees', auth(['hr', 'founder']), (req, res) => {
  const { errors, e } = validateEmployee(req.body || {})
  if (errors.length) return res.status(400).json({ error: errors.join('；') })
  const b = req.body || {}
  if (b.status != null && !['active', 'offer', 'departed'].includes(b.status)) return res.status(400).json({ error: '员工状态不合法' })
  if (b.employment_type != null && !['employee', 'consultant', 'intern'].includes(b.employment_type)) return res.status(400).json({ error: '用工类型不合法' })
  const status = b.status || 'active'
  const etype = b.employment_type || 'employee'
  const sfund = Number(b.supplemental_fund_rate ?? 0)
  if (!Number.isFinite(sfund) || sfund < 0 || sfund > 0.08) return res.status(400).json({ error: '补充公积金比例须在 0-0.08' })
  const leaveDate = b.leave_date || (isPeriod(b.leave_month) ? monthBounds(b.leave_month).end : null)
  if (leaveDate && !isDate(leaveDate)) return res.status(400).json({ error: '离职日期须为有效的 YYYY-MM-DD' })
  const leaveMonth = leaveDate?.slice(0, 7) || null
  const severance = Math.max(0, Math.round(Number(b.severance_amount) || 0))
  if (status === 'departed' && !leaveDate) return res.status(400).json({ error: '离职员工必须填写离职日期' })
  if (leaveDate && e.hire_date && leaveDate < e.hire_date) return res.status(400).json({ error: '离职日期不得早于入职日期' })
  const departmentId = b.department_id ? Number(b.department_id) : null
  if (departmentId && !db.prepare('SELECT 1 FROM departments WHERE id=?').get(departmentId)) return res.status(400).json({ error: '部门不存在' })
  const id = inTransaction(() => {
    const r = db.prepare('INSERT INTO employees(name,grade,job_family,city,monthly_base,perf_ratio,special_deduction,hire_month,hire_date,department_id,category,status,employment_type,supplemental_fund_rate,leave_month,leave_date,severance_amount) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(e.name, e.grade, e.job_family, e.city, e.monthly_base, e.perf_ratio, e.special_deduction, e.hire_month, e.hire_date, departmentId, e.category, status, etype, sfund, leaveMonth, leaveDate, severance)
    const employee = db.prepare('SELECT * FROM employees WHERE id=?').get(r.lastInsertRowid)
    upsertCompensationTerm(employee, e.hire_month, { actor: req.user.name })
    audit(req.user, 'create', 'employee', r.lastInsertRowid, null, employee)
    return r.lastInsertRowid
  })
  res.json({ ok: true, id })
})

staff.put('/employees/:id', auth(['hr', 'founder']), (req, res) => {
  const { errors, e } = validateEmployee(req.body || {})
  if (errors.length) return res.status(400).json({ error: errors.join('；') })
  const b = req.body || {}
  if (b.status != null && !['active', 'offer', 'departed'].includes(b.status)) return res.status(400).json({ error: '员工状态不合法' })
  if (b.employment_type != null && !['employee', 'consultant', 'intern'].includes(b.employment_type)) return res.status(400).json({ error: '用工类型不合法' })
  const status = b.status || 'active'
  const etype = b.employment_type || 'employee'
  const sfund = Number(b.supplemental_fund_rate ?? 0)
  if (!Number.isFinite(sfund) || sfund < 0 || sfund > 0.08) return res.status(400).json({ error: '补充公积金比例须在 0-0.08' })
  const leaveDate = b.leave_date || (isPeriod(b.leave_month) ? monthBounds(b.leave_month).end : null)
  if (leaveDate && !isDate(leaveDate)) return res.status(400).json({ error: '离职日期须为有效的 YYYY-MM-DD' })
  const leaveMonth = leaveDate?.slice(0, 7) || null
  const severance = Math.max(0, Math.round(Number(b.severance_amount) || 0))
  if (status === 'departed' && !leaveDate) return res.status(400).json({ error: '离职员工必须填写离职日期' })
  if (leaveDate && e.hire_date && leaveDate < e.hire_date) return res.status(400).json({ error: '离职日期不得早于入职日期' })
  const before = db.prepare('SELECT * FROM employees WHERE id=?').get(req.params.id)
  if (!before) return res.status(404).json({ error: '员工不存在' })
  const latestLocked = db.prepare(`SELECT MAX(p.period) period FROM payroll p
    JOIN payroll_runs r ON r.period=p.period WHERE p.employee_id=?`).get(req.params.id)?.period || null
  const oldHireDate = before.hire_date || (isPeriod(before.hire_month) ? `${before.hire_month}-01` : null)
  if (latestLocked && e.hire_date !== oldHireDate) {
    return res.status(409).json({ error: '该员工已有锁定工资历史，不能修改入职日期' })
  }
  const oldLeaveMonth = before.leave_date?.slice(0, 7) || before.leave_month || null
  if (latestLocked && oldLeaveMonth !== leaveMonth && ((oldLeaveMonth && oldLeaveMonth <= latestLocked) || (leaveMonth && leaveMonth <= latestLocked))) {
    return res.status(409).json({ error: '离职日期变更会影响已锁定工资历史，请通过后续月份补差处理' })
  }
  const effectiveMonth = b.effective_month || currentPeriod()
  if (!isPeriod(effectiveMonth)) return res.status(400).json({ error: '薪酬生效月份须为 YYYY-MM' })
  if (periodIsLocked(effectiveMonth)) return res.status(409).json({ error: '该生效月份已经月结，不可覆盖；请选择后续月份' })
  const departmentId = b.department_id ? Number(b.department_id) : null
  if (departmentId && !db.prepare('SELECT 1 FROM departments WHERE id=?').get(departmentId)) return res.status(400).json({ error: '部门不存在' })
  let after
  inTransaction(() => {
    const immediate = effectiveMonth <= currentPeriod()
    const master = immediate ? { ...e, department_id: departmentId, status, employment_type: etype, supplemental_fund_rate: sfund } : before
    db.prepare('UPDATE employees SET name=?,grade=?,job_family=?,city=?,monthly_base=?,perf_ratio=?,special_deduction=?,hire_month=?,hire_date=?,department_id=?,category=?,status=?,employment_type=?,supplemental_fund_rate=?,leave_month=?,leave_date=?,severance_amount=? WHERE id=?')
      .run(e.name, master.grade, master.job_family, master.city, master.monthly_base, master.perf_ratio, master.special_deduction, e.hire_month, e.hire_date, master.department_id, master.category, status, master.employment_type, master.supplemental_fund_rate, leaveMonth, leaveDate, severance, req.params.id)
    after = db.prepare('SELECT * FROM employees WHERE id=?').get(req.params.id)
    const compensationTerm = upsertCompensationTerm({ ...after, ...e, department_id: departmentId, employment_type: etype, supplemental_fund_rate: sfund }, effectiveMonth, { actor: req.user.name })
    audit(req.user, 'update', 'employee', req.params.id, before, { ...after, effective_month: effectiveMonth, compensation_term: compensationTerm })
  })
  res.json({ ok: true, id: Number(req.params.id) })
})

staff.delete('/employees/:id', auth(['hr', 'founder']), (req, res) => {
  const empId = req.params.id
  const resumes = db.prepare('SELECT file_path FROM employee_resumes WHERE employee_id=?').all(empId)
  const employee = db.prepare('SELECT * FROM employees WHERE id=?').get(empId)
  if (!employee) return res.status(404).json({ error: '员工不存在' })
  if (db.prepare('SELECT 1 FROM payroll WHERE employee_id=? LIMIT 1').get(empId) || db.prepare('SELECT 1 FROM candidates WHERE employee_id=? LIMIT 1').get(empId)) {
    return res.status(409).json({ error: '该员工已有工资或招聘历史，不可物理删除；请改为离职状态' })
  }
  inTransaction(() => {
    for (const t of ['option_grants', 'emergency_contacts', 'employee_education', 'employee_work_experience', 'employee_family', 'employee_events', 'employee_resumes', 'attendance_days', 'performance_reviews', 'employee_compensation_terms']) db.prepare(`DELETE FROM ${t} WHERE employee_id=?`).run(empId)
    db.prepare('UPDATE users SET employee_id=NULL WHERE employee_id=?').run(empId)
    db.prepare('DELETE FROM employees WHERE id=?').run(empId)
    audit(req.user, 'delete', 'employee', empId, employee, null)
  })
  for (const x of resumes) { try { rmSync(x.file_path, { force: true }) } catch { /* 忽略 */ } }
  res.json({ ok: true, id: Number(req.params.id) })
})
