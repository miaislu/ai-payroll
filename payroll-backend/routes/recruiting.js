// 招聘管理：需求 / 候选人管线（Kanban）/ 面试 / Offer / 渠道成本 / 漏斗与成本指标 / 候选人简历与 AI 解析
import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { audit, db, inTransaction } from '../db.js'
import multer from 'multer'
import path from 'node:path'
import { mkdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { bandOf, bandPosition } from './cost.js'
import { extractText, parseResume } from '../lib/resume_parser.js'
import { resumeFileFilter, validateResumeFile } from '../lib/uploads.js'
import { categoryOf } from '../lib/validators.js'
import { isDate, isPeriod } from '../lib/periods.js'
import { upsertCompensationTerm } from '../lib/employee_terms.js'
import { buildOfferApprovalContext } from '../lib/approvals.js'

export const recruiting = Router()

export const CANDIDATE_STAGES = ['new', 'screening', 'interview', 'offer', 'hired', 'rejected', 'withdrawn']
export const STAGE_LABELS = { new: '新简历', screening: '初筛', interview: '面试', offer: 'Offer', hired: '已入职', rejected: '已淘汰', withdrawn: '已放弃' }
export const REQUISITION_STATUS = ['draft', 'open', 'interview', 'closed', 'cancelled']
const PRIORITIES = ['low', 'normal', 'high', 'urgent']
const INTERVIEW_RESULTS = ['pending', 'pass', 'fail']
const STAGE_TRANSITIONS = {
  new: ['screening', 'rejected', 'withdrawn'],
  screening: ['new', 'interview', 'rejected', 'withdrawn'],
  interview: ['screening', 'offer', 'rejected', 'withdrawn'],
  offer: ['interview', 'rejected', 'withdrawn'],
  rejected: ['screening'],
  withdrawn: ['screening'],
  hired: []
}

const finiteNonnegative = value => Number.isFinite(Number(value)) && Number(value) >= 0
const departmentExists = id => id == null || id === '' || Boolean(db.prepare('SELECT id FROM departments WHERE id=?').get(Number(id)))
const requisitionExists = id => id == null || id === '' || Boolean(db.prepare('SELECT id FROM job_requisitions WHERE id=?').get(Number(id)))

// 候选人简历上传目录
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CAND_UPLOAD_DIR = path.join(process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads'), 'candidate_resumes')
mkdirSync(CAND_UPLOAD_DIR, { recursive: true, mode: 0o700 })
const candUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, CAND_UPLOAD_DIR),
    filename: (req, file, cb) => {
      cb(null, `${randomUUID()}${path.extname(file.originalname || '').toLowerCase()}`)
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: resumeFileFilter
})

// ── 招聘需求 ──
recruiting.get('/requisitions', (req, res) => {
  const rows = db.prepare('SELECT * FROM job_requisitions ORDER BY status, id DESC').all()
  const depts = Object.fromEntries(db.prepare('SELECT id, name FROM departments').all().map(d => [d.id, d.name]))
  const filled = db.prepare("SELECT requisition_id, COUNT(*) c FROM candidates WHERE stage='hired' GROUP BY requisition_id").all()
  const filledMap = Object.fromEntries(filled.map(f => [f.requisition_id, f.c]))
  const active = db.prepare("SELECT requisition_id, COUNT(*) c FROM candidates WHERE stage NOT IN ('rejected','withdrawn') GROUP BY requisition_id").all()
  const activeMap = Object.fromEntries(active.map(a => [a.requisition_id, a.c]))
  res.json(rows.map(r => ({
    ...r, department: depts[r.department_id] || '—',
    filled: filledMap[r.id] || 0, active_candidates: activeMap[r.id] || 0
  })))
})

