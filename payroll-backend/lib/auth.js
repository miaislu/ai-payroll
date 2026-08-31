// 鉴权中间件：会话 token（12h 过期）+ 可选角色校验
// 用法：app.use('/api', auth()) 仅需登录；auth(['hr','founder']) 限定角色
import { db } from '../db.js'

export function auth(roles) {
  return (req, res, next) => {
    const t = (req.headers.authorization || '').replace('Bearer ', '')
    const s = db.prepare('SELECT * FROM sessions WHERE token=?').get(t)
    if (!s || s.expires_at < Date.now()) return res.status(401).json({ error: '未登录或会话过期' })
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(s.user_id)
    if (!u) return res.status(401).json({ error: '用户不存在' })
    if (roles && !roles.includes(u.role)) return res.status(403).json({ error: '无权限' })
    req.user = u
    next()
  }
}
