import { db } from '../db.js'
import { periodIsLocked, upsertCompensationTerm } from './employee_terms.js'
import { addMonths, currentPeriod, isPeriod } from './periods.js'

export function parsePayload(row) {
  try { return JSON.parse(row?.payload_json || '{}') } catch { return {} }
}

export function nextApprovalId() {
  const rows = db.prepare("SELECT id FROM approvals WHERE id GLOB 'A-[0-9]*'").all()
  let max = 100
  for (const row of rows) {
    const n = Number(String(row.id).replace(/^A-/, ''))
    if (Number.isFinite(n) && n > max) max = n
  }
  return `A-${max + 1}`
}

export function presentApproval(row, extras = {}) {
  if (!row) return null
  const payload = parsePayload(row)
  return { ...row, payload, ...extras }
}

export function normalizeApprovalPayload(type, input = {}) {
  const payload = { kind: type, ...(input && typeof input === 'object' ? input : {}) }
  if (type === 'band') {
    const values = ['p25', 'p50', 'p75'].map(key => Number(payload.to?.[key]))
    if (!payload.direction || values.some(value => !Number.isFinite(value) || value <= 0)) throw Object.assign(new Error('带宽审批需要 direction 与正数 p25/p50/p75'), { statusCode: 400 })
    if (!(values[0] <= values[1] && values[1] <= values[2])) throw Object.assign(new Error('带宽须满足 p25 ≤ p50 ≤ p75'), { statusCode: 400 })
    if (!String(payload.source || '').trim()) throw Object.assign(new Error('带宽审批必须说明可复核的数据来源'), { statusCode: 400 })
    payload.to = { ...payload.to, p25: values[0], p50: values[1], p75: values[2] }
  } else if (type === 'raise') {
    payload.employee_id = Number(payload.employee_id)
    payload.to_monthly = Math.round(Number(payload.to_monthly))
    payload.effective_month ||= addMonths(currentPeriod(), 1)
    if (!payload.employee_id || !Number.isFinite(payload.to_monthly) || payload.to_monthly < 2000 || payload.to_monthly > 500000) throw Object.assign(new Error('调薪审批需要有效 employee_id 与 2000-500000 元月薪'), { statusCode: 400 })
    if (!isPeriod(payload.effective_month)) throw Object.assign(new Error('调薪生效月份须为 YYYY-MM'), { statusCode: 400 })
  } else if (type === 'option') {
    const share = Number(payload.share_count)
    const exercise = Number(payload.exercise_price ?? 1)
    const fair = Number(payload.fair_value ?? 50)
    const vesting = Number(payload.vesting_months ?? 48)
    const cliff = Number(payload.cliff_months ?? 12)
    if (!Number(payload.employee_id) || !Number.isFinite(share) || share <= 0) throw Object.assign(new Error('期权审批需要有效员工与正数授予股数'), { statusCode: 400 })
    if (![exercise, fair, vesting, cliff].every(Number.isFinite) || exercise < 0 || fair < exercise || vesting < 1 || vesting > 120 || cliff < 0 || cliff > vesting) throw Object.assign(new Error('期权价格、归属期或 cliff 不合法'), { statusCode: 400 })
    Object.assign(payload, { employee_id: Number(payload.employee_id), share_count: share, exercise_price: exercise, fair_value: fair, vesting_months: vesting, cliff_months: cliff })
  } else if (type === 'offer') {
    payload.candidate_id = Number(payload.candidate_id)
    if (!payload.candidate_id) throw Object.assign(new Error('Offer 审批需要 candidate_id'), { statusCode: 400 })
  }
  return payload
}

function calcGrant(shareCount, exercisePrice, fairValue, vestingMonths) {
  const share = Number(shareCount) || 0
  const fair = Number(fairValue) || 0
  const exercise = Number(exercisePrice) || 0
  const vesting = Number(vestingMonths ?? 48)
  const total_value = Math.round(share * 10000 * (fair - exercise))
  const monthly_amort = vesting > 0 ? Math.round(total_value / vesting) : 0
  return { share, fair, exercise, vesting, total_value, monthly_amort }
}