recruiting.post('/requisitions', (req, res) => {
  const b = req.body || {}
  if (!String(b.title || '').trim()) return res.status(400).json({ error: '缺少岗位名称' })
  if (!departmentExists(b.department_id)) return res.status(400).json({ error: '部门不存在' })
  if (!Number.isInteger(Number(b.headcount ?? 1)) || Number(b.headcount ?? 1) < 1 || Number(b.headcount ?? 1) > 1000) return res.status(400).json({ error: '招聘人数须为 1-1000 的整数' })
  if (b.status && !REQUISITION_STATUS.includes(b.status)) return res.status(400).json({ error: '需求状态不合法' })
  if (b.priority && !PRIORITIES.includes(b.priority)) return res.status(400).json({ error: '优先级不合法' })
  if (b.target_month && !isPeriod(b.target_month)) return res.status(400).json({ error: '目标月份须为 YYYY-MM' })
  if ((b.salary_min != null && !finiteNonnegative(b.salary_min)) || (b.salary_max != null && !finiteNonnegative(b.salary_max)) || (b.salary_min != null && b.salary_max != null && Number(b.salary_min) > Number(b.salary_max))) return res.status(400).json({ error: '薪资范围不合法' })
  const grade = ['P4', 'P5', 'P6', 'P7', 'M1', 'M2'].includes(b.grade) ? b.grade : 'P5'
  const r = db.prepare('INSERT INTO job_requisitions(title,department_id,job_family,grade,city,headcount,priority,status,salary_min,salary_max,reason,created_by,created_at,target_month) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(String(b.title).trim().slice(0, 120), b.department_id || null, String(b.job_family || '').slice(0, 80), grade, String(b.city || '上海').slice(0, 30), Number(b.headcount ?? 1), b.priority || 'normal', b.status || 'open', b.salary_min == null ? null : Number(b.salary_min), b.salary_max == null ? null : Number(b.salary_max), String(b.reason || '').slice(0, 1000), req.user.name, new Date().toISOString().slice(0, 10), b.target_month || null)
  audit(req.user, 'create', 'job_requisition', r.lastInsertRowid, null, db.prepare('SELECT * FROM job_requisitions WHERE id=?').get(r.lastInsertRowid))
  res.json({ ok: true, id: r.lastInsertRowid })
})

recruiting.put('/requisitions/:id', (req, res) => {
  const b = req.body || {}
  const before = db.prepare('SELECT * FROM job_requisitions WHERE id=?').get(req.params.id)
  if (!before) return res.status(404).json({ error: '需求不存在' })
  const next = { ...before, ...b }
  if (!String(next.title || '').trim() || !departmentExists(next.department_id)) return res.status(400).json({ error: '岗位名称或部门不合法' })
  if (!Number.isInteger(Number(next.headcount)) || Number(next.headcount) < 1 || Number(next.headcount) > 1000) return res.status(400).json({ error: '招聘人数须为 1-1000 的整数' })
  if (!REQUISITION_STATUS.includes(next.status) || !PRIORITIES.includes(next.priority)) return res.status(400).json({ error: '需求状态或优先级不合法' })
  if (next.target_month && !isPeriod(next.target_month)) return res.status(400).json({ error: '目标月份须为 YYYY-MM' })
  if ((next.salary_min != null && !finiteNonnegative(next.salary_min)) || (next.salary_max != null && !finiteNonnegative(next.salary_max)) || (next.salary_min != null && next.salary_max != null && Number(next.salary_min) > Number(next.salary_max))) return res.status(400).json({ error: '薪资范围不合法' })
  const r = db.prepare(`UPDATE job_requisitions SET
    title=COALESCE(?,title), department_id=COALESCE(?,department_id), job_family=COALESCE(?,job_family), grade=COALESCE(?,grade),
    city=COALESCE(?,city), headcount=COALESCE(?,headcount), priority=COALESCE(?,priority), status=COALESCE(?,status),
    salary_min=?, salary_max=?, reason=COALESCE(?,reason), target_month=COALESCE(?,target_month),
    closed_at=CASE WHEN ?='closed' THEN COALESCE(closed_at,date('now')) ELSE closed_at END
    WHERE id=?`)
    .run(b.title || null, b.department_id ?? null, b.job_family || null, b.grade || null, b.city || null, b.headcount ?? null, b.priority || null, b.status || null, b.salary_min ?? null, b.salary_max ?? null, b.reason || null, b.target_month || null, b.status || null, req.params.id)
  audit(req.user, 'update', 'job_requisition', req.params.id, before, db.prepare('SELECT * FROM job_requisitions WHERE id=?').get(req.params.id))
  res.json({ ok: true, id: Number(req.params.id) })
})

recruiting.delete('/requisitions/:id', (req, res) => {
  if (db.prepare('SELECT 1 FROM candidates WHERE requisition_id=? LIMIT 1').get(req.params.id)) return res.status(409).json({ error: '该需求已有候选人，不可物理删除；请改为取消状态' })
  const before = db.prepare('SELECT * FROM job_requisitions WHERE id=?').get(req.params.id)
  if (!before) return res.status(404).json({ error: '需求不存在' })
  inTransaction(() => {
    db.prepare('DELETE FROM job_requisitions WHERE id=?').run(req.params.id)
    audit(req.user, 'delete', 'job_requisition', req.params.id, before, null)
  })
  res.json({ ok: true })
})

// ── 候选人 ──
recruiting.get('/candidates', (req, res) => {
  const { stage, requisition_id } = req.query
  let sql = 'SELECT c.*, r.title AS requisition_title, r.job_family FROM candidates c LEFT JOIN job_requisitions r ON c.requisition_id=r.id'
  const where = [], args = []
  if (stage) { where.push('c.stage=?'); args.push(stage) }
  if (requisition_id) { where.push('c.requisition_id=?'); args.push(requisition_id) }
  if (where.length) sql += ' WHERE ' + where.join(' AND ')
  sql += ' ORDER BY c.id DESC'
  const rows = db.prepare(sql).all(...args)
  const iv = db.prepare('SELECT * FROM interviews ORDER BY round_no').all()
  const byCand = {}
  for (const i of iv) (byCand[i.candidate_id] = byCand[i.candidate_id] || []).push(i)
  res.json(rows.map(c => ({ ...c, interviews: byCand[c.id] || [] })))
})

// 管线看板：按阶段分组（附带面试记录）
recruiting.get('/candidates/kanban', (req, res) => {
  const rows = db.prepare('SELECT c.*, r.title AS requisition_title, r.job_family, r.grade AS req_grade FROM candidates c LEFT JOIN job_requisitions r ON c.requisition_id=r.id ORDER BY c.id DESC').all()
  const iv = db.prepare('SELECT * FROM interviews ORDER BY round_no').all()
  const byCand = {}
  for (const i of iv) (byCand[i.candidate_id] = byCand[i.candidate_id] || []).push(i)
  const groups = CANDIDATE_STAGES.map(s => ({
    stage: s, label: STAGE_LABELS[s], items: rows.filter(c => c.stage === s).map(c => ({ ...c, interviews: byCand[c.id] || [] }))
  }))
  res.json(groups)
})

recruiting.post('/candidates', (req, res) => {
  const b = req.body || {}
  if (!String(b.name || '').trim()) return res.status(400).json({ error: '缺少候选人姓名' })
  if (!requisitionExists(b.requisition_id)) return res.status(400).json({ error: '招聘需求不存在' })
  if (b.apply_date && !isDate(b.apply_date)) return res.status(400).json({ error: '申请日期不合法' })
  if (b.expected_salary != null && !finiteNonnegative(b.expected_salary)) return res.status(400).json({ error: '期望薪资不合法' })
  if (b.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(b.email))) return res.status(400).json({ error: '邮箱格式不合法' })
  const r = db.prepare('INSERT INTO candidates(name,phone,email,source_channel,requisition_id,stage,apply_date,expected_salary,offer_amount,offer_date,onboard_date,eval_score,reject_reason,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(String(b.name).trim().slice(0, 80), String(b.phone || '').slice(0, 40), String(b.email || '').slice(0, 160), String(b.source_channel || '内推').slice(0, 80), b.requisition_id || null, 'new', b.apply_date || new Date().toISOString().slice(0, 10), b.expected_salary == null ? null : Number(b.expected_salary), null, null, null, b.eval_score ?? null, '', new Date().toISOString().slice(0, 10))
  audit(req.user, 'create', 'candidate', r.lastInsertRowid, null, db.prepare('SELECT * FROM candidates WHERE id=?').get(r.lastInsertRowid))
  res.json({ ok: true, id: r.lastInsertRowid })
})

recruiting.put('/candidates/:id', (req, res) => {
  const b = req.body || {}
  const current = db.prepare('SELECT * FROM candidates WHERE id=?').get(req.params.id)
  if (!current) return res.status(404).json({ error: '候选人不存在' })
  const offerChanged = b.offer_amount !== undefined && Number(b.offer_amount) !== Number(current.offer_amount)
  const next = { ...current }
  for (const field of ['name', 'phone', 'email', 'source_channel', 'requisition_id', 'apply_date', 'expected_salary', 'offer_amount', 'offer_date', 'onboard_date', 'eval_score', 'reject_reason']) {
    if (b[field] !== undefined) next[field] = b[field]
  }
  if (!String(next.name || '').trim() || !requisitionExists(next.requisition_id)) return res.status(400).json({ error: '候选人姓名或招聘需求不合法' })
  for (const field of ['apply_date', 'offer_date', 'onboard_date']) if (next[field] && !isDate(next[field])) return res.status(400).json({ error: `${field} 日期不合法` })
  for (const field of ['expected_salary', 'offer_amount', 'eval_score']) if (next[field] != null && !finiteNonnegative(next[field])) return res.status(400).json({ error: `${field} 须为非负数字` })
  if (next.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(next.email))) return res.status(400).json({ error: '邮箱格式不合法' })
  inTransaction(() => {
    db.prepare(`UPDATE candidates SET
      name=?, phone=?, email=?, source_channel=?, requisition_id=?,
      apply_date=?, expected_salary=?, offer_amount=?, offer_date=?,
      onboard_date=?, eval_score=?, reject_reason=?,
      offer_status=CASE WHEN ? THEN NULL ELSE offer_status END
      WHERE id=?`)
      .run(next.name, next.phone, next.email, next.source_channel, next.requisition_id, next.apply_date, next.expected_salary, next.offer_amount, next.offer_date, next.onboard_date, next.eval_score, next.reject_reason, offerChanged ? 1 : 0, req.params.id)
    if (offerChanged) db.prepare("UPDATE approvals SET status='cancelled', comment=COALESCE(comment,'Offer 金额变更，审批自动失效') WHERE ref_type='candidate' AND ref_id=? AND type='offer' AND status='pending'").run(req.params.id)
    audit(req.user, 'update', 'candidate', current.id, current, { ...next, offer_status: offerChanged ? null : current.offer_status })
  })
  res.json({ ok: true, id: Number(req.params.id) })
})

