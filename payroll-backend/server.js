// AI 薪酬管理系统 · 后端 API（Express + SQLite）
import express from 'express'
import cors from 'cors'
import { randomUUID } from 'node:crypto'
import { db, seedIfEmpty, verifyPassword, createSession } from './db.js'
import { benchmarkCard, optionMetrics, optionSensitivity } from './lib/calc.js'
import { chat, llmConfigured, LLM_MODEL, LLM_BASE } from './lib/llm.js'
import { retrieve, buildContext, contextSources, COPILOT_SYSTEM } from './lib/rag.js'
import { socialFund, computeMonthFallback } from './lib/payroll.js'
import { detectCity, cityContext, KNOWN_CITIES } from './lib/city_policies.js'
import { DIRECTIONS_KEYS, CITY_KEYS, validateEmployee } from './lib/validators.js'

seedIfEmpty()
const app = express()
app.use(cors())
app.use(express.json())

// ── 鉴权：会话表 token（12h 过期）──
function auth(roles) {
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

// ── 健康检查 ──
app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }))

// ── 登录（用户名 + 密码）──
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {}
  if (!username || !password) return res.status(400).json({ error: '缺少用户名或密码' })
  const u = db.prepare('SELECT * FROM users WHERE username=?').get(String(username).trim())
  if (!u || !verifyPassword(String(password), u.password_hash)) {
    return res.status(401).json({ error: '用户名或密码错误' })
  }
  res.json({ token: createSession(u.id), role: u.role, name: u.name, username: u.username })
})
app.post('/api/auth/logout', auth(), (req, res) => {
  const t = (req.headers.authorization || '').replace('Bearer ', '')
  db.prepare('DELETE FROM sessions WHERE token=?').run(t)
  res.json({ ok: true })
})

// ── 员工 ──
app.get('/api/employees', auth(), (req, res) => {
  res.json(db.prepare('SELECT * FROM employees ORDER BY id').all())
})
app.post('/api/employees', auth(['hr', 'founder']), (req, res) => {
  const { errors, e } = validateEmployee(req.body || {})
  if (errors.length) return res.status(400).json({ error: errors.join('；') })
  const r = db.prepare('INSERT INTO employees(name,grade,job_family,city,monthly_base,perf_ratio,special_deduction,hire_month) VALUES(?,?,?,?,?,?,?,?)')
    .run(e.name, e.grade, e.job_family, e.city, e.monthly_base, e.perf_ratio, e.special_deduction, e.hire_month)
  res.json({ ok: true, id: r.lastInsertRowid })
})
app.put('/api/employees/:id', auth(['hr', 'founder']), (req, res) => {
  const { errors, e } = validateEmployee(req.body || {})
  if (errors.length) return res.status(400).json({ error: errors.join('；') })
  const r = db.prepare('UPDATE employees SET name=?,grade=?,job_family=?,city=?,monthly_base=?,perf_ratio=?,special_deduction=?,hire_month=? WHERE id=?')
    .run(e.name, e.grade, e.job_family, e.city, e.monthly_base, e.perf_ratio, e.special_deduction, e.hire_month, req.params.id)
  if (!r.changes) return res.status(404).json({ error: '员工不存在' })
  res.json({ ok: true, id: Number(req.params.id) })
})
app.delete('/api/employees/:id', auth(['hr', 'founder']), (req, res) => {
  const r = db.prepare('DELETE FROM employees WHERE id=?').run(req.params.id)
  if (!r.changes) return res.status(404).json({ error: '员工不存在' })
  res.json({ ok: true, id: Number(req.params.id) })
})

// ── 对标 ──
app.get('/api/benchmarks/directions', auth(), (req, res) => {
  res.json(db.prepare('SELECT direction,p25,p50,p75,rarity,sample,trend,evidence FROM benchmarks ORDER BY id').all())
})
app.get('/api/benchmarks', auth(), (req, res) => {
  const { direction, city = '上海', exp = '3-5年', type = 'Fabless', stage = 'B轮' } = req.query
  const row = db.prepare('SELECT * FROM benchmarks WHERE direction=?').get(direction)
  if (!row) return res.status(404).json({ error: '方向不存在: ' + direction })
  res.json({ ...benchmarkCard(row, city, exp, type, stage), direction: row.direction, evidence: row.evidence })
})

