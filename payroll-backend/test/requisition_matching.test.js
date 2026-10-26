import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { availableRequisitions, professionalMatchProfile, validateRequisitionMatches, matchRequisitions, validateRequisitionChange } from '../lib/requisition_matching.js'

const source = () => ({ basic: { name: '不要送给模型的姓名', gender: '女', date_of_birth: '1990-01-01', marital_status: '已婚', nationality: '汉族', mobile: '13900139000', personal_email: 'private@example.invalid', current_address: '具体住址', skills: 'MBE,ALD,外延工艺' },
  education: [{ school: '不要送给模型的学校', major: '材料物理', qualification: '硕士' }],
  work_experience: [{ company: '不要送给模型的雇主', title: 'MBE工艺开发工程师', note: '负责外延工艺和ALD薄膜工艺' }] })
const jobs = [
  { id: 1, title: 'MBE 工艺开发工程师', job_family: 'MBE 工艺开发工程师', city: '上海' },
  { id: 2, title: 'ALD 工艺开发工程师', job_family: 'ALD 工艺开发工程师', city: '上海' }
]
const proposal = (id, confidence = 'high') => ({ requisition_id: id, confidence, reason: '经历涉及对应工艺', evidence: [id === 1 ? 'MBE' : 'ALD'] })

test('role matching includes professional facts and excludes demographics, contacts, names and employers', () => {
  const profile = professionalMatchProfile(source())
  const input = JSON.stringify(profile)
  for (const excluded of ['姓名', '学校', '雇主', '女', '1990', '已婚', '汉族', '13900139000', 'private@example', '住址']) assert.ok(!input.includes(excluded), excluded)
  assert.match(input, /MBE/)
  assert.match(input, /材料物理/)
})

test('recommendations cannot invent jobs or evidence, duplicates and low matches are excluded', () => {
  const profile = professionalMatchProfile(source())
  const good = validateRequisitionMatches({ matches: [proposal(1), proposal(1), proposal(999)], unmatched_reason: '' }, jobs, profile)
  assert.equal(good.length, 1)
  assert.equal(good[0].requisition_id, 1)
  assert.equal(validateRequisitionMatches({ matches: [{ ...proposal(1), evidence: ['原文没有的设备技能'] }, proposal(2, 'low')], unmatched_reason: '' }, jobs, profile).length, 0)
  assert.throws(() => validateRequisitionMatches({}, jobs, profile), /格式不完整/)
})

test('only open jobs with remaining capacity may be selected; approved offers are preserved', () => {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE job_requisitions(id INTEGER PRIMARY KEY,title TEXT,status TEXT,headcount INTEGER,headcount_max INTEGER);
    CREATE TABLE candidates(id INTEGER PRIMARY KEY,requisition_id INTEGER,stage TEXT);
    CREATE TABLE approvals(id INTEGER PRIMARY KEY,ref_type TEXT,ref_id INTEGER,type TEXT,status TEXT);
    INSERT INTO job_requisitions VALUES(1,'open','open',1,2),(2,'draft','draft',1,1),(3,'closed','closed',1,1),(4,'full','open',1,1),(5,'cancelled','cancelled',1,1);
    INSERT INTO candidates VALUES(1,1,'hired'),(2,4,'hired');`)
  assert.deepEqual(availableRequisitions(db).map(row => row.id), [1])
  const candidate = { id: 9, stage: 'new', requisition_id: null }
  assert.equal(validateRequisitionChange(db, candidate, '1'), 1)
  for (const id of [2, 3, 4, 5]) assert.throws(() => validateRequisitionChange(db, candidate, id), error => error.statusCode === 409)
  assert.throws(() => validateRequisitionChange(db, { ...candidate, stage: 'accepted' }, 1), /录用/)
  assert.throws(() => validateRequisitionChange(db, { ...candidate, offer_status: 'approved' }, 1), /Offer/)
  db.prepare("INSERT INTO approvals VALUES(1,'candidate',9,'offer','pending')").run()
  assert.throws(() => validateRequisitionChange(db, candidate, 1), /Offer/)
  assert.equal(validateRequisitionChange(db, { ...candidate, stage: 'hired', requisition_id: 3 }, 3), 3)
  db.close()
})

test('local semantic matching preselects one clear job, leaves ambiguity for review, and bounds catalog batches', { timeout: 10000 }, async t => {
  let mode = 'single', requests = []
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw), data = JSON.parse(body.messages[1].content)
    requests.push({ raw, data })
    const matches = mode === 'single' ? [proposal(data.available_jobs[0].id)] : mode === 'ambiguous' ? data.available_jobs.slice(0, 2).map(job => proposal(job.id)) : []
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ matches, unmatched_reason: '' }) } }] }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const old = { enabled: process.env.RESUME_LOCAL_LLM, base: process.env.RESUME_LOCAL_BASE_URL }
  t.after(() => {
    for (const [key, value] of [['RESUME_LOCAL_LLM', old.enabled], ['RESUME_LOCAL_BASE_URL', old.base]]) if (value === undefined) delete process.env[key]; else process.env[key] = value
    server.closeAllConnections(); server.close()
  })
  Object.assign(process.env, { RESUME_LOCAL_LLM: 'true', RESUME_LOCAL_BASE_URL: `http://127.0.0.1:${server.address().port}/v1` })
  const clear = await matchRequisitions(source(), jobs)
  assert.equal(clear.engine, 'local-llm')
  assert.equal(clear.suggested_requisition_id, 1)
  for (const excluded of ['13900139000', 'private@example', '已婚', '1990-01-01', '具体住址', '不要送给模型']) assert.ok(!requests[0].raw.includes(excluded), excluded)
  mode = 'ambiguous'
  const ambiguous = await matchRequisitions(source(), jobs)
  assert.equal(ambiguous.matches.length, 2)
  assert.equal(ambiguous.suggested_requisition_id, null)
  const before = requests.length
  assert.equal((await matchRequisitions(source(), [])).matches.length, 0)
  assert.equal((await matchRequisitions({ basic: { name: '只有姓名' } }, jobs)).matches.length, 0)
  assert.equal(requests.length, before)
  mode = 'none'
  assert.equal((await matchRequisitions(source(), jobs)).suggested_requisition_id, null)
  requests = []
  const many = Array.from({ length: 31 }, (_, i) => ({ id: i + 1, title: '招聘岗位'.repeat(30), job_family: '工艺方向'.repeat(30), skills: '技能'.repeat(500), responsibilities: '职责'.repeat(500) }))
  await matchRequisitions(source(), many)
  assert.equal(requests.length, 3)
  assert.ok(requests.every(request => request.data.available_jobs.length <= 15 && JSON.stringify(request.data).length < 8500))
})