recruiting.delete('/candidates/:id', (req, res) => {
  const candidate = db.prepare('SELECT * FROM candidates WHERE id=?').get(req.params.id)
  if (!candidate) return res.status(404).json({ error: '候选人不存在' })
  if (candidate.employee_id) return res.status(409).json({ error: '已入职候选人不可删除，请保留招聘审计链路' })
  if (db.prepare('SELECT 1 FROM approvals WHERE ref_type=\'candidate\' AND ref_id=? LIMIT 1').get(req.params.id)) return res.status(409).json({ error: '已有审批记录的候选人不可物理删除' })
  inTransaction(() => {
    db.prepare('DELETE FROM interviews WHERE candidate_id=?').run(req.params.id)
    db.prepare('DELETE FROM candidates WHERE id=?').run(req.params.id)
    audit(req.user, 'delete', 'candidate', req.params.id, candidate, null)
  })
  if (candidate.resume_path) { try { rmSync(candidate.resume_path, { force: true }) } catch { /* ignore */ } }
  res.json({ ok: true })
})

// 阶段流转（Kanban 拖拽）
recruiting.post('/candidates/:id/stage', (req, res) => {
  const { stage, reject_reason } = req.body || {}
  if (!CANDIDATE_STAGES.includes(stage)) return res.status(400).json({ error: '非法阶段' })
  if (stage === 'hired') return res.status(400).json({ error: '已入职阶段只能通过办理入职产生' })
  const current = db.prepare('SELECT * FROM candidates WHERE id=?').get(req.params.id)
  if (!current) return res.status(404).json({ error: '候选人不存在' })
  if (!STAGE_TRANSITIONS[current.stage]?.includes(stage)) return res.status(409).json({ error: `不允许从 ${current.stage} 流转到 ${stage}` })
  const r = db.prepare('UPDATE candidates SET stage=?, reject_reason=COALESCE(?,reject_reason) WHERE id=?').run(stage, reject_reason || null, req.params.id)
  audit(req.user, 'stage_change', 'candidate', current.id, { stage: current.stage }, { stage })
  res.json({ ok: true, id: Number(req.params.id), stage })
})

