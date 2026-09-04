// 员工完整档案：基础信息 / 联系方式 / 紧急联系人 / 教育经历 / 工作经历 / 家庭 / 简历
import { Router } from 'express'
import { audit, db, inTransaction } from '../db.js'
import multer from 'multer'
import path from 'node:path'
import { mkdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { extractText, parseResume, RESUME_APPLY_MAP } from '../lib/resume_parser.js'
import { randomUUID } from 'node:crypto'
import { resumeFileFilter, validateResumeFile } from '../lib/uploads.js'
import { isDate } from '../lib/periods.js'

export const employee = Router()

// 简历上传目录（payroll-backend/uploads/resumes）
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const UPLOAD_DIR = path.join(process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads'), 'resumes')
mkdirSync(UPLOAD_DIR, { recursive: true, mode: 0o700 })
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      cb(null, `${randomUUID()}${path.extname(file.originalname || '').toLowerCase()}`)
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: resumeFileFilter
})

// 档案字段白名单（防止任意列注入）
const PROFILE_FIELDS = [
  'gender', 'date_of_birth', 'marital_status', 'nationality', 'education_level', 'id_number',
  'mobile', 'personal_email', 'alternate_mobile', 'current_address', 'permanent_address',
  'contract_type', 'contract_start', 'contract_end', 'probation_end', 'confirmation_date',
  'social_security_no', 'housing_fund_no', 'bank_name', 'bank_account', 'skills', 'notice_period'
]
const childRows = (table, employeeId) =>
  db.prepare(`SELECT * FROM ${table} WHERE employee_id=? ORDER BY id`).all(employeeId)
const employeeExists = id => Boolean(db.prepare('SELECT id FROM employees WHERE id=?').get(id))
const PROFILE_DATE_FIELDS = new Set(['date_of_birth', 'contract_start', 'contract_end', 'probation_end', 'confirmation_date'])

// ── 完整档案（员工 + 各子表）──
employee.get('/:id/profile', (req, res) => {
  const e = db.prepare('SELECT * FROM employees WHERE id=?').get(req.params.id)
  if (!e) return res.status(404).json({ error: '员工不存在' })
  res.json({
    employee: e,
    emergency_contacts: childRows('emergency_contacts', e.id),
    education: childRows('employee_education', e.id),
    work_experience: childRows('employee_work_experience', e.id),
    family: childRows('employee_family', e.id)
  })
})

// ── 更新基础档案字段（仅白名单列）──
employee.put('/:id/profile', (req, res) => {
  const e = db.prepare('SELECT * FROM employees WHERE id=?').get(req.params.id)
  if (!e) return res.status(404).json({ error: '员工不存在' })
  const b = req.body || {}
  for (const field of PROFILE_DATE_FIELDS) if (b[field] && !isDate(b[field])) return res.status(400).json({ error: `${field} 日期不合法` })
  if (b.personal_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(b.personal_email))) return res.status(400).json({ error: '个人邮箱格式不合法' })
  const sets = [], args = []
  for (const f of PROFILE_FIELDS) {
    if (b[f] !== undefined) { sets.push(`${f}=?`); args.push(b[f] === '' ? null : b[f]) }
  }
  if (sets.length) {
    args.push(req.params.id)
    inTransaction(() => {
      db.prepare(`UPDATE employees SET ${sets.join(',')} WHERE id=?`).run(...args)
      audit(req.user, 'update', 'employee_profile', req.params.id, e, db.prepare('SELECT * FROM employees WHERE id=?').get(req.params.id))
    })
  }
  res.json({ ok: true, id: Number(req.params.id), updated: sets.length })
})

