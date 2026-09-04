#!/usr/bin/env node
import { db, DB_PATH } from '../db.js'

const apply = process.argv.includes('--apply')
const archiveExists = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='payroll_archive_v10'").get())

if (!archiveExists) {
  console.log('[recover-v10] 未发现 payroll_archive_v10，无需恢复。数据库:', DB_PATH)
  process.exit(0)
}

const archiveCount = db.prepare('SELECT COUNT(*) c FROM payroll_archive_v10').get().c
const payrollCount = db.prepare('SELECT COUNT(*) c FROM payroll').get().c
console.log(`[recover-v10] 数据库: ${DB_PATH}`)
console.log(`[recover-v10] 归档 ${archiveCount} 条；当前 payroll ${payrollCount} 条。`)

if (!apply) {
  console.log('[recover-v10] 当前为只读检查。确认已备份数据库且 payroll 为空后，添加 --apply 执行恢复。')
  process.exit(0)
}
if (archiveCount === 0) {
  console.log('[recover-v10] 归档为空，无需恢复。')
  process.exit(0)
}
if (payrollCount !== 0) {
  console.error('[recover-v10] 拒绝恢复：当前 payroll 非空。请人工核对归档与现有数据，脚本不会覆盖或猜测业务数据。')
  process.exit(2)
}

const targetColumns = db.prepare('PRAGMA table_info(payroll)').all().map(r => r.name)
const archiveColumns = new Set(db.prepare('PRAGMA table_info(payroll_archive_v10)').all().map(r => r.name))
const columns = targetColumns.filter(name => archiveColumns.has(name))
for (const required of ['period', 'employee_id', 'net']) {
  if (!columns.includes(required)) throw new Error(`归档缺少必要列 ${required}，拒绝自动恢复`)
}
const quoted = columns.map(name => `"${name.replaceAll('"', '""')}"`).join(',')
db.exec('BEGIN IMMEDIATE')
try {
  db.exec(`INSERT INTO payroll(${quoted}) SELECT ${quoted} FROM payroll_archive_v10`)
  db.exec('COMMIT')
} catch (error) {
  db.exec('ROLLBACK')
  throw error
}
console.log(`[recover-v10] 已恢复 ${db.prepare('SELECT COUNT(*) c FROM payroll').get().c} 条工资记录。归档表保留供复核。`)
