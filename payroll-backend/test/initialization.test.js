import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const backendDir = path.resolve(import.meta.dirname, '..')

function isolatedRun(source, env = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'payroll-init-test-'))
  const dbPath = path.join(dir, 'payroll.db')
  try {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
      cwd: backendDir,
      env: { ...process.env, DB_PATH: dbPath, ...env },
      encoding: 'utf8'
    })
    assert.equal(result.status, 0, result.stderr || result.stdout)
    const last = result.stdout.trim().split('\n').at(-1)
    return JSON.parse(last)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('v10 migration never deletes payroll rows based on date or row count', () => {
  const result = isolatedRun(`
    const { db, migrate } = await import('./db.js')
    const insert = db.prepare('INSERT INTO payroll(period,employee_id,name,net) VALUES(?,?,?,?)')
    for (let month = 1; month <= 6; month++) insert.run('2025-' + String(month).padStart(2, '0'), month, '真实员工' + month, 10000 + month)
    migrate()
    console.log(JSON.stringify({ payroll: db.prepare('SELECT COUNT(*) c FROM payroll').get().c, archive: db.prepare('SELECT COUNT(*) c FROM payroll_archive_v10').get().c }))
  `)
  assert.deepEqual(result, { payroll: 6, archive: 0 })
})

test('non-demo initialization creates only the initial admin', () => {
  const result = isolatedRun(`
    const { seedIfEmpty } = await import('./seed.js')
    const { db } = await import('./db.js')
    seedIfEmpty()
    const count = table => db.prepare('SELECT COUNT(*) c FROM ' + table).get().c
    console.log(JSON.stringify({ users: count('users'), employees: count('employees'), approvals: count('approvals'), payroll: count('payroll'), candidates: count('candidates'), performance: count('performance_reviews'), market: count('market_samples') }))
  `, { NODE_ENV: 'production', DEMO_MODE: 'false', INITIAL_ADMIN_PASSWORD: 'a-strong-test-password' })
  assert.deepEqual(result, { users: 1, employees: 0, approvals: 0, payroll: 0, candidates: 0, performance: 0, market: 0 })
})

test('demo data requires explicit DEMO_MODE=true', () => {
  const result = isolatedRun(`
    const { seedIfEmpty } = await import('./seed.js')
    const { db } = await import('./db.js')
    seedIfEmpty()
    console.log(JSON.stringify({ users: db.prepare('SELECT COUNT(*) c FROM users').get().c, employees: db.prepare('SELECT COUNT(*) c FROM employees').get().c }))
  `, { NODE_ENV: 'development', DEMO_MODE: 'true' })
  assert.ok(result.users >= 4)
  assert.ok(result.employees > 0)
})
