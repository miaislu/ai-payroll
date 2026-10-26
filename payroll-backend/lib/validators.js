// 表单校验白名单（CRUD 用）
import { isDate, isPeriod } from './periods.js'
import { JOB_CATALOG, JOB_FAMILIES, categoryOfJob } from './job_catalog.js'
import { normalizeSpecialDeductions } from './special_deductions.js'

// 员工可选岗位统一来自三大类岗位目录。
export const DIRECTIONS_KEYS = JOB_CATALOG.tech.jobs
export const SUPPORT_FAMILIES = JOB_CATALOG.support.jobs
export const MGMT_FAMILIES = JOB_CATALOG.mgmt.jobs
export { JOB_FAMILIES }
export const CATEGORIES = ['tech', 'support', 'mgmt']
export const CATEGORY_LABELS = { tech: '技术', support: '职能', mgmt: '管理' }
export const CITY_KEYS = ['上海', '北京', '深圳', '苏州', '无锡', '合肥', '武汉', '成都', '西安', '杭州', '南京', '广州', '厦门']
export const GRADES = ['P4', 'P5', 'P6', 'P7', 'M1', 'M2']

export function categoryOf(jobFamily) {
  return categoryOfJob(jobFamily) || 'tech'
}

export function validateEmployee(body) {
  const errors = []
  const e = {}
  e.name = String(body.name || '').trim()
  if (!e.name || e.name.length > 20) errors.push('姓名必填且不超过 20 字')
  e.grade = String(body.grade || '')
  if (!GRADES.includes(e.grade)) errors.push(`职级须为 ${GRADES.join('/')}`)
  e.job_family = String(body.job_family || '')
  if (!JOB_FAMILIES.includes(e.job_family)) errors.push('岗位不在支持列表（技术/职能/管理）')
  e.category = categoryOf(e.job_family)
  e.city = String(body.city || '')
  if (!CITY_KEYS.includes(e.city)) errors.push('城市不在支持列表')
  e.monthly_base = Math.round(Number(body.monthly_base))
  if (!Number.isFinite(e.monthly_base) || e.monthly_base < 2000 || e.monthly_base > 500000) errors.push('月薪须在 2000-500000 之间')
  e.fixed_salary_months = Number(body.fixed_salary_months ?? 12)
  if (!Number.isFinite(e.fixed_salary_months) || e.fixed_salary_months < 1 || e.fixed_salary_months > 24) errors.push('全年固定薪资月数须在 1-24 之间')
  e.annual_bonus_months = Number(body.annual_bonus_months ?? 0)
  if (!Number.isFinite(e.annual_bonus_months) || e.annual_bonus_months < 0 || e.annual_bonus_months > 24) errors.push('年终奖约定月数须在 0-24 之间')
  e.perf_ratio = Number(body.perf_ratio)
  if (!Number.isFinite(e.perf_ratio) || e.perf_ratio < 0 || e.perf_ratio > 1) errors.push('绩效比例须在 0-1 之间')
  const deductions = normalizeSpecialDeductions(body.special_deductions ?? body.special_deductions_json, e.city, body.special_deduction)
  errors.push(...deductions.errors)
  e.special_deductions = deductions.items
  e.special_deductions_json = JSON.stringify(deductions.items)
  e.special_deduction = deductions.monthly
  const hireDate = String(body.hire_date || (isPeriod(body.hire_month) ? `${body.hire_month}-01` : ''))
  if (!isDate(hireDate)) errors.push('入职日期必填且须为有效的 YYYY-MM-DD')
  e.hire_date = isDate(hireDate) ? hireDate : null
  e.hire_month = e.hire_date?.slice(0, 7) || null
  return { errors, e }
}
