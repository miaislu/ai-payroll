import { Router } from 'express'
import { audit, db, inTransaction } from '../db.js'
import { auth } from '../lib/auth.js'
import { canReadEmployeeEvents } from '../lib/access.js'
import { overtimePay } from '../lib/payroll.js'
import { isCycle, RATINGS, suggestRaise } from '../lib/performance.js'
import { nextApprovalId } from '../lib/approvals.js'
import { addMonths, currentPeriod, isPeriod, monthBounds, weekdaysInRange } from '../lib/periods.js'
import { periodIsLocked } from '../lib/employee_terms.js'

export const people = Router()

function clampHours(value, max = 200) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.min(max, Math.round(n * 10) / 10)
}

people.get('/attendance', auth(), (req, res) => {
  const period = req.query.period || new Date().toISOString().slice(0, 7)
  if (!isPeriod(period)) return res.status(400).json({ error: 'period 须为 YYYY-MM' })
  const own = req.user.role === 'emp'
  if (own && !req.user.employee_id) return res.json({ period, rows: [] })
  const emps = own
    ? db.prepare('SELECT id, name, grade, job_family, monthly_base, status FROM employees WHERE id=?').all(req.user.employee_id)
    : db.prepare("SELECT id, name, grade, job_family, monthly_base, status FROM employees WHERE status='active' OR (status='departed' AND leave_month>=?) ORDER BY id").all(period)
  const recs = Object.fromEntries(db.prepare('SELECT * FROM attendance_days WHERE period=?').all(period).map(r => [r.employee_id, r]))
  const rows = emps.map(e => {
    const bounds = monthBounds(period)
    const defaultDays = bounds ? weekdaysInRange(bounds.start, bounds.end) : 21.75
    const rec = recs[e.id] || { work_days: defaultDays, scheduled_work_days: defaultDays, ot_weekday_hours: 0, ot_rest_hours: 0, ot_holiday_hours: 0, unpaid_leave_days: 0, note: '' }
    const merged = { ...rec, employee_id: e.id, period }
    return {
      employee_id: e.id, name: e.name, grade: e.grade, job_family: e.job_family, status: e.status,
      period, work_days: rec.work_days ?? defaultDays, scheduled_work_days: rec.scheduled_work_days ?? defaultDays, ot_weekday_hours: rec.ot_weekday_hours || 0,
      ot_rest_hours: rec.ot_rest_hours || 0, ot_holiday_hours: rec.ot_holiday_hours || 0,
      unpaid_leave_days: rec.unpaid_leave_days || 0, note: rec.note || '',
      ot_amount: overtimePay(e.monthly_base, merged),
      has_record: Boolean(recs[e.id])
    }
  })
  res.json({ period, rows })
})

people.put('/attendance', auth(['hr', 'founder']), (req, res) => {
  const period = req.body?.period
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : []
  if (!isPeriod(period)) return res.status(400).json({ error: 'period 须为 YYYY-MM' })
  if (periodIsLocked(period)) return res.status(409).json({ error: '该月工资已锁定，考勤不可直接修改；请在后续月份办理补差调整' })
  if (!rows.length) return res.status(400).json({ error: '缺少考勤行' })
  if (rows.length > 200) return res.status(400).json({ error: '单次最多 200 人' })
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ')
  const upsert = db.prepare(`INSERT INTO attendance_days(employee_id,period,work_days,ot_weekday_hours,ot_rest_hours,ot_holiday_hours,unpaid_leave_days,note,updated_at,scheduled_work_days)
    VALUES(?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(employee_id, period) DO UPDATE SET
      work_days=excluded.work_days, ot_weekday_hours=excluded.ot_weekday_hours, ot_rest_hours=excluded.ot_rest_hours,
      ot_holiday_hours=excluded.ot_holiday_hours, unpaid_leave_days=excluded.unpaid_leave_days, note=excluded.note,
      updated_at=excluded.updated_at, scheduled_work_days=excluded.scheduled_work_days`)
  inTransaction(() => {
    for (const row of rows) {
      const empId = Number(row.employee_id)
      if (!empId || !db.prepare('SELECT id FROM employees WHERE id=?').get(empId)) continue
      const workDays = clampHours(row.work_days, 31)
      const scheduledDays = clampHours(row.scheduled_work_days, 31)
      if (scheduledDays <= 0 || workDays > scheduledDays) throw Object.assign(new Error('计划工作日须大于 0，计薪天数不得超过计划工作日'), { statusCode: 400 })
      const weekday = clampHours(row.ot_weekday_hours)
      const rest = clampHours(row.ot_rest_hours)
      const holiday = clampHours(row.ot_holiday_hours)
      const unpaid = clampHours(row.unpaid_leave_days, 22)
      const note = String(row.note || '').slice(0, 200)
      const empty = !workDays && !weekday && !rest && !holiday && !unpaid && !note
      const existing = db.prepare('SELECT id FROM attendance_days WHERE employee_id=? AND period=?').get(empId, period)
      if (empty && !existing) continue
      upsert.run(empId, period, workDays, weekday, rest, holiday, unpaid, note, now, scheduledDays)
    }
    audit(req.user, 'upsert', 'attendance', period, null, { period, count: rows.length })
  })
  res.json({ ok: true, period, count: rows.length })
})

