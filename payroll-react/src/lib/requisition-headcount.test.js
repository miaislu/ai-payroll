import test from 'node:test'
import assert from 'node:assert/strict'
import { changeRequisitionHeadcount, requisitionHeadcountError } from './requisition-headcount.js'

test('待定需求从零增加基准，以及提高到原上限以上，自动保持可保存的编制范围', () => {
  for (const [base, maximum, next] of [[0, 0, 1], [1, 1, 3], [1, 2, 4]]) {
    const form = changeRequisitionHeadcount({ headcount: base, headcount_max: maximum }, 'headcount', String(next))
    assert.equal(form.headcount, next)
    assert.equal(form.headcount_max, next)
    assert.equal(requisitionHeadcountError(form), '')
  }
})

test('已有较高上限保持不变；降低基准不缩减弹性名额；零编制正常保存', () => {
  assert.deepEqual(changeRequisitionHeadcount({ headcount: 1, headcount_max: 5 }, 'headcount', '3'), { headcount: 3, headcount_max: 5 })
  const form = changeRequisitionHeadcount({ headcount: 3, headcount_max: 5 }, 'headcount', '0')
  assert.deepEqual(form, { headcount: 0, headcount_max: 5 })
  assert.equal(requisitionHeadcountError(form), '')
  assert.equal(requisitionHeadcountError({ headcount: 0, headcount_max: 0 }), '')
})

test('清空输入、非整数和越界值不能保存，主动调低上限时提示具体原因', () => {
  for (const value of ['', null, -1, 1.5, 1001]) {
    assert.ok(requisitionHeadcountError({ headcount: value, headcount_max: 5 }))
    assert.ok(requisitionHeadcountError({ headcount: 0, headcount_max: value }))
  }
  const form = changeRequisitionHeadcount({ headcount: 3, headcount_max: 5 }, 'headcount_max', '2')
  assert.match(requisitionHeadcountError(form), /不能低于/)
  const empty = changeRequisitionHeadcount({ headcount: 1, headcount_max: 2 }, 'headcount', '')
  assert.equal(empty.headcount, '')
  assert.ok(requisitionHeadcountError(empty))
})
