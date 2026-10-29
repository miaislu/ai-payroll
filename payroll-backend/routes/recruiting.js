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
import { localResumeStatus } from '../lib/local_resume_model.js'
import { candidatePersonalProfile, mergePersonalProfile, normalizeResumeProfile, readProfile } from '../lib/resume_profile.js'
import { availableRequisitions, matchRequisitions, validateRequisitionChange } from '../lib/requisition_matching.js'
import { resumeFileFilter, validateResumeBatch } from '../lib/uploads.js'
import { candidateResumeRows, candidateResumeToken, candidateSourceToken, resumeMetadata, resolveCandidateResume, insertCandidateResume, selectCandidateResume } from '../lib/candidate_resumes.js'
import { categoryOf, JOB_FAMILIES } from '../lib/validators.js'
import { JOB_CATALOG } from '../lib/job_catalog.js'
import { isDate, isPeriod } from '../lib/periods.js'
import { upsertCompensationTerm } from '../lib/employee_terms.js'
import { buildOfferApprovalContext } from '../lib/approvals.js'
import { formatRequisitionPosting } from '../lib/requisition_export.js'
import { monthlyInterviewStats, shanghaiToday } from '../lib/interview_stats.js'
import { EXPECTED_SALARY_RANGES, expectedSalaryLabel, exactExpectedSalary } from '../lib/candidate_salary.js'
import { normalizeAnnualSalary } from '../lib/candidate_annual_salary.js'
import { archiveCandidate, restoreCandidate } from '../lib/candidate_deleted_records.js'
import { candidateChannel } from '../lib/recruiting_channels.js'
import { CANDIDATE_STAGES, STAGE_LABELS, INTERVIEW_STATUSES, candidateEvent, changeCandidateStage,
  recordInterviewEvent, syncInterviewStage, candidateForEmployee, linkCandidateEmployee } from '../lib/candidate_workflow.js'

export const recruiting = Router()

recruiting.get('/job-catalog', (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.json(JOB_CATALOG)
})

recruiting.get('/resume-parser/status', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.json(await localResumeStatus())
})

export { CANDIDATE_STAGES, STAGE_LABELS }
export const REQUISITION_STATUS = ['draft', 'open', 'interview', 'closed', 'cancelled']
const PRIORITIES = ['P0', 'P1', 'P2', 'pending', 'low', 'normal', 'high', 'urgent']
const INTERVIEW_SCORES = { strong_recommend: 5, recommend: 4, pending: 3, not_recommend: 2, strong_not_recommend: 1 }
const INTERVIEW_RESULTS = Object.keys(INTERVIEW_SCORES)
const CHANNEL_TYPES = ['job_board', 'headhunter', 'employee_ref', 'university', 'other']

const finiteNonnegative = value => Number.isFinite(Number(value)) && Number(value) >= 0
const validPayMonths = (value, minimum = 0) => Number.isFinite(Number(value)) && Number(value) >= minimum && Number(value) <= 24
const validHeadcount = (base, maximum) => Number.isInteger(Number(base)) && Number(base) >= 0 && Number(base) <= 1000 && Number.isInteger(Number(maximum)) && Number(maximum) >= Number(base) && Number(maximum) <= 1000
const departmentExists = id => id == null || id === '' || Boolean(db.prepare('SELECT id FROM departments WHERE id=?').get(Number(id)))
const requisitionExists = id => id == null || id === '' || Boolean(db.prepare('SELECT id FROM job_requisitions WHERE id=?').get(Number(id)))
function recordRequisitionLink(candidate, requisitionId, user) {
  if (requisitionId === (candidate.requisition_id ?? null)) return
  const job = requisitionId ? db.prepare('SELECT title FROM job_requisitions WHERE id=?').get(requisitionId) : null
  candidateEvent(candidate.id, user, 'requisition_linked', { note: job ? `确认关联岗位：${job.title}` : '取消关联岗位',
    snapshot: { previous_requisition_id: candidate.requisition_id, requisition_id: requisitionId } })
}
function candidateDetails(rows) {
  const interviews = db.prepare('SELECT * FROM interviews ORDER BY interview_date,round_no,id').all()
  const events = db.prepare('SELECT id,candidate_id,type,from_stage,to_stage,round_no,interview_id,note,actor,occurred_at FROM candidate_events ORDER BY occurred_at,id').all()
  const groupedInterviews = {}, groupedEvents = {}, groupedResumes = {}
  for (const item of interviews) (groupedInterviews[item.candidate_id] ||= []).push(item)
  for (const item of events) (groupedEvents[item.candidate_id] ||= []).push(item)
  for (const item of db.prepare('SELECT * FROM candidate_resumes ORDER BY id DESC').all()) (groupedResumes[item.candidate_id] ||= []).push(resumeMetadata(item))
  return rows.map(row => {
    const rounds = groupedInterviews[row.id] || []
    const active = rounds.find(item => item.status === 'in_progress')
    const currentRound = row.stage === 'interview'
      ? active?.round_no || Math.max(row.current_round || 1, ...rounds.filter(item => item.status === 'completed').map(item => item.round_no))
      : row.current_round
    return { ...row, current_round: currentRound, interviews: rounds, timeline: groupedEvents[row.id] || [],
      personal_profile: candidatePersonalProfile(row), resumes: groupedResumes[row.id] || [], resume_result_token: candidateSourceToken(row),
      resume_pending: Boolean(row.resume_parsed && candidateSourceToken(row) !== row.resume_applied_hash) }
  })
}
function insertCandidate(body, user) {
  const fail = message => { throw Object.assign(new Error(message), { statusCode: 400 }) }
  if (!String(body.name || '').trim()) fail('缺少候选人姓名')
  if (!requisitionExists(body.requisition_id)) fail('招聘需求不存在')
  if (body.apply_date && !isDate(body.apply_date)) fail('申请日期不合法')
  if (body.expected_salary != null && body.expected_salary !== '' && !finiteNonnegative(body.expected_salary)) fail('期望薪资不合法')
  if (body.expected_salary_range != null && !Object.hasOwn(EXPECTED_SALARY_RANGES, body.expected_salary_range)) fail('期望月薪选项不合法')
  if (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(body.email))) fail('邮箱格式不合法')
  const channel = candidateChannel(body, db.prepare('SELECT id,name FROM recruiting_channels').all())
  if (body.source_channel_id && !channel) fail('来源渠道不存在')
  const annualSalary = normalizeAnnualSalary(body.expected_salary_annual)
  const result = db.prepare(`INSERT INTO candidates(name,phone,email,source_channel,source_channel_id,requisition_id,stage,apply_date,expected_salary,expected_salary_range,created_at)
    VALUES(?,?,?,?,?,?,'new',?,?,?,?)`).run(String(body.name).trim().slice(0, 80), String(body.phone || '').slice(0, 40),
    String(body.email || '').slice(0, 160), channel?.name || String(body.source_channel || '其他').slice(0, 120), channel?.id || null,
    body.requisition_id || null, body.apply_date || shanghaiToday(), body.expected_salary == null || body.expected_salary === '' ? null : Number(body.expected_salary), body.expected_salary_range ?? null, new Date().toISOString())
  const id = Number(result.lastInsertRowid)
  if (annualSalary != null) db.prepare('UPDATE candidates SET expected_salary_annual=? WHERE id=?').run(annualSalary, id)
  candidateEvent(id, user, 'created', { to_stage: 'new', note: body.resume_import ? '上传简历建档' : '手动录入建档' })
  audit(user, 'create', 'candidate', id, null, { name: body.name, stage: 'new' })
  return id
}
const optionalNumber = value => value == null || value === '' ? null : Number(value)
const channelDetails = (body, type) => {
  if (type !== 'headhunter') return { fee_basis_months: null, fee_rate: null, guarantee_months: null, payment_account_name: '', payment_account_number: '', payment_bank: '' }
  const details = {
    fee_basis_months: optionalNumber(body.fee_basis_months),
    fee_rate: optionalNumber(body.fee_rate),
    guarantee_months: optionalNumber(body.guarantee_months),
    payment_account_name: String(body.payment_account_name || '').trim().slice(0, 120),
    payment_account_number: String(body.payment_account_number || '').trim().slice(0, 120),
    payment_bank: String(body.payment_bank || '').trim().slice(0, 160)
  }
  if (details.fee_basis_months != null && ![6, 12, 13, 15].includes(details.fee_basis_months)) throw new Error('计费依据须为 6、12、13 或 15 个月月薪')
  if (details.fee_rate != null && (!Number.isFinite(details.fee_rate) || details.fee_rate < 0 || details.fee_rate > 100)) throw new Error('费率须为 0-100%')
  if (details.guarantee_months != null && (!Number.isFinite(details.guarantee_months) || details.guarantee_months < 0 || details.guarantee_months > 24)) throw new Error('保证期须为 0-24 个月')
  return details
}

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
  const rows = db.prepare(`SELECT * FROM job_requisitions ORDER BY
    CASE status WHEN 'open' THEN 0 WHEN 'interview' THEN 1 WHEN 'draft' THEN 2 WHEN 'closed' THEN 3 ELSE 4 END,
    CASE priority WHEN 'P0' THEN 0 WHEN 'urgent' THEN 0 WHEN 'P1' THEN 1 WHEN 'high' THEN 1 WHEN 'P2' THEN 2 WHEN 'normal' THEN 2 ELSE 3 END,
    id DESC`).all()
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