// ── 紧急联系人 ──
employee.get('/:id/emergency-contacts', (req, res) => {
  res.json(childRows('emergency_contacts', req.params.id))
})
employee.post('/:id/emergency-contacts', (req, res) => {
  const b = req.body || {}
  if (!employeeExists(req.params.id)) return res.status(404).json({ error: '员工不存在' })
  if (!b.name) return res.status(400).json({ error: '联系人姓名必填' })
  const r = db.prepare('INSERT INTO emergency_contacts(employee_id,name,relation,mobile,address,is_primary) VALUES(?,?,?,?,?,?)')
    .run(req.params.id, b.name, b.relation || '', b.mobile || '', b.address || '', b.is_primary ? 1 : 0)
  audit(req.user, 'create', 'emergency_contact', r.lastInsertRowid, null, db.prepare('SELECT * FROM emergency_contacts WHERE id=?').get(r.lastInsertRowid))
  res.json({ ok: true, id: r.lastInsertRowid })
})
employee.put('/emergency-contacts/:cid', (req, res) => {
  const b = req.body || {}
  const before = db.prepare('SELECT * FROM emergency_contacts WHERE id=?').get(req.params.cid)
  if (!before) return res.status(404).json({ error: '联系人不存在' })
  const r = db.prepare('UPDATE emergency_contacts SET name=COALESCE(?,name), relation=COALESCE(?,relation), mobile=COALESCE(?,mobile), address=COALESCE(?,address), is_primary=? WHERE id=?')
    .run(b.name || null, b.relation || null, b.mobile || null, b.address || null, b.is_primary ? 1 : 0, req.params.cid)
  audit(req.user, 'update', 'emergency_contact', req.params.cid, before, db.prepare('SELECT * FROM emergency_contacts WHERE id=?').get(req.params.cid))
  res.json({ ok: true })
})
employee.delete('/emergency-contacts/:cid', (req, res) => {
  const before = db.prepare('SELECT * FROM emergency_contacts WHERE id=?').get(req.params.cid)
  if (!before) return res.status(404).json({ error: '联系人不存在' })
  db.prepare('DELETE FROM emergency_contacts WHERE id=?').run(req.params.cid)
  audit(req.user, 'delete', 'emergency_contact', req.params.cid, before, null)
  res.json({ ok: true })
})

// ── 教育经历 ──
employee.get('/:id/education', (req, res) => {
  res.json(childRows('employee_education', req.params.id))
})
employee.post('/:id/education', (req, res) => {
  const b = req.body || {}
  if (!employeeExists(req.params.id)) return res.status(404).json({ error: '员工不存在' })
  if (!b.school) return res.status(400).json({ error: '学校必填' })
  const r = db.prepare('INSERT INTO employee_education(employee_id,school,qualification,major,graduation_year,note) VALUES(?,?,?,?,?,?)')
    .run(req.params.id, b.school, b.qualification || '', b.major || '', b.graduation_year || null, b.note || '')
  audit(req.user, 'create', 'employee_education', r.lastInsertRowid, null, db.prepare('SELECT * FROM employee_education WHERE id=?').get(r.lastInsertRowid))
  res.json({ ok: true, id: r.lastInsertRowid })
})
employee.delete('/education/:eid', (req, res) => {
  const before = db.prepare('SELECT * FROM employee_education WHERE id=?').get(req.params.eid)
  if (!before) return res.status(404).json({ error: '教育记录不存在' })
  db.prepare('DELETE FROM employee_education WHERE id=?').run(req.params.eid)
  audit(req.user, 'delete', 'employee_education', req.params.eid, before, null)
  res.json({ ok: true })
})

// ── 工作经历 ──
employee.get('/:id/work-experience', (req, res) => {
  res.json(childRows('employee_work_experience', req.params.id))
})
employee.post('/:id/work-experience', (req, res) => {
  const b = req.body || {}
  if (!employeeExists(req.params.id)) return res.status(404).json({ error: '员工不存在' })
  if (!b.company) return res.status(400).json({ error: '公司必填' })
  const r = db.prepare('INSERT INTO employee_work_experience(employee_id,company,title,start_date,end_date,note) VALUES(?,?,?,?,?,?)')
    .run(req.params.id, b.company, b.title || '', b.start_date || '', b.end_date || '', b.note || '')
  audit(req.user, 'create', 'employee_work_experience', r.lastInsertRowid, null, db.prepare('SELECT * FROM employee_work_experience WHERE id=?').get(r.lastInsertRowid))
  res.json({ ok: true, id: r.lastInsertRowid })
})
employee.delete('/work-experience/:wid', (req, res) => {
  const before = db.prepare('SELECT * FROM employee_work_experience WHERE id=?').get(req.params.wid)
  if (!before) return res.status(404).json({ error: '工作经历不存在' })
  db.prepare('DELETE FROM employee_work_experience WHERE id=?').run(req.params.wid)
  audit(req.user, 'delete', 'employee_work_experience', req.params.wid, before, null)
  res.json({ ok: true })
})

