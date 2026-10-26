import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeResumeProfile } from './resume-profile.js'

test('review form uses newly recognized contacts and keeps existing data for missing fields', () => {
  const original = { basic: { name: '旧姓名', mobile: '13800138000', personal_email: 'old@example.invalid', current_address: '上海' }, education: [{ school: '已核对大学' }], work_experience: [] }
  const edited = mergeResumeProfile(original, { basic: { name: '新姓名', mobile: '13900139000', personal_email: 'new@example.invalid', current_address: '' }, work_experience: [{ company: '新识别公司', note: '完整项目经历' }] })
  assert.equal(edited.basic.mobile, '13900139000')
  assert.equal(edited.basic.personal_email, 'new@example.invalid')
  assert.equal(edited.basic.current_address, '上海')
  assert.equal(edited.education[0].school, '已核对大学')
  assert.equal(edited.work_experience[0].note, '完整项目经历')
  assert.equal(mergeResumeProfile(original, { basic: { mobile: '138****8000' } }).basic.mobile, '13800138000')
})