// ── 审批 ──
app.get('/api/approvals', auth(), (req, res) => {
  res.json(db.prepare("SELECT * FROM approvals ORDER BY (status='pending') DESC, id").all())
})
app.post('/api/approvals/:id/action', auth(['founder']), (req, res) => {
  const { action, key } = req.body || {}
  if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: 'action 须为 approve/reject' })
  const status = action === 'approve' ? 'approved' : 'rejected'
  db.prepare('UPDATE approvals SET status=?, key=COALESCE(?, key) WHERE id=?').run(status, key || null, req.params.id)
  res.json({ ok: true, id: req.params.id, status })
})

// ── 算薪（读取规则引擎生成的工资单表 + 校验）──
app.get('/api/payroll/:period', auth(), (req, res) => {
  const period = req.params.period
  let rows = db.prepare('SELECT * FROM payroll WHERE period=? ORDER BY employee_id').all(period)
  let fallback = false
  if (!rows.length) {
    // 历史种子外的月份：单月兜底（月度预扣口径，标注简化）
    const emps = db.prepare('SELECT * FROM employees').all()
    rows = computeMonthFallback(period, emps).map(r => ({
      period: r.period, employee_id: r.employee_id, name: r.name, grade: r.grade, status: r.status,
      base: r.base, perf: r.perf, ot: r.ot, social: r.social, fund: r.fund, tax: r.tax, net: r.net, flags: JSON.stringify(r.flags), category: r.category
    }))
    fallback = true
  }
  const cats = db.prepare('SELECT id, category FROM employees').all()
  const catMap = Object.fromEntries(cats.map(c => [c.id, c.category]))
  const list = rows.map(r => ({
    name: r.name, grade: r.grade, status: r.status, category: r.category || catMap[r.employee_id] || 'tech',
    base: r.status === 'departed' ? '离职结算' : r.base.toLocaleString('zh-CN'),
    perf: r.perf ? r.perf.toLocaleString('zh-CN') : '', ot: r.ot ? r.ot.toLocaleString('zh-CN') : '',
    sf: (-(r.social + r.fund)).toLocaleString('zh-CN'), tax: (-r.tax).toLocaleString('zh-CN'),
    net: r.net.toLocaleString('zh-CN'),
    flags: JSON.parse(r.flags || '[]')
  }))
  const total = rows.reduce((s, r) => s + r.net, 0)
  res.json({ period, rows: list, total: total.toLocaleString('zh-CN'), count: list.length, fallback })
})
app.post('/api/payroll/:period/submit', auth(['hr']), (req, res) => res.json({ ok: true, period: req.params.period, status: 'submitted' }))

