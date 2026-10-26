import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { localModelConfig, localResumeStatus, parseWithLocalModel, validateModelResume, resumeChunks, mergeResumeParts } from '../lib/local_resume_model.js'
import { parseResume } from '../lib/resume_parser.js'
import { resumeOriginalName } from '../lib/uploads.js'

const sample = () => ({
  basic: { name: '虚构测试员', gender: '', date_of_birth: '', marital_status: '', nationality: '', education_level: '', mobile: '13800138000', personal_email: 'test@example.invalid', current_address: '上海', skills: 'UVM,Python' },
  education: [{ school: '虚构大学', qualification: '硕士', major: '电子工程', note: '', graduation_year: 2020 }],
  work_experience: [{ company: '虚构测试有限公司', title: '验证工程师', start_date: '2020-07', end_date: '', note: '搭建回归流程' }]
})

test('resume filenames retain Chinese and existing Latin-1 names', () => {
  assert.equal(resumeOriginalName(Buffer.from('中文简历.xlsx', 'utf8').toString('latin1')), '中文简历.xlsx')
  assert.equal(resumeOriginalName('中文简历.xlsx'), '中文简历.xlsx')
  assert.equal(resumeOriginalName('résumé.pdf'), 'résumé.pdf')
  assert.equal(resumeOriginalName('C:\\fakepath\\resume.pdf'), 'resume.pdf')
})

test('local resume config rejects remote, credentials and alternate protocols', () => {
  for (const base of ['https://127.0.0.1/v1', 'http://localhost:1234/v1', 'http://example.com/v1', 'http://127.0.0.1.evil.test/v1', 'http://user:pass@127.0.0.1/v1', 'file:///tmp/model', 'http://127.0.0.1/v1?url=https://remote']) {
    assert.throws(() => localModelConfig({ RESUME_LOCAL_LLM: 'true', RESUME_LOCAL_BASE_URL: base }), /本机回环/)
  }
  assert.throws(() => localModelConfig({}), /尚未启用/)
  assert.equal(localModelConfig({ RESUME_LOCAL_LLM: 'true' }).model, 'hr-resume-qwen3-vl-8b')
})

test('model result validates structure and normalizes invalid dates without inventing missing facts', () => {
  const value = sample()
  value.basic.date_of_birth = '2000-02-31'
  value.work_experience[0].start_date = '2020-13'
  const parsed = validateModelResume(value)
  assert.equal(parsed.basic.date_of_birth, '')
  assert.equal(parsed.work_experience[0].start_date, '')
  assert.equal(parsed.basic.education_level, '硕士')
  assert.equal(parsed.basic.mobile, '13800138000')
  value.work_experience[0].start_date = '2022.7'
  assert.equal(validateModelResume(value).work_experience[0].start_date, '2022-07')
  assert.throws(() => validateModelResume({ basic: {}, education: {}, work_experience: [] }), /结构不完整/)
  value.basic.skills = ['Python']
  assert.throws(() => validateModelResume(value), /结构不完整/)
})

test('long resumes preserve tail and merge overlap without duplicate work rows', () => {
  const text = Array.from({ length: 800 }, (_, i) => `段落${i}：项目成果和职责。`).join('\n')
  const chunks = resumeChunks(text)
  assert.ok(chunks.length > 1)
  assert.ok(chunks.every(chunk => chunk.length <= 6000))
  assert.ok(chunks.at(-1).endsWith('段落799：项目成果和职责。'))
  for (const line of text.split('\n')) assert.ok(chunks.some(chunk => chunk.includes(line)), line)
  const first = sample(), second = sample()
  second.basic.skills = 'UVM,C++'
  second.work_experience[0].note = '覆盖率达到98%'
  const merged = mergeResumeParts([first, second])
  assert.equal(merged.work_experience.length, 1)
  assert.match(merged.work_experience[0].note, /搭建回归流程\n覆盖率达到98%/)
  assert.equal(merged.basic.skills, 'UVM,Python,C++')
  assert.throws(() => resumeChunks('x'.repeat(24001)), /24000/)
})

test('local model health, successful parsing, busy, malformed, timeout, redirect and no fallback', { timeout: 12000 }, async t => {
  let mode = 'ok', calls = 0, received
  const server = http.createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    if (req.url === '/v1/models') {
      res.setHeader('Content-Type', 'application/json')
      return res.end(JSON.stringify({ data: mode === 'missing' ? [] : [{ id: 'unit-resume-model' }] }))
    }
    calls++; received = JSON.parse(body)
    if (mode === 'redirect') { res.writeHead(307, { Location: 'http://example.invalid/' }); return res.end() }
    if (mode === 'error') { res.writeHead(500); return res.end('private server diagnostic') }
    if (mode === 'slow' || mode === 'timeout') await new Promise(resolve => setTimeout(resolve, 1200))
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ choices: [{ finish_reason: mode === 'length' ? 'length' : 'stop', message: { content: mode === 'malformed' ? 'not json' : JSON.stringify(mode === 'badshape' ? {} : sample()) } }] }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const keys = ['RESUME_LOCAL_LLM', 'RESUME_LOCAL_BASE_URL', 'RESUME_LOCAL_MODEL', 'RESUME_LOCAL_TIMEOUT_MS']
  const old = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  t.after(() => { for (const key of keys) { if (old[key] === undefined) delete process.env[key]; else process.env[key] = old[key] } server.closeAllConnections(); server.close() })
  Object.assign(process.env, { RESUME_LOCAL_LLM: 'true', RESUME_LOCAL_BASE_URL: `http://127.0.0.1:${server.address().port}/v1`, RESUME_LOCAL_MODEL: 'unit-resume-model', RESUME_LOCAL_TIMEOUT_MS: '3000' })
  assert.equal((await localResumeStatus()).available, true)
  const parsed = await parseResume('虚构测试简历', { mode: 'local_model' })
  assert.equal(parsed.engine, 'local-llm')
  assert.equal(parsed.model, 'unit-resume-model')
  assert.equal(parsed.work_experience[0].company, '虚构测试有限公司')
  assert.equal(received.response_format.type, 'json_schema')
  assert.equal(received.model, 'unit-resume-model')
  assert.match(received.messages[1].content, /虚构测试简历/)
  const before = calls
  assert.equal((await parseResume('姓名：李测试', { mode: 'rules', allowExternal: true })).engine, 'rules-local')
  assert.equal(calls, before)
  mode = 'missing'
  assert.equal((await localResumeStatus()).available, false)
  mode = 'slow'
  const pending = parseWithLocalModel('虚构简历')
  await assert.rejects(parseWithLocalModel('另一份简历'), error => error.statusCode === 429)
  assert.equal((await localResumeStatus()).busy, true)
  await pending
  for (const failure of ['malformed', 'badshape', 'length', 'error', 'redirect', 'timeout']) {
    mode = failure
    process.env.RESUME_LOCAL_TIMEOUT_MS = failure === 'timeout' ? '1000' : '3000'
    await assert.rejects(parseResume('虚构简历', { mode: 'local_model' }), error => error.statusCode >= 500)
    assert.equal((await localResumeStatus()).busy, false)
  }
  await assert.rejects(parseResume('test', { mode: 'remote' }), error => error.statusCode === 400)
})
