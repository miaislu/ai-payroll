// 鉴权中间件：仅接受 HttpOnly Cookie 会话（12h）+ 可选角色校验
import { db, sessionTokenHash } from '../db.js'
import { tokenFromRequest } from './cookie.js'

export function auth(roles) {
  return (req, res, next) => {
    const token = tokenFromRequest(req)
    const session = token ? db.prepare('SELECT * FROM sessions WHERE token=?').get(sessionTokenHash(token)) : null
    if (!session || session.expires_at < Date.now()) return res.status(401).json({ error: '未登录或会话过期' })
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(session.user_id)
    if (!user) return res.status(401).json({ error: '用户不存在' })
    if (roles && !roles.includes(user.role)) return res.status(403).json({ error: '无权限' })
    req.user = user
    req.sessionToken = token
    next()
  }
}
