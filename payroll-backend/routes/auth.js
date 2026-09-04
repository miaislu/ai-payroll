import { Router } from 'express'
import { audit, createSession, db, destroySession, hashPassword, inTransaction, verifyPassword } from '../db.js'
import { auth } from '../lib/auth.js'
import { publicUser } from '../lib/access.js'
import { clearSessionCookieHeader, sessionCookieHeader, tokenFromRequest } from '../lib/cookie.js'

export const authRoutes = Router()

const loginAttempts = new Map()
const MAX_LOGIN_FAILS = 5
const LOGIN_LOCK_MS = 15 * 60 * 1000
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000
  for (const [key, value] of loginAttempts) if ((value.lastAt || 0) < cutoff && value.lockedUntil < Date.now()) loginAttempts.delete(key)
}, 10 * 60 * 1000).unref()

authRoutes.post('/auth/login', (req, res) => {
  const { username, password } = req.body || {}
  if (!username || !password) return res.status(400).json({ error: '缺少用户名或密码' })
  const key = `${req.ip || 'unknown'}:${String(username).trim().toLowerCase()}`
  const now = Date.now()
  const rec = loginAttempts.get(key)
  if (rec && rec.lockedUntil > now) {
    return res.status(429).json({ error: `尝试过于频繁，请 ${Math.ceil((rec.lockedUntil - now) / 60000)} 分钟后重试` })
  }
  const u = db.prepare('SELECT * FROM users WHERE username=?').get(String(username).trim())
  if (!u || !verifyPassword(String(password), u.password_hash)) {
    const r = rec || { count: 0, lockedUntil: 0, lastAt: now }
    r.count++
    r.lastAt = now
    if (r.count >= MAX_LOGIN_FAILS) { r.lockedUntil = now + LOGIN_LOCK_MS; r.count = 0 }
    if (!loginAttempts.has(key) && loginAttempts.size >= 10000) {
      const oldest = [...loginAttempts.entries()].sort((a, b) => (a[1].lastAt || 0) - (b[1].lastAt || 0))[0]?.[0]
      if (oldest) loginAttempts.delete(oldest)
    }
    loginAttempts.set(key, r)
    return res.status(401).json({ error: '用户名或密码错误' })
  }
  loginAttempts.delete(key)
  const token = createSession(u.id)
  res.setHeader('Set-Cookie', sessionCookieHeader(token, req))
  res.json(publicUser(u))
})

authRoutes.get('/auth/me', auth(), (req, res) => {
  res.json(publicUser(req.user))
})

authRoutes.post('/auth/logout', (req, res) => {
  destroySession(req.sessionToken || tokenFromRequest(req))
  res.setHeader('Set-Cookie', clearSessionCookieHeader(req))
  res.json({ ok: true })
})

authRoutes.get('/users', auth(['founder']), (req, res) => {
  res.json(db.prepare('SELECT id,username,role,name,employee_id FROM users ORDER BY id').all())
})

authRoutes.post('/users', auth(['founder']), (req, res) => {
  const { username, password, role, name, employee_id = null } = req.body || {}
  if (!/^[A-Za-z0-9_.-]{3,40}$/.test(String(username || ''))) return res.status(400).json({ error: '用户名须为 3-40 位字母、数字或 _.-' })
  if (String(password || '').length < 12) return res.status(400).json({ error: '密码至少 12 位' })
  if (!['founder', 'hr', 'finance', 'emp'].includes(role)) return res.status(400).json({ error: '角色不合法' })
  if (!String(name || '').trim()) return res.status(400).json({ error: '姓名必填' })
  if (role === 'emp' && (!employee_id || !db.prepare('SELECT id FROM employees WHERE id=?').get(employee_id))) return res.status(400).json({ error: '员工账号必须关联有效员工档案' })
  try {
    const result = db.prepare('INSERT INTO users(username,password_hash,role,name,employee_id) VALUES(?,?,?,?,?)').run(username, hashPassword(password), role, String(name).trim(), employee_id || null)
    audit(req.user, 'create', 'user', result.lastInsertRowid, null, { username, role, name, employee_id })
    res.json({ ok: true, id: result.lastInsertRowid })
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) return res.status(409).json({ error: '用户名已存在' })
    throw error
  }
})

authRoutes.post('/users/:id/reset-password', auth(['founder']), (req, res) => {
  const password = String(req.body?.password || '')
  if (password.length < 12) return res.status(400).json({ error: '密码至少 12 位' })
  const changed = db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(password), req.params.id)
  if (!changed.changes) return res.status(404).json({ error: '账号不存在' })
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(req.params.id)
  audit(req.user, 'reset_password', 'user', req.params.id, null, { sessions_revoked: true })
  res.json({ ok: true })
})

authRoutes.delete('/users/:id', auth(['founder']), (req, res) => {
  if (Number(req.params.id) === req.user.id) return res.status(409).json({ error: '不能删除当前登录账号' })
  const before = db.prepare('SELECT id,username,role,name,employee_id FROM users WHERE id=?').get(req.params.id)
  if (!before) return res.status(404).json({ error: '账号不存在' })
  inTransaction(() => {
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(req.params.id)
    db.prepare('DELETE FROM users WHERE id=?').run(req.params.id)
    audit(req.user, 'delete', 'user', req.params.id, before, null)
  })
  res.json({ ok: true })
})
