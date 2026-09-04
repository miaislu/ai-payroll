import test from 'node:test'
import assert from 'node:assert/strict'
import { parseCookieHeader, tokenFromRequest, sessionCookieHeader, SESSION_COOKIE } from '../lib/cookie.js'

test('parseCookieHeader 读取指定 cookie', () => {
  assert.equal(parseCookieHeader(`${SESSION_COOKIE}=abc123; other=1`), 'abc123')
  assert.equal(parseCookieHeader('a=1; payroll_session=tok%2Fen'), 'tok/en')
  assert.equal(parseCookieHeader(''), '')
})

test('tokenFromRequest 只接受 HttpOnly Cookie，不接受 Authorization 旁路', () => {
  assert.equal(tokenFromRequest({ headers: { authorization: 'Bearer abc', cookie: `${SESSION_COOKIE}=fromcookie` } }), 'fromcookie')
  assert.equal(tokenFromRequest({ headers: { cookie: `${SESSION_COOKIE}=fromcookie` } }), 'fromcookie')
  assert.equal(tokenFromRequest({ headers: {} }), '')
})

test('sessionCookieHeader 含 HttpOnly 且严格同站', () => {
  const header = sessionCookieHeader('tok', { secure: false })
  assert.match(header, /payroll_session=tok/)
  assert.match(header, /HttpOnly/)
  assert.match(header, /SameSite=Strict/)
})