// ── 申报导出：真实格式文件（个税扣缴/社保申报/银行代发）──
function fmtCsv(rows) {
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
  return '\uFEFF' + rows.map(r => r.map(esc).join(',')).join('\r\n') // BOM 便于 Excel 打开中文
}
app.get('/api/payroll/:period/export/:type', auth(['hr', 'founder']), (req, res) => {
  const { period, type } = req.params
  const rows = db.prepare("SELECT * FROM payroll WHERE period=? AND status!='departed' ORDER BY employee_id").all(period)
  if (!rows.length) return res.status(404).json({ error: '该月无工资单数据' })
  let csv = '', filename = ''
  if (type === 'tax') {
    filename = `个税扣缴申报-${period}.csv`
    csv = fmtCsv([
      ['姓名', '证件号码', '收入额', '基本减除费用', '专项扣除(社保公积金)', '专项附加扣除', '应纳税所得额', '适用税率', '速算扣除数', '应纳税额', '实发工资'],
      ...rows.map(r => [r.name, r.name === '张三' ? '3101***********1234' : '3101***********5678', r.base + r.perf + r.ot, 5000, r.social + r.fund, 0, Math.max(0, r.base + r.perf + r.ot - 5000 - r.social - r.fund), '—', '—', r.tax, r.net])
    ])
  } else if (type === 'social') {
    filename = `社保公积金申报-${period}.csv`
    const rowsWithCity = db.prepare("SELECT p.*, e.city FROM payroll p JOIN employees e ON p.employee_id=e.id WHERE p.period=? AND p.status!='departed' ORDER BY p.employee_id").all(period)
    csv = fmtCsv([
      ['姓名', '城市', '缴费基数(封顶后)', '养老(8%)', '医疗(2%)', '失业(0.3%)', '工伤(0)', '生育(0)', '公积金(7%)', '个人合计'],
      ...rowsWithCity.map(r => {
        const cb = socialFund(r.base, r.city).base
        return [r.name, r.city, cb, Math.round(cb * 0.08), Math.round(cb * 0.02), Math.round(cb * 0.003), 0, 0, Math.round(cb * 0.07), r.social + r.fund]
      })
    ])
  } else if (type === 'bank') {
    filename = `银行代发-${period}.csv`
    csv = fmtCsv([
      ['序号', '姓名', '银行卡号', '金额', '备注'],
      ...rows.map((r, i) => [i + 1, r.name, r.name === '张三' ? '6225***********1234' : '6225***********5678', r.net, `${period} 工资`])
    ])
  } else return res.status(400).json({ error: 'type 须为 tax/social/bank' })
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
  res.send(csv)
})

