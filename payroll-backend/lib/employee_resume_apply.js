import { db } from '../db.js'
import { PROFILE_BASIC_FIELDS, PROFILE_EDUCATION_FIELDS, PROFILE_WORK_FIELDS } from './resume_profile.js'

// Caller owns the transaction. Reapplying updates matching rows instead of silently skipping them.
export function writeEmployeeResumeProfile(employeeId, profile, { replaceExperience = false, fillOnly = false } = {}) {
  const applied = { basic: 0, education: 0, work_experience: 0 }
  const employee = db.prepare('SELECT * FROM employees WHERE id=?').get(employeeId)
  if (!employee) throw Object.assign(new Error('员工不存在'), { statusCode: 404 })
  for (const key of PROFILE_BASIC_FIELDS) {
    const value = profile.basic[key]
    if (!value || (fillOnly && employee[key]) || (key === 'mobile' && value.includes('*') && employee[key] && !employee[key].includes('*'))) continue
    db.prepare(`UPDATE employees SET ${key}=? WHERE id=?`).run(value, employeeId)
    applied.basic++
  }
  for (const [key, table, fields] of [
    ['education', 'employee_education', PROFILE_EDUCATION_FIELDS],
    ['work_experience', 'employee_work_experience', PROFILE_WORK_FIELDS]
  ]) {
    // Missing extracted sections never clear existing history.
    if (replaceExperience && profile[key].length) db.prepare(`DELETE FROM ${table} WHERE employee_id=?`).run(employeeId)
    for (const row of profile[key]) {
      const existing = db.prepare(`SELECT * FROM ${table} WHERE employee_id=? AND ${fields[0]}=?`).all(employeeId, row[fields[0]])
      const match = key === 'education'
        ? existing.find(item => (!item.qualification || !row.qualification || item.qualification === row.qualification) && (!item.graduation_year || !row.graduation_year || item.graduation_year === row.graduation_year))
        : existing.find(item => (!item.start_date || !row.start_date || item.start_date === row.start_date) && (item.start_date && row.start_date || !item.title || !row.title || item.title === row.title))
      if (match) {
        const updates = fields.filter(field => row[field] != null && row[field] !== '' && (!fillOnly || !match[field]))
        if (updates.length) db.prepare(`UPDATE ${table} SET ${updates.map(field => `${field}=?`).join(',')} WHERE id=?`).run(...updates.map(field => row[field]), match.id)
      } else {
        db.prepare(`INSERT INTO ${table}(employee_id,${fields.join(',')}) VALUES(${fields.map(() => '?').join(',')},?)`)
          .run(employeeId, ...fields.map(field => row[field] ?? null))
      }
      applied[key]++
    }
  }
  return applied
}

export function employeeResumeSnapshot(employeeId) {
  const employee = db.prepare('SELECT * FROM employees WHERE id=?').get(employeeId)
  return { basic: Object.fromEntries(PROFILE_BASIC_FIELDS.map(key => [key, employee?.[key] ?? ''])),
    education: db.prepare('SELECT * FROM employee_education WHERE employee_id=? ORDER BY id').all(employeeId),
    work_experience: db.prepare('SELECT * FROM employee_work_experience WHERE employee_id=? ORDER BY id').all(employeeId) }
}