// ── Offer → 入职打通：候选人转员工档案（招聘模块 → 员工模块闭环）──
// 生成员工档案（职级/岗位/城市/月薪取自关联需求与 Offer）+ 自动记录入职事件
recruiting.post('/candidates/:id/onboard', (req, res) => {
  const { onboard_date, department_id } = req.body || {}
  const c = db.prepare('SELECT * FROM candidates WHERE id=?').get(req.params.id)
  if (!c) return res.status(404).json({ error: '候选人不存在' })
  if (c.employee_id || c.stage === 'hired') return res.status(409).json({ error: '该候选人已入职，请勿重复办理', employee_id: c.employee_id || null })
  if (c.stage !== 'offer' || c.offer_status !== 'approved') return res.status(409).json({ error: '仅已通过 Offer 审批的候选人可以办理入职' })
  if (!isDate(onboard_date)) return res.status(400).json({ error: '入职日期必填且须为有效的 YYYY-MM-DD' })
  const r = c.requisition_id ? db.prepare('SELECT * FROM job_requisitions WHERE id=?').get(c.requisition_id) : null
  const ALLOWED_GRADES = ['P4', 'P5', 'P6', 'P7', 'M1', 'M2']
  const grade = ALLOWED_GRADES.includes(r?.grade) ? r.grade : 'P4'
  const job_family = r?.job_family || '模拟IC设计'
  const city = r?.city || '上海'
  const base = c.offer_amount
  if (!base) return res.status(400).json({ error: '缺少已审批的 Offer 薪资' })
  const date = onboard_date
  const hire_month = date.slice(0, 7)
  const dept = department_id ?? r?.department_id ?? null
  const empId = inTransaction(() => {
    const fresh = db.prepare('SELECT * FROM candidates WHERE id=?').get(c.id)
    if (fresh.employee_id || fresh.stage === 'hired') throw Object.assign(new Error('候选人已入职'), { statusCode: 409 })
    if (fresh.stage !== 'offer' || fresh.offer_status !== 'approved') throw Object.assign(new Error('Offer 尚未批准'), { statusCode: 409 })
    const ins = db.prepare('INSERT INTO employees(name,grade,job_family,city,category,status,monthly_base,perf_ratio,hire_month,hire_date,department_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(c.name, grade, job_family, city, categoryOf(job_family), 'active', base, 0.30, hire_month, date, dept)
    const id = ins.lastInsertRowid
    upsertCompensationTerm(db.prepare('SELECT * FROM employees WHERE id=?').get(id), hire_month, { actor: req.user.name })
    db.prepare('INSERT INTO employee_events(employee_id,type,event_date,from_value,to_value,note) VALUES(?,?,?,?,?,?)')
      .run(id, 'onboard', date, null, `${job_family} ${grade}`, `由招聘入职：候选人 #${c.id}（${c.source_channel}）`)
    db.prepare("UPDATE candidates SET stage='hired', onboard_date=?, employee_id=? WHERE id=? AND employee_id IS NULL").run(date, id, c.id)
    if (r) {
      const filled = db.prepare("SELECT COUNT(*) c FROM candidates WHERE requisition_id=? AND stage='hired'").get(r.id).c
      const need = r.headcount || 1
      if (filled >= need && r.status !== 'closed') db.prepare("UPDATE job_requisitions SET status='closed', closed_at=date('now') WHERE id=?").run(r.id)
    }
    audit(req.user, 'onboard', 'candidate', c.id, c, { employee_id: id, onboard_date: date })
    return id
  })
  res.json({ ok: true, employee_id: empId, candidate_id: c.id, name: c.name, hire_month, onboard_date: date })
})

// ── 面试 ──
recruiting.get('/interviews', (req, res) => {
  const rows = db.prepare('SELECT i.*, c.name AS candidate_name, c.requisition_id FROM interviews i LEFT JOIN candidates c ON i.candidate_id=c.id ORDER BY i.interview_date DESC').all()
  res.json(rows)
})
recruiting.post('/interviews', (req, res) => {
  const b = req.body || {}
  if (!b.candidate_id || !b.interviewer) return res.status(400).json({ error: '缺少候选人或面试官' })
  if (!db.prepare('SELECT id FROM candidates WHERE id=?').get(b.candidate_id)) return res.status(400).json({ error: '候选人不存在' })
  if (b.interview_date && !isDate(b.interview_date)) return res.status(400).json({ error: '面试日期不合法' })
  if (b.result && !INTERVIEW_RESULTS.includes(b.result)) return res.status(400).json({ error: '面试结果不合法' })
  if (!Number.isInteger(Number(b.round_no ?? 1)) || Number(b.round_no ?? 1) < 1 || Number(b.round_no ?? 1) > 20) return res.status(400).json({ error: '轮次须为 1-20 的整数' })
  if (b.score != null && (!Number.isFinite(Number(b.score)) || Number(b.score) < 0 || Number(b.score) > 100)) return res.status(400).json({ error: '评分须为 0-100' })
  const r = db.prepare('INSERT INTO interviews(candidate_id,round_no,interviewer,interview_date,result,score,notes) VALUES(?,?,?,?,?,?,?)')
    .run(b.candidate_id, Number(b.round_no ?? 1), String(b.interviewer).slice(0, 80), b.interview_date || new Date().toISOString().slice(0, 10), b.result || 'pending', b.score == null ? null : Number(b.score), String(b.notes || '').slice(0, 2000))
  audit(req.user, 'create', 'interview', r.lastInsertRowid, null, db.prepare('SELECT * FROM interviews WHERE id=?').get(r.lastInsertRowid))
  res.json({ ok: true, id: r.lastInsertRowid })
})
recruiting.put('/interviews/:id', (req, res) => {
  const b = req.body || {}
  const before = db.prepare('SELECT * FROM interviews WHERE id=?').get(req.params.id)
  if (!before) return res.status(404).json({ error: '面试不存在' })
  const next = { ...before, ...b }
  if (!String(next.interviewer || '').trim() || !isDate(next.interview_date) || !INTERVIEW_RESULTS.includes(next.result)) return res.status(400).json({ error: '面试官、日期或结果不合法' })
  if (!Number.isInteger(Number(next.round_no)) || Number(next.round_no) < 1 || Number(next.round_no) > 20) return res.status(400).json({ error: '轮次须为 1-20 的整数' })
  if (next.score != null && (!Number.isFinite(Number(next.score)) || Number(next.score) < 0 || Number(next.score) > 100)) return res.status(400).json({ error: '评分须为 0-100' })
  const r = db.prepare('UPDATE interviews SET round_no=COALESCE(?,round_no), interviewer=COALESCE(?,interviewer), interview_date=COALESCE(?,interview_date), result=COALESCE(?,result), score=?, notes=COALESCE(?,notes) WHERE id=?')
    .run(b.round_no ?? null, b.interviewer || null, b.interview_date || null, b.result || null, b.score ?? null, b.notes || null, req.params.id)
  audit(req.user, 'update', 'interview', req.params.id, before, db.prepare('SELECT * FROM interviews WHERE id=?').get(req.params.id))
  res.json({ ok: true })
})
recruiting.delete('/interviews/:id', (req, res) => {
  const before = db.prepare('SELECT * FROM interviews WHERE id=?').get(req.params.id)
  if (!before) return res.status(404).json({ error: '面试不存在' })
  db.prepare('DELETE FROM interviews WHERE id=?').run(req.params.id)
  audit(req.user, 'delete', 'interview', req.params.id, before, null)
  res.json({ ok: true })
})

// ── 渠道与费用 ──
recruiting.get('/channels', (req, res) => {
  const rows = db.prepare('SELECT * FROM recruiting_channels ORDER BY id').all()
  const exp = db.prepare('SELECT id, channel_id, year_month, amount, note FROM channel_expenses ORDER BY year_month, id').all()
  const perChannel = {}
  for (const e of exp) (perChannel[e.channel_id] = perChannel[e.channel_id] || []).push({ id: e.id, year_month: e.year_month, amount: e.amount, note: e.note })
  res.json(rows.map(c => ({ ...c, expenses: perChannel[c.id] || [] })))
})
recruiting.post('/channels', (req, res) => {
  const b = req.body || {}
  if (!b.name) return res.status(400).json({ error: '缺少渠道名称' })
  const r = db.prepare('INSERT INTO recruiting_channels(name,type,contact,note) VALUES(?,?,?,?)').run(b.name, b.type || 'other', b.contact || '', b.note || '')
  audit(req.user, 'create', 'recruiting_channel', r.lastInsertRowid, null, db.prepare('SELECT * FROM recruiting_channels WHERE id=?').get(r.lastInsertRowid))
  res.json({ ok: true, id: r.lastInsertRowid })
})
recruiting.put('/channels/:id', (req, res) => {
  const b = req.body || {}
  const before = db.prepare('SELECT * FROM recruiting_channels WHERE id=?').get(req.params.id)
  if (!before) return res.status(404).json({ error: '渠道不存在' })
  const r = db.prepare('UPDATE recruiting_channels SET name=COALESCE(?,name), type=COALESCE(?,type), contact=COALESCE(?,contact), note=COALESCE(?,note) WHERE id=?')
    .run(b.name || null, b.type || null, b.contact || null, b.note || null, req.params.id)
  audit(req.user, 'update', 'recruiting_channel', req.params.id, before, db.prepare('SELECT * FROM recruiting_channels WHERE id=?').get(req.params.id))
  res.json({ ok: true })
})
recruiting.delete('/channels/:id', (req, res) => {
  const before = db.prepare('SELECT * FROM recruiting_channels WHERE id=?').get(req.params.id)
  if (!before) return res.status(404).json({ error: '渠道不存在' })
  const expenseCount = db.prepare('SELECT COUNT(*) c FROM channel_expenses WHERE channel_id=?').get(req.params.id).c
  inTransaction(() => {
    db.prepare('DELETE FROM channel_expenses WHERE channel_id=?').run(req.params.id)
    db.prepare('DELETE FROM recruiting_channels WHERE id=?').run(req.params.id)
    audit(req.user, 'delete', 'recruiting_channel', req.params.id, { ...before, expense_count: expenseCount }, null)
  })
  res.json({ ok: true })
})
// 费用记录
recruiting.post('/channel-expenses', (req, res) => {
  const b = req.body || {}
  if (!b.channel_id || !b.year_month) return res.status(400).json({ error: '缺少渠道或月份' })
  if (!db.prepare('SELECT id FROM recruiting_channels WHERE id=?').get(b.channel_id)) return res.status(400).json({ error: '渠道不存在' })
  if (!isPeriod(b.year_month) || !finiteNonnegative(b.amount ?? 0)) return res.status(400).json({ error: '月份或金额不合法' })
  const r = db.prepare('INSERT INTO channel_expenses(channel_id,year_month,amount,note) VALUES(?,?,?,?)').run(b.channel_id, b.year_month, Math.round(Number(b.amount || 0)), String(b.note || '').slice(0, 500))
  audit(req.user, 'create', 'channel_expense', r.lastInsertRowid, null, db.prepare('SELECT * FROM channel_expenses WHERE id=?').get(r.lastInsertRowid))
  res.json({ ok: true, id: r.lastInsertRowid })
})
recruiting.delete('/channel-expenses/:id', (req, res) => {
  const before = db.prepare('SELECT * FROM channel_expenses WHERE id=?').get(req.params.id)
  if (!before) return res.status(404).json({ error: '费用不存在' })
  db.prepare('DELETE FROM channel_expenses WHERE id=?').run(req.params.id)
  audit(req.user, 'delete', 'channel_expense', req.params.id, before, null)
  res.json({ ok: true })
})

// ── Offer 定薪建议：引用对标带宽，计算建议区间与带宽分位 ──
recruiting.get('/offer/suggest', (req, res) => {
  const { job_family, annual_cash, city = '上海' } = req.query
  const b = bandOf(job_family)
  if (!b) return res.status(404).json({ error: '该岗位族没有已审批带宽: ' + job_family })
  const cash = Number(annual_cash) || 0
  const pos = cash ? bandPosition(cash, job_family) : null
  res.json({
    job_family, city, scope: '上海 · 3-5年 · Fabless · 现金年薪',
    baseline: { p25: b.p25, p50: b.p50, p75: b.p75, sample: b.sample, evidence: b.evidence },
    current: cash ? { annual_cash: cash, monthly: Math.round(cash / 12), position: pos, positionLabel: pos === null ? null : (pos < 25 ? '低于带宽' : pos > 75 ? '超出带宽' : '带宽内') } : null,
    note: city === '上海'
      ? '仅与已审批的上海·3-5年·Fabless 基准比较；候选人经验或公司类型不一致时不可直接作为定薪建议。'
      : `候选人城市为${city}，系统没有经审批的城市换算系数；以下只展示上海基准，不作本地化定薪建议。`
  })
})

// ── 招聘统计：漏斗 / 周期 / 成本 / 渠道效果 ──
recruiting.get('/stats', (req, res) => {
  const cands = db.prepare('SELECT * FROM candidates').all()
  // 漏斗：各阶段人数（按管线顺序累计口径：进入该阶段及之后）
  const stageCount = s => cands.filter(c => c.stage === s).length
  const funnel = CANDIDATE_STAGES.map(s => ({ stage: s, label: STAGE_LABELS[s], count: stageCount(s) }))
  // 周期：hired 候选人的 申请→入职 平均天数
  const hired = cands.filter(c => c.stage === 'hired' && c.apply_date && c.onboard_date)
  const avgCycle = hired.length
    ? Math.round(hired.reduce((s, c) => s + (new Date(c.onboard_date) - new Date(c.apply_date)) / 86400000, 0) / hired.length)
    : 0
  // 成本：期间渠道费用 + 人均招聘成本
  const exp = db.prepare('SELECT e.year_month, e.amount, e.note, c.name AS channel FROM channel_expenses e LEFT JOIN recruiting_channels c ON e.channel_id=c.id ORDER BY e.year_month').all()
  const months = [...new Set(exp.map(e => e.year_month))].sort()
  const monthly = months.map(m => ({ year_month: m, total: exp.filter(e => e.year_month === m).reduce((s, e) => s + e.amount, 0) }))
  const totalCost = exp.reduce((s, e) => s + e.amount, 0)
  const hires = cands.filter(c => c.stage === 'hired').length
  const costPerHire = hires ? Math.round(totalCost / hires) : 0
  const accepted = cands.filter(c => ['hired', 'offer'].includes(c.stage) && c.offer_amount).length
  const offers = cands.filter(c => c.offer_amount).length
  const acceptRate = offers ? Math.round(accepted / offers * 1000) / 10 : 0
  // 渠道效果：各渠道 费用 / 候选人 / 入职
  const chCands = {}
  for (const c of cands) (chCands[c.source_channel] = chCands[c.source_channel] || { n: 0, hired: 0 }).n++
  const chHired = {}
  for (const c of cands) if (c.stage === 'hired') (chHired[c.source_channel] = (chHired[c.source_channel] || 0) + 1)
  const chExp = {}
  for (const e of exp) chExp[e.channel] = (chExp[e.channel] || 0) + e.amount
  const channels = Object.entries(chCands).map(([name, v]) => ({
    name, candidates: v.n, hired: chHired[name] || 0,
    cost: chExp[name] || 0,
    costPerHire: (chHired[name] || 0) ? Math.round((chExp[name] || 0) / chHired[name]) : null
  }))
  res.json({ funnel, avgCycle, monthly, totalCost, costPerHire, acceptRate, hires, channels })
})

// ── 候选人简历上传 / AI 解析 / 下载 / 删除（线索即结构化）──
recruiting.post('/candidates/:id/resume', (req, res, next) => {
  if (!db.prepare('SELECT id FROM candidates WHERE id=?').get(req.params.id)) return res.status(404).json({ error: '候选人不存在' })
  next()
}, candUpload.single('resume'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '缺少简历文件（字段名 resume）' })
  if (!validateResumeFile(req.file)) {
    try { rmSync(req.file.path, { force: true }) } catch { /* ignore */ }
    return res.status(400).json({ error: '文件内容与扩展名不匹配' })
  }
  const c = db.prepare('SELECT id, resume_path, resume_name FROM candidates WHERE id=?').get(req.params.id)
  if (!c) return res.status(404).json({ error: '候选人不存在' })
  if (c.resume_path) { try { rmSync(c.resume_path, { force: true }) } catch { /* 忽略 */ } }
  db.prepare("UPDATE candidates SET resume_name=?, resume_path=?, resume_parsed=NULL, skills=NULL, tags=NULL, experience_years=NULL WHERE id=?")
    .run(req.file.originalname, req.file.path, req.params.id)
  audit(req.user, 'upload', 'candidate_resume', req.params.id, { filename: c.resume_name, had_resume: Boolean(c.resume_path) }, { filename: req.file.originalname, size: req.file.size })
  res.json({ ok: true, id: Number(req.params.id), filename: req.file.originalname })
})