// ── 仪表盘（真实数据：员工 + 工资单）──
function periodTotal(period) {
  return db.prepare('SELECT COALESCE(SUM(net),0) t FROM payroll WHERE period=?').get(period).t
}
function bandOf(jobFamily) {
  return db.prepare('SELECT * FROM benchmarks WHERE direction=?').get(jobFamily)
}
app.get('/api/dashboard/summary', auth(), (req, res) => {
  const period = req.query.period || '2025-06'
  const prev = prevPeriod(period)
  const cur = periodTotal(period), before = periodTotal(prev)
  const mom = before ? Math.round((cur - before) / before * 1000) / 10 : 0
  // 归因（各项之和 = 环比增量）
  const newHire = db.prepare("SELECT COALESCE(SUM(net),0) n FROM payroll WHERE period=? AND employee_id IN (SELECT id FROM employees WHERE hire_month=?)").get(period, period).n
  const severance = db.prepare("SELECT COALESCE(SUM(net),0) n FROM payroll WHERE period=? AND status='departed'").get(period).n
  // 社保基数调整影响：该月带调整标记员工 vs 上月同批员工 的净额变化（近似缴存变化）
  const adjCur = db.prepare("SELECT COALESCE(SUM(p.net),0) n FROM payroll p JOIN employees e ON p.employee_id=e.id WHERE p.period=? AND e.flag='社保基数调整'").get(period).n
  const adjPrev = db.prepare("SELECT COALESCE(SUM(p.net),0) n FROM payroll p JOIN employees e ON p.employee_id=e.id WHERE p.period=? AND e.flag='社保基数调整'").get(prev).n
  const socialAdj = adjCur - adjPrev
  const other = cur - before - newHire - severance - socialAdj
  // 带宽穿透率：年薪超过带宽 P75 的员工占比
  const emps = db.prepare("SELECT * FROM employees WHERE status='active'").all()
  let over = 0
  for (const e of emps) {
    const b = bandOf(e.job_family)
    if (b && e.monthly_base * 12 > b.p75 * 10000 * 1.1) over++
  }
  const headcount = emps.length
  const wan = v => Math.round(v / 100 / 10 * 10) / 10
  // 人事指标（创始人视角）：员工总数 / 待入职 / 待离职 / 发offer
  const offers = db.prepare("SELECT COUNT(*) c FROM employees WHERE status='offer'").get().c
  const pendingHires = db.prepare("SELECT COUNT(*) c FROM employees WHERE hire_month>? AND status!='departed'").get(period).c
  const pendingLeavers = db.prepare("SELECT COUNT(*) c FROM employees WHERE status='active' AND leave_month>?").get(period).c
  const byCategory = db.prepare("SELECT category, COUNT(*) c FROM employees WHERE status='active' GROUP BY category").all()
  res.json({
    period, total: cur, prev: before, mom,
    headcount, penetration: headcount ? Math.round(over / headcount * 1000) / 10 : 0,
    people: { headcount, pendingHires, pendingLeavers, offers, byCategory },
    attribution: {
      newHire: wan(newHire), severance: wan(severance), socialAdj: wan(socialAdj), other: wan(other),
      deltaWan: wan(cur - before)
    }
  })
})
app.get('/api/dashboard/trend', auth(), (req, res) => {
  const months = Number(req.query.months) || 6
  const list = db.prepare('SELECT period, SUM(net) total, COUNT(*) c FROM payroll GROUP BY period ORDER BY period DESC LIMIT ?').all(months)
  res.json(list.reverse().map(r => ({ period: r.period, label: r.period.slice(5).replace('-', '月') + '月', value: Math.round(r.total / 10000 * 10) / 10, count: r.c })))
})
app.get('/api/dashboard/distribution', auth(), (req, res) => {
  const category = req.query.category || 'all'
  const emps = db.prepare("SELECT * FROM employees WHERE status='active'" + (category !== 'all' ? ' AND category=?' : '')).all(...(category !== 'all' ? [category] : []))
  const byGrade = {}
  for (const e of emps) {
    byGrade[e.grade] = byGrade[e.grade] || { sum: 0, n: 0 }
    byGrade[e.grade].sum += e.monthly_base
    byGrade[e.grade].n++
  }
  const data = Object.entries(byGrade).sort().map(([g, v]) => ({ label: g, value: Math.round(v.sum / v.n / 1000 * 10) / 10 }))
  const ref = bandOf('模拟IC设计')
  res.json({ data, refP50: ref ? ref.p50 : null, category, count: emps.length })
})
app.get('/api/dashboard/attrition', auth(), (req, res) => {
  const emps = db.prepare("SELECT * FROM employees WHERE status='active'").all()
  const list = []
  for (const e of emps) {
    const b = bandOf(e.job_family)
    const annual = e.monthly_base * 12 / 10000
    const below = b ? annual < b.p50 * 0.85 : false
    if (e.flag === '留才预警' || below) list.push({ name: e.name, job_family: e.job_family, annual: Math.round(annual), p50: b ? b.p50 : null, risk: e.flag === '留才预警' ? '高' : '中' })
  }
  res.json(list)
})
app.get('/api/dashboard/forecast', auth(), (req, res) => {
  const target = Number(req.query.target) || 60
  const cur = periodTotal('2025-06')
  const headcount = db.prepare("SELECT COUNT(*) c FROM employees WHERE status='active'").get().c
  const monthly = Math.round(cur * target / headcount / 10000 * 10) / 10
  res.json({ target, currentHeadcount: headcount, monthlyCostWan: monthly, note: '线性外推：月成本 ≈ 当前月成本 × 目标人数 / 现有人数（未计入带宽结构变化）' })
})
function prevPeriod(period) {
  const [y, m] = period.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

// ── 薪酬单（当前登录用户本人；MVP 固定返回张三，数据来自真实工资单）──
app.get('/api/payslip/me', auth(), (req, res) => {
  const e = db.prepare("SELECT * FROM employees WHERE name='张三'").get()
  const r = db.prepare("SELECT * FROM payroll WHERE period='2025-06' AND employee_id=?").get(e.id)
  const fund = r.fund, social = r.social
  res.json({
    employee: { name: e.name, grade: e.grade, job_family: e.job_family },
    period: '2025-06',
    items: [
      { label: '基本工资', value: r.base.toLocaleString('zh-CN') },
      { label: '绩效奖金', value: r.perf.toLocaleString('zh-CN') },
      { label: '加班费', value: r.ot ? r.ot.toLocaleString('zh-CN') : '0' },
      { label: '社保（个人）', value: (-social).toLocaleString('zh-CN') },
      { label: '公积金（个人）', value: (-fund).toLocaleString('zh-CN') },
      { label: '个人所得税（累计预扣）', value: (-r.tax).toLocaleString('zh-CN') }
    ],
    net: r.net.toLocaleString('zh-CN'),
    ai_note: '个税按累计预扣法计算（全年累计收入减累计扣除后套用年度税率表，再减已预扣）。本月社保基数已按 2025 年新基数调整。',
    option: { granted: 100000, strike: 0.5, vested: '25%', est_value: '≈ 52.5 万（未扣税）' }
  })
})

// ── Copilot（RAG + 真实 LLM，LLM 未配置/失败时降级规则 KB）──
const KB = [
  { k: ['试用期', '社保'], a: '按制度第 3 条：试用期工资 ≥ 转正工资的 80% 且不低于当地最低工资。社保公积金按员工所在城市当年基数与比例执行（见城市政策参数表：上海 2025 社保下限 7460、合肥最低基数 4227 等；未收录城市需人工核实）。个人比例参考：养老 8%、医疗 2%、失业 0.3%。\n试用期按实际工资申报缴费。', s: '来源：薪酬制度 v3.2 P3 · 城市政策参数表' },
  { k: ['加班'], a: '工作日加班：1.5 倍；休息日加班：2 倍（可调休）；法定节假日：3 倍。\n加班基数 = 基本工资 ÷ 21.75 天。', s: '来源：《劳动法》第 44 条 · 公司加班管理制度 v2.1' },
  { k: ['递延', '101号', '期权'], a: '非上市公司股权激励符合财税〔2016〕101 号可递延纳税：行权时不征税，转让时按"财产转让所得" 20% 缴纳。\n条件：激励计划备案、期权池设立、员工真实行权、持股平台合规等。', s: '来源：财税〔2016〕101 号 · 政策库 #45' },
  { k: ['补贴', '人才'], a: '各地半导体人才政策差异大，常见：落户（上海/深圳/苏州）、购房补贴（无锡 20-50 万）、个税返还（合肥/成都）、一次性安家费。\n建议按员工所在城市检索政策库，可自动生成申报材料。', s: '来源：政策知识库 · 人才补贴类 23 条' },
  { k: ['税', '个税'], a: '个税 = 累计预扣法。2025 年专项附加扣除：子女教育 2000/月、住房贷款 1000/月、赡养老人 3000/月（独生子女）等。\n示例：张三（月薪 25K，社保公积金 3950）个税 ≈ 2,310 元。', s: '来源：个人所得税法 · 国家税务总局 2025 年专项附加扣除公告' },
  { k: ['离职', '结算'], a: '离职结算：当月工资 + 未休年假折算 + 经济补偿（N：每满一年一个月工资；违法解除 N×2）。\n社保：离职当月由公司缴纳，次月起停缴。', s: '来源：《劳动合同法》第 46-47 条 · 离职结算制度 v1.5' }
]
app.get('/api/copilot/config', auth(), (req, res) => {
  res.json({ configured: llmConfigured(), engine: llmConfigured() ? 'llm' : 'kb', model: llmConfigured() ? LLM_MODEL : null, base: llmConfigured() ? LLM_BASE : null, cities: KNOWN_CITIES.length, retrieval: 'hybrid(tfidf-cosine+synonym+keyword)' })
})
// 检索调试：查看向量检索命中的语料、关键词分与融合分
app.get('/api/copilot/retrieval', auth(), (req, res) => {
  const q = (req.query.q || '').trim()
  if (!q) return res.status(400).json({ error: '缺少 q' })
  res.json({ question: q, hits: retrieve(q, 5).map(x => ({ id: x.c.id, title: x.c.title, score: Math.round(x.s * 100) / 100, kw: x.kw, cos: Math.round(x.cos * 1000) / 1000 })) })
})

// ── 会话记忆（内存 Map，TTL 60 分钟；后续可换 Redis/数据库）──
const sessions = new Map()
const SESSION_TTL = 60 * 60 * 1000
const MAX_HISTORY = 10 // 保留最近 10 条消息（5 轮对话）
setInterval(() => {
  const now = Date.now()
  for (const [sid, s] of sessions) if (now - s.updatedAt > SESSION_TTL) sessions.delete(sid)
}, 10 * 60 * 1000).unref()
function getSession(sid) {
  if (!sid) return null
  let s = sessions.get(sid)
  if (!s) { s = { messages: [], updatedAt: Date.now() }; sessions.set(sid, s) }
  s.updatedAt = Date.now()
  return s
}
app.post('/api/copilot/clear', auth(), (req, res) => {
  const sid = (req.body?.sessionId || '').trim()
  if (sid) sessions.delete(sid)
  res.json({ ok: true })
})

app.post('/api/copilot/ask', auth(), async (req, res) => {
  const q = (req.body?.question || '').trim()
  if (!q) return res.status(400).json({ error: 'question 不能为空' })
  const sid = (req.body?.sessionId || '').trim() || ('s-' + randomUUID())
  const session = getSession(sid)
  session.messages.push({ role: 'user', content: q })
  if (session.messages.length > MAX_HISTORY * 2) session.messages.splice(0, session.messages.length - MAX_HISTORY * 2)

  // 城市识别：命中 → 注入城市参数上下文（含"未收录"诚实提示）
  const city = detectCity(q)
  const cityCtx = city ? cityContext(city) : ''

  // ① 真实 LLM：RAG + 城市参数 + 多轮历史
  if (llmConfigured() && (retrieve(q).length > 0 || city)) {
    const scored = retrieve(q)
    const ctxBlock = [cityCtx, buildContext(scored)].filter(Boolean).join('\n\n')
    try {
      // 历史取"不含当前问题"的最近 MAX_HISTORY 条（干净问答），当前问题以带上下文的形式作为最后一条
      const history = session.messages.slice(0, -1).slice(-MAX_HISTORY)
      const answer = await chat([
        { role: 'system', content: COPILOT_SYSTEM },
        ...history.map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: `【参考上下文】\n${ctxBlock}\n\n【用户问题】\n${q}\n\n请回答（附来源）。` }
      ])
      session.messages.push({ role: 'assistant', content: answer })
      return res.json({ sessionId: sid, answer, source: [cityCtx.includes('来源') ? cityCtx.match(/来源：(\S+)/)?.[1] : '', ...contextSources(scored)].filter(Boolean).join('；'), engine: 'llm', escalated: false })
    } catch (e) {
      console.warn('[copilot] LLM 调用失败，降级规则 KB:', e.message)
    }
  }

  // ② 降级：规则 KB（打分制：命中任一关键词按权重选最优，避免"全命中"过于严格）
  const scoredKb = KB.map(e => ({ e, s: e.k.reduce((acc, kw) => acc + (q.includes(kw) ? 1 : 0), 0) }))
    .filter(x => x.s > 0).sort((a, b) => b.s - a.s)[0]
  if (scoredKb) {
    session.messages.push({ role: 'assistant', content: scoredKb.e.a })
    return res.json({ sessionId: sid, answer: scoredKb.e.a, source: scoredKb.e.s, engine: 'kb', escalated: false })
  }
  const esc = '这个问题需要结合具体情况，已转给 HR 人工处理（预计 2 小时内回复）。\n\n提示：可尝试"试用期/社保""加班""期权递延""离职结算"等关键词。'
  session.messages.push({ role: 'assistant', content: esc })
  res.json({ sessionId: sid, answer: esc, source: null, engine: 'kb', escalated: true })
})

// ── 期权模拟（服务端计算，供 API 调用/测试）──
app.post('/api/option/simulate', auth(), (req, res) => {
  const { inp, taxMode = true } = req.body || {}
  if (!inp) return res.status(400).json({ error: '缺少 inp' })
  res.json({ metrics: optionMetrics(inp, taxMode), sensitivity: optionSensitivity(inp, taxMode) })
})

const PORT = process.env.PORT || 3001
app.listen(PORT, '127.0.0.1', () => console.log(`[backend] AI 薪酬 API 运行于 http://127.0.0.1:${PORT}`))
