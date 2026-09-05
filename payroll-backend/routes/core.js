import { Router } from 'express'
import { audit, db, inTransaction } from '../db.js'
import { auth } from '../lib/auth.js'
import { benchmarkCard } from '../lib/calc.js'
import { applyApproval, buildOfferApprovalContext, mergeActionPayload, nextApprovalId, normalizeApprovalPayload, presentApproval } from '../lib/approvals.js'
import { canApprove, HR_ROLES, OPS_ROLES } from '../lib/access.js'

export const core = Router()

core.get('/benchmarks/directions', auth(), (req, res) => {
  const rows = db.prepare('SELECT direction,p25,p50,p75,rarity,sample,evidence,verified FROM benchmarks ORDER BY id').all()
  const known = new Set(rows.map(row => row.direction))
  for (const { direction } of db.prepare('SELECT DISTINCT direction FROM market_samples ORDER BY direction').all()) {
    if (!known.has(direction)) rows.push({ direction, p25: null, p50: null, p75: null, rarity: 1, sample: 0, evidence: null, verified: 0 })
  }
  res.json(rows)
})

core.get('/benchmarks', auth(), (req, res) => {
  const { direction } = req.query
  const row = db.prepare('SELECT * FROM benchmarks WHERE direction=?').get(direction)
  if (!row) return res.status(404).json({ error: '方向不存在: ' + direction })
  const card = benchmarkCard(row)
  if (!card || !Number.isFinite(card.p25) || !Number.isFinite(card.p50) || !Number.isFinite(card.p75)) return res.status(409).json({ error: '该方向尚无完整带宽，请先导入同口径样本并完成审批' })
  let sources = []
  try { sources = JSON.parse(row.sources || '[]') } catch { /* legacy */ }
  res.json({ ...card, direction: row.direction, evidence: row.evidence, scope: '上海 · 3-5年 · Fabless · 现金年薪', sources })
})

core.get('/approvals', auth(OPS_ROLES), (req, res) => {
  const rows = db.prepare('SELECT * FROM approvals ORDER BY (status=\'pending\') DESC, id DESC').all()
  const cands = Object.fromEntries(db.prepare('SELECT id, name, offer_amount, stage FROM candidates').all().map(c => [c.id, c]))
  const emps = Object.fromEntries(db.prepare('SELECT id, name, grade, job_family, monthly_base FROM employees').all().map(e => [e.id, e]))
  res.json(rows.map(a => {
    const presented = presentApproval(a, {
      ref: a.ref_type === 'candidate' ? cands[a.ref_id] || null : null
    })
    const empId = presented.payload?.employee_id
    if (empId && emps[empId]) presented.employee = emps[empId]
    if (a.type === 'offer') presented.offer_context = presented.payload?.offer_context || buildOfferApprovalContext(a.ref_id || presented.payload?.candidate_id)
    return presented
  }))
})

core.get('/approvals/:id', auth(OPS_ROLES), (req, res) => {
  const a = db.prepare('SELECT * FROM approvals WHERE id=?').get(req.params.id)
  if (!a) return res.status(404).json({ error: '审批不存在' })
  const presented = presentApproval(a)
  if (a.ref_type === 'candidate') presented.ref = db.prepare('SELECT id, name, offer_amount, stage FROM candidates WHERE id=?').get(a.ref_id) || null
  if (presented.payload?.employee_id) presented.employee = db.prepare('SELECT id, name, grade, job_family, monthly_base FROM employees WHERE id=?').get(presented.payload.employee_id) || null
  if (a.type === 'offer') presented.offer_context = presented.payload?.offer_context || buildOfferApprovalContext(a.ref_id || presented.payload?.candidate_id)
  res.json(presented)
})

