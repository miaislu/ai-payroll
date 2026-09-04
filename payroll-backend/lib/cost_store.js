import { db } from '../db.js'
import { companyCostForPeriod } from './company_cost.js'
import { employeesForPeriod } from './employee_terms.js'
import { attachAttendance } from './payroll.js'

export function liveCompanyCostRows(period) {
  const employees = employeesForPeriod(period)
  const grants = db.prepare("SELECT * FROM option_grants WHERE status='granted'").all()
  const grantsMap = {}
  for (const grant of grants) (grantsMap[grant.employee_id] ||= []).push(grant)
  const attendance = db.prepare('SELECT * FROM attendance_days WHERE period=?').all(period)
  return companyCostForPeriod(period, attachAttendance(employees, attendance), grantsMap)
}

export function persistCompanyCostSnapshot(period, rows = liveCompanyCostRows(period)) {
  db.prepare('DELETE FROM company_cost_snapshots WHERE period=?').run(period)
  const insert = db.prepare('INSERT INTO company_cost_snapshots(period,employee_id,row_json,created_at) VALUES(?,?,?,?)')
  const now = new Date().toISOString()
  for (const row of rows) insert.run(period, row.employee_id, JSON.stringify(row), now)
  return rows.length
}

export function companyCostRowsForPeriod(period) {
  const run = db.prepare('SELECT * FROM payroll_runs WHERE period=?').get(period) || null
  if (run) {
    const snapshots = db.prepare('SELECT row_json FROM company_cost_snapshots WHERE period=? ORDER BY employee_id').all(period)
    if (snapshots.length) return { rows: snapshots.map(row => JSON.parse(row.row_json)), run, frozen: true }
  }
  return { rows: liveCompanyCostRows(period), run, frozen: false }
}
