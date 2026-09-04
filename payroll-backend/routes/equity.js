// 期权授予台账：期权池 / 授予记录 CRUD / 汇总（摊销联动成本预测）
import { Router } from 'express'
import { audit, db, inTransaction } from '../db.js'
import { auth } from '../lib/auth.js'
import { FINANCE_ROLES } from '../lib/access.js'
import { isDate } from '../lib/periods.js'

export const equity = Router()
export const GRANT_STATUS = ['granted', 'vested', 'exercised', 'forfeited']

// 计算授予价值：total_value = share_count×10000 × (fair_value - exercise_price)；monthly_amort = total_value / vesting_months
function calcGrant(b) {
  const share = Number(b.share_count) || 0
  const fair = Number(b.fair_value) || 0
  const exercise = Number(b.exercise_price) || 0
  const vesting = Number(b.vesting_months ?? 48)
  const total_value = Math.round(share * 10000 * (fair - exercise))
  const monthly_amort = vesting > 0 ? Math.round(total_value / vesting) : 0
  return { share, fair, exercise, vesting, total_value, monthly_amort }
}

// ── 期权池 ──
equity.get('/pool', (req, res) => {
  const pool = db.prepare('SELECT * FROM option_pool WHERE id=1').get() || { id: 1, pool_percent: 0, total_shares: 0, valuation_wan: 0, updated_at: null }
  const granted = db.prepare("SELECT COALESCE(SUM(share_count),0) s FROM option_grants WHERE status IN ('granted','vested','exercised')").get().s
  const activeEmployees = db.prepare("SELECT COUNT(DISTINCT employee_id) c FROM option_grants WHERE status IN ('granted','vested')").get().c
  const monthlyAmort = db.prepare("SELECT COALESCE(SUM(monthly_amort),0) s FROM option_grants WHERE status='granted'").get().s
  const sharePrice = pool.total_shares > 0 ? Math.round(pool.valuation_wan * 10000 / (pool.total_shares * 10000) * 100) / 100 : 0
  res.json({
    ...pool,
    granted_shares: Math.round(granted * 100) / 100,
    remaining_shares: Math.round((pool.total_shares - granted) * 100) / 100,
    active_employees: activeEmployees,
    monthly_amort: monthlyAmort,
    annual_amort: monthlyAmort * 12,
    share_price: sharePrice
  })
})

equity.put('/pool', auth(FINANCE_ROLES), (req, res) => {
  const b = req.body || {}
  if (b.pool_percent !== undefined && (!Number.isFinite(Number(b.pool_percent)) || Number(b.pool_percent) < 0 || Number(b.pool_percent) > 100)) return res.status(400).json({ error: '期权池比例须在 0-100 之间' })
  if (b.total_shares !== undefined && (!Number.isFinite(Number(b.total_shares)) || Number(b.total_shares) <= 0)) return res.status(400).json({ error: '总股数须 >0' })
  if (b.valuation_wan !== undefined && (!Number.isFinite(Number(b.valuation_wan)) || Number(b.valuation_wan) < 0)) return res.status(400).json({ error: '估值不得为负数' })
  const granted = db.prepare("SELECT COALESCE(SUM(share_count),0) s FROM option_grants WHERE status IN ('granted','vested','exercised')").get().s
  if (b.total_shares !== undefined && Number(b.total_shares) < granted) return res.status(409).json({ error: `总股数不能低于已授予 ${granted}` })
  const before = db.prepare('SELECT * FROM option_pool WHERE id=1').get() || null
  if (!before && b.total_shares === undefined) return res.status(400).json({ error: '首次配置期权池必须填写总股数' })
  inTransaction(() => {
    const r = db.prepare('UPDATE option_pool SET pool_percent=COALESCE(?,pool_percent), total_shares=COALESCE(?,total_shares), valuation_wan=COALESCE(?,valuation_wan), updated_at=? WHERE id=1')
      .run(b.pool_percent ?? null, b.total_shares ?? null, b.valuation_wan ?? null, new Date().toISOString().slice(0, 10))
    if (!r.changes) {
      db.prepare('INSERT INTO option_pool(id,pool_percent,total_shares,valuation_wan,updated_at) VALUES(1,?,?,?,?)')
        .run(b.pool_percent ?? 0, b.total_shares ?? 0, b.valuation_wan ?? 0, new Date().toISOString().slice(0, 10))
    }
    audit(req.user, before ? 'update' : 'create', 'option_pool', 1, before, db.prepare('SELECT * FROM option_pool WHERE id=1').get())
  })
  res.json({ ok: true })
})

