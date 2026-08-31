// 报销与预支（Expense Claim + Employee Advance，参考 Frappe HR）
import { Router } from 'express'
import { audit, db, inTransaction } from '../db.js'
import { nextAdvanceStatus, nextClaimStatus } from '../lib/workflows.js'

export const expense = Router()

export const EXPENSE_TYPES = ['差旅', '餐饮', '交通', '办公', '招待', '其他']
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
  const amount = Number(b.amount)
  const offset = Number(b.advance_offset) || 0
  if (!employee_id) return res.status(400).json({ error: '缺少员工' })
  if (!db.prepare('SELECT id FROM employees WHERE id=?').get(employee_id)) return res.status(400).json({ error: '员工不存在' })
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: '金额须 >0' })
  if (!Number.isFinite(offset) || offset < 0 || offset > amount) return res.status(400).json({ error: '预支核销金额须在 0 到报销金额之间' })
  if (!EXPENSE_TYPES.includes(b.expense_type)) return res.status(400).json({ error: '费用类型不合法' })
  const r = db.prepare('INSERT INTO expense_claims(employee_id,expense_type,amount,claim_date,description,status,submitted_by,submitted_at,advance_offset) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(employee_id, b.expense_type, Math.round(amount), b.claim_date || new Date().toISOString().slice(0, 10), b.description || '', 'submitted', req.user.name, new Date().toISOString().slice(0, 19).replace('T', ' '), Math.round(offset))
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
  const status = nextClaimStatus(c.status, action)
  if (!status) return res.status(409).json({ error: `报销单状态 ${c.status} 不允许执行 ${action}` })
  try {
    inTransaction(() => {
      if (action === 'approve' && c.advance_offset > 0) {
        const available = db.prepare("SELECT COALESCE(SUM(outstanding),0) n FROM employee_advances WHERE employee_id=? AND status='approved' AND outstanding>0").get(c.employee_id).n
        if (available < c.advance_offset) throw Object.assign(new Error(`可核销预支仅 ${available} 元`), { statusCode: 409 })
        let remain = c.advance_offset
        const advances = db.prepare("SELECT * FROM employee_advances WHERE employee_id=? AND status='approved' AND outstanding > 0 ORDER BY id").all(c.employee_id)
        for (const a of advances) {
          if (remain <= 0) break
          const deduct = Math.min(remain, a.outstanding)
          const newOutstanding = a.outstanding - deduct
          db.prepare('UPDATE employee_advances SET outstanding=?, status=? WHERE id=?').run(newOutstanding, newOutstanding === 0 ? 'cleared' : 'approved', a.id)
          remain -= deduct
        }
      }
      const changed = db.prepare('UPDATE expense_claims SET status=?, approver=?, approved_at=?, comment=COALESCE(?,comment) WHERE id=? AND status=?')
        .run(status, req.user.name, now, comment || null, req.params.id, c.status)
      if (!changed.changes) throw Object.assign(new Error('报销单已被其他操作处理'), { statusCode: 409 })
      audit(req.user, action, 'expense_claim', c.id, c, { ...c, status, comment: comment || c.comment })
    })
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message })
    throw error
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
  const amount = Number(b.amount)
  if (!employee_id) return res.status(400).json({ error: '缺少员工' })
  if (!db.prepare('SELECT id FROM employees WHERE id=?').get(employee_id)) return res.status(400).json({ error: '员工不存在' })
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: '金额须 >0' })
  const r = db.prepare('INSERT INTO employee_advances(employee_id,amount,reason,advance_date,status,outstanding) VALUES(?,?,?,?,?,?)')
    .run(employee_id, Math.round(amount), b.reason || '', b.advance_date || new Date().toISOString().slice(0, 10), 'submitted', 0)
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
  const status = nextAdvanceStatus(a.status, action)
  if (!status) return res.status(409).json({ error: `预支状态 ${a.status} 不允许执行 ${action}` })
  const outstanding = action === 'approve' ? a.amount : (action === 'repay' ? 0 : a.outstanding)
  inTransaction(() => {
    const changed = db.prepare('UPDATE employee_advances SET status=?, outstanding=?, approver=?, approved_at=?, comment=COALESCE(?,comment) WHERE id=? AND status=?')
      .run(status, outstanding, req.user.name, now, comment || null, req.params.id, a.status)
    if (!changed.changes) throw Object.assign(new Error('预支已被其他操作处理'), { statusCode: 409 })
    audit(req.user, action, 'employee_advance', a.id, a, { ...a, status, outstanding, comment: comment || a.comment })
  })
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
