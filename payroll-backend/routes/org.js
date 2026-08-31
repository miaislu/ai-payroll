// 组织架构：部门树 + 员工入转调离事件
import { Router } from 'express'
import { db } from '../db.js'
import { auth } from '../lib/auth.js'

export const org = Router()

// 写操作统一限 hr/founder
const admin = auth(['hr', 'founder'])

// ── 部门 ──
org.get('/departments', (req, res) => {
  const rows = db.prepare('SELECT * FROM departments ORDER BY id').all()
  const emps = db.prepare("SELECT department_id, COUNT(*) c FROM employees WHERE status='active' GROUP BY department_id").all()
  const headcount = Object.fromEntries(emps.map(e => [e.department_id, e.c]))
  // 树形结构（parent_id 引用 id；自增 id 有序保证父先于子）
  const tree = rows.map(d => ({ ...d, headcount: headcount[d.id] || 0, children: [] }))
  const byId = Object.fromEntries(tree.map(d => [d.id, d]))
  const roots = []
  for (const d of tree) {
    if (d.parent_id && byId[d.parent_id]) byId[d.parent_id].children.push(d)
    else roots.push(d)
  }
  res.json({ list: rows, tree: roots, headcount })
})

org.post('/departments', admin, (req, res) => {
  const { name, parent_id = null, head = '', budget_owner = '' } = req.body || {}
  if (!name) return res.status(400).json({ error: '缺少部门名称' })
  const r = db.prepare('INSERT INTO departments(name,parent_id,head,budget_owner) VALUES(?,?,?,?)').run(name, parent_id, head, budget_owner)
  res.json({ ok: true, id: r.lastInsertRowid })
})

org.put('/departments/:id', admin, (req, res) => {
  const { name, parent_id, head, budget_owner } = req.body || {}
  const r = db.prepare('UPDATE departments SET name=COALESCE(?,name), parent_id=?, head=COALESCE(?,head), budget_owner=COALESCE(?,budget_owner) WHERE id=?')
    .run(name || null, parent_id ?? null, head || null, budget_owner || null, req.params.id)
  if (!r.changes) return res.status(404).json({ error: '部门不存在' })
  res.json({ ok: true, id: Number(req.params.id) })
})

org.delete('/departments/:id', admin, (req, res) => {
  const id = Number(req.params.id)
  const child = db.prepare('SELECT COUNT(*) c FROM departments WHERE parent_id=?').get(id).c
  if (child > 0) return res.status(400).json({ error: `该部门下有 ${child} 个子部门，请先删除或迁移子部门` })
  const emp = db.prepare('SELECT COUNT(*) c FROM employees WHERE department_id=?').get(id).c
  if (emp > 0) return res.status(400).json({ error: `该部门下仍有 ${emp} 名员工，请先迁移员工` })
  for (const [table, label] of [['job_requisitions', '招聘需求'], ['cost_budgets', '预算'], ['headcount_plan', '编制计划']]) {
    const count = db.prepare(`SELECT COUNT(*) c FROM ${table} WHERE department_id=?`).get(id).c
    if (count > 0) return res.status(409).json({ error: `该部门仍关联 ${count} 条${label}，请先迁移或关闭` })
  }
  const r = db.prepare('DELETE FROM departments WHERE id=?').run(id)
  if (!r.changes) return res.status(404).json({ error: '部门不存在' })
  res.json({ ok: true, id })
})

// ── 员工入转调离事件 ──
org.get('/employees/:id/events', (req, res) => {
  res.json(db.prepare('SELECT * FROM employee_events WHERE employee_id=? ORDER BY event_date').all(req.params.id))
})

org.post('/employees/:id/events', admin, (req, res) => {
  const { type, event_date, from_value = null, to_value = null, note = '' } = req.body || {}
  if (!type || !event_date) return res.status(400).json({ error: '缺少类型或日期' })
  const r = db.prepare('INSERT INTO employee_events(employee_id,type,event_date,from_value,to_value,note) VALUES(?,?,?,?,?,?)')
    .run(req.params.id, type, event_date, from_value, to_value, note)
  res.json({ ok: true, id: r.lastInsertRowid })
})

org.delete('/events/:id', admin, (req, res) => {
  const r = db.prepare('DELETE FROM employee_events WHERE id=?').run(req.params.id)
  if (!r.changes) return res.status(404).json({ error: '事件不存在' })
  res.json({ ok: true })
})

// 组织总览统计：部门编制 vs 实际（供组织页 + 成本预测用）
org.get('/org/overview', (req, res) => {
  const depts = db.prepare('SELECT id, name FROM departments WHERE parent_id IS NULL').all()
  const actual = db.prepare("SELECT department_id, COUNT(*) c FROM employees WHERE status='active' GROUP BY department_id").all()
  const plans = db.prepare('SELECT department_id, SUM(planned) p, MAX(year_month) m FROM headcount_plan GROUP BY department_id').all()
  const map = Object.fromEntries(actual.map(a => [a.department_id, a.c]))
  const planMap = Object.fromEntries(plans.map(p => [p.department_id, p.p]))
  res.json({
    totalActual: actual.reduce((s, a) => s + a.c, 0),
    totalPlan: plans.reduce((s, p) => s + p.p, 0),
    departments: depts.map(d => ({ ...d, actual: map[d.id] || 0, planned: planMap[d.id] || 0 }))
  })
})
