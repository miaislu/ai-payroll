import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { normalizeResumeProfile, mergePersonalProfile, resumeResultToken } from '../lib/resume_profile.js'
import { repairLegacyResumeNames } from '../lib/uploads.js'

test('confirmed resume profile covers all personal fields and validates edited histories', () => {
  const profile = normalizeResumeProfile({ basic: { name: '虚构人选', gender: '女', date_of_birth: '1995-03-16', marital_status: '未婚', nationality: '汉族', education_level: '硕士', mobile: '13800138000', personal_email: 'resume@example.invalid', current_address: '上海', skills: 'Python,UVM', monthly_base: '999999' },
    education: [{ school: '虚构大学', qualification: '硕士', major: '电子信息', graduation_year: '2020', note: '论文及项目说明' }],
    work_experience: [{ company: '虚构企业', title: '验证工程师', start_date: '2020-07', end_date: '', note: '完整职责与项目成果' }] })
  assert.equal(Object.keys(profile.basic).length, 10)
  assert.equal(profile.basic.monthly_base, undefined)
  assert.equal(profile.education[0].graduation_year, 2020)
  assert.equal(profile.work_experience[0].note, '完整职责与项目成果')
  assert.throws(() => normalizeResumeProfile({ basic: { personal_email: 'bad' } }), /邮箱/)
  assert.throws(() => normalizeResumeProfile({ basic: { date_of_birth: '2000-02-31' } }), /出生日期/)
  assert.throws(() => normalizeResumeProfile({ work_experience: [{ company: '测试', start_date: '2024-05', end_date: '2020-01' }] }), /结束时间/)
  assert.notEqual(resumeResultToken('before'), resumeResultToken('after'))
})

test('applying a newer parse prefers corrected contacts while keeping absent fields and unmasked phones', () => {
  const old = { basic: { name: '旧姓名', mobile: '13800138000', personal_email: 'old@example.invalid', current_address: '上海' }, education: [{ school: '已核对大学' }], work_experience: [] }
  const merged = mergePersonalProfile(old, normalizeResumeProfile({ basic: { name: '新姓名', mobile: '138****8000', personal_email: 'new@example.invalid' } }))
  assert.equal(merged.basic.name, '新姓名')
  assert.equal(merged.basic.mobile, '13800138000')
  assert.equal(merged.basic.personal_email, 'new@example.invalid')
  assert.equal(merged.basic.current_address, '上海')
  assert.equal(merged.education[0].school, '已核对大学')
})

test('legacy filename repair updates stored records once without changing attachments or valid names', () => {
  const db = new DatabaseSync(':memory:')
  db.exec('CREATE TABLE candidates(id INTEGER PRIMARY KEY,resume_name TEXT,resume_path TEXT); CREATE TABLE employee_resumes(id INTEGER PRIMARY KEY,original_name TEXT,file_path TEXT)')
  const garbled = Buffer.from('中文简历.pdf', 'utf8').toString('latin1')
  db.prepare('INSERT INTO candidates VALUES(1,?,?)').run(garbled, '/unchanged/attachment.pdf')
  db.prepare('INSERT INTO employee_resumes VALUES(1,?,?)').run(garbled, '/unchanged/employee.pdf')
  db.prepare('INSERT INTO employee_resumes VALUES(2,?,?)').run('résumé.docx', '/unchanged/resume.docx')
  assert.equal(repairLegacyResumeNames(db), 2)
  assert.equal(repairLegacyResumeNames(db), 0)
  assert.deepEqual({ ...db.prepare('SELECT resume_name,resume_path FROM candidates').get() }, { resume_name: '中文简历.pdf', resume_path: '/unchanged/attachment.pdf' })
  assert.equal(db.prepare('SELECT original_name FROM employee_resumes WHERE id=2').get().original_name, 'résumé.docx')
  db.close()
})
