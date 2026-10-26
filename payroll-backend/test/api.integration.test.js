import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import net from 'node:net'
import http from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import * as XLSX from 'xlsx'
import { shanghaiToday } from '../lib/interview_stats.js'

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
  let modelFails = false, matchInput = null
  const modelServer = http.createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    res.setHeader('Content-Type', 'application/json')
    if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'test-resume-model' }] }))
    const modelBody = JSON.parse(body)
    assert.equal(modelBody.model, 'test-resume-model')
    if (modelBody.response_format?.json_schema?.name === 'requisition_matches') {
      matchInput = JSON.parse(modelBody.messages[1].content)
      const job = matchInput.available_jobs.find(item => item.title === '岗位关联测试')
      const result = { matches: job ? [{ requisition_id: job.id, confidence: 'high', reason: '任职经历明确涉及验证职责', evidence: ['UVM'] }] : [], unmatched_reason: '' }
      return res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) } }] }))
    }
    const basic = Object.fromEntries(['name', 'gender', 'date_of_birth', 'marital_status', 'nationality', 'education_level', 'mobile', 'personal_email', 'current_address', 'skills'].map(key => [key, '']))
    basic.name = '模型测试人选'; basic.skills = 'Python,UVM'
    const parsed = { basic, education: [], work_experience: [{ company: '虚构测试企业', title: '验证工程师', start_date: '2020-01', end_date: '', note: '负责验证平台' }] }
    res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: modelFails ? 'malformed' : JSON.stringify(parsed) } }] }))
  })
  await new Promise(resolve => modelServer.listen(0, '127.0.0.1', resolve))
  t.after(() => { modelServer.closeAllConnections(); modelServer.close() })
  const child = spawn(process.execPath, ['server.js'], {
    cwd: projectDir,
    env: { ...process.env, DB_PATH: dbPath, UPLOAD_DIR: path.join(dir, 'uploads'), CITY_POLICY_FILE: policyPath, DEMO_MODE: 'true', COOKIE_SECURE: '0', PORT: String(port), NODE_ENV: 'test', RESUME_LOCAL_LLM: 'true', RESUME_LOCAL_BASE_URL: `http://127.0.0.1:${modelServer.address().port}/v1`, RESUME_LOCAL_MODEL: 'test-resume-model' },
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
  assert.equal((await request(base, '/api/recruiting/resume-parser/status')).response.status, 401)
  assert.equal((await request(base, '/api/recruiting/resume-parser/status', { cookie: finance })).response.status, 403)
  assert.equal((await request(base, '/api/recruiting/resume-parser/status', { cookie: hr })).data.available, true)
  assert.equal((await request(base, '/api/recruiting/job-catalog')).response.status, 401)
  assert.equal((await request(base, '/api/recruiting/job-catalog', { cookie: finance })).response.status, 403)
  const jobCatalog = await request(base, '/api/recruiting/job-catalog', { cookie: hr })
  assert.equal(jobCatalog.response.status, 200)
  assert.ok(jobCatalog.data.tech.jobs.includes('数字验证'))

  const requisition = await request(base, '/api/recruiting/requisitions', { cookie: hr, method: 'POST', body: {
    title: '研发管理负责人', job_family: '研发管理', city: '上海', headcount: 1,
    headcount_max: 2, priority: 'P0', team_label: '研发-管理', target_timing: 'Q4-2026',
    employment_type: 'employee', salary_min: 50000, salary_max: 70000,
    fixed_salary_months: 13, annual_bonus_months: 2, responsibilities: '负责研发团队管理',
    requirements: '具备芯片研发与团队管理经验', education_requirement: '本科', experience_requirement: '10年以上',
    skills: '研发管理,项目管理', reason: '新增管理岗位', target_month: '2025-08'
  } })
  assert.equal(requisition.response.status, 200, JSON.stringify(requisition.data))
  const matchingJob = await request(base, '/api/recruiting/requisitions', { cookie: hr, method: 'POST', body: {
    title: '岗位关联测试', job_family: '数字验证', city: '上海', status: 'open', headcount: 2,
    skills: 'UVM,Python', responsibilities: '负责数字验证平台与回归流程'
  } })
  assert.equal(matchingJob.response.status, 200, JSON.stringify(matchingJob.data))
  const requisitionExport = await request(base, `/api/recruiting/requisitions/export?id=${requisition.data.id}`, { cookie: hr })
  assert.equal(requisitionExport.response.status, 200, JSON.stringify(requisitionExport.data))
  assert.match(requisitionExport.data, /研发管理负责人/)
  assert.match(requisitionExport.data, /全年固定薪资：13 个月/)
  assert.match(requisitionExport.data, /弹性上限 2 人/)
  const recruitingStats = await request(base, '/api/recruiting/stats', { cookie: hr })
  assert.equal(recruitingStats.response.status, 200, JSON.stringify(recruitingStats.data))
  assert.ok(recruitingStats.data.requisitionPlan.maximum >= recruitingStats.data.requisitionPlan.baseline)

  const headhunter = await request(base, '/api/recruiting/channels', { cookie: hr, method: 'POST', body: {
    name: '测试猎头', type: 'headhunter', contact: '顾问', contact_info: '13800000000 / consultant@example.com', fee_basis_months: 12, fee_rate: 20,
    guarantee_months: 3, payment_account_name: '测试咨询公司', payment_account_number: '6222000012345678', payment_bank: '测试银行上海支行'
  } })
  assert.equal(headhunter.response.status, 200, JSON.stringify(headhunter.data))
  const referredCandidate = await request(base, '/api/recruiting/candidates', { cookie: hr, method: 'POST', body: {
    name: '猎头推荐候选人', source_channel_id: headhunter.data.id, requisition_id: requisition.data.id,
    expected_salary: 50000, apply_date: '2025-07-01'
  } })
  assert.equal(referredCandidate.response.status, 200, JSON.stringify(referredCandidate.data))
  const headhunterExpense = await request(base, '/api/recruiting/channel-expenses', { cookie: hr, method: 'POST', body: {
    channel_id: headhunter.data.id, candidate_id: referredCandidate.data.id, year_month: '2025-07', note: '首期猎头费'
  } })
  assert.equal(headhunterExpense.response.status, 200, JSON.stringify(headhunterExpense.data))
  const channels = await request(base, '/api/recruiting/channels', { cookie: hr })
  const storedHeadhunter = channels.data.find(item => item.id === headhunter.data.id)
  assert.equal(storedHeadhunter.fee_basis_months, 12)
  assert.equal(storedHeadhunter.fee_rate, 20)
  assert.equal(storedHeadhunter.guarantee_months, 3)
  assert.equal(storedHeadhunter.contact_info, '13800000000 / consultant@example.com')
  assert.equal(storedHeadhunter.payment_account_number, '6222000012345678')
  assert.equal(storedHeadhunter.candidates[0].id, referredCandidate.data.id)
  assert.equal(storedHeadhunter.expenses[0].candidate_id, referredCandidate.data.id)
  assert.equal(storedHeadhunter.expenses[0].amount, 120000)

  const rangedCandidate = await request(base, '/api/recruiting/candidates', { cookie: hr, method: 'POST', body: {
    name: '薪资区间人选', expected_salary_range: '30k_50k'
  } })
  assert.equal(rangedCandidate.response.status, 200)
  const rangedRows = await request(base, '/api/recruiting/candidates', { cookie: hr })
  assert.equal(rangedRows.data.find(item => item.id === rangedCandidate.data.id).expected_salary_range, '30k_50k')
  assert.equal(rangedRows.data.find(item => item.id === rangedCandidate.data.id).expected_salary, null)
  assert.equal((await request(base, `/api/recruiting/candidates/${rangedCandidate.data.id}`, {
    cookie: hr, method: 'PUT', body: { expected_salary_range: 'invalid' }
  })).response.status, 400)
  assert.equal((await request(base, `/api/recruiting/candidates/${referredCandidate.data.id}`, {
    cookie: hr, method: 'PUT', body: { expected_salary_range: 'above_50k' }
  })).response.status, 200)
  const preservedSalary = await request(base, '/api/recruiting/candidates', { cookie: hr })
  assert.equal(preservedSalary.data.find(item => item.id === referredCandidate.data.id).expected_salary, 50000)
  const noEstimatedFeeFromRange = await request(base, '/api/recruiting/channel-expenses', { cookie: hr, method: 'POST', body: {
    channel_id: headhunter.data.id, candidate_id: referredCandidate.data.id, year_month: '2025-07'
  } })
  assert.equal(noEstimatedFeeFromRange.response.status, 400, '薪资区间不能当成具体金额计算猎头费')

  const candidates = await request(base, '/api/recruiting/candidates', { cookie: hr })
  const linkedCandidate = candidates.data.find(item => item.id === referredCandidate.data.id)
  assert.equal(linkedCandidate.source_channel_id, headhunter.data.id)
  assert.equal(linkedCandidate.linked_channel_type, 'headhunter')
  const interview = await request(base, '/api/recruiting/interviews', { cookie: hr, method: 'POST', body: {
    candidate_id: referredCandidate.data.id, round_no: 8, interviewer: '测试面试官', interview_date: '2025-07-01',
    result: 'strong_recommend', notes: '能力表现突出'
  } })
  assert.equal(interview.response.status, 200, JSON.stringify(interview.data))
  const interviews = await request(base, '/api/recruiting/interviews', { cookie: hr })
  const storedInterview = interviews.data.find(item => item.id === interview.data.id)
  assert.equal(storedInterview.result, 'strong_recommend')
  assert.equal(storedInterview.score, 5)

  const pipeline = await request(base, '/api/recruiting/candidates/kanban', { cookie: hr })
  const pipelineCandidate = pipeline.data.flatMap(group => group.items).find(item => item.id === referredCandidate.data.id)
  assert.equal(pipelineCandidate.interviews.find(item => item.id === interview.data.id).notes, '能力表现突出')
  const revisedInterview = await request(base, `/api/recruiting/interviews/${interview.data.id}`, { cookie: hr, method: 'PUT', body: {
    result: 'recommend', notes: '编辑后同步到候选人详情'
  } })
  assert.equal(revisedInterview.response.status, 200)
  const revisedPipeline = await request(base, '/api/recruiting/candidates/kanban', { cookie: hr })
  assert.equal(revisedPipeline.data.flatMap(group => group.items).find(item => item.id === referredCandidate.data.id)
    .interviews.find(item => item.id === interview.data.id).notes, '编辑后同步到候选人详情')
  const monthlyStats = await request(base, '/api/recruiting/stats?interview_month=2025-07', { cookie: hr })
  assert.equal(monthlyStats.response.status, 200)
  assert.ok(monthlyStats.data.interviewMonthly.candidates.some(item => item.candidate_id === referredCandidate.data.id && item.result === 'recommend'))
  assert.ok(monthlyStats.data.interviewHistory.some(item => item.month === '2025-07'))
  assert.equal((await request(base, '/api/recruiting/stats?interview_month=2025-99', { cookie: hr })).response.status, 400)

  for (const bookType of ['xlsx', 'xls']) {
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['姓名', '测试人选'], ['技能', 'Python,RTL,Verilog'], ['教育', '上海交通大学 本科 微电子 2020']
    ]), '简历')
    const bytes = XLSX.write(workbook, { type: 'buffer', bookType })
    const upload = new FormData()
    upload.append('resume', new Blob([bytes]), `resume.${bookType}`)
    const uploadResponse = await fetch(`${base}/api/recruiting/candidates/${referredCandidate.data.id}/resume`, {
      method: 'POST', headers: { Cookie: hr }, body: upload
    })
    assert.equal(uploadResponse.status, 200, await uploadResponse.text())
    const parsedResume = await request(base, `/api/recruiting/candidates/${referredCandidate.data.id}/resume/parse`, {
      cookie: hr, method: 'POST', body: { allow_external: false }
    })
    assert.equal(parsedResume.response.status, 200, JSON.stringify(parsedResume.data))
    assert.equal(parsedResume.data.parsed.basic.name, '测试人选')
    assert.match(parsedResume.data.parsed.basic.skills, /Python/)
    const employeeUpload = new FormData()
    employeeUpload.append('resume', new Blob([bytes]), `employee-resume.${bookType}`)
    const employeeUploadResponse = await fetch(`${base}/api/employees/1/resume`, {
      method: 'POST', headers: { Cookie: hr }, body: employeeUpload
    })
    const employeeUploadData = await employeeUploadResponse.json()
    assert.equal(employeeUploadResponse.status, 200, JSON.stringify(employeeUploadData))
    const employeeParsed = await request(base, `/api/employees/1/resume/${employeeUploadData.id}/parse`, {
      cookie: hr, method: 'POST', body: { allow_external: false }
    })
    assert.equal(employeeParsed.response.status, 200, JSON.stringify(employeeParsed.data))
    assert.equal(employeeParsed.data.parsed.basic.name, '测试人选')
    const candidateParsePath = `/api/recruiting/candidates/${referredCandidate.data.id}/resume/parse`
    const employeeParsePath = `/api/employees/1/resume/${employeeUploadData.id}/parse`
    for (const pathname of [candidateParsePath, employeeParsePath]) {
      const result = await request(base, pathname, { cookie: hr, method: 'POST', body: { mode: 'local_model' } })
      assert.equal(result.response.status, 200, JSON.stringify(result.data))
      assert.equal(result.data.engine, 'local-llm')
      assert.equal(result.data.parsed.basic.name, '模型测试人选')
      assert.equal(result.data.parsed.work_experience[0].company, '虚构测试企业')
    }
    const checkDb = new DatabaseSync(dbPath)
    const savedCandidate = checkDb.prepare('SELECT resume_parsed FROM candidates WHERE id=?').get(referredCandidate.data.id).resume_parsed
    const savedEmployee = checkDb.prepare('SELECT parsed_data FROM employee_resumes WHERE id=?').get(employeeUploadData.id).parsed_data
    assert.equal(JSON.parse(savedCandidate).engine, 'local-llm')
    assert.equal(JSON.parse(savedEmployee).engine, 'local-llm')
    const personal = {
      basic: { name: '核对后测试人选', gender: '女', date_of_birth: '1995-03-16', education_level: '硕士', mobile: '13900139000', personal_email: 'corrected@example.invalid', current_address: '上海', skills: 'UVM,Python' },
      education: [{ school: '虚构大学', qualification: '硕士', major: '电子信息', graduation_year: 2020, note: '已核对教育经历' }],
      work_experience: [{ company: '虚构测试企业', title: '高级验证工程师', start_date: '2020-01', end_date: '', note: '已校正职责和成果' }]
    }
    const candidateApplyPath = `/api/recruiting/candidates/${referredCandidate.data.id}/resume/apply`
    const groupBefore = (await request(base, '/api/recruiting/candidates/kanban', { cookie: hr })).data.flatMap(group => group.items).find(item => item.id === referredCandidate.data.id)
    assert.equal(groupBefore.resume_pending, true)
    const matchPath = `/api/recruiting/candidates/${referredCandidate.data.id}/requisition-match`
    assert.equal((await request(base, matchPath, { cookie: finance, method: 'POST', body: { personal_profile: personal } })).response.status, 403)
    const matched = await request(base, matchPath, { cookie: hr, method: 'POST', body: { personal_profile: personal } })
    assert.equal(matched.response.status, 200, JSON.stringify(matched.data))
    assert.equal(matched.data.suggested_requisition_id, matchingJob.data.id)
    const sentToModel = JSON.stringify(matchInput)
    assert.ok(!sentToModel.includes('corrected@example.invalid'))
    assert.ok(!sentToModel.includes('13900139000'))
    assert.ok(!sentToModel.includes('1995-03-16'))
    assert.equal(checkDb.prepare('SELECT requisition_id FROM candidates WHERE id=?').get(referredCandidate.data.id).requisition_id, groupBefore.requisition_id)
    checkDb.prepare("UPDATE job_requisitions SET status='closed' WHERE id=?").run(matchingJob.data.id)
    const closedSelection = await request(base, candidateApplyPath, { cookie: hr, method: 'POST', body: { result_token: groupBefore.resume_result_token, personal_profile: personal, requisition_id: matchingJob.data.id } })
    // An existing historical association may be retained; a new closed job cannot be selected.
    assert.equal(closedSelection.response.status, groupBefore.requisition_id === matchingJob.data.id ? 200 : 409)
    if (groupBefore.requisition_id !== matchingJob.data.id) assert.equal(checkDb.prepare('SELECT name FROM candidates WHERE id=?').get(referredCandidate.data.id).name, groupBefore.name)
    checkDb.prepare("UPDATE job_requisitions SET status='open' WHERE id=?").run(matchingJob.data.id)
    assert.equal((await request(base, candidateApplyPath, { cookie: hr, method: 'POST', body: { result_token: 'stale', personal_profile: personal } })).response.status, 409)
    assert.equal((await request(base, candidateApplyPath, { cookie: finance, method: 'POST', body: { result_token: groupBefore.resume_result_token, personal_profile: personal } })).response.status, 403)
    const appliedCandidate = await request(base, candidateApplyPath, { cookie: hr, method: 'POST', body: { result_token: groupBefore.resume_result_token, personal_profile: personal, requisition_id: matchingJob.data.id } })
    assert.equal(appliedCandidate.response.status, 200, JSON.stringify(appliedCandidate.data))
    const confirmed = (await request(base, '/api/recruiting/candidates/kanban', { cookie: hr })).data.flatMap(group => group.items).find(item => item.id === referredCandidate.data.id)
    assert.equal(confirmed.resume_pending, false)
    assert.equal(confirmed.name, personal.basic.name)
    assert.equal(confirmed.phone, personal.basic.mobile)
    assert.equal(confirmed.email, personal.basic.personal_email)
    assert.equal(confirmed.personal_profile.basic.current_address, '上海')
    assert.equal(confirmed.personal_profile.education[0].major, '电子信息')
    assert.equal(confirmed.personal_profile.work_experience[0].note, '已校正职责和成果')
    assert.equal(confirmed.stage, groupBefore.stage)
    assert.equal(confirmed.offer_amount, groupBefore.offer_amount)
    assert.equal(confirmed.requisition_id, matchingJob.data.id)
    assert.ok(confirmed.timeline.some(item => item.type === 'requisition_linked'))
    assert.ok(confirmed.timeline.some(item => item.type === 'resume_applied'))
    personal.basic.current_address = '苏州'
    const manualProfile = await request(base, `/api/recruiting/candidates/${referredCandidate.data.id}`, { cookie: hr, method: 'PUT', body: { personal_profile: personal } })
    assert.equal(manualProfile.response.status, 200, JSON.stringify(manualProfile.data))
    assert.equal(JSON.parse(checkDb.prepare('SELECT profile_json FROM candidates WHERE id=?').get(referredCandidate.data.id).profile_json).basic.current_address, '苏州')
    personal.basic.name = checkDb.prepare('SELECT name FROM employees WHERE id=1').get().name
    const employeeApplyPath = `/api/employees/1/resume/${employeeUploadData.id}/apply`
    const initialApply = await request(base, employeeApplyPath, { cookie: hr, method: 'POST', body: { personal_profile: personal } })
    assert.equal(initialApply.response.status, 200, JSON.stringify(initialApply.data))
    personal.work_experience[0].title = '验证负责人'
    personal.work_experience[0].note = '第二次校正内容'
    assert.equal((await request(base, employeeApplyPath, { cookie: hr, method: 'POST', body: { personal_profile: personal } })).response.status, 200)
    assert.equal(checkDb.prepare("SELECT count(*) AS count FROM employee_work_experience WHERE employee_id=1 AND company='虚构测试企业' AND start_date='2020-01'").get().count, 1)
    assert.equal(checkDb.prepare("SELECT title FROM employee_work_experience WHERE employee_id=1 AND company='虚构测试企业' AND start_date='2020-01'").get().title, '验证负责人')
    checkDb.prepare("INSERT INTO employee_work_experience(employee_id,company,note) VALUES(1,'旧错误企业','旧乱码记录')").run()
    for (let applyAgain = 0; applyAgain < 2; applyAgain++) {
      const replaced = await request(base, employeeApplyPath, { cookie: hr, method: 'POST', body: { personal_profile: personal, replace_experience: true } })
      assert.equal(replaced.response.status, 200, JSON.stringify(replaced.data))
      assert.equal(checkDb.prepare('SELECT count(*) AS count FROM employee_work_experience WHERE employee_id=1').get().count, 1)
      assert.equal(checkDb.prepare('SELECT count(*) AS count FROM employee_education WHERE employee_id=1').get().count, 1)
    }
    assert.ok(checkDb.prepare('SELECT before_json FROM resume_apply_history WHERE employee_id=1').all().some(item => item.before_json.includes('旧错误企业')))
    modelFails = true
    for (const pathname of [candidateParsePath, employeeParsePath]) {
      const failed = await request(base, pathname, { cookie: hr, method: 'POST', body: { mode: 'local_model' } })
      assert.equal(failed.response.status, 502)
      assert.match(failed.data.error, /原有结果未改动/)
    }
    assert.equal(checkDb.prepare('SELECT resume_parsed FROM candidates WHERE id=?').get(referredCandidate.data.id).resume_parsed, savedCandidate)
    assert.equal(checkDb.prepare('SELECT parsed_data FROM employee_resumes WHERE id=?').get(employeeUploadData.id).parsed_data, savedEmployee)
    checkDb.close()
    modelFails = false
  }

  const createdEmployee = await request(base, '/api/employees', { cookie: hr, method: 'POST', body: {
    name: '薪酬包测试', grade: 'P4', job_family: '人力资源', city: '上海', monthly_base: 20000,
    fixed_salary_months: 13, annual_bonus_months: 1.5, perf_ratio: 0, hire_date: '2025-07-01',
    employment_type: 'employee', status: 'active', special_deductions: {
      child_education: { enabled: true, amount: 2000 }, housing_rent: { enabled: true, amount: 1500 }
    }
  } })
  assert.equal(createdEmployee.response.status, 200, JSON.stringify(createdEmployee.data))

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

  // 简历库完整闭环：上传建档 → 安排/开始/完成面试 → 录用 → 新增员工关联。
  const ok = async (pathname, method = 'GET', body) => {
    const result = await request(base, pathname, { cookie: hr, method, body })
    assert.equal(result.response.status, 200, `${pathname}: ${JSON.stringify(result.data)}`)
    return result.data
  }
  const cv = new FormData()
  const cvText = '姓名：流转人选\n手机：13800009999\n邮箱：workflow@example.com\n技能：Python RTL Verilog\n上海交通大学 本科 微电子 2020'
  cv.append('resume', new Blob([cvText]), 'workflow.txt')
  cv.append('requisition_id', String(requisition.data.id))
  const importedResponse = await fetch(base + '/api/recruiting/candidates/from-resume', { method: 'POST', headers: { Cookie: hr }, body: cv })
  const imported = await importedResponse.json()
  assert.equal(importedResponse.status, 200, JSON.stringify(imported))
  const person = async () => (await ok('/api/recruiting/candidates')).find(item => item.id === imported.id)
  assert.equal((await person()).name, '流转人选')
  assert.equal((await person()).timeline[0].type, 'created')
  const today = shanghaiToday()
  const schedule = await ok('/api/recruiting/interviews', 'POST', {
    candidate_id: imported.id, round_no: 1, interviewer: '测试面试官', interview_date: today, status: 'scheduled'
  })
  assert.equal((await person()).stage, 'waiting')
  let monthly = await ok(`/api/recruiting/stats?interview_month=${today.slice(0, 7)}`)
  assert.ok(monthly.interviewMonthly.awaitingCandidates.some(item => item.candidate_id === imported.id))
  assert.ok(!monthly.interviewMonthly.candidates.some(item => item.candidate_id === imported.id))
  const duplicateRound = await request(base, '/api/recruiting/interviews', { cookie: hr, method: 'POST', body: {
    candidate_id: imported.id, round_no: 1, interviewer: '面试官', interview_date: today, status: 'scheduled'
  } })
  assert.equal(duplicateRound.response.status, 409)
  await ok(`/api/recruiting/interviews/${schedule.id}`, 'PUT', { status: 'in_progress' })
  assert.equal((await person()).stage, 'interview')
  assert.equal((await person()).current_round, 1)
  await ok(`/api/recruiting/interviews/${schedule.id}`, 'PUT', { status: 'completed', result: 'recommend', notes: '本轮面试完成' })
  const second = await ok('/api/recruiting/interviews', 'POST', {
    candidate_id: imported.id, round_no: 2, interviewer: '二面面试官', interview_date: today, status: 'in_progress'
  })
  assert.equal((await person()).current_round, 2)
  await ok(`/api/recruiting/interviews/${second.id}`, 'PUT', { status: 'completed', result: 'strong_recommend' })
  monthly = await ok(`/api/recruiting/stats?interview_month=${today.slice(0, 7)}`)
  assert.ok(!monthly.interviewMonthly.awaitingCandidates.some(item => item.candidate_id === imported.id))
  assert.equal(monthly.interviewMonthly.candidates.find(item => item.candidate_id === imported.id).rounds, 2)
  await ok(`/api/recruiting/candidates/${imported.id}/stage`, 'POST', { stage: 'offer' })
  const prematureAcceptance = await request(base, `/api/recruiting/candidates/${imported.id}/stage`, { cookie: hr, method: 'POST', body: { stage: 'accepted' } })
  assert.equal(prematureAcceptance.response.status, 409)
  await ok(`/api/recruiting/candidates/${imported.id}`, 'PUT', { offer_amount: 50000, phone: '13800009999' })
  const offer = await ok(`/api/recruiting/candidates/${imported.id}/offer-approval`, 'POST', {})
  const action = await request(base, `/api/approvals/${offer.approval_id}/action`, { cookie: founder, method: 'POST', body: { action: 'approve' } })
  assert.equal(action.response.status, 200, JSON.stringify(action.data))
  await ok(`/api/recruiting/candidates/${imported.id}/stage`, 'POST', { stage: 'accepted' })
  assert.equal((await person()).stage, 'accepted')
  assert.equal((await person()).employee_id, null)
  await ok(`/api/recruiting/candidates/${imported.id}`, 'PUT', { personal_profile: {
    basic: { name: '流转人选', mobile: '13800009999', personal_email: 'onboard@example.invalid', education_level: '硕士', current_address: '上海', skills: 'Python,UVM' },
    education: [{ school: '虚构大学', qualification: '硕士', graduation_year: 2020 }],
    work_experience: [{ company: '虚构原单位', title: '验证工程师', start_date: '2020-07', end_date: '2024-03', note: '已核对的任职经历' }]
  } })
  const employeeBody = { candidate_id: imported.id, name: '流转人选', grade: 'P4', job_family: '研发管理', city: '上海',
    monthly_base: 50000, fixed_salary_months: 13, annual_bonus_months: 2, perf_ratio: 0, hire_date: today, status: 'active' }
  const linkedEmployee = await ok('/api/employees', 'POST', employeeBody)
  assert.equal((await person()).employee_id, linkedEmployee.id)
  assert.equal((await person()).stage, 'hired')
  const profile = await ok(`/api/employees/${linkedEmployee.id}/profile`)
  assert.equal(profile.recruitment_candidate.id, imported.id)
  assert.equal(profile.employee.mobile, '13800009999')
  assert.equal(profile.employee.current_address, '上海')
  assert.equal(profile.education[0].school, '虚构大学')
  assert.equal(profile.work_experience[0].note, '已核对的任职经历')
  assert.equal((await request(base, `/api/recruiting/candidates/${imported.id}`, { cookie: hr, method: 'PUT', body: { requisition_id: matchingJob.data.id } })).response.status, 409)
  const employeeResumes = await ok(`/api/employees/${linkedEmployee.id}/resume`)
  assert.equal(employeeResumes.length, 1)
  const employeesBeforeRetry = (await ok('/api/employees')).length
  const retry = await request(base, '/api/employees', { cookie: hr, method: 'POST', body: employeeBody })
  assert.equal(retry.response.status, 409)
  assert.equal((await ok('/api/employees')).length, employeesBeforeRetry)
  await ok(`/api/recruiting/candidates/${imported.id}/resume`, 'DELETE')
  const copiedCv = await request(base, `/api/employees/${linkedEmployee.id}/resume/${employeeResumes[0].id}/file`, { cookie: hr })
  assert.equal(copiedCv.response.status, 200)
  assert.equal(copiedCv.data, cvText, '候选人删除旧简历不影响员工档案中的独立副本')
  await ok(`/api/employees/${linkedEmployee.id}/profile`, 'PUT', { current_address: '测试地址', skills: '更新技能' })
  assert.equal((await ok(`/api/employees/${linkedEmployee.id}/profile`)).employee.skills, '更新技能')
  assert.ok((await person()).timeline.some(item => item.type === 'employee_linked'))
  const rejected = await ok('/api/recruiting/candidates', 'POST', { name: '淘汰测试人选' })
  const cancelled = await ok('/api/recruiting/interviews', 'POST', { candidate_id: rejected.id, interviewer: '面试官', round_no: 1, interview_date: today, status: 'scheduled' })
  await ok(`/api/recruiting/candidates/${rejected.id}/stage`, 'POST', { stage: 'rejected', reject_reason: '测试终止流程' })
  assert.equal((await ok('/api/recruiting/interviews')).find(item => item.id === cancelled.id).status, 'cancelled')
})