people.get('/performance', auth(), (req, res) => {
  const cycle = req.query.cycle || `${currentPeriod().slice(0, 4)}-${Number(currentPeriod().slice(5)) <= 6 ? 'H1' : 'H2'}`
  if (!isCycle(cycle)) return res.status(400).json({ error: 'cycle 须为 YYYY-H1 或 YYYY-H2' })
  const own = req.user.role === 'emp'
  if (!own && !['hr', 'founder'].includes(req.user.role)) return res.status(403).json({ error: '仅 HR、CEO 或员工本人可查看绩效' })
  let rows
  if (own) {
    if (!req.user.employee_id) return res.json({ cycle, rows: [] })
    rows = db.prepare('SELECT * FROM performance_reviews WHERE cycle=? AND employee_id=?').all(cycle, req.user.employee_id)
  } else {
    rows = db.prepare('SELECT * FROM performance_reviews WHERE cycle=? ORDER BY id').all(cycle)
  }
  const emps = Object.fromEntries(db.prepare('SELECT id, name, grade, job_family, monthly_base, flag FROM employees').all().map(e => [e.id, e]))
  res.json({
    cycle,
    rows: rows.map(r => {
      const emp = emps[r.employee_id] || {}
      return { ...r, name: emp.name, grade: emp.grade, job_family: emp.job_family, monthly_base: emp.monthly_base, flag: emp.flag, suggest: suggestRaise(emp.monthly_base, r.rating) }
    })
  })
})

people.post('/performance', auth(['hr', 'founder']), (req, res) => {
  const b = req.body || {}
  const empId = Number(b.employee_id)
  const cycle = String(b.cycle || '')
  const rating = String(b.rating || '')
  if (!empId || !db.prepare('SELECT id FROM employees WHERE id=?').get(empId)) return res.status(400).json({ error: '员工不存在' })
  if (!isCycle(cycle)) return res.status(400).json({ error: 'cycle 须为 YYYY-H1 或 YYYY-H2' })
  if (!RATINGS.includes(rating)) return res.status(400).json({ error: '评级须为 S/A/B/C/D' })
  const score = b.score == null || b.score === '' ? null : Number(b.score)
  if (score != null && (!Number.isFinite(score) || score < 0 || score > 100)) return res.status(400).json({ error: '分数须在 0-100' })
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ')
  const existing = db.prepare('SELECT id FROM performance_reviews WHERE employee_id=? AND cycle=?').get(empId, cycle)
  if (existing) {
    db.prepare('UPDATE performance_reviews SET rating=?, score=?, comment=?, created_by=? WHERE id=?')
      .run(rating, score, String(b.comment || '').slice(0, 500), req.user.name, existing.id)
    audit(req.user, 'update', 'performance', existing.id, existing, { employee_id: empId, cycle, rating, score })
    return res.json({ ok: true, id: existing.id })
  }
  const r = db.prepare('INSERT INTO performance_reviews(employee_id,cycle,rating,score,comment,created_by,created_at) VALUES(?,?,?,?,?,?,?)')
    .run(empId, cycle, rating, score, String(b.comment || '').slice(0, 500), req.user.name, now)
  audit(req.user, 'create', 'performance', r.lastInsertRowid, null, { employee_id: empId, cycle, rating, score })
  res.json({ ok: true, id: r.lastInsertRowid })
})

people.delete('/performance/:id', auth(['hr', 'founder']), (req, res) => {
  const row = db.prepare('SELECT * FROM performance_reviews WHERE id=?').get(req.params.id)
  if (!row) return res.status(404).json({ error: '绩效记录不存在' })
  db.prepare('DELETE FROM performance_reviews WHERE id=?').run(req.params.id)
  audit(req.user, 'delete', 'performance', req.params.id, row, null)
  res.json({ ok: true })
})

people.post('/performance/:id/raise', auth(['hr', 'founder']), (req, res) => {
  const review = db.prepare('SELECT * FROM performance_reviews WHERE id=?').get(req.params.id)
  if (!review) return res.status(404).json({ error: '绩效记录不存在' })
  if (!canReadEmployeeEvents(req.user, review.employee_id)) return res.status(403).json({ error: '无权限' })
  const emp = db.prepare('SELECT * FROM employees WHERE id=?').get(review.employee_id)
  if (!emp) return res.status(400).json({ error: '员工不存在' })
  const suggest = suggestRaise(emp.monthly_base, review.rating)
  if (!suggest || suggest.pct <= 0) return res.status(409).json({ error: `评级 ${review.rating} 不建议调薪` })
  const pending = db.prepare("SELECT id FROM approvals WHERE type='raise' AND status='pending' AND json_extract(payload_json, '$.employee_id')=?").get(emp.id)
  if (pending) return res.status(409).json({ error: `该员工已有待审调薪 ${pending.id}` })
  const id = nextApprovalId()
  const payload = {
    kind: 'raise',
    employee_id: emp.id,
    from_monthly: suggest.from_monthly,
    to_monthly: suggest.to_monthly,
    option_share_count: 0,
    rating: review.rating,
    cycle: review.cycle,
    effective_month: addMonths(currentPeriod(), 1),
    note: `${review.cycle} 绩效 ${review.rating}`
  }
  const key = `+${Math.round(suggest.pct * 100)}%（${Math.round(suggest.annual_from / 10000)}万 → ${Math.round(suggest.annual_to / 10000)}万）`
  db.prepare('INSERT INTO approvals(id,type,title,who,key,summary,status,page,payload_json,created_by_user_id) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(id, 'raise', `调薪申请 · ${emp.name}（${emp.job_family} ${emp.grade}）`, `${req.user.name} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`, key, payload.note, 'pending', 'raise-approval', JSON.stringify(payload), req.user.id)
  audit(req.user, 'create', 'approval', id, null, payload)
  res.json({ ok: true, id, key })
})
