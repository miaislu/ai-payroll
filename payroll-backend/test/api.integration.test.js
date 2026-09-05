import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { DatabaseSync } from 'node:sqlite'

const projectDir = path.resolve(import.meta.dirname, '..')

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      server.close(error => error ? reject(error) : resolve(port))
    })
  })
}

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    let output = ''
    const timer = setTimeout(() => reject(new Error(`后端启动超时：${output}`)), 15000)
    const onData = chunk => {
      output += chunk
      if (output.includes('[backend]')) {
        clearTimeout(timer)
        resolve()
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.once('exit', code => {
      clearTimeout(timer)
      reject(new Error(`后端提前退出 ${code}：${output}`))
    })
  })
}

async function request(base, pathname, { cookie, method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(base + pathname, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const contentType = response.headers.get('content-type') || ''
  const data = contentType.includes('application/json') ? await response.json() : await response.text()
  return { response, data }
}

async function login(base, username, password) {
  const { response, data } = await request(base, '/api/auth/login', { method: 'POST', body: { username, password } })
  assert.equal(response.status, 200, JSON.stringify(data))
  return response.headers.get('set-cookie').split(';')[0]
}

test('API 权限、同源、月结、离职导出与快照不可变', { timeout: 30000 }, async t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'payroll-api-test-'))
  const dbPath = path.join(dir, 'test.db')
  const policyPath = path.join(dir, 'policies.json')
  const cities = ['上海', '北京', '深圳', '苏州', '无锡', '合肥', '武汉', '成都', '西安', '杭州', '南京', '广州', '厦门']
  writeFileSync(policyPath, JSON.stringify({ policies: cities.map(city => ({
    city, verified: true, effective_from: '2025-01', effective_to: '2025-12', source: 'integration-test-fixture',
    social_base_min: 1000, social_base_max: 100000, fund_min: 1000, fund_max: 100000,
    personal_pension_rate: 0.08, personal_medical_rate: 0.02, personal_unemployment_rate: 0.003,
    personal_social_rate: 0.103, employer_social_rate: 0.26, personal_fund_rate: 0.07, employer_fund_rate: 0.07,
    local_avg_monthly_wage: 10000,
    min_wage: 1000
  })) }))
  const port = await freePort()
  const child = spawn(process.execPath, ['server.js'], {
    cwd: projectDir,
    env: { ...process.env, DB_PATH: dbPath, UPLOAD_DIR: path.join(dir, 'uploads'), CITY_POLICY_FILE: policyPath, DEMO_MODE: 'true', COOKIE_SECURE: '0', PORT: String(port), NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  t.after(() => {
    child.kill('SIGTERM')
    rmSync(dir, { recursive: true, force: true })
  })
  await waitForServer(child)
  const base = `http://127.0.0.1:${port}`
  const hr = await login(base, 'hr', 'hr123')
  const finance = await login(base, 'finance', 'finance123')
  const founder = await login(base, 'founder', 'admin123')

  const financeEmployees = await request(base, '/api/employees', { cookie: finance })
  assert.equal(financeEmployees.response.status, 200)
  assert.ok(financeEmployees.data.length > 0)
  assert.equal('monthly_base' in financeEmployees.data[0], false)
  const financePerformance = await request(base, '/api/performance?cycle=2025-H1', { cookie: finance })
  assert.equal(financePerformance.response.status, 403)

  const ownClaim = await request(base, '/api/expense/claims', { cookie: finance, method: 'POST', body: { expense_type: '办公', amount: 100, claim_date: '2025-06-01', description: 'maker-checker test' } })
  assert.equal(ownClaim.response.status, 200, JSON.stringify(ownClaim.data))
  const ownClaimApproval = await request(base, `/api/expense/claims/${ownClaim.data.id}/action`, { cookie: finance, method: 'POST', body: { action: 'approve' } })
  assert.equal(ownClaimApproval.response.status, 409)
  const founderClaimApproval = await request(base, `/api/expense/claims/${ownClaim.data.id}/action`, { cookie: founder, method: 'POST', body: { action: 'approve' } })
  assert.equal(founderClaimApproval.response.status, 200, JSON.stringify(founderClaimApproval.data))

  const equityDenied = await request(base, '/api/equity/pool', { cookie: hr, method: 'PUT', body: { total_shares: 2000 } })
  assert.equal(equityDenied.response.status, 403)

  const csrfDenied = await request(base, '/api/departments', { cookie: hr, method: 'POST', headers: { Origin: 'https://evil.example' }, body: { name: '越权部门' } })
  assert.equal(csrfDenied.response.status, 403)

  const unverifiedReference = await request(base, '/api/recruiting/offer/suggest?job_family=%E6%A8%A1%E6%8B%9FIC%E8%AE%BE%E8%AE%A1&annual_cash=500000&city=%E4%B8%8A%E6%B5%B7', { cookie: hr })
  assert.equal(unverifiedReference.response.status, 404)

  const unverifiedDistribution = await request(base, '/api/dashboard/distribution?category=all&period=2025-06', { cookie: hr })
  assert.equal(unverifiedDistribution.response.status, 200, JSON.stringify(unverifiedDistribution.data))
  assert.equal(unverifiedDistribution.data.refP50, null)
  const unverifiedAttrition = await request(base, '/api/dashboard/attrition', { cookie: hr })
  assert.equal(unverifiedAttrition.response.status, 200, JSON.stringify(unverifiedAttrition.data))
  assert.ok(unverifiedAttrition.data.every(item => item.p50 === null), '未核验带宽不得进入留才判断')

  const approvalList = await request(base, '/api/approvals', { cookie: hr })
  assert.equal(approvalList.response.status, 200, JSON.stringify(approvalList.data))
  const seededOffer = approvalList.data.find(item => item.type === 'offer')
  assert.ok(seededOffer?.offer_context, 'Offer 审批应提供完整决策上下文')
  assert.equal(seededOffer.offer_context.candidate.name, '吴敏')
  assert.ok(seededOffer.offer_context.candidate.expected_salary > 0)
  assert.ok(seededOffer.offer_context.requisition.salary_min > 0)
  assert.equal(seededOffer.offer_context.benchmark, null)
  assert.match(seededOffer.offer_context.benchmark_note, /未核验|暂无/)
  assert.ok(Array.isArray(seededOffer.offer_context.interviews))

  const approval = await request(base, '/api/approvals', { cookie: hr, method: 'POST', body: {
    type: 'band', title: '测试审批', payload: { direction: '数字验证', source: 'integration-test-fixture', to: { p25: 30, p50: 40, p75: 50 } }
  } })
  assert.equal(approval.response.status, 200, JSON.stringify(approval.data))
  const selfApproval = await request(base, `/api/approvals/${approval.data.id}/action`, { cookie: hr, method: 'POST', body: { action: 'approve' } })
  assert.equal(selfApproval.response.status, 409)
  const approvedByFounder = await request(base, `/api/approvals/${approval.data.id}/action`, { cookie: founder, method: 'POST', body: { action: 'approve' } })
  assert.equal(approvedByFounder.response.status, 200, JSON.stringify(approvedByFounder.data))
  const approvedReference = await request(base, '/api/recruiting/offer/suggest?job_family=%E6%95%B0%E5%AD%97%E9%AA%8C%E8%AF%81&annual_cash=400000&city=%E8%8B%8F%E5%B7%9E', { cookie: hr })
  assert.equal(approvedReference.response.status, 200, JSON.stringify(approvedReference.data))
  assert.equal(approvedReference.data.baseline.p50, 40)
  assert.equal('adjusted' in approvedReference.data, false)

  const unlockedExport = await request(base, '/api/payroll/2025-05/export/social', { cookie: finance })
  assert.equal(unlockedExport.response.status, 409)

  const submitted = await request(base, '/api/payroll/2025-06/submit', { cookie: finance, method: 'POST', body: {} })
  assert.equal(submitted.response.status, 200, JSON.stringify(submitted.data))
  const socialExport = await request(base, '/api/payroll/2025-06/export/social', { cookie: finance })
  assert.equal(socialExport.response.status, 200, JSON.stringify(socialExport.data))
  assert.match(socialExport.data, /王五/)

  const attendanceLocked = await request(base, '/api/attendance', { cookie: hr, method: 'PUT', body: { period: '2025-06', rows: [{ employee_id: 1, scheduled_work_days: 22, work_days: 22 }] } })
  assert.equal(attendanceLocked.response.status, 409)

  const hrEmployees = await request(base, '/api/employees', { cookie: hr })
  const lockedEmployee = hrEmployees.data.find(employee => employee.id === 1)
  const hireDateLocked = await request(base, '/api/employees/1', {
    cookie: hr,
    method: 'PUT',
    body: { ...lockedEmployee, hire_date: '2025-02-01', effective_month: '2025-07' }
  })
  assert.equal(hireDateLocked.response.status, 409)

  const direct = new DatabaseSync(dbPath)
  const storedSession = direct.prepare('SELECT token FROM sessions LIMIT 1').get().token
  const rawSession = decodeURIComponent(founder.slice(founder.indexOf('=') + 1))
  assert.notEqual(storedSession, rawSession)
  assert.match(storedSession, /^[a-f0-9]{64}$/)
  assert.throws(() => direct.prepare('UPDATE payroll SET net=1 WHERE period=?').run('2025-06'), /不可修改/)
  assert.throws(() => direct.prepare('DELETE FROM company_cost_snapshots WHERE period=?').run('2025-06'), /不可删除/)
  const frozen = direct.prepare('SELECT city,employment_type,base,perf,ot,gross,tax,regular_tax,severance_tax,special_deduction,social_base,id_number,bank_account,personal_pension_rate,personal_medical_rate,personal_unemployment_rate FROM payroll WHERE period=? AND employee_id=1').get('2025-06')
  assert.equal(direct.prepare('SELECT verified FROM benchmarks WHERE direction=?').get('数字验证').verified, 1)
  assert.equal(frozen.city, '上海')
  assert.equal(frozen.employment_type, 'employee')
  assert.ok(frozen.social_base > 0)
  assert.ok(frozen.id_number)
  assert.ok(frozen.bank_account)
  assert.equal(frozen.personal_pension_rate, 0.08)
  assert.equal(frozen.personal_medical_rate, 0.02)
  assert.equal(frozen.personal_unemployment_rate, 0.003)
  assert.equal(frozen.gross, frozen.base + frozen.perf + frozen.ot)
  assert.equal(frozen.tax, frozen.regular_tax + frozen.severance_tax)
  direct.close()
})
