import test from 'node:test'
import assert from 'node:assert/strict'
import { parseHash, toHash, resolvePage } from './hash-route.js'
import { CAN_APPROVE } from '../data.js'

test('parseHash 员工档案深链', () => {
  assert.deepEqual(parseHash('#/employee-profile/12'), { page: 'employee-profile', empId: 12 })
  assert.deepEqual(parseHash('#/payroll'), { page: 'payroll', empId: null })
  assert.equal(parseHash('#/not-a-page').page, 'dashboard')
})

test('toHash 与 parseHash 往返', () => {
  assert.equal(toHash('settings'), '#/settings')
  assert.equal(toHash('employee-profile', 3), '#/employee-profile/3')
  assert.deepEqual(parseHash(toHash('copilot')), { page: 'copilot', empId: null })
})

test('resolvePage 按角色收敛', () => {
  assert.deepEqual(resolvePage('emp', 'payroll'), { page: 'dashboard', empId: null })
  assert.deepEqual(resolvePage('emp', 'attendance'), { page: 'attendance', empId: null })
  assert.deepEqual(resolvePage('founder', 'employee-profile', 7), { page: 'employee-profile', empId: 7 })
  assert.deepEqual(resolvePage('founder', 'employee-profile'), { page: 'employees', empId: null })
  assert.deepEqual(resolvePage('hr', 'settings'), { page: 'settings', empId: null })
  assert.deepEqual(resolvePage('finance', 'payroll'), { page: 'payroll', empId: null })
  assert.deepEqual(resolvePage('finance', 'recruiting'), { page: 'dashboard', empId: null })
})

test('带宽 HR/CEO，发钱类财务/CEO', () => {
  assert.equal(CAN_APPROVE('hr', 'band'), true)
  assert.equal(CAN_APPROVE('hr', 'raise'), false)
  assert.equal(CAN_APPROVE('finance', 'raise'), true)
  assert.equal(CAN_APPROVE('finance', 'band'), false)
  assert.equal(CAN_APPROVE('founder', 'offer'), true)
  assert.equal(CAN_APPROVE('emp', 'raise'), false)
})