export function insertOptionGrant(payload, note) {
  const empId = Number(payload.employee_id)
  const emp = db.prepare('SELECT id FROM employees WHERE id=?').get(empId)
  if (!emp) throw Object.assign(new Error('员工不存在'), { statusCode: 400 })
  const c = calcGrant(payload.share_count ?? payload.option_share_count, payload.exercise_price ?? 1, payload.fair_value ?? 50, payload.vesting_months ?? 48)
  if (c.share <= 0) throw Object.assign(new Error('授予股数须 >0'), { statusCode: 400 })
  if (c.fair < c.exercise) throw Object.assign(new Error('公允价须 ≥ 行权价'), { statusCode: 400 })
  const cliff = Number(payload.cliff_months ?? 12)
  if (c.vesting < 1 || c.vesting > 120 || cliff < 0 || cliff > c.vesting) {
    throw Object.assign(new Error('归属期须为 1-120 月，cliff 不得超过归属期'), { statusCode: 400 })
  }
  const pool = db.prepare('SELECT total_shares FROM option_pool WHERE id=1').get()
  const granted = db.prepare("SELECT COALESCE(SUM(share_count),0) s FROM option_grants WHERE status IN ('granted','vested','exercised')").get().s
  if (pool && granted + c.share > pool.total_shares) throw Object.assign(new Error('授予股数超过期权池剩余额度'), { statusCode: 409 })
  const r = db.prepare('INSERT INTO option_grants(employee_id,grant_date,share_count,exercise_price,fair_value,vesting_months,cliff_months,total_value,monthly_amort,status,note) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(empId, payload.grant_date || new Date().toISOString().slice(0, 10), c.share, c.exercise, c.fair, c.vesting, cliff, c.total_value, c.monthly_amort, 'granted', note || payload.note || '审批通过授予')
  return { id: r.lastInsertRowid, ...c }
}

export function applyApproval(approval, extras = {}) {
  const payload = { ...parsePayload(approval), ...extras }
  const kind = payload.kind || approval.type
  if (kind === 'offer') {
    const refId = approval.ref_type === 'candidate' ? approval.ref_id : payload.candidate_id
    if (refId) db.prepare("UPDATE candidates SET offer_status='approved' WHERE id=?").run(refId)
    return { applied: 'offer', payload }
  }
  if (kind === 'band') {
    const direction = payload.direction
    const to = payload.to
    if (!direction || !to || !Number.isFinite(Number(to.p25)) || !Number.isFinite(Number(to.p50)) || !Number.isFinite(Number(to.p75)) || Number(to.p25) <= 0 || Number(to.p25) > Number(to.p50) || Number(to.p50) > Number(to.p75)) {
      throw Object.assign(new Error('带宽审批缺少有效 payload（direction / to.p25/p50/p75）'), { statusCode: 400 })
    }
    const before = db.prepare('SELECT * FROM benchmarks WHERE direction=?').get(direction) || null
    const after = {
      p25: Math.round(Number(to.p25)), p50: Math.round(Number(to.p50)), p75: Math.round(Number(to.p75)),
      sample: Math.max(0, Math.round(Number(payload.sample) || 0)), verified: 1
    }
    db.prepare(`INSERT INTO benchmarks(direction,p25,p50,p75,rarity,sample,trend,annual_months,evidence,sources,verified)
      VALUES(?,?,?,?,1,?,NULL,12,'已审批',?,1)
      ON CONFLICT(direction) DO UPDATE SET p25=excluded.p25,p50=excluded.p50,p75=excluded.p75,
        sample=excluded.sample,trend=NULL,evidence='已审批',sources=excluded.sources,verified=1`)
      .run(direction, after.p25, after.p50, after.p75, after.sample, JSON.stringify([{ title: String(payload.source).slice(0, 200), type: 'approved_input' }]))
    return { applied: 'band', payload, before, after }
  }
  if (kind === 'raise') {
    const empId = Number(payload.employee_id)
    const toMonthly = Math.round(Number(payload.to_monthly))
    if (!empId || !Number.isFinite(toMonthly) || toMonthly < 2000 || toMonthly > 500000) {
      throw Object.assign(new Error('调薪审批缺少有效 payload（employee_id / to_monthly）'), { statusCode: 400 })
    }
    const emp = db.prepare('SELECT * FROM employees WHERE id=?').get(empId)
    if (!emp) throw Object.assign(new Error('员工不存在'), { statusCode: 400 })
    const effectiveMonth = payload.effective_month || currentPeriod()
    if (!isPeriod(effectiveMonth)) throw Object.assign(new Error('调薪生效月份须为 YYYY-MM'), { statusCode: 400 })
    if (periodIsLocked(effectiveMonth)) throw Object.assign(new Error('调薪生效月份已经月结，请选择后续月份'), { statusCode: 409 })
    upsertCompensationTerm({ ...emp, monthly_base: toMonthly }, effectiveMonth, { actor: approval.action_by || 'approval', sourceApprovalId: approval.id })
    if (effectiveMonth <= currentPeriod()) db.prepare('UPDATE employees SET monthly_base=? WHERE id=?').run(toMonthly, empId)
    db.prepare('INSERT INTO employee_events(employee_id,type,event_date,from_value,to_value,note) VALUES(?,?,?,?,?,?)')
      .run(empId, 'raise', `${effectiveMonth}-01`, String(emp.monthly_base), String(toMonthly), `${payload.note || '调薪审批通过'}；${effectiveMonth} 生效`)
    let grant = null
    const extraShares = Number(payload.option_share_count) || 0
    if (extraShares > 0) {
      grant = insertOptionGrant({
        employee_id: empId,
        share_count: extraShares,
        exercise_price: payload.exercise_price ?? 1,
        fair_value: payload.fair_value ?? 50,
        vesting_months: payload.vesting_months ?? 48,
        cliff_months: payload.cliff_months ?? 12
      }, '调薪配套期权加授')
    }
    return { applied: 'raise', payload: { ...payload, effective_month: effectiveMonth }, from_monthly: emp.monthly_base, to_monthly: toMonthly, effective_month: effectiveMonth, grant }
  }
  if (kind === 'option') {
    const grant = insertOptionGrant(payload, payload.note || '期权授予审批通过')
    return { applied: 'option', payload, grant }
  }
  return { applied: null, payload }
}

export function mergeActionPayload(approval, body) {
  const payload = parsePayload(approval)
  if (body?.to && typeof body.to === 'object') payload.to = { ...payload.to, ...body.to }
  if (body?.option_share_count != null) payload.option_share_count = Number(body.option_share_count) || 0
  if (body?.p50 != null && payload.to) payload.to = { ...payload.to, p50: Number(body.p50) }
  return payload
}
