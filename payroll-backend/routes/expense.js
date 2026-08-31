// 报销与预支（Expense Claim + Employee Advance，参考 Frappe HR）
import { Router } from 'express'
import { db } from '../db.js'

export const expense = Router()

export const EXPENSE_TYPES = ['差旅', '餐饮', '交通', '办公', '招待', '其他']
const CLAIM_STATUS = ['draft', 'submitted', 'approved', 'rejected', 'paid']
const ADVANCE_STATUS = ['submitted', 'approved', 'repaid', 'cleared']

const empName = id => db.prepare('SELECT name FROM employees WHERE id=?').get(id)?.name || '（已删除）'

// emp 只能看/操作自己的；hr/founder 全部
function scope(req) {
  return req.user.role === 'emp' ? req.user.employee_id : null
}
function isAdmin(req) {
  return ['hr', 'founder'].includes(req.user.role)
}

// ── 报销单 ──
expense.get('/claims', (req, res) => {
  const own = scope(req)
  let rows
  if (own) rows = db.prepare('SELECT * FROM expense_claims WHERE employee_id=? ORDER BY id DESC').all(own)
  else rows = db.prepare('SELECT * FROM expense_claims ORDER BY (status=\'submitted\') DESC, id DESC').all()
  res.json(rows.map(c => ({ ...c, employee_name: empName(c.employee_id) })))
})

expense.post('/claims', (req, res) => {
  const b = req.body || {}
  const employee_id = isAdmin(req) ? (b.employee_id || req.user.employee_id) : req.user.employee_id
  if (!employee_id) return res.status(400).json({ error: '缺少员工' })
  if (!b.amount || Number(b.amount) <= 0) return res.status(400).json({ error: '金额须 >0' })
  if (!EXPENSE_TYPES.includes(b.expense_type)) return res.status(400).json({ error: '费用类型不合法' })
  const r = db.prepare('INSERT INTO expense_claims(employee_id,expense_type,amount,claim_date,description,status,submitted_by,submitted_at,advance_offset) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(employee_id, b.expense_type, Number(b.amount), b.claim_date || new Date().toISOString().slice(0, 10), b.description || '', 'submitted', req.user.name, new Date().toISOString().slice(0, 19).replace('T', ' '), Number(b.advance_offset) || 0)
  res.json({ ok: true, id: r.lastInsertRowid })
})

// 审批报销（approve/reject，带意见留痕；approve 时核销预支）
expense.post('/claims/:id/action', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: '无权限' })
  const { action, comment } = req.body || {}
  if (!['approve', 'reject', 'pay'].includes(action)) return res.status(400).json({ error: 'action 须为 approve/reject/pay' })
  const c = db.prepare('SELECT * FROM expense_claims WHERE id=?').get(req.params.id)
  if (!c) return res.status(404).json({ error: '报销单不存在' })
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ')
  let status = c.status
  if (action === 'approve') status = 'approved'
  else if (action === 'reject') status = 'rejected'
  else if (action === 'pay') status = 'paid'
  db.prepare('UPDATE expense_claims SET status=?, approver=?, approved_at=?, comment=COALESCE(?,comment) WHERE id=?')
    .run(status, req.user.name, now, comment || null, req.params.id)
  // 核销预支：approve 且 advance_offset > 0 时，从该员工未核销预支中扣减
  if (action === 'approve' && c.advance_offset > 0) {
    let remain = c.advance_offset
    const advances = db.prepare("SELECT * FROM employee_advances WHERE employee_id=? AND status='approved' AND outstanding > 0 ORDER BY id").all(c.employee_id)
    for (const a of advances) {
      if (remain <= 0) break
      const deduct = Math.min(remain, a.outstanding)
      const newOutstanding = a.outstanding - deduct
      db.prepare('UPDATE employee_advances SET outstanding=?, status=? WHERE id=?')
        .run(newOutstanding, newOutstanding === 0 ? 'cleared' : 'approved', a.id)
      remain -= deduct
    }
  }
  res.json({ ok: true, id: Number(req.params.id), status })
})

expense.delete('/claims/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM expense_claims WHERE id=?').get(req.params.id)
  if (!c) return res.status(404).json({ error: '报销单不存在' })
  if (!isAdmin(req) && c.employee_id !== req.user.employee_id) return res.status(403).json({ error: '无权限' })
  if (c.status === 'approved' || c.status === 'paid') return res.status(400).json({ error: '已审批/已打款的报销不可删除' })
  db.prepare('DELETE FROM expense_claims WHERE id=?').run(req.params.id)
  res.json({ ok: true })
})

// ── 预支 ──
expense.get('/advances', (req, res) => {
  const own = scope(req)
  let rows
  if (own) rows = db.prepare('SELECT * FROM employee_advances WHERE employee_id=? ORDER BY id DESC').all(own)
  else rows = db.prepare('SELECT * FROM employee_advances ORDER BY (status=\'submitted\') DESC, id DESC').all()
  res.json(rows.map(a => ({ ...a, employee_name: empName(a.employee_id) })))
})

expense.post('/advances', (req, res) => {
  const b = req.body || {}
  const employee_id = isAdmin(req) ? (b.employee_id || req.user.employee_id) : req.user.employee_id
  if (!employee_id) return res.status(400).json({ error: '缺少员工' })
  if (!b.amount || Number(b.amount) <= 0) return res.status(400).json({ error: '金额须 >0' })
  const r = db.prepare('INSERT INTO employee_advances(employee_id,amount,reason,advance_date,status,outstanding) VALUES(?,?,?,?,?,?)')
    .run(employee_id, Number(b.amount), b.reason || '', b.advance_date || new Date().toISOString().slice(0, 10), 'submitted', 0)
  res.json({ ok: true, id: r.lastInsertRowid })
})

// 审批预支（approve 时 outstanding = amount 开始记未核销）
expense.post('/advances/:id/action', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: '无权限' })
  const { action, comment } = req.body || {}
  if (!['approve', 'reject', 'repay'].includes(action)) return res.status(400).json({ error: 'action 须为 approve/reject/repay' })
  const a = db.prepare('SELECT * FROM employee_advances WHERE id=?').get(req.params.id)
  if (!a) return res.status(404).json({ error: '预支不存在' })
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ')
  let status = a.status
  if (action === 'approve') status = 'approved'
  else if (action === 'reject') status = 'rejected'
  else if (action === 'repay') status = 'repaid'
  const outstanding = action === 'approve' ? a.amount : (action === 'repay' ? 0 : a.outstanding)
  db.prepare('UPDATE employee_advances SET status=?, outstanding=?, approver=?, approved_at=?, comment=COALESCE(?,comment) WHERE id=?')
    .run(status, outstanding, req.user.name, now, comment || null, req.params.id)
  res.json({ ok: true, id: Number(req.params.id), status })
})

expense.delete('/advances/:id', (req, res) => {
  const a = db.prepare('SELECT * FROM employee_advances WHERE id=?').get(req.params.id)
  if (!a) return res.status(404).json({ error: '预支不存在' })
  if (!isAdmin(req) && a.employee_id !== req.user.employee_id) return res.status(403).json({ error: '无权限' })
  if (a.status !== 'submitted') return res.status(400).json({ error: '已审批的预支不可删除' })
  db.prepare('DELETE FROM employee_advances WHERE id=?').run(req.params.id)
  res.json({ ok: true })
})