// UTF-8 纯文本 JD：可直接转发猎头、复制到招聘网站，支持单个或全部在招需求。
recruiting.get('/requisitions/export', (req, res) => {
  const id = req.query.id ? Number(req.query.id) : null
  const rows = id
    ? db.prepare('SELECT * FROM job_requisitions WHERE id=?').all(id)
    : db.prepare(`SELECT * FROM job_requisitions WHERE status NOT IN ('closed','cancelled') ORDER BY
        CASE priority WHEN 'P0' THEN 0 WHEN 'urgent' THEN 0 WHEN 'P1' THEN 1 WHEN 'high' THEN 1 WHEN 'P2' THEN 2 WHEN 'normal' THEN 2 ELSE 3 END,
        id DESC`).all()
  if (!rows.length) return res.status(404).json({ error: '没有可导出的招聘需求' })
  const output = rows.map(formatRequisitionPosting).join('\n\n' + '='.repeat(48) + '\n\n')
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="recruiting-jd-${id || 'all'}.txt"`)
  res.send('\uFEFF' + output)
})

recruiting.post('/requisitions', (req, res) => {
  const b = req.body || {}
  if (!String(b.title || '').trim()) return res.status(400).json({ error: '缺少岗位名称' })
  if (!departmentExists(b.department_id)) return res.status(400).json({ error: '部门不存在' })
  const headcount = Number(b.headcount ?? 1)
  const headcountMax = Number(b.headcount_max ?? headcount)
  if (!validHeadcount(headcount, headcountMax)) return res.status(400).json({ error: '基准编制须为 0-1000 的整数，弹性上限不得低于基准编制' })
  if (b.status && !REQUISITION_STATUS.includes(b.status)) return res.status(400).json({ error: '需求状态不合法' })
  if (b.priority && !PRIORITIES.includes(b.priority)) return res.status(400).json({ error: '优先级不合法' })
  if (b.target_month && !isPeriod(b.target_month)) return res.status(400).json({ error: '目标月份须为 YYYY-MM' })
  if ((b.salary_min != null && !finiteNonnegative(b.salary_min)) || (b.salary_max != null && !finiteNonnegative(b.salary_max)) || (b.salary_min != null && b.salary_max != null && Number(b.salary_min) > Number(b.salary_max))) return res.status(400).json({ error: '薪资范围不合法' })
  const jobFamily = String(b.job_family || '')
  if (!JOB_FAMILIES.includes(jobFamily)) return res.status(400).json({ error: '岗位不在技术、管理、职能分类清单中' })
  const employmentType = ['employee', 'consultant', 'intern'].includes(b.employment_type) ? b.employment_type : 'employee'
  const fixedMonths = Number(b.fixed_salary_months ?? 12)
  const bonusMonths = Number(b.annual_bonus_months ?? 0)
  if (!validPayMonths(fixedMonths, 1) || !validPayMonths(bonusMonths)) return res.status(400).json({ error: '固定薪资月数或年终奖月数不合法' })
  const grade = ['P4', 'P5', 'P6', 'P7', 'M1', 'M2'].includes(b.grade) ? b.grade : 'P5'
  const r = db.prepare(`INSERT INTO job_requisitions(
    title,department_id,job_family,job_category,grade,city,headcount,headcount_max,priority,status,salary_min,salary_max,
    reason,created_by,created_at,target_month,employment_type,fixed_salary_months,annual_bonus_months,
    responsibilities,requirements,education_requirement,experience_requirement,skills,team_label,target_timing
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(String(b.title).trim().slice(0, 120), b.department_id || null, jobFamily, categoryOf(jobFamily), grade,
      String(b.city || '上海').slice(0, 30), headcount, headcountMax, b.priority || 'P1', b.status || 'open',
      b.salary_min == null ? null : Number(b.salary_min), b.salary_max == null ? null : Number(b.salary_max),
      String(b.reason || '').slice(0, 3000), req.user.name, new Date().toISOString().slice(0, 10), b.target_month || null,
      employmentType, fixedMonths, bonusMonths, String(b.responsibilities || '').slice(0, 6000),
      String(b.requirements || '').slice(0, 6000), String(b.education_requirement || '').slice(0, 100),
      String(b.experience_requirement || '').slice(0, 100), String(b.skills || '').slice(0, 6000),
      String(b.team_label || '').slice(0, 120), String(b.target_timing || '').slice(0, 120))
  audit(req.user, 'create', 'job_requisition', r.lastInsertRowid, null, db.prepare('SELECT * FROM job_requisitions WHERE id=?').get(r.lastInsertRowid))
  res.json({ ok: true, id: r.lastInsertRowid })
})

recruiting.put('/requisitions/:id', (req, res) => {
  const b = req.body || {}
  const before = db.prepare('SELECT * FROM job_requisitions WHERE id=?').get(req.params.id)
  if (!before) return res.status(404).json({ error: '需求不存在' })
  const next = { ...before, ...b }
  if (!String(next.title || '').trim() || !departmentExists(next.department_id)) return res.status(400).json({ error: '岗位名称或部门不合法' })
  if (!validHeadcount(next.headcount, next.headcount_max ?? next.headcount)) return res.status(400).json({ error: '基准编制须为 0-1000 的整数，弹性上限不得低于基准编制' })
  if (!REQUISITION_STATUS.includes(next.status) || !PRIORITIES.includes(next.priority)) return res.status(400).json({ error: '需求状态或优先级不合法' })
  if (next.target_month && !isPeriod(next.target_month)) return res.status(400).json({ error: '目标月份须为 YYYY-MM' })
  if ((next.salary_min != null && !finiteNonnegative(next.salary_min)) || (next.salary_max != null && !finiteNonnegative(next.salary_max)) || (next.salary_min != null && next.salary_max != null && Number(next.salary_min) > Number(next.salary_max))) return res.status(400).json({ error: '薪资范围不合法' })
  if (!JOB_FAMILIES.includes(String(next.job_family || ''))) return res.status(400).json({ error: '岗位不在技术、管理、职能分类清单中' })
  if (!['employee', 'consultant', 'intern'].includes(next.employment_type || 'employee')) return res.status(400).json({ error: '用工类型不合法' })
  if (!validPayMonths(next.fixed_salary_months ?? 12, 1) || !validPayMonths(next.annual_bonus_months ?? 0)) return res.status(400).json({ error: '固定薪资月数或年终奖月数不合法' })
  const r = db.prepare(`UPDATE job_requisitions SET
    title=?, department_id=?, job_family=?, job_category=?, grade=COALESCE(?,grade),
    city=COALESCE(?,city), headcount=COALESCE(?,headcount), headcount_max=COALESCE(?,headcount_max), priority=COALESCE(?,priority), status=COALESCE(?,status),
    salary_min=?, salary_max=?, reason=?, target_month=?, employment_type=?, fixed_salary_months=?, annual_bonus_months=?,
    responsibilities=?, requirements=?, education_requirement=?, experience_requirement=?, skills=?, team_label=?, target_timing=?,
    closed_at=CASE WHEN ?='closed' THEN COALESCE(closed_at,date('now')) ELSE closed_at END
    WHERE id=?`)
    .run(String(next.title).trim().slice(0, 120), next.department_id || null, next.job_family, categoryOf(next.job_family), b.grade || null,
      next.city, Number(next.headcount), Number(next.headcount_max ?? next.headcount), next.priority, next.status, next.salary_min ?? null, next.salary_max ?? null,
      String(next.reason || '').slice(0, 3000), next.target_month || null, next.employment_type || 'employee',
      Number(next.fixed_salary_months ?? 12), Number(next.annual_bonus_months ?? 0),
      String(next.responsibilities || '').slice(0, 6000), String(next.requirements || '').slice(0, 6000),
      String(next.education_requirement || '').slice(0, 100), String(next.experience_requirement || '').slice(0, 100),
      String(next.skills || '').slice(0, 6000), String(next.team_label || '').slice(0, 120),
      String(next.target_timing || '').slice(0, 120), next.status, req.params.id)
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
  let sql = `SELECT c.*, COALESCE(rc.name,c.source_channel) AS source_channel,
    rc.name AS linked_channel_name, rc.type AS linked_channel_type, rc.fee_basis_months, rc.fee_rate, rc.guarantee_months,
    r.title AS requisition_title, r.job_family
    FROM candidates c
    LEFT JOIN job_requisitions r ON c.requisition_id=r.id
    LEFT JOIN recruiting_channels rc ON c.source_channel_id=rc.id`
  const where = [], args = []
  if (stage) { where.push('c.stage=?'); args.push(stage) }
  if (requisition_id) { where.push('c.requisition_id=?'); args.push(requisition_id) }
  if (where.length) sql += ' WHERE ' + where.join(' AND ')
  sql += ' ORDER BY c.id DESC'
  const rows = db.prepare(sql).all(...args)
  res.json(candidateDetails(rows))
})

// 管线看板：按阶段分组（附带面试记录）
recruiting.get('/candidates/kanban', (req, res) => {
  const rows = db.prepare(`SELECT c.*, COALESCE(rc.name,c.source_channel) AS source_channel,
    rc.name AS linked_channel_name, rc.type AS linked_channel_type, rc.fee_basis_months, rc.fee_rate, rc.guarantee_months,
    r.title AS requisition_title, r.job_family, r.grade AS req_grade
    FROM candidates c
    LEFT JOIN job_requisitions r ON c.requisition_id=r.id
    LEFT JOIN recruiting_channels rc ON c.source_channel_id=rc.id
    ORDER BY c.id DESC`).all()
  const detailed = candidateDetails(rows)
  const groups = CANDIDATE_STAGES.map(s => ({
    stage: s, label: STAGE_LABELS[s], items: detailed.filter(c => c.stage === s)
  }))
  res.json(groups)
})

recruiting.post('/candidates', (req, res) => {
  const id = inTransaction(() => insertCandidate(req.body || {}, req.user))
  res.json({ ok: true, id })
})

recruiting.post('/candidates/from-resume', candUpload.array('resume', 10), async (req, res) => {
  const files = req.files || []
  try {
    validateResumeBatch(files)
    const primary = req.body?.primary_index == null ? 0 : Number(req.body.primary_index)
    if (!Number.isInteger(primary) || primary < 0 || primary >= files.length) throw Object.assign(new Error('请选择有效的建档提取文件'), { statusCode: 400 })
    const file = files[primary]
    const extracted = await extractText(file.path, file.mimetype, file.originalname)
    let parsed = null
    let warning = extracted.error || ''
    if (extracted.text?.trim()) parsed = await parseResume(extracted.text, { allowExternal: false })
    else warning ||= '未提取到文字，已保存原始简历，请手动补充信息'
    const basic = parsed?.basic || {}
    const b = req.body || {}
    const localPhone = extracted.text?.match(/(?:\+?86[-\s]?)?(1[3-9]\d{9})/)?.[1]
    const name = b.name?.trim() || basic.name || `待补充姓名 · ${path.basename(file.originalname, path.extname(file.originalname))}`
    let saved
    const id = inTransaction(() => {
      const id = insertCandidate({ ...b, name, phone: b.phone || localPhone || basic.mobile || '', email: b.email || basic.personal_email || '', resume_import: true }, req.user)
      saved = files.map((item, index) => insertCandidateResume(db, id, item, index === primary ? parsed : null))
      selectCandidateResume(db, id, saved[primary])
      candidateEvent(id, req.user, 'resume_uploaded', { note: `已保存 ${saved.length} 份简历附件` })
      return id
    })
    res.json({ ok: true, id, warning, resumes: saved.map(resumeMetadata), source_resume_id: saved[primary].id })
  } catch (error) {
    for (const file of files) try { rmSync(file.path, { force: true }) } catch { /* cleanup */ }
    throw error
  }
})

recruiting.put('/candidates/:id', (req, res) => {
  const b = req.body || {}
  const current = db.prepare('SELECT * FROM candidates WHERE id=?').get(req.params.id)
  if (!current) return res.status(404).json({ error: '候选人不存在' })
  const personalProfile = b.personal_profile ? normalizeResumeProfile(b.personal_profile) : candidatePersonalProfile(current)
  const offerChanged = b.offer_amount !== undefined && Number(b.offer_amount) !== Number(current.offer_amount)
  const next = { ...current }
  if (b.notes_category !== undefined) {
    if (!['', 'high', 'pending', 'custom'].includes(b.notes_category)) return res.status(400).json({ error: '备注选项不合法' })
    next.notes_category = b.notes_category
  }
  if (b.notes !== undefined) {
    if (typeof b.notes !== 'string' || b.notes.length > 5000) return res.status(400).json({ error: '备注须为文本，最多5000字' })
    next.notes = b.notes
  }
  if (b.expected_salary_annual !== undefined) next.expected_salary_annual = normalizeAnnualSalary(b.expected_salary_annual)
  if (b.personal_profile) {
    next.name = personalProfile.basic.name
    next.phone = personalProfile.basic.mobile
    next.email = personalProfile.basic.personal_email
  }
  for (const field of ['name', 'phone', 'email', 'source_channel', 'source_channel_id', 'requisition_id', 'apply_date', 'expected_salary', 'expected_salary_range', 'offer_amount', 'offer_date', 'onboard_date', 'eval_score', 'reject_reason']) {
    if (b[field] !== undefined) next[field] = b[field]
  }
  if (!String(next.name || '').trim() || !requisitionExists(next.requisition_id)) return res.status(400).json({ error: '候选人姓名或招聘需求不合法' })
  next.requisition_id = validateRequisitionChange(db, current, next.requisition_id)
  for (const field of ['apply_date', 'offer_date', 'onboard_date']) if (next[field] && !isDate(next[field])) return res.status(400).json({ error: `${field} 日期不合法` })
  for (const field of ['expected_salary', 'offer_amount', 'eval_score']) if (next[field] != null && !finiteNonnegative(next[field])) return res.status(400).json({ error: `${field} 须为非负数字` })
  if (next.expected_salary_range != null && !Object.hasOwn(EXPECTED_SALARY_RANGES, next.expected_salary_range)) return res.status(400).json({ error: '期望月薪选项不合法' })
  if (next.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(next.email))) return res.status(400).json({ error: '邮箱格式不合法' })
  const sourceChannel = candidateChannel(next, db.prepare('SELECT id,name FROM recruiting_channels').all())
  if (next.source_channel_id != null && next.source_channel_id !== '' && !sourceChannel) return res.status(400).json({ error: '来源渠道不存在' })
  next.source_channel_id = sourceChannel?.id || null
  next.source_channel = sourceChannel?.name || String(next.source_channel || '其他').trim().slice(0, 80)
  inTransaction(() => {
    db.prepare(`UPDATE candidates SET
      name=?, phone=?, email=?, source_channel=?, source_channel_id=?, requisition_id=?,
      apply_date=?, expected_salary=?, expected_salary_range=?, offer_amount=?, offer_date=?,
      onboard_date=?, eval_score=?, reject_reason=?,
      offer_status=CASE WHEN ? THEN NULL ELSE offer_status END
      WHERE id=?`)
      .run(next.name, next.phone, next.email, next.source_channel, next.source_channel_id, next.requisition_id, next.apply_date, next.expected_salary, next.expected_salary_range, next.offer_amount, next.offer_date, next.onboard_date, next.eval_score, next.reject_reason, offerChanged ? 1 : 0, req.params.id)
    if (offerChanged) db.prepare("UPDATE approvals SET status='cancelled', comment=COALESCE(comment,'Offer 金额变更，审批自动失效') WHERE ref_type='candidate' AND ref_id=? AND type='offer' AND status='pending'").run(req.params.id)
    if (b.notes_category !== undefined) db.prepare('UPDATE candidates SET notes_category=? WHERE id=?').run(next.notes_category, current.id)
    if (b.notes !== undefined) db.prepare('UPDATE candidates SET notes=? WHERE id=?').run(next.notes, current.id)
    if (b.expected_salary_annual !== undefined) db.prepare('UPDATE candidates SET expected_salary_annual=? WHERE id=?').run(next.expected_salary_annual, current.id)
    if (offerChanged && current.stage === 'accepted') changeCandidateStage(current.id, 'offer', req.user, { note: 'Offer 薪资变更，需重新审批与确认录用' })
    candidateEvent(current.id, req.user, 'profile_updated', { note: offerChanged ? '更新 Offer 薪资' : (b.notes !== undefined || b.notes_category !== undefined) ? '更新候选人备注' : '更新人选资料' })
    recordRequisitionLink(current, next.requisition_id, req.user)
    audit(req.user, 'update', 'candidate', current.id, current, { ...next, offer_status: offerChanged ? null : current.offer_status })
    personalProfile.basic = { ...personalProfile.basic, name: next.name, mobile: next.phone || '', personal_email: next.email || '' }
    db.prepare('UPDATE candidates SET profile_json=?,skills=? WHERE id=?').run(JSON.stringify(personalProfile), personalProfile.basic.skills || null, current.id)
  })
  res.json({ ok: true, id: Number(req.params.id) })
})