core.post('/approvals', auth(HR_ROLES), (req, res) => {
  const b = req.body || {}
  const type = String(b.type || '')
  if (!['band', 'raise', 'option', 'offer'].includes(type)) return res.status(400).json({ error: 'type 须为 band/raise/option/offer' })
  let payload
  try { payload = normalizeApprovalPayload(type, b.payload) } catch (error) { return res.status(error.statusCode || 400).json({ error: error.message }) }
  if (type === 'band') {
    const pending = db.prepare("SELECT id FROM approvals WHERE type='band' AND status='pending' AND json_extract(payload_json, '$.direction')=?").get(payload.direction)
    if (pending) return res.status(409).json({ error: `该方向已有待审带宽 ${pending.id}` })
  }
  if (type === 'raise') {
    if (!db.prepare('SELECT 1 FROM employees WHERE id=?').get(payload.employee_id)) return res.status(400).json({ error: '员工不存在' })
  }
  if (type === 'option' && !db.prepare('SELECT 1 FROM employees WHERE id=?').get(payload.employee_id)) {
    return res.status(400).json({ error: '员工不存在' })
  }
  if (type === 'offer' && !db.prepare('SELECT 1 FROM candidates WHERE id=?').get(payload.candidate_id)) {
    return res.status(400).json({ error: '候选人不存在' })
  }
  const id = b.id && /^A-\d+$/.test(b.id) ? b.id : nextApprovalId()
  if (db.prepare('SELECT id FROM approvals WHERE id=?').get(id)) return res.status(409).json({ error: '审批编号已存在' })
  const page = b.page || (type === 'band' ? 'band-approval' : type === 'raise' ? 'raise-approval' : type === 'offer' ? 'offer-approval' : 'option-approval')
  db.prepare('INSERT INTO approvals(id,type,title,who,key,summary,status,page,ref_type,ref_id,payload_json,created_by_user_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, type, String(b.title || type).slice(0, 120), `${req.user.name} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`, String(b.key || '').slice(0, 120), String(b.summary || '').slice(0, 200), 'pending', page, b.ref_type || null, b.ref_id || null, JSON.stringify(payload), req.user.id)
  audit(req.user, 'create', 'approval', id, null, payload)
  res.json({ ok: true, id })
})

core.post('/approvals/:id/action', auth(OPS_ROLES), (req, res) => {
  const { action, key, comment } = req.body || {}
  if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: 'action 须为 approve/reject' })
  const a = db.prepare('SELECT * FROM approvals WHERE id=?').get(req.params.id)
  if (!a) return res.status(404).json({ error: '审批不存在' })
  if (a.status !== 'pending') return res.status(409).json({ error: `审批已处理，当前状态：${a.status}` })
  if (a.created_by_user_id && Number(a.created_by_user_id) === Number(req.user.id)) return res.status(409).json({ error: '发起人不能审批自己的申请，请由另一位有权人员处理' })
  if (!canApprove(req.user, a.type)) {
    const hint = a.type === 'band' ? '带宽由 HR 或 CEO 审批' : '该项由财务或 CEO 审批'
    return res.status(403).json({ error: hint })
  }
  const status = action === 'approve' ? 'approved' : 'rejected'
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ')
  let applied = null
  inTransaction(() => {
    const payload = mergeActionPayload(a, req.body || {})
    const payloadJson = JSON.stringify(payload)
    const changed = db.prepare("UPDATE approvals SET status=?, key=COALESCE(?, key), action_by=?, action_at=?, comment=COALESCE(?, comment), payload_json=? WHERE id=? AND status='pending'")
      .run(status, key || null, req.user.name, now, comment || null, payloadJson, req.params.id)
    if (!changed.changes) throw Object.assign(new Error('审批已被处理'), { statusCode: 409 })
    if (status === 'approved') applied = applyApproval({ ...a, payload_json: payloadJson }, payload)
    else if (a.type === 'offer' && a.ref_type === 'candidate') db.prepare("UPDATE candidates SET offer_status='rejected' WHERE id=?").run(a.ref_id)
    audit(req.user, action, 'approval', a.id, a, { ...a, status, comment: comment || a.comment, applied })
  })
  res.json({ ok: true, id: req.params.id, status, applied: applied?.applied || null })
})

core.get('/audit-logs', auth(['founder']), (req, res) => {
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100))
  res.json(db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?').all(limit))
})