recruiting.post('/candidates/:id/resume/parse', async (req, res) => {
  const c = db.prepare('SELECT * FROM candidates WHERE id=?').get(req.params.id)
  if (!c) return res.status(404).json({ error: '候选人不存在' })
  if (!c.resume_path) return res.status(400).json({ error: '请先上传简历' })
  const { text, unsupported, error } = await extractText(c.resume_path, '', c.resume_name)
  if (unsupported) return res.status(400).json({ error: '暂不支持该文件类型（支持 txt/md/docx/pdf）' })
  if (!text.trim()) return res.status(400).json({ error: '未能从文件中提取文本' + (error ? '：' + error : '') })
  const parsed = await parseResume(text, {
    allowExternal: req.body?.allow_external === true,
    onExternal: meta => audit(req.user, 'external_llm_request', 'candidate_resume', c.id, null, meta)
  })
  const b = parsed.basic || {}
  const skills = b.skills || (parsed.tags || []).join(',') || null
  db.prepare('UPDATE candidates SET resume_parsed=?, skills=?, tags=?, experience_years=? WHERE id=?')
    .run(JSON.stringify(parsed), skills, JSON.stringify(parsed.tags || []), parsed.experience_years ?? null, req.params.id)
  audit(req.user, 'parse', 'candidate_resume', c.id, null, { engine: parsed.engine })
  res.json({ ok: true, id: Number(req.params.id), engine: parsed.engine, parsed })
})

