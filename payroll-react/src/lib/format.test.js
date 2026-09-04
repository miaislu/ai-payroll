import test from 'node:test'
import assert from 'node:assert/strict'
import { formatWan, formatWanInt, formatYuan, maskPii } from './format.js'

test('formatWan 一位小数万元', () => {
  assert.equal(formatWan(150000), '¥15万')
  assert.equal(formatWan(155000), '¥15.5万')
})

test('formatWanInt 整数万元', () => {
  assert.equal(formatWanInt(180000), '¥18万')
})

test('formatYuan 千分位', () => {
  assert.equal(formatYuan(25000), '¥25,000')
})

test('maskPii 证件与邮箱', () => {
  assert.equal(maskPii('310101199001011234'), '310••••••••1234')
  assert.equal(maskPii('a@example.com'), 'a***@example.com')
  assert.equal(maskPii('330***********1234'), '330***********1234')
  assert.equal(maskPii(''), '')
})
