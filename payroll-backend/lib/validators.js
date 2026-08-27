// 表单校验白名单（CRUD 用）
import { DIRECTIONS } from './data-shim.js'

// 员工可选岗位（与对标库方向一致）
export const DIRECTIONS_KEYS = Object.keys(DIRECTIONS)
export const CITY_KEYS = ['上海', '北京', '深圳', '苏州', '无锡', '合肥', '武汉', '成都', '西安', '杭州', '南京', '广州', '厦门']
export const GRADES = ['P4', 'P5', 'P6', 'M1']

export function validateEmployee(body) {
  const errors = []
  const e = {}
  e.name = String(body.name || '').trim()
  if (!e.name || e.name.length > 20) errors.push('姓名必填且不超过 20 字')
  e.grade = String(body.grade || '')
  if (!GRADES.includes(e.grade)) errors.push(`职级须为 ${GRADES.join('/')}`)
  e.job_family = String(body.job_family || '')
  if (!DIRECTIONS_KEYS.includes(e.job_family)) errors.push('岗位方向不在对标库中')
  e.city = String(body.city || '')
  if (!CITY_KEYS.includes(e.city)) errors.push('城市不在支持列表')
  e.monthly_base = Math.round(Number(body.monthly_base))
  if (!Number.isFinite(e.monthly_base) || e.monthly_base < 2000 || e.monthly_base > 500000) errors.push('月薪须在 2000-500000 之间')
  e.perf_ratio = Number(body.perf_ratio)
  if (!Number.isFinite(e.perf_ratio) || e.perf_ratio < 0 || e.perf_ratio > 1) errors.push('绩效比例须在 0-1 之间')
  e.special_deduction = Math.round(Number(body.special_deduction) || 0)
  if (e.special_deduction < 0 || e.special_deduction > 10000) errors.push('专项附加扣除须在 0-10000 之间')
  e.hire_month = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(body.hire_month || '')) ? body.hire_month : '2025-01'
  return { errors, e }
}