// ── 家庭成员 ──
employee.get('/:id/family', (req, res) => {
  res.json(childRows('employee_family', req.params.id))
})
employee.post('/:id/family', (req, res) => {
  const b = req.body || {}
  if (!employeeExists(req.params.id)) return res.status(404).json({ error: '员工不存在' })
  if (!b.name) return res.status(400).json({ error: '姓名必填' })
  const r = db.prepare('INSERT INTO employee_family(employee_id,name,relation,note) VALUES(?,?,?,?)')
    .run(req.params.id, b.name, b.relation || '', b.note || '')
  audit(req.user, 'create', 'employee_family', r.lastInsertRowid, null, db.prepare('SELECT * FROM employee_family WHERE id=?').get(r.lastInsertRowid))
  res.json({ ok: true, id: r.lastInsertRowid })
})
employee.delete('/family/:fid', (req, res) => {
  const before = db.prepare('SELECT * FROM employee_family WHERE id=?').get(req.params.fid)
  if (!before) return res.status(404).json({ error: '家庭成员不存在' })
  db.prepare('DELETE FROM employee_family WHERE id=?').run(req.params.fid)
  audit(req.user, 'delete', 'employee_family', req.params.fid, before, null)
  res.json({ ok: true })
})

// ── 简历附件与 AI 解析 ──
// 上传简历（multipart 字段 resume）
employee.post('/:id/resume', (req, res, next) => {
  if (!db.prepare('SELECT id FROM employees WHERE id=?').get(req.params.id)) return res.status(404).json({ error: '员工不存在' })
  next()
}, upload.single('resume'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '缺少简历文件（字段名 resume）' })
  if (!validateResumeFile(req.file)) {
    try { rmSync(req.file.path, { force: true }) } catch { /* ignore */ }
    return res.status(400).json({ error: '文件内容与扩展名不匹配' })
  }
  const r = db.prepare('INSERT INTO employee_resumes(employee_id,filename,original_name,content_type,size,file_path,uploaded_at,parse_status) VALUES(?,?,?,?,?,?,?,?)')
    .run(req.params.id, req.file.filename, req.file.originalname, req.file.mimetype, req.file.size, req.file.path, new Date().toISOString().slice(0, 19).replace('T', ' '), 'pending')
  audit(req.user, 'upload', 'employee_resume', r.lastInsertRowid, null, { employee_id: Number(req.params.id), filename: req.file.originalname, size: req.file.size })
  res.json({ ok: true, id: r.lastInsertRowid, filename: req.file.originalname })
})

// 简历列表
employee.get('/:id/resume', (req, res) => {
  res.json(db.prepare('SELECT id, filename, original_name, content_type, size, uploaded_at, parse_status, parse_engine, parsed_data FROM employee_resumes WHERE employee_id=? ORDER BY id DESC').all(req.params.id))
})

// 下载/预览简历文件
employee.get('/:id/resume/:rid/file', (req, res) => {
  const row = db.prepare('SELECT * FROM employee_resumes WHERE id=? AND employee_id=?').get(req.params.rid, req.params.id)
  if (!row) return res.status(404).json({ error: '简历不存在' })
  res.download(row.file_path, row.original_name || row.filename)
})

// 删除简历（含文件）
employee.delete('/:id/resume/:rid', (req, res) => {
  const row = db.prepare('SELECT * FROM employee_resumes WHERE id=? AND employee_id=?').get(req.params.rid, req.params.id)
  if (!row) return res.status(404).json({ error: '简历不存在' })
  db.prepare('DELETE FROM employee_resumes WHERE id=?').run(req.params.rid)
  audit(req.user, 'delete', 'employee_resume', req.params.rid, row, null)
  try { rmSync(row.file_path, { force: true }) } catch { /* 文件清理失败不阻断 */ }
  res.json({ ok: true })
})

