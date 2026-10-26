import { createHash } from 'node:crypto'
import { isDate, isPeriod } from './periods.js'

export const PROFILE_BASIC_FIELDS = ['name', 'gender', 'date_of_birth', 'marital_status', 'nationality', 'education_level', 'mobile', 'personal_email', 'current_address', 'skills']
export const PROFILE_EDUCATION_FIELDS = ['school', 'qualification', 'major', 'graduation_year', 'note']
export const PROFILE_WORK_FIELDS = ['company', 'title', 'start_date', 'end_date', 'note']
const invalid = message => { throw Object.assign(new Error(message), { statusCode: 400 }) }
export const resumeResultToken = value => value ? createHash('sha256').update(value).digest('hex') : null
export function readProfile(value) {
  try { return typeof value === 'string' ? JSON.parse(value) : value || {} } catch { return {} }
}

// The editor accepts every personal/education/work field produced by the parser.
// Payroll, channel and hiring decisions remain outside this profile payload.
export function normalizeResumeProfile(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('个人信息格式不正确')
  const text = (value, key) => {
    if (value == null) return ''
    if (typeof value !== 'string' || value.length > (key === 'note' || key === 'skills' ? 16000 : 500)) invalid('资料字段格式或长度不正确')
    return value.trim()
  }
  if (value.basic != null && (typeof value.basic !== 'object' || Array.isArray(value.basic))) invalid('基本信息格式不正确')
  const basic = Object.fromEntries(PROFILE_BASIC_FIELDS.map(key => [key, text(value.basic?.[key], key)]))
  if (basic.name.length > 20) invalid('姓名不能超过 20 字，请核对识别结果')
  if (basic.date_of_birth && !isDate(basic.date_of_birth)) invalid('出生日期须为有效的 YYYY-MM-DD 日期')
  if (basic.personal_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(basic.personal_email)) invalid('邮箱格式不正确，请先校正')
  const rows = (key, fields) => {
    const source = value[key] ?? []
    if (!Array.isArray(source) || source.length > 100) invalid('经历列表格式不正确或超过 100 条')
    return source.map(row => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) invalid('经历记录格式不正确')
      return Object.fromEntries(fields.map(field => {
        if (field !== 'graduation_year') return [field, text(row[field], field)]
        if (row[field] == null || row[field] === '') return [field, null]
        const year = Number(row[field])
        if (!Number.isInteger(year) || year < 1900 || year > 2200) invalid('毕业年份不正确')
        return [field, year]
      }))
    }).filter(row => row[fields[0]])
  }
  const education = rows('education', PROFILE_EDUCATION_FIELDS)
  const work_experience = rows('work_experience', PROFILE_WORK_FIELDS)
  for (const row of work_experience) {
    for (const key of ['start_date', 'end_date']) if (row[key] && !isPeriod(row[key])) invalid('工作起止时间须为 YYYY-MM')
    if (row.start_date && row.end_date && row.end_date < row.start_date) invalid('工作结束时间不能早于开始时间')
  }
  return { basic, education, work_experience }
}

export function candidatePersonalProfile(candidate) {
  const profile = readProfile(candidate.profile_json)
  return { basic: { ...(profile.basic || {}), name: candidate.name || '', mobile: candidate.phone || '', personal_email: candidate.email || '', skills: profile.basic?.skills || candidate.skills || '' },
    education: profile.education || [], work_experience: profile.work_experience || [] }
}

export function mergePersonalProfile(current, incoming) {
  const basic = { ...current.basic }
  for (const [key, value] of Object.entries(incoming.basic)) {
    if (value && !(key === 'mobile' && value.includes('*') && basic.mobile && !basic.mobile.includes('*'))) basic[key] = value
  }
  return { basic, education: incoming.education.length ? incoming.education : current.education || [],
    work_experience: incoming.work_experience.length ? incoming.work_experience : current.work_experience || [] }
}