recruiting.get('/candidates/:id/resume', (req, res) => {
  const c = db.prepare('SELECT resume_path, resume_name FROM candidates WHERE id=?').get(req.params.id)
  if (!c || !c.resume_path) return res.status(404).json({ error: '该候选人未上传简历' })
  res.download(c.resume_path, c.resume_name)
})

recruiting.delete('/candidates/:id/resume', (req, res) => {
  const c = db.prepare('SELECT resume_path, resume_name FROM candidates WHERE id=?').get(req.params.id)
  if (!c) return res.status(404).json({ error: '候选人不存在' })
  if (c?.resume_path) { try { rmSync(c.resume_path, { force: true }) } catch { /* 忽略 */ } }
  db.prepare("UPDATE candidates SET resume_name=NULL, resume_path=NULL, resume_parsed=NULL, skills=NULL, tags=NULL, experience_years=NULL WHERE id=?").run(req.params.id)
  audit(req.user, 'delete', 'candidate_resume', req.params.id, { filename: c.resume_name, had_resume: Boolean(c.resume_path) }, null)
  res.json({ ok: true })
})

// ── Offer 审批发起（候选人 → 审批中心，approve 后 offer_status=approved）──
recruiting.post('/candidates/:id/offer-approval', (req, res) => {
  const c = db.prepare('SELECT * FROM candidates WHERE id=?').get(req.params.id)
  if (!c) return res.status(404).json({ error: '候选人不存在' })
  if (c.stage !== 'offer') return res.status(400).json({ error: '仅 Offer 阶段可发起审批' })
  if (!c.offer_amount) return res.status(400).json({ error: '请先填写 Offer 金额' })
  const r = c.requisition_id ? db.prepare('SELECT * FROM job_requisitions WHERE id=?').get(c.requisition_id) : null
  const annual = c.offer_amount * 12
  const pos = r?.city === '上海' ? bandPosition(annual, r.job_family) : null
  const posLabel = pos === null ? '' : (pos < 25 ? '低于带宽' : pos > 75 ? '超出带宽' : '带宽内')
  const existing = db.prepare("SELECT id FROM approvals WHERE ref_type='candidate' AND ref_id=? AND type='offer' AND status='pending'").get(c.id)
  if (existing) return res.status(409).json({ error: '该候选人已有待审批 Offer', approval_id: existing.id })
  const id = 'OFF-' + randomUUID()
  const title = `Offer 审批 · ${c.name}（${r?.job_family || ''} ${r?.grade || ''}）`
  const key = `现金 ¥${c.offer_amount.toLocaleString('zh-CN')}/月${pos !== null ? ` · 上海3-5年Fabless基准 ${pos}%分位(${posLabel})` : ' · 无同口径已审批带宽'}`
  const summary = `来源 ${c.source_channel} · 期望 ¥${c.expected_salary?.toLocaleString('zh-CN') || '—'}/月` + (c.eval_score ? ` · 评分 ${c.eval_score}` : '')
  const payload = { kind: 'offer', candidate_id: c.id, offer_context: buildOfferApprovalContext(c.id) }
  inTransaction(() => {
    db.prepare("INSERT INTO approvals(id,type,title,who,key,summary,status,page,ref_type,ref_id,payload_json,created_by_user_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(id, 'offer', title, `${req.user.name} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`, key, summary, 'pending', 'offer-approval', 'candidate', c.id, JSON.stringify(payload), req.user.id)
    db.prepare("UPDATE candidates SET offer_status='pending' WHERE id=?").run(c.id)
    audit(req.user, 'submit_offer_approval', 'candidate', c.id, { offer_status: c.offer_status }, { offer_status: 'pending', approval_id: id })
  })
  res.json({ ok: true, approval_id: id, title, key, summary })
})