// 解析简历 → 默认本地规则；环境开关与用户逐次授权同时满足时才调用外部 LLM
employee.post('/:id/resume/:rid/parse', async (req, res) => {
  const row = db.prepare('SELECT * FROM employee_resumes WHERE id=? AND employee_id=?').get(req.params.rid, req.params.id)
  if (!row) return res.status(404).json({ error: '简历不存在' })
  const { text, engine, unsupported, error } = await extractText(row.file_path, row.content_type, row.original_name)
  if (unsupported) return res.status(400).json({ error: '暂不支持该文件类型解析（支持 txt/md/docx/pdf）' })
  if (!text.trim()) return res.status(400).json({ error: '未能从文件中提取文本' + (error ? '：' + error : '') })
  const parsed = await parseResume(text, {
    allowExternal: req.body?.allow_external === true,
    onExternal: meta => audit(req.user, 'external_llm_request', 'employee_resume', row.id, null, meta)
  })
  db.prepare("UPDATE employee_resumes SET parse_status='parsed', parse_engine=?, parsed_data=?, text_preview=? WHERE id=?")
    .run(engine ? parsed.engine + '+extract(' + engine + ')' : parsed.engine, JSON.stringify(parsed), text.slice(0, 500), req.params.rid)
  audit(req.user, 'parse', 'employee_resume', req.params.rid, { parse_status: row.parse_status }, { parse_status: 'parsed', engine: parsed.engine })
  res.json({ ok: true, id: req.params.rid, engine: parsed.engine, parsed, text_preview: text.slice(0, 300) })
})

// 应用解析结果 → 更新档案（基础字段 + 教育 + 工作经历；已存在的记录跳过）
employee.post('/:id/resume/:rid/apply', (req, res) => {
  const row = db.prepare('SELECT * FROM employee_resumes WHERE id=? AND employee_id=?').get(req.params.rid, req.params.id)
  if (!row) return res.status(404).json({ error: '简历不存在' })
  let parsed
  try { parsed = JSON.parse(row.parsed_data) } catch { return res.status(400).json({ error: '该简历尚未解析，请先执行解析' }) }
  const applied = { basic: 0, education: 0, work_experience: 0 }
  // 基础字段（白名单）
  const b = parsed.basic || {}
  const sets = [], args = []
  for (const f of RESUME_APPLY_MAP.basic) {
    if (b[f] !== undefined && b[f] !== '' && b[f] !== null) { sets.push(`${f}=?`); args.push(String(b[f])); applied.basic++ }
  }
  inTransaction(() => {
    if (sets.length) {
      args.push(req.params.id)
      db.prepare(`UPDATE employees SET ${sets.join(',')} WHERE id=?`).run(...args)
    }
    // 教育经历（学校已存在则跳过）
    for (const ed of parsed.education || []) {
      if (!ed.school) continue
      const dup = db.prepare('SELECT id FROM employee_education WHERE employee_id=? AND school=?').get(req.params.id, ed.school)
      if (dup) continue
      db.prepare('INSERT INTO employee_education(employee_id,school,qualification,major,graduation_year,note) VALUES(?,?,?,?,?,?)')
        .run(req.params.id, ed.school, ed.qualification || '', ed.major || '', ed.graduation_year || null, ed.note || '')
      applied.education++
    }
    // 工作经历（公司已存在则跳过）
    for (const w of parsed.work_experience || []) {
      if (!w.company) continue
      const dup = db.prepare('SELECT id FROM employee_work_experience WHERE employee_id=? AND company=?').get(req.params.id, w.company)
      if (dup) continue
      db.prepare('INSERT INTO employee_work_experience(employee_id,company,title,start_date,end_date,note) VALUES(?,?,?,?,?,?)')
        .run(req.params.id, w.company, w.title || '', w.start_date || '', w.end_date || '', w.note || '')
      applied.work_experience++
    }
    db.prepare("UPDATE employee_resumes SET parse_status='applied' WHERE id=?").run(req.params.rid)
    audit(req.user, 'apply', 'employee_resume', req.params.rid, { parse_status: row.parse_status }, { parse_status: 'applied', applied })
  })
  res.json({ ok: true, applied })
})
