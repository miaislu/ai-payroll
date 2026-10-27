import test from 'node:test'
import assert from 'node:assert/strict'
import { interviewOutcomeLabel } from './interview-outcome.js'

test('完成但未通过的面试与取消面试明确区分', () => {
  assert.equal(interviewOutcomeLabel({ status: 'completed', result: 'not_recommend' }), '已完成 · 未通过')
  assert.equal(interviewOutcomeLabel({ status: 'completed', result: 'fail' }), '已完成 · 未通过')
  assert.equal(interviewOutcomeLabel({ status: 'completed', result: 'recommend' }), '已完成 · 通过')
  assert.equal(interviewOutcomeLabel({ status: 'completed', result: 'pending' }), '已完成 · 待定')
  assert.equal(interviewOutcomeLabel({ status: 'cancelled', result: 'pending' }), '已取消')
})