recruiting.delete('/candidates/:id', (req, res) => {
  const candidate = db.prepare('SELECT * FROM candidates WHERE id=?').get(req.params.id)
  if (!candidate) return res.status(404).json({ error: '候选人不存在' })
  if (candidate.employee_id) return res.status(409).json({ error: '已入职候选人不可删除，请保留招聘审计链路' })
  if (db.prepare('SELECT 1 FROM approvals WHERE ref_type=\'candidate\' AND ref_id=? LIMIT 1').get(req.params.id)) return res.status(409).json({ error: '已有审批记录的候选人不可物理删除' })
  if (db.prepare('SELECT 1 FROM channel_expenses WHERE candidate_id=? LIMIT 1').get(req.params.id)) return res.status(409).json({ error: '该候选人已有猎头费用记录，不可删除' })
  const archiveId = inTransaction(() => {
    const id = archiveCandidate(db, candidate, req.user.name)
    audit(req.user, 'archive', 'candidate', req.params.id, candidate, { archive_id: id })
    return id
  })
  res.json({ ok: true, archive_id: archiveId, recoverable: true })
})

recruiting.get('/candidates/deleted', (req, res) => {
  res.json(db.prepare('SELECT id,candidate_id,name,deleted_at,deleted_by FROM candidate_deleted_records WHERE restored_at IS NULL ORDER BY id DESC').all())
})

