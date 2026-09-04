// 小公司人力管理系统 · 后端 API（Express + SQLite）
import express from 'express'
import cors from 'cors'
import { seedIfEmpty } from './seed.js'
import { org } from './routes/org.js'
import { recruiting } from './routes/recruiting.js'
import { cost } from './routes/cost.js'
import { employee } from './routes/employee.js'
import { equity } from './routes/equity.js'
import { expense } from './routes/expense.js'
import { auth } from './lib/auth.js'
import { HR_ROLES, OPS_ROLES } from './lib/access.js'
import { authRoutes } from './routes/auth.js'
import { staff } from './routes/staff.js'
import { core } from './routes/core.js'
import { payroll } from './routes/payroll.js'
import { dashboard } from './routes/dashboard.js'
import { copilot } from './routes/copilot.js'
import { option } from './routes/option.js'
import { people } from './routes/people.js'
import { market } from './routes/market.js'

seedIfEmpty()
const app = express()
app.disable('x-powered-by')
app.set('trust proxy', 'loopback')
const configuredOrigins = (process.env.CORS_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean)
const localhostOrigin = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/
const originAllowed = origin => !origin || configuredOrigins.includes(origin) || (process.env.NODE_ENV !== 'production' && localhostOrigin.test(origin))
app.use(cors({
  origin(origin, callback) {
    const allowed = originAllowed(origin)
    callback(allowed ? null : Object.assign(new Error('来源不在 CORS 白名单'), { statusCode: 403 }), allowed)
  },
  credentials: true
}))
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'")
  next()
})
app.use(express.json({ limit: '256kb' }))
app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()
  const origin = req.get('origin')
  const fetchSite = req.get('sec-fetch-site')
  if ((origin && !originAllowed(origin)) || fetchSite === 'cross-site') return res.status(403).json({ error: '拒绝跨站状态变更请求' })
  next()
})

app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }))
app.use('/api', authRoutes)
app.use('/api', staff)
app.use('/api', core)
app.use('/api', payroll)
app.use('/api', dashboard)
app.use('/api', copilot)
app.use('/api', option)
app.use('/api', people)
app.use('/api', market)

app.use('/api', auth(), org)
app.use('/api/recruiting', auth(HR_ROLES), recruiting)
app.use('/api/cost', auth(OPS_ROLES), cost)
app.use('/api/equity', auth(OPS_ROLES), equity)
app.use('/api/employees', auth(HR_ROLES), employee)
app.use('/api/expense', auth(), expense)

app.use((err, req, res, next) => {
  console.error('[server error]', err?.message || err)
  if (res.headersSent) return next(err)
  const status = err?.statusCode || (err?.name === 'MulterError' ? 400 : 500)
  res.setHeader('Content-Type', 'application/json')
  res.status(status).json({ error: status < 500 ? err.message : '服务器内部错误' })
})
process.on('unhandledRejection', reason => {
  console.error('[unhandledRejection]', reason?.message || reason)
})

const PORT = process.env.PORT || 3001
app.listen(PORT, '127.0.0.1', () => console.log(`[backend] 人力 API 运行于 http://127.0.0.1:${PORT}`))