// ── 授予记录 ──
equity.get('/grants', (req, res) => {
  const { employee_id } = req.query
  let rows
  if (employee_id) rows = db.prepare('SELECT * FROM option_grants WHERE employee_id=? ORDER BY grant_date DESC').all(employee_id)
  else rows = db.prepare('SELECT * FROM option_grants ORDER BY grant_date DESC, id DESC').all()
  const emps = Object.fromEntries(db.prepare('SELECT id, name, grade, job_family FROM employees').all().map(e => [e.id, e]))
  res.json(rows.map(g => ({ ...g, employee_name: emps[g.employee_id]?.name || '（已删除）', grade: emps[g.employee_id]?.grade || '', job_family: emps[g.employee_id]?.job_family || '' })))
})

equity.post('/grants', auth(FINANCE_ROLES), (req, res) => {
  const b = req.body || {}
  if (!b.employee_id || !b.share_count) return res.status(400).json({ error: '缺少员工或授予股数' })
  const emp = db.prepare('SELECT id FROM employees WHERE id=?').get(b.employee_id)
  if (!emp) return res.status(400).json({ error: '员工不存在' })
  if (Number(b.share_count) <= 0) return res.status(400).json({ error: '授予股数须 >0' })
  if (b.grant_date && !isDate(b.grant_date)) return res.status(400).json({ error: '授予日期不合法' })
  if (![b.share_count, b.fair_value ?? 0, b.exercise_price ?? 0, b.vesting_months ?? 48, b.cliff_months ?? 12].every(x => Number.isFinite(Number(x)))) return res.status(400).json({ error: '授予数值字段不合法' })
  if (Number(b.fair_value) < Number(b.exercise_price)) return res.status(400).json({ error: '公允价须 ≥ 行权价' })
  if (b.status && !GRANT_STATUS.includes(b.status)) return res.status(400).json({ error: '授予状态不合法' })
  const c = calcGrant(b)
  const cliff = Number(b.cliff_months ?? 12)
  if (c.vesting < 1 || c.vesting > 120 || cliff < 0 || cliff > c.vesting) return res.status(400).json({ error: '归属期须为 1-120 月，cliff 不得超过归属期' })
  const pool = db.prepare('SELECT total_shares FROM option_pool WHERE id=1').get()
  if (!pool) return res.status(409).json({ error: '请先由财务或 CEO 配置期权池' })
  const granted = db.prepare("SELECT COALESCE(SUM(share_count),0) s FROM option_grants WHERE status IN ('granted','vested','exercised')").get().s
  if (pool && granted + c.share > pool.total_shares) return res.status(409).json({ error: '授予股数超过期权池剩余额度' })
  let id
  inTransaction(() => {
    const r = db.prepare('INSERT INTO option_grants(employee_id,grant_date,share_count,exercise_price,fair_value,vesting_months,cliff_months,total_value,monthly_amort,status,note) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(b.employee_id, b.grant_date || new Date().toISOString().slice(0, 10), c.share, c.exercise, c.fair, c.vesting, cliff, c.total_value, c.monthly_amort, b.status || 'granted', b.note || '')
    id = r.lastInsertRowid
    audit(req.user, 'create', 'option_grant', id, null, db.prepare('SELECT * FROM option_grants WHERE id=?').get(id))
  })
  res.json({ ok: true, id, total_value: c.total_value, monthly_amort: c.monthly_amort })
})

equity.put('/grants/:id', auth(FINANCE_ROLES), (req, res) => {
  const b = req.body || {}
  const cur = db.prepare('SELECT * FROM option_grants WHERE id=?').get(req.params.id)
  if (!cur) return res.status(404).json({ error: '授予记录不存在' })
  const merged = {
    share_count: b.share_count ?? cur.share_count, exercise_price: b.exercise_price ?? cur.exercise_price,
    fair_value: b.fair_value ?? cur.fair_value, vesting_months: b.vesting_months ?? cur.vesting_months
  }
  const c = calcGrant(merged)
  const cliff = b.cliff_months ?? cur.cliff_months
  if (b.grant_date && !isDate(b.grant_date)) return res.status(400).json({ error: '授予日期不合法' })
  if (![merged.share_count, merged.fair_value, merged.exercise_price, merged.vesting_months, cliff].every(x => Number.isFinite(Number(x)))) return res.status(400).json({ error: '授予数值字段不合法' })
  if (c.share <= 0 || c.fair < c.exercise) return res.status(400).json({ error: '授予股数须 >0，公允价须 ≥ 行权价' })
  if (c.vesting < 1 || c.vesting > 120 || Number(cliff) < 0 || Number(cliff) > c.vesting) return res.status(400).json({ error: '归属期须为 1-120 月，cliff 不得超过归属期' })
  if (b.status && !GRANT_STATUS.includes(b.status)) return res.status(400).json({ error: '授予状态不合法' })
  const pool = db.prepare('SELECT total_shares FROM option_pool WHERE id=1').get()
  const grantedOther = db.prepare("SELECT COALESCE(SUM(share_count),0) s FROM option_grants WHERE id<>? AND status IN ('granted','vested','exercised')").get(req.params.id).s
  const nextStatus = b.status || cur.status
  if (pool && ['granted', 'vested', 'exercised'].includes(nextStatus) && grantedOther + c.share > pool.total_shares) return res.status(409).json({ error: '授予股数超过期权池剩余额度' })
  inTransaction(() => {
    db.prepare('UPDATE option_grants SET share_count=?, exercise_price=?, fair_value=?, vesting_months=?, cliff_months=COALESCE(?,cliff_months), total_value=?, monthly_amort=?, status=COALESCE(?,status), note=COALESCE(?,note), grant_date=COALESCE(?,grant_date) WHERE id=?')
      .run(c.share, c.exercise, c.fair, c.vesting, cliff, c.total_value, c.monthly_amort, b.status || null, b.note || null, b.grant_date || null, req.params.id)
    audit(req.user, 'update', 'option_grant', req.params.id, cur, db.prepare('SELECT * FROM option_grants WHERE id=?').get(req.params.id))
  })
  res.json({ ok: true, id: Number(req.params.id), total_value: c.total_value, monthly_amort: c.monthly_amort })
})

equity.delete('/grants/:id', auth(FINANCE_ROLES), (req, res) => {
  const before = db.prepare('SELECT * FROM option_grants WHERE id=?').get(req.params.id)
  if (!before) return res.status(404).json({ error: '授予记录不存在' })
  inTransaction(() => {
    db.prepare('DELETE FROM option_grants WHERE id=?').run(req.params.id)
    audit(req.user, 'delete', 'option_grant', req.params.id, before, null)
  })
  res.json({ ok: true })
})

// ── 汇总：按员工/按部门 摊销分布 ──
equity.get('/summary', (req, res) => {
  const grants = db.prepare("SELECT g.*, e.name, e.department_id, d.name AS department FROM option_grants g LEFT JOIN employees e ON g.employee_id=e.id LEFT JOIN departments d ON e.department_id=d.id WHERE g.status='granted'").all()
  const totalMonthly = grants.reduce((s, g) => s + (g.monthly_amort || 0), 0)
  const byEmployee = grants.map(g => ({ employee_id: g.employee_id, name: g.name, department: g.department, monthly_amort: g.monthly_amort, total_value: g.total_value }))
  const byDept = {}
  for (const g of grants) {
    const key = g.department || '未分配'
    byDept[key] = byDept[key] || { monthly: 0, total: 0 }
    byDept[key].monthly += g.monthly_amort || 0
    byDept[key].total += g.total_value || 0
  }
  res.json({
    totalMonthly, totalAnnual: totalMonthly * 12,
    byEmployee, byDept: Object.entries(byDept).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.monthly - a.monthly)
  })
})
