import { audit, db } from '../db.js'
import { randomUUID } from 'node:crypto'
import { copyFileSync, mkdirSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { candidatePersonalProfile, normalizeResumeProfile } from './resume_profile.js'
import { writeEmployeeResumeProfile } from './employee_resume_apply.js'

export const CANDIDATE_STAGES = ['new', 'screening', 'waiting', 'interview', 'offer', 'accepted', 'hired', 'rejected', 'withdrawn']
export const STAGE_LABELS = { new: '新简历', screening: '初筛', waiting: '待面试', interview: '面试中', offer: 'Offer', accepted: '已录用', hired: '已建员工档案', rejected: '已淘汰', withdrawn: '已放弃' }
export const INTERVIEW_STATUSES = ['scheduled', 'in_progress', 'completed', 'cancelled']
export const INTERVIEW_STATUS_LABELS = { scheduled: '待面试', in_progress: '面试中', completed: '已完成', cancelled: '已取消' }
const TRANSITIONS = {
  new: ['screening', 'waiting', 'interview', 'rejected', 'withdrawn'],
  screening: ['new', 'waiting', 'interview', 'rejected', 'withdrawn'],
  waiting: ['screening', 'interview', 'rejected', 'withdrawn'],
  interview: ['waiting', 'offer', 'rejected', 'withdrawn'],
  offer: ['interview', 'accepted', 'rejected', 'withdrawn'],
  accepted: ['offer', 'withdrawn'], rejected: ['screening'], withdrawn: ['screening'], hired: []
}
const failure = (message, statusCode = 409) => Object.assign(new Error(message), { statusCode })

export function candidateEvent(candidateId, user, type, options = {}) {
  db.prepare(`INSERT INTO candidate_events(candidate_id,type,from_stage,to_stage,round_no,interview_id,note,actor,occurred_at,snapshot_json)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run(candidateId, type, options.from_stage ?? null, options.to_stage ?? null,
    options.round_no ?? null, options.interview_id ?? null, String(options.note || '').slice(0, 2000),
    user?.name || 'system', new Date().toISOString(), options.snapshot ? JSON.stringify(options.snapshot) : null)
}

export function changeCandidateStage(candidateId, stage, user, { note = '', round = null } = {}) {
  const current = db.prepare('SELECT * FROM candidates WHERE id=?').get(candidateId)
  if (!current) throw failure('候选人不存在', 404)
  if (!TRANSITIONS[current.stage]?.includes(stage)) throw failure(`不能从“${STAGE_LABELS[current.stage]}”流转到“${STAGE_LABELS[stage]}”`)
  if (stage === 'accepted' && current.offer_status !== 'approved') throw failure('请先完成 Offer 审批，再确认录用')
  if (stage === 'rejected' && !String(note).trim()) throw failure('请填写淘汰原因', 400)
  const nextRound = Number(round ?? current.current_round ?? 1)
  if (!Number.isInteger(nextRound) || nextRound < 1 || nextRound > 20) throw failure('面试轮次须为 1-20 的整数', 400)
  db.prepare('UPDATE candidates SET stage=?,current_round=?,reject_reason=CASE WHEN ? THEN ? ELSE reject_reason END WHERE id=?')
    .run(stage, nextRound, stage === 'rejected' ? 1 : 0, note, candidateId)
  if (['rejected', 'withdrawn', 'accepted'].includes(stage)) {
    for (const interview of db.prepare("SELECT * FROM interviews WHERE candidate_id=? AND status IN ('scheduled','in_progress')").all(candidateId)) {
      db.prepare("UPDATE interviews SET status='cancelled' WHERE id=?").run(interview.id)
      recordInterviewEvent({ ...interview, status: 'cancelled' }, user, 'interview_cancelled', '人选状态变更，取消未完成的面试安排')
    }
  }
  candidateEvent(candidateId, user, 'stage_change', { from_stage: current.stage, to_stage: stage, round_no: nextRound, note })
  audit(user, 'stage_change', 'candidate', candidateId, { stage: current.stage }, { stage, current_round: nextRound })
  return db.prepare('SELECT * FROM candidates WHERE id=?').get(candidateId)
}

export function recordInterviewEvent(interview, user, type, note = '') {
  candidateEvent(interview.candidate_id, user, type, { round_no: interview.round_no, interview_id: interview.id,
    note: note || `${INTERVIEW_STATUS_LABELS[interview.status]} · ${interview.interview_date}`,
    snapshot: { id: interview.id, candidate_id: interview.candidate_id, round_no: interview.round_no,
      interview_date: interview.interview_date, status: interview.status } })
}

export function syncInterviewStage(interview, user) {
  const current = db.prepare('SELECT * FROM candidates WHERE id=?').get(interview.candidate_id)
  if (!current || ['offer', 'accepted', 'hired', 'rejected', 'withdrawn'].includes(current.stage)) return
  const active = db.prepare("SELECT * FROM interviews WHERE candidate_id=? AND status IN ('scheduled','in_progress') ORDER BY CASE status WHEN 'in_progress' THEN 0 ELSE 1 END,interview_date,round_no,id").get(current.id)
  if (interview.status === 'cancelled' && !active) {
    const completed = db.prepare("SELECT round_no FROM interviews WHERE candidate_id=? AND status='completed' ORDER BY interview_date DESC,round_no DESC,id DESC").get(current.id)
    if (['waiting', 'interview'].includes(current.stage)) {
      const stage = completed ? 'interview' : 'screening'
      if (current.stage !== stage) changeCandidateStage(current.id, stage, user, { round: completed?.round_no || current.current_round, note: '面试安排已取消' })
    }
    return
  }
  const stage = active?.status === 'scheduled' ? 'waiting' : 'interview'
  const round = active?.round_no || interview.round_no
  if (current.stage !== stage) changeCandidateStage(current.id, stage, user, { round, note: '面试安排或面评更新' })
  else if (current.current_round !== round) {
    db.prepare('UPDATE candidates SET current_round=? WHERE id=?').run(round, current.id)
    candidateEvent(current.id, user, 'round_change', { from_stage: stage, to_stage: stage, round_no: round, note: `进入第 ${round} 轮面试` })
  }
}

export function candidateForEmployee(candidateId) {
  const candidate = db.prepare('SELECT * FROM candidates WHERE id=?').get(candidateId)
  if (!candidate) throw failure('关联候选人不存在', 400)
  if (candidate.employee_id || candidate.stage === 'hired') throw failure('该人选已关联员工档案，请勿重复建档')
  if (!['accepted', 'offer'].includes(candidate.stage) || candidate.offer_status !== 'approved') throw failure('仅已录用且 Offer 已审批的人选可以关联员工档案')
  return candidate
}

// Caller owns the transaction; this is its last write group before returning the employee id.
export function linkCandidateEmployee(candidateId, employeeId, hireDate, user) {
  const candidate = candidateForEmployee(candidateId)
  const employee = db.prepare('SELECT * FROM employees WHERE id=?').get(employeeId)
  if (!employee || employee.status !== 'active') throw failure('关联员工档案必须为在职状态')
  if (Number(employee.monthly_base) !== Number(candidate.offer_amount)) throw failure('关联建档的月薪须与已审批 Offer 一致')
  let copiedPath = null
  try {
    let parsed = {}
    try { parsed = JSON.parse(candidate.resume_parsed || '{}') } catch { /* unparsed resume */ }
    const basic = candidate.profile_json ? candidatePersonalProfile(candidate).basic : parsed.basic || {}
    const fields = { mobile: candidate.phone || basic.mobile, personal_email: candidate.email || basic.personal_email,
      gender: basic.gender, education_level: basic.education_level, skills: basic.skills || candidate.skills }
    for (const [key, value] of Object.entries(fields)) {
      if (value) db.prepare(`UPDATE employees SET ${key}=? WHERE id=? AND (${key} IS NULL OR ${key}='')`).run(String(value), employeeId)
    }
    if (candidate.profile_json) writeEmployeeResumeProfile(employeeId, normalizeResumeProfile(candidatePersonalProfile(candidate)), { fillOnly: true })
    if (candidate.resume_path) {
      const root = process.env.UPLOAD_DIR || fileURLToPath(new URL('../uploads/', import.meta.url))
      const folder = path.join(root, 'resumes')
      mkdirSync(folder, { recursive: true, mode: 0o700 })
      const filename = randomUUID() + path.extname(candidate.resume_name || '')
      copiedPath = path.join(folder, filename)
      copyFileSync(candidate.resume_path, copiedPath)
      db.prepare(`INSERT INTO employee_resumes(employee_id,filename,original_name,content_type,size,file_path,uploaded_at,parse_status,parsed_data)
        VALUES(?,?,?,?,?,?,?,?,?)`).run(employeeId, filename, candidate.resume_name || filename, '', statSync(copiedPath).size, copiedPath,
        new Date().toISOString(), candidate.resume_parsed ? 'parsed' : 'pending', candidate.resume_parsed || null)
    }
    db.prepare("UPDATE candidates SET stage='hired',employee_id=?,onboard_date=? WHERE id=? AND employee_id IS NULL").run(employeeId, hireDate, candidate.id)
    candidateEvent(candidate.id, user, 'employee_linked', { from_stage: candidate.stage, to_stage: 'hired', note: `关联员工档案 #${employeeId}，入职日期 ${hireDate}` })
    db.prepare('INSERT INTO employee_events(employee_id,type,event_date,from_value,to_value,note) VALUES(?,?,?,?,?,?)')
      .run(employeeId, 'onboard', hireDate, null, employee.job_family, `由简历库人选 #${candidate.id} 关联建档（${candidate.source_channel || '其他'}）`)
    if (candidate.requisition_id) {
      const requisition = db.prepare('SELECT * FROM job_requisitions WHERE id=?').get(candidate.requisition_id)
      const filled = db.prepare("SELECT COUNT(*) c FROM candidates WHERE requisition_id=? AND stage='hired'").get(candidate.requisition_id).c
      if (requisition && filled >= (requisition.headcount || 1)) db.prepare("UPDATE job_requisitions SET status='closed',closed_at=COALESCE(closed_at,date('now')) WHERE id=?").run(requisition.id)
    }
    audit(user, 'onboard', 'candidate', candidate.id, { stage: candidate.stage }, { stage: 'hired', employee_id: employeeId })
  } catch (error) {
    if (copiedPath) rmSync(copiedPath, { force: true })
    throw error
  }
}