recruiting.post('/candidates/deleted/:archiveId/restore', (req, res) => {
  const id = inTransaction(() => {
    const id = restoreCandidate(db, Number(req.params.archiveId), req.user.name)
    audit(req.user, 'restore', 'candidate', id, null, { archive_id: Number(req.params.archiveId) })
    return id
  })
  res.json({ ok: true, id })
})

// 阶段流转（Kanban 拖拽）
recruiting.post('/candidates/:id/stage', (req, res) => {
  const { stage, reject_reason, note, round_no } = req.body || {}
  if (!CANDIDATE_STAGES.includes(stage)) return res.status(400).json({ error: '非法阶段' })
  if (stage === 'hired') return res.status(400).json({ error: '已入职阶段只能通过办理入职产生' })
  inTransaction(() => changeCandidateStage(Number(req.params.id), stage, req.user, { note: reject_reason || note || '', round: round_no }))
  res.json({ ok: true, id: Number(req.params.id), stage })
})

// ── Offer → 入职打通：候选人转员工档案（招聘模块 → 员工模块闭环）──
// 生成员工档案（职级/岗位/城市/月薪取自关联需求与 Offer）+ 自动记录入职事件
recruiting.post('/candidates/:id/onboard', (req, res) => {
  const { onboard_date, department_id } = req.body || {}
  const c = db.prepare('SELECT * FROM candidates WHERE id=?').get(req.params.id)
  if (!c) return res.status(404).json({ error: '候选人不存在' })
  if (c.employee_id || c.stage === 'hired') return res.status(409).json({ error: '该候选人已入职，请勿重复办理', employee_id: c.employee_id || null })
  candidateForEmployee(c.id)
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
    candidateForEmployee(fresh.id)
    const ins = db.prepare(`INSERT INTO employees(
      name,grade,job_family,city,category,status,monthly_base,perf_ratio,hire_month,hire_date,department_id,
      fixed_salary_months,annual_bonus_months
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(c.name, grade, job_family, city, categoryOf(job_family), 'active', base, 0.30, hire_month, date, dept,
        Number(r?.fixed_salary_months ?? 12), Number(r?.annual_bonus_months ?? 0))
    const id = ins.lastInsertRowid
    upsertCompensationTerm(db.prepare('SELECT * FROM employees WHERE id=?').get(id), hire_month, { actor: req.user.name })
    linkCandidateEmployee(c.id, id, date, req.user)
    return id
  })
  res.json({ ok: true, employee_id: empId, candidate_id: c.id, name: c.name, hire_month, onboard_date: date })
})

// ── 面试 ──
recruiting.get('/interviews', (req, res) => {
  const rows = db.prepare(`SELECT i.*, c.name AS candidate_name, c.requisition_id, r.title AS requisition_title
    FROM interviews i LEFT JOIN candidates c ON i.candidate_id=c.id
    LEFT JOIN job_requisitions r ON c.requisition_id=r.id
    ORDER BY i.interview_date DESC,i.round_no DESC,i.id DESC`).all()
  res.json(rows)
})
recruiting.post('/interviews', (req, res) => {
  const b = req.body || {}
  if (!b.candidate_id || !String(b.interviewer || '').trim()) return res.status(400).json({ error: '缺少候选人或面试官' })
  if (!db.prepare('SELECT id FROM candidates WHERE id=?').get(b.candidate_id)) return res.status(400).json({ error: '候选人不存在' })
  if (b.interview_date && !isDate(b.interview_date)) return res.status(400).json({ error: '面试日期不合法' })
  if (b.result && !INTERVIEW_RESULTS.includes(b.result)) return res.status(400).json({ error: '面试结果不合法' })
  const status = b.status || 'completed'
  if (!INTERVIEW_STATUSES.includes(status)) return res.status(400).json({ error: '面试状态不合法' })
  const candidate = db.prepare('SELECT stage FROM candidates WHERE id=?').get(b.candidate_id)
  if (['scheduled', 'in_progress'].includes(status) && ['accepted', 'hired', 'rejected', 'withdrawn'].includes(candidate.stage)) return res.status(409).json({ error: '该人选已结束招聘流程，不能新增待面试安排' })
  if (['scheduled', 'in_progress'].includes(status) && db.prepare("SELECT 1 FROM interviews WHERE candidate_id=? AND round_no=? AND status IN ('scheduled','in_progress')").get(b.candidate_id, Number(b.round_no ?? 1))) return res.status(409).json({ error: '已有本轮面试安排，请编辑原记录' })
  if (status !== 'completed' && !b.interview_date) return res.status(400).json({ error: '安排面试须填写日期' })
  if (!Number.isInteger(Number(b.round_no ?? 1)) || Number(b.round_no ?? 1) < 1 || Number(b.round_no ?? 1) > 20) return res.status(400).json({ error: '轮次须为 1-20 的整数' })
  const result = status === 'completed' ? b.result || 'pending' : 'pending'
  const id = inTransaction(() => {
    const r = db.prepare('INSERT INTO interviews(candidate_id,round_no,interviewer,interview_date,result,score,notes,status) VALUES(?,?,?,?,?,?,?,?)')
      .run(b.candidate_id, Number(b.round_no ?? 1), String(b.interviewer).slice(0, 80), b.interview_date || shanghaiToday(), result,
        status === 'completed' ? INTERVIEW_SCORES[result] : null, String(b.notes || '').slice(0, 4000), status)
    const interview = db.prepare('SELECT * FROM interviews WHERE id=?').get(r.lastInsertRowid)
    recordInterviewEvent(interview, req.user, status === 'scheduled' ? 'interview_scheduled' : 'interview_recorded')
    syncInterviewStage(interview, req.user)
    audit(req.user, 'create', 'interview', interview.id, null, interview)
    return interview.id
  })
  res.json({ ok: true, id })
})
recruiting.put('/interviews/:id', (req, res) => {
  const b = req.body || {}
  const before = db.prepare('SELECT * FROM interviews WHERE id=?').get(req.params.id)
  if (!before) return res.status(404).json({ error: '面试不存在' })
  const next = { ...before, ...b }
  if (!String(next.interviewer || '').trim() || !isDate(next.interview_date) || !INTERVIEW_RESULTS.includes(next.result)) return res.status(400).json({ error: '面试官、日期或结果不合法' })
  if (!Number.isInteger(Number(next.round_no)) || Number(next.round_no) < 1 || Number(next.round_no) > 20) return res.status(400).json({ error: '轮次须为 1-20 的整数' })
  if (!INTERVIEW_STATUSES.includes(next.status)) return res.status(400).json({ error: '面试状态不合法' })
  if (['scheduled', 'in_progress'].includes(next.status)) {
    const candidate = db.prepare('SELECT stage FROM candidates WHERE id=?').get(before.candidate_id)
    if (['accepted', 'hired', 'rejected', 'withdrawn'].includes(candidate.stage)) return res.status(409).json({ error: '该人选已结束招聘流程，不能恢复待面试安排' })
    if (db.prepare("SELECT 1 FROM interviews WHERE candidate_id=? AND round_no=? AND status IN ('scheduled','in_progress') AND id<>?").get(before.candidate_id, Number(next.round_no), before.id)) return res.status(409).json({ error: '已有本轮面试安排，请编辑原记录' })
  }
  if (next.status !== 'completed') next.result = 'pending'
  inTransaction(() => {
    db.prepare('UPDATE interviews SET round_no=?,interviewer=?,interview_date=?,result=?,score=?,notes=?,status=? WHERE id=?')
      .run(next.round_no, String(next.interviewer).slice(0, 80), next.interview_date, next.result,
        next.status === 'completed' ? INTERVIEW_SCORES[next.result] : null, String(next.notes || '').slice(0, 4000), next.status, req.params.id)
    const interview = db.prepare('SELECT * FROM interviews WHERE id=?').get(req.params.id)
    recordInterviewEvent(interview, req.user, 'interview_updated')
    syncInterviewStage(interview, req.user)
    audit(req.user, 'update', 'interview', req.params.id, before, interview)
  })
  res.json({ ok: true })
})
recruiting.delete('/interviews/:id', (req, res) => {
  const before = db.prepare('SELECT * FROM interviews WHERE id=?').get(req.params.id)
  if (!before) return res.status(404).json({ error: '面试不存在' })
  inTransaction(() => {
    recordInterviewEvent({ ...before, status: 'cancelled' }, req.user, 'interview_deleted', '删除面试记录（流转历史保留）')
    db.prepare('DELETE FROM interviews WHERE id=?').run(req.params.id)
    syncInterviewStage({ ...before, status: 'cancelled' }, req.user)
    audit(req.user, 'delete', 'interview', req.params.id, before, null)
  })
  res.json({ ok: true })
})

// ── 渠道与费用 ──
recruiting.get('/channels', (req, res) => {
  const rows = db.prepare('SELECT * FROM recruiting_channels ORDER BY id').all()
  const exp = db.prepare(`SELECT e.id,e.channel_id,e.candidate_id,e.year_month,e.amount,e.note,
    c.name AS candidate_name FROM channel_expenses e LEFT JOIN candidates c ON e.candidate_id=c.id
    ORDER BY e.year_month,e.id`).all()
  const candidates = db.prepare(`SELECT c.id,c.source_channel,c.source_channel_id,c.name,c.stage,c.apply_date,c.expected_salary,c.expected_salary_range,c.expected_salary_annual,c.offer_amount,
    r.title AS requisition_title FROM candidates c
    LEFT JOIN job_requisitions r ON c.requisition_id=r.id
    ORDER BY c.id DESC`).all()
  const perChannel = {}
  const candidatesPerChannel = {}
  for (const e of exp) (perChannel[e.channel_id] = perChannel[e.channel_id] || []).push(e)
  for (const candidate of candidates) {
    const channel = candidateChannel(candidate, rows)
    if (channel) (candidatesPerChannel[channel.id] ||= []).push(candidate)
  }
  res.json(rows.map(c => ({ ...c, expenses: perChannel[c.id] || [], candidates: candidatesPerChannel[c.id] || [],
    candidate_count: (candidatesPerChannel[c.id] || []).length,
    total_cost: (perChannel[c.id] || []).reduce((sum, item) => sum + Number(item.amount || 0), 0) })))
})
recruiting.post('/channels', (req, res) => {
  const b = req.body || {}
  const type = b.type || 'other'
  if (!String(b.name || '').trim()) return res.status(400).json({ error: '缺少渠道名称' })
  if (db.prepare('SELECT 1 FROM recruiting_channels WHERE name=?').get(String(b.name).trim().slice(0,120))) return res.status(409).json({ error: '同名渠道已存在，请使用现有渠道' })
  if (!CHANNEL_TYPES.includes(type)) return res.status(400).json({ error: '渠道类型不合法' })
  let details
  try { details = channelDetails(b, type) } catch (error) { return res.status(400).json({ error: error.message }) }
  const r = db.prepare(`INSERT INTO recruiting_channels(
    name,type,contact,contact_info,note,fee_basis_months,fee_rate,guarantee_months,payment_account_name,payment_account_number,payment_bank
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
    String(b.name).trim().slice(0, 120), type, String(b.contact || '').trim().slice(0, 160), String(b.contact_info || '').trim().slice(0, 240), String(b.note || '').trim().slice(0, 1000),
    details.fee_basis_months, details.fee_rate, details.guarantee_months, details.payment_account_name, details.payment_account_number, details.payment_bank)
  audit(req.user, 'create', 'recruiting_channel', r.lastInsertRowid, null, db.prepare('SELECT * FROM recruiting_channels WHERE id=?').get(r.lastInsertRowid))
  res.json({ ok: true, id: r.lastInsertRowid })
})
recruiting.put('/channels/:id', (req, res) => {
  const b = req.body || {}
  const before = db.prepare('SELECT * FROM recruiting_channels WHERE id=?').get(req.params.id)
  if (!before) return res.status(404).json({ error: '渠道不存在' })
  const next = { ...before, ...b }
  if (!String(next.name || '').trim()) return res.status(400).json({ error: '缺少渠道名称' })
  if (db.prepare('SELECT 1 FROM recruiting_channels WHERE name=? AND id<>?').get(String(next.name).trim().slice(0,120),before.id)) return res.status(409).json({ error: '同名渠道已存在' })
  if (!CHANNEL_TYPES.includes(next.type)) return res.status(400).json({ error: '渠道类型不合法' })
  let details
  try { details = channelDetails(next, next.type) } catch (error) { return res.status(400).json({ error: error.message }) }
  const r = db.prepare(`UPDATE recruiting_channels SET
    name=?, type=?, contact=?, contact_info=?, note=?, fee_basis_months=?, fee_rate=?, guarantee_months=?,
    payment_account_name=?, payment_account_number=?, payment_bank=? WHERE id=?`).run(
    String(next.name).trim().slice(0, 120), next.type, String(next.contact || '').trim().slice(0, 160), String(next.contact_info || '').trim().slice(0, 240), String(next.note || '').trim().slice(0, 1000),
    details.fee_basis_months, details.fee_rate, details.guarantee_months, details.payment_account_name, details.payment_account_number, details.payment_bank, req.params.id)
  db.prepare('UPDATE candidates SET source_channel=? WHERE source_channel_id=?').run(String(next.name).trim().slice(0, 120), req.params.id)
  audit(req.user, 'update', 'recruiting_channel', req.params.id, before, db.prepare('SELECT * FROM recruiting_channels WHERE id=?').get(req.params.id))
  res.json({ ok: true })
})
recruiting.delete('/channels/:id', (req, res) => {
  const before = db.prepare('SELECT * FROM recruiting_channels WHERE id=?').get(req.params.id)
  if (!before) return res.status(404).json({ error: '渠道不存在' })
  const channels = db.prepare('SELECT id,name FROM recruiting_channels').all()
  const candidateCount = db.prepare('SELECT source_channel_id,source_channel FROM candidates').all().filter(candidate => candidateChannel(candidate,channels)?.id === before.id).length
  if (candidateCount) return res.status(409).json({ error: `该渠道已关联 ${candidateCount} 位候选人，请先调整候选人来源` })
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
  const channel = db.prepare('SELECT * FROM recruiting_channels WHERE id=?').get(b.channel_id)
  if (!channel) return res.status(400).json({ error: '渠道不存在' })
  const candidate = b.candidate_id == null || b.candidate_id === '' ? null : db.prepare('SELECT id,name,source_channel,source_channel_id,expected_salary,expected_salary_range,offer_amount FROM candidates WHERE id=?').get(b.candidate_id)
  if (b.candidate_id != null && b.candidate_id !== '' && !candidate) return res.status(400).json({ error: '候选人不存在' })
  if (candidate && candidateChannel(candidate,db.prepare('SELECT id,name FROM recruiting_channels').all())?.id !== channel.id) return res.status(400).json({ error: '候选人未关联到该渠道' })
  if (channel.type === 'headhunter' && !candidate) return res.status(400).json({ error: '猎头费用必须关联具体候选人' })
  const salary = Number(candidate?.offer_amount || exactExpectedSalary(candidate))
  const suggested = salary && channel.fee_basis_months != null && channel.fee_rate != null
    ? Math.round(salary * Number(channel.fee_basis_months) * Number(channel.fee_rate) / 100)
    : null
  const amount = b.amount == null || b.amount === '' ? suggested : Number(b.amount)
  if (!isPeriod(b.year_month) || amount == null || !finiteNonnegative(amount)) return res.status(400).json({ error: '月份或金额不合法' })
  const r = db.prepare('INSERT INTO channel_expenses(channel_id,candidate_id,year_month,amount,note) VALUES(?,?,?,?,?)').run(b.channel_id, candidate?.id || null, b.year_month, Math.round(amount), String(b.note || '').slice(0, 500))
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
  const today = shanghaiToday()
  const interviewMonth = req.query.interview_month || today.slice(0, 7)
  if (!isPeriod(interviewMonth)) return res.status(400).json({ error: '面试统计月份须为 YYYY-MM' })
  const interviewRows = db.prepare(`SELECT i.id,i.candidate_id,i.round_no,i.interviewer,i.interview_date,i.result,i.status,
    c.name AS candidate_name,r.title AS requisition_title
    FROM interviews i JOIN candidates c ON i.candidate_id=c.id
    LEFT JOIN job_requisitions r ON c.requisition_id=r.id
    ORDER BY i.interview_date,i.round_no,i.id`).all()
  const interviewEvents = db.prepare(`SELECT e.id,e.interview_id,e.occurred_at,e.snapshot_json,c.name AS candidate_name
    FROM candidate_events e JOIN candidates c ON e.candidate_id=c.id WHERE e.snapshot_json IS NOT NULL ORDER BY e.occurred_at,e.id`).all()
  const historicalMonths = interviewEvents.map(event => {
    try { return JSON.parse(event.snapshot_json).interview_date?.slice(0, 7) } catch { return null }
  })
  const interviewMonths = [...new Set([interviewMonth, today.slice(0, 7), ...historicalMonths, ...interviewRows.map(row => row.interview_date.slice(0, 7))])]
    .filter(isPeriod).sort().reverse()
  const interviewHistory = interviewMonths.map(month => monthlyInterviewStats(interviewRows, month, today, interviewEvents))
  const interviewMonthly = interviewHistory.find(item => item.month === interviewMonth)
  const cands = db.prepare('SELECT * FROM candidates').all()
  const planned = db.prepare("SELECT job_category,employment_type,headcount,COALESCE(headcount_max,headcount) headcount_max,priority,status FROM job_requisitions WHERE status NOT IN ('closed','cancelled')").all()
  const countable = planned.filter(r => Number(r.headcount) > 0)
  const priorityOrder = ['P0', 'P1', 'P2', 'pending']
  const prioritySummary = priorityOrder.map(priority => {
    const rows = planned.filter(r => r.priority === priority)
    return {
      priority,
      roles: rows.length,
      baseline: rows.reduce((sum, r) => sum + Number(r.headcount || 0), 0),
      maximum: rows.reduce((sum, r) => sum + Number(r.headcount_max || 0), 0)
    }
  })
  const requisitionPlan = {
    roles: planned.length,
    countableRoles: countable.length,
    pendingRoles: planned.filter(r => Number(r.headcount) === 0 && r.employment_type !== 'consultant').length,
    consultantRoles: planned.filter(r => r.employment_type === 'consultant').length,
    baseline: countable.reduce((sum, r) => sum + Number(r.headcount), 0),
    maximum: countable.reduce((sum, r) => sum + Number(r.headcount_max || r.headcount), 0),
    priority: prioritySummary,
    categories: ['tech', 'mgmt', 'support'].map(category => ({
      category,
      roles: planned.filter(r => r.job_category === category).length,
      baseline: planned.filter(r => r.job_category === category).reduce((sum, r) => sum + Number(r.headcount || 0), 0)
    }))
  }
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
  const accepted = cands.filter(c => ['hired', 'accepted', 'offer'].includes(c.stage) && c.offer_amount).length
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
  res.json({ requisitionPlan, funnel, avgCycle, monthly, totalCost, costPerHire, acceptRate, hires, channels, interviewMonthly, interviewHistory })
})

// ── 候选人简历上传 / AI 解析 / 下载 / 删除（线索即结构化）──
recruiting.post('/candidates/:id/resume', (req, res, next) => {
  if (!db.prepare('SELECT id FROM candidates WHERE id=?').get(req.params.id)) return res.status(404).json({ error: '候选人不存在' })
  next()
}, candUpload.array('resume', 10), (req, res) => {
  const files = req.files || []
  try {
    validateResumeBatch(files)
    const c = db.prepare('SELECT * FROM candidates WHERE id=?').get(req.params.id)
    if (!c) throw Object.assign(new Error('候选人不存在'), { statusCode: 404 })
    let saved
    inTransaction(() => {
      saved = files.map(file => insertCandidateResume(db, c.id, file))
      if (!c.resume_source_id) selectCandidateResume(db, c.id, saved[0])
      audit(req.user, 'upload', 'candidate_resume', c.id, null, { count: saved.length })
      candidateEvent(c.id, req.user, 'resume_uploaded', { note: `新增 ${saved.length} 份简历附件，保留原有文件` })
    })
    res.json({ ok: true, id: c.id, filename: saved[0].original_name, resumes: saved.map(resumeMetadata) })
  } catch (error) {
    for (const file of files) try { rmSync(file.path, { force: true }) } catch { /* cleanup */ }
    throw error
  }
})

recruiting.get('/candidates/:id/resumes', (req, res) => {
  if (!db.prepare('SELECT id FROM candidates WHERE id=?').get(req.params.id)) return res.status(404).json({ error: '候选人不存在' })
  res.json(candidateResumeRows(db, req.params.id).map(resumeMetadata))
})

recruiting.get('/candidates/:id/resumes/:rid/result', (req, res) => {
  const row = resolveCandidateResume(db, { id: Number(req.params.id) }, req.params.rid)
  if (!row.parsed_data) return res.status(400).json({ error: '此文件尚未解析' })
  res.json({ ...resumeMetadata(row), resume_id: row.id, filename: row.original_name, parsed: JSON.parse(row.parsed_data), engine: row.parse_engine })
})

recruiting.get('/candidates/:id/resumes/:rid/file', (req, res) => {
  const row = resolveCandidateResume(db, { id: Number(req.params.id) }, req.params.rid)
  res.download(row.file_path, row.original_name)
})

recruiting.post('/candidates/:id/resume/parse', async (req, res) => {
  const c = db.prepare('SELECT * FROM candidates WHERE id=?').get(req.params.id)
  if (!c) return res.status(404).json({ error: '候选人不存在' })
  const file = resolveCandidateResume(db, c, req.body?.resume_id, { explicitWhenMultiple: true })
  const { text, unsupported, error } = await extractText(file.file_path, file.content_type, file.original_name)
  if (unsupported) return res.status(400).json({ error: '暂不支持该文件类型（支持 txt/md/docx/pdf/xlsx/xls）' })
  if (!text.trim()) return res.status(400).json({ error: '未能从文件中提取文本' + (error ? '：' + error : '') })
  const parsed = await parseResume(text, {
    mode: req.body?.mode,
    allowExternal: req.body?.allow_external === true,
    onExternal: meta => audit(req.user, 'external_llm_request', 'candidate_resume', c.id, null, meta)
  })
  inTransaction(() => {
    if (!db.prepare('SELECT id FROM candidate_resumes WHERE id=? AND candidate_id=?').get(file.id, c.id)) throw Object.assign(new Error('解析期间此文件已被移除，请重新选择文件'), { statusCode: 409 })
    db.prepare("UPDATE candidate_resumes SET parsed_data=?,parse_status='parsed',parse_engine=? WHERE id=?").run(JSON.stringify(parsed), parsed.engine, file.id)
    selectCandidateResume(db, c.id, { ...file, parsed_data: JSON.stringify(parsed) })
    audit(req.user, 'parse', 'candidate_resume', file.id, null, { engine: parsed.engine, candidate_id: c.id })
    candidateEvent(c.id, req.user, 'resume_parsed', { note: `完成简历解析：${file.original_name}` })
  })
  res.json({ ok: true, id: c.id, resume_id: file.id, filename: file.original_name, engine: parsed.engine, parsed,
    result_token: candidateResumeToken({ ...file, parsed_data: JSON.stringify(parsed) }) })
})

recruiting.post('/candidates/:id/requisition-match', async (req, res) => {
  const current = db.prepare('SELECT * FROM candidates WHERE id=?').get(req.params.id)
  if (!current) return res.status(404).json({ error: '候选人不存在' })
  const source = req.body?.personal_profile || (current.resume_applied_hash === candidateSourceToken(current)
    ? candidatePersonalProfile(current) : mergePersonalProfile(candidatePersonalProfile(current), { basic: {}, education: [], work_experience: [], ...readProfile(current.resume_parsed) }))
  const result = await matchRequisitions(source, availableRequisitions(db))
  res.setHeader('Cache-Control', 'no-store')
  res.json({ ...result, current_requisition_id: current.requisition_id ?? null })
})

recruiting.post('/candidates/:id/resume/apply', (req, res) => {
  const current = db.prepare('SELECT * FROM candidates WHERE id=?').get(req.params.id)
  if (!current) return res.status(404).json({ error: '候选人不存在' })
  const file = resolveCandidateResume(db, current, req.body?.resume_id)
  if (!file.parsed_data) return res.status(400).json({ error: '请先解析所选简历文件' })
  const token = candidateResumeToken(file)
  if (req.body?.result_token !== token) return res.status(409).json({ error: '简历结果已变化，请重新打开最新结果后再保存' })
  const input = normalizeResumeProfile(req.body?.personal_profile || JSON.parse(file.parsed_data))
  const profile = mergePersonalProfile(candidatePersonalProfile(current), input)
  if (!profile.basic.name) return res.status(400).json({ error: '请填写姓名' })
  const requisitionId = validateRequisitionChange(db, current, req.body?.requisition_id)
  inTransaction(() => {
    db.prepare('UPDATE candidates SET name=?,phone=?,email=?,skills=?,profile_json=?,resume_applied_hash=?,requisition_id=? WHERE id=?')
      .run(profile.basic.name, profile.basic.mobile || '', profile.basic.personal_email || '', profile.basic.skills || '', JSON.stringify(profile), token, requisitionId, current.id)
    selectCandidateResume(db, current.id, file)
    db.prepare('UPDATE candidates SET resume_applied_id=?,skills=? WHERE id=?').run(file.id, profile.basic.skills || '', current.id)
    db.prepare("UPDATE candidate_resumes SET parse_status='applied' WHERE id=?").run(file.id)
    recordRequisitionLink(current, requisitionId, req.user)
    candidateEvent(current.id, req.user, 'resume_applied', { note: `由 ${file.original_name} 更新个人信息、${profile.education.length} 段教育经历、${profile.work_experience.length} 段工作经历` })
    audit(req.user, 'apply', 'candidate_resume', current.id, null, { basic: Object.values(input.basic).filter(Boolean).length, education: input.education.length, work_experience: input.work_experience.length })
  })
  res.json({ ok: true, personal_profile: profile })
})

recruiting.get('/candidates/:id/resume', (req, res) => {
  const c = db.prepare('SELECT * FROM candidates WHERE id=?').get(req.params.id)
  if (!c) return res.status(404).json({ error: '候选人不存在' })
  const file = resolveCandidateResume(db, c, req.query.resume_id)
  res.download(file.file_path, file.original_name)
})

function deleteCandidateResumeFile(req, res) {
  const c = db.prepare('SELECT * FROM candidates WHERE id=?').get(req.params.id)
  if (!c) return res.status(404).json({ error: '候选人不存在' })
  const file = resolveCandidateResume(db, c, req.params.rid || req.query.resume_id, { explicitWhenMultiple: true })
  inTransaction(() => {
    db.prepare('DELETE FROM candidate_resumes WHERE id=? AND candidate_id=?').run(file.id, c.id)
    if (c.resume_source_id === file.id) selectCandidateResume(db, c.id, candidateResumeRows(db, c.id).find(row => row.parsed_data) || candidateResumeRows(db, c.id)[0] || null)
    if (c.resume_applied_id === file.id) db.prepare('UPDATE candidates SET resume_applied_id=NULL WHERE id=?').run(c.id)
    audit(req.user, 'delete', 'candidate_resume', file.id, { candidate_id: c.id, filename: file.original_name }, null)
    candidateEvent(c.id, req.user, 'resume_deleted', { note: `移除简历附件：${file.original_name}；已保存的个人资料保留` })
  })
  try { rmSync(file.file_path, { force: true }) } catch { /* retry cleanup independently if needed */ }
  res.json({ ok: true })
}
recruiting.delete('/candidates/:id/resume', deleteCandidateResumeFile)
recruiting.delete('/candidates/:id/resumes/:rid', deleteCandidateResumeFile)

// ── Offer 审批发起（候选人 → 审批中心，approve 后 offer_status=approved）──
recruiting.post('/candidates/:id/offer-approval', (req, res) => {
  const c = db.prepare('SELECT * FROM candidates WHERE id=?').get(req.params.id)
  if (!c) return res.status(404).json({ error: '候选人不存在' })
  if (c.stage !== 'offer') return res.status(400).json({ error: '仅 Offer 阶段可发起审批' })
  if (!c.offer_amount) return res.status(400).json({ error: '请先填写 Offer 金额' })
  const r = c.requisition_id ? db.prepare('SELECT * FROM job_requisitions WHERE id=?').get(c.requisition_id) : null
  const annualMonths = Number(r?.fixed_salary_months ?? 12) + Number(r?.annual_bonus_months ?? 0)
  const annual = c.offer_amount * annualMonths
  const pos = r?.city === '上海' ? bandPosition(annual, r.job_family) : null
  const posLabel = pos === null ? '' : (pos < 25 ? '低于带宽' : pos > 75 ? '超出带宽' : '带宽内')
  const existing = db.prepare("SELECT id FROM approvals WHERE ref_type='candidate' AND ref_id=? AND type='offer' AND status='pending'").get(c.id)
  if (existing) return res.status(409).json({ error: '该候选人已有待审批 Offer', approval_id: existing.id })
  const id = 'OFF-' + randomUUID()
  const title = `Offer 审批 · ${c.name}（${r?.job_family || ''}）`
  const key = `现金 ¥${c.offer_amount.toLocaleString('zh-CN')}/月 · ${annualMonths} 个月目标现金${pos !== null ? ` · 上海3-5年Fabless基准 ${pos}%分位(${posLabel})` : ' · 无同口径已审批带宽'}`
  const summary = `来源 ${c.source_channel} · 期望 ${expectedSalaryLabel(c)}` + (c.eval_score ? ` · 评分 ${c.eval_score}` : '')
  const payload = { kind: 'offer', candidate_id: c.id, offer_context: buildOfferApprovalContext(c.id) }
  inTransaction(() => {
    db.prepare("INSERT INTO approvals(id,type,title,who,key,summary,status,page,ref_type,ref_id,payload_json,created_by_user_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(id, 'offer', title, `${req.user.name} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`, key, summary, 'pending', 'offer-approval', 'candidate', c.id, JSON.stringify(payload), req.user.id)
    db.prepare("UPDATE candidates SET offer_status='pending' WHERE id=?").run(c.id)
    audit(req.user, 'submit_offer_approval', 'candidate', c.id, { offer_status: c.offer_status }, { offer_status: 'pending', approval_id: id })
  })
  res.json({ ok: true, approval_id: id, title, key, summary })
})
