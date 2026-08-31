// 薪酬成本管理：公司口径成本总览 / 预算对比 / 构成分析 / 成本预测 / 单位经济
// 另导出 bandOf / bandPosition 供招聘 Offer 建议引用对标带宽
import { Router } from 'express'
import { db } from '../db.js'
import { companyCostForPeriod, grantActiveInPeriod } from '../lib/company_cost.js'

export const cost = Router()

export const COST_CATEGORIES = ['salary', 'social', 'fund', 'option', 'recruiting', 'other']
export const CATEGORY_LABELS = { salary: '应发工资', social: '公司社保', fund: '公司公积金', option: '期权摊销', recruiting: '招聘成本', other: '其他' }

// 对标带宽查询（供 Offer 建议）：bandOf 按岗位族返回 {p25,p50,p75}
export function bandOf(jobFamily) {
  return db.prepare('SELECT * FROM benchmarks WHERE direction=?').get(jobFamily) || null
}
// 年现金在带宽中的分位（p25→25%，p50→50%，p75→75% 线性插值，超出截断标注）
export function bandPosition(annualCash, jobFamily) {
  const b = bandOf(jobFamily)
  if (!b || !b.p25 || !b.p75) return null
  const cashWan = annualCash / 10000
  if (cashWan <= b.p25) return Math.max(5, Math.round((cashWan / b.p25) * 25))
  if (cashWan >= b.p75) return Math.min(95, Math.round(75 + ((cashWan - b.p75) / (b.p75 || 1)) * 20))
  return Math.round(25 + ((cashWan - b.p25) / (b.p75 - b.p25)) * 50)
}

function prevPeriod(period) {
  const [y, m] = period.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

// 某期间公司成本明细（按员工聚合，含部门 + 期权台账摊销）
function costRows(period) {
  const employees = db.prepare('SELECT e.*, d.name AS department FROM employees e LEFT JOIN departments d ON e.department_id=d.id').all()
  const grants = db.prepare("SELECT * FROM option_grants WHERE status='granted'").all().filter(g => grantActiveInPeriod(g, period))
  const grantsMap = {}
  for (const g of grants) (grantsMap[g.employee_id] = grantsMap[g.employee_id] || []).push(g)
  return companyCostForPeriod(period, employees, grantsMap)
}

// ── 成本总览：公司口径 KPI + 部门构成 + 类别构成 + 环比归因 ──
cost.get('/summary', (req, res) => {
  const period = req.query.period || '2025-06'
  const prev = prevPeriod(period)
  const cur = costRows(period)
  const before = costRows(prev)
  const sum = rows => rows.reduce((s, r) => s + r.total, 0)
  const curTotal = sum(cur), prevTotal = sum(before)
  const mom = prevTotal ? Math.round((curTotal - prevTotal) / prevTotal * 1000) / 10 : 0
  // 类别构成
  const cat = {}
  for (const r of cur) {
    cat.salary = (cat.salary || 0) + r.gross
    cat.social = (cat.social || 0) + r.social
    cat.fund = (cat.fund || 0) + r.fund
    cat.option = (cat.option || 0) + r.option_amort
  }
  const categories = COST_CATEGORIES.map(c => ({ category: c, label: CATEGORY_LABELS[c], amount: cat[c] || 0 }))
  // 部门构成（顶层部门聚合：子部门并入父级）
  const deptRows = db.prepare('SELECT id, name, parent_id FROM departments').all()
  const childOf = deptRows.filter(d => d.parent_id).reduce((m, d) => { (m[d.parent_id] = m[d.parent_id] || []).push(d); return m }, {})
  const byDept = {}
  for (const r of cur) {
    let did = r.department_id
    // 提升到顶层部门
    while (did) { const d = deptRows.find(x => x.id === did); if (!d) break; if (!d.parent_id) break; did = d.parent_id }
    byDept[did] = (byDept[did] || 0) + r.total
  }
  const departments = Object.entries(byDept).map(([id, amount]) => ({
    department_id: Number(id), name: deptRows.find(d => d.id === Number(id))?.name || '未分配', amount
  })).sort((a, b) => b.amount - a.amount)
  // 归因：新增入职 / 离职 / 存量变化（三者之和 = 环比增量）
  const curByEmp = new Map(cur.map(r => [r.employee_id, r]))
  const prevByEmp = new Map(before.map(r => [r.employee_id, r]))
  let newHire = 0, departed = 0, other = 0
  for (const [id, r] of curByEmp) if (!prevByEmp.has(id)) newHire += r.total
  for (const [id, r] of prevByEmp) if (!curByEmp.has(id)) departed += r.total
  other = (curTotal - prevTotal) - newHire - departed
  const attribution = {
    newHire: Math.round(newHire), departed: Math.round(departed), other: Math.round(other),
    delta: curTotal - prevTotal
  }
  const wan = v => Math.round(v / 10000 * 10) / 10
  const headcount = cur.length
  res.json({
    period, total: curTotal, prev: prevTotal, mom,
    headcount, perCapita: headcount ? Math.round(curTotal / headcount) : 0,
    categories, departments, attribution: {
      newHire: wan(attribution.newHire), departed: wan(attribution.departed), other: wan(attribution.other), deltaWan: wan(attribution.delta)
    }
  })
})

// ── 成本趋势（近 N 月）──
cost.get('/trend', (req, res) => {
  const months = Math.min(36, Math.max(1, Number(req.query.months) || 6))
  const periods = []
  let [y, m] = '2025-06'.split('-').map(Number)
  for (let i = 0; i < months; i++) { periods.unshift(`${y}-${String(m).padStart(2, '0')}`); m--; if (m === 0) { m = 12; y-- } }
  const data = periods.map(p => {
    const rows = costRows(p)
    return { period: p, label: p.slice(5).replace('-', '月') + '月', total: Math.round(rows.reduce((s, r) => s + r.total, 0)), count: rows.length }
  })
  res.json(data)
})

// ── 预算 vs 实际 ──
cost.get('/budget', (req, res) => {
  const period = req.query.period || '2025-06'
  const budgets = db.prepare('SELECT * FROM cost_budgets WHERE year_month=?').all(period)
  const actual = costRows(period)
  const deptNames = Object.fromEntries(db.prepare('SELECT id, name FROM departments').all().map(d => [d.id, d.name]))
  const bCat = {}, bDept = {}
  for (const b of budgets) {
    const key = b.department_id ? `d${b.department_id}` : 'c'
    bCat[key] = bCat[key] || {}
    bCat[key][b.category] = (bCat[key][b.category] || 0) + b.amount
  }
  // 实际：按部门汇总（salary/social/fund/option），招聘成本来自渠道费用
  const recExp = db.prepare('SELECT COALESCE(SUM(amount),0) a FROM channel_expenses WHERE year_month=?').get(period).a
  const rows = []
  const aDept = {}
  for (const r of actual) {
    const did = r.department_id || 0
    aDept[did] = aDept[did] || { salary: 0, social: 0, fund: 0, option: 0 }
    aDept[did].salary += r.gross; aDept[did].social += r.social; aDept[did].fund += r.fund; aDept[did].option += r.option_amort
  }
  for (const [did, a] of Object.entries(aDept)) {
    const id = Number(did)
    rows.push({
      key: id ? `d${id}` : 'c', name: id ? (deptNames[id] || '未分配') : '招聘（全公司）',
      actual: a, budget: bCat[id ? `d${id}` : 'c'] || {}
    })
  }
  rows.push({ key: 'c', name: '招聘（全公司）', actual: { recruiting: recExp }, budget: bCat['c'] || {} })
  // 汇总行
  const totals = { actual: { salary: 0, social: 0, fund: 0, option: 0, recruiting: recExp }, budget: { salary: 0, social: 0, fund: 0, option: 0, recruiting: 0 } }
  for (const b of budgets) if (!b.department_id) totals.budget[b.category] = (totals.budget[b.category] || 0) + b.amount
  for (const [did, a] of Object.entries(aDept)) {
    totals.actual.salary += a.salary; totals.actual.social += a.social; totals.actual.fund += a.fund; totals.actual.option += a.option
  }
  const budgetAll = Object.values(bCat).reduce((m, x) => { for (const [k, v] of Object.entries(x)) m[k] = (m[k] || 0) + v; return m }, {})
  for (const [k, v] of Object.entries(budgetAll)) totals.budget[k] = (totals.budget[k] || 0) + v
  res.json({ period, rows, totals })
})

// ── 成本预测：编制计划 × 部门人均成本 → 未来 N 月 ──
cost.get('/forecast', (req, res) => {
  const months = Math.min(36, Math.max(1, Number(req.query.months) || 6))
  const startPeriod = req.query.start || '2025-07'
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(startPeriod)) return res.status(400).json({ error: 'start 须为 YYYY-MM' })
  const depts = db.prepare('SELECT id, name, parent_id FROM departments').all()
  // 顶层部门（预测按顶层口径聚合，避免父子部门重复计）
  const topOf = id => { let cur = depts.find(d => d.id === id); while (cur && cur.parent_id) cur = depts.find(d => d.id === cur.parent_id); return cur ? cur.id : id }
  const tops = depts.filter(d => !d.parent_id)
  const cur = costRows('2025-06')
  // 顶层部门人均成本（含子部门员工）
  const avgByTop = {}
  for (const r of cur) {
    const t = topOf(r.department_id)
    avgByTop[t] = avgByTop[t] || { sum: 0, n: 0 }
    avgByTop[t].sum += r.total; avgByTop[t].n++
  }
  const avgMap = Object.fromEntries(Object.entries(avgByTop).map(([id, v]) => [id, Math.round(v.sum / v.n)]))
  const topAvg = avgMap[1] || 40000 // 兜底：芯片设计部人均
  const plans = db.prepare('SELECT * FROM headcount_plan ORDER BY year_month').all()
  const manualByMonth = {}
  for (const p of plans) {
    const t = topOf(p.department_id)
    manualByMonth[p.year_month] = manualByMonth[p.year_month] || {}
    manualByMonth[p.year_month][t] = (manualByMonth[p.year_month][t] || 0) + p.planned
  }
  // 招聘需求联动：进行中（open/interview）需求按预计到岗月自动计入编制
  const reqs = db.prepare("SELECT department_id, headcount, target_month FROM job_requisitions WHERE status IN ('open','interview') AND target_month IS NOT NULL").all()
  const reqsByTop = {}
  for (const r of reqs) {
    const t = topOf(r.department_id)
    reqsByTop[t] = reqsByTop[t] || []
    reqsByTop[t].push({ target_month: r.target_month, headcount: Number(r.headcount) || 0 })
  }
  const curCountByTop = {}
  for (const r of cur) { const t = topOf(r.department_id); curCountByTop[t] = (curCountByTop[t] || 0) + 1 }
  // 生成预测期间
  const periods = []
  let [y, m] = startPeriod.split('-').map(Number)
  for (let i = 0; i < months; i++) { periods.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m === 13) { m = 1; y++ } }
  const series = periods.map(p => {
    const mm = manualByMonth[p] || {}
    let total = 0, planned = 0, plannedManual = 0, plannedRequisition = 0, detail = []
    for (const t of tops) {
      const hasManual = mm[t.id] !== undefined
      const manual = hasManual ? mm[t.id] : 0
      const req = (reqsByTop[t.id] || []).filter(x => x.target_month <= p).reduce((s, x) => s + x.headcount, 0)
      // 手工编制是该月权威总人数；没有手工编制时，当前人数加截至该月预计入职人数。
      const count = hasManual ? manual : (curCountByTop[t.id] ?? 0) + req
      if (!count) continue
      const avg = avgMap[t.id] || topAvg
      total += count * avg; planned += count
      plannedManual += manual; plannedRequisition += hasManual ? 0 : req
      const source = hasManual ? 'manual' : req ? 'requisition' : 'current'
      detail.push({ department_id: t.id, name: t.name, count, manual, req, avg, amount: count * avg, source })
    }
    return { period: p, label: p.slice(5).replace('-', '月') + '月', total: Math.round(total), planned, plannedManual, plannedRequisition, detail, currentPlanned: cur.length }
  })
  res.json({ series, avgPerCapita: avgMap, topAvg })
})

// ── 单位经济指标 ──
cost.get('/unit', (req, res) => {
  const period = req.query.period || '2025-06'
  const rows = costRows(period)
  const total = rows.reduce((s, r) => s + r.total, 0)
  const headcount = rows.length
  const gross = rows.reduce((s, r) => s + r.gross, 0)
  const socialFund = rows.reduce((s, r) => s + r.social + r.fund, 0)
  const recExp = db.prepare('SELECT COALESCE(SUM(amount),0) a FROM channel_expenses WHERE year_month=?').get(period).a
  res.json({
    period, headcount, perCapitaMonthly: headcount ? Math.round(total / headcount) : 0,
    perCapitaAnnual: headcount ? Math.round(total / headcount * 12) : 0,
    laborCostRatio: total ? Math.round(gross / total * 1000) / 10 : 0, // 应发占公司成本比（含社保等）
    socialFundBurden: gross ? Math.round(socialFund / gross * 1000) / 10 : 0, // 社保公积金占应发比
    recruitingBurden: total ? Math.round(recExp / total * 1000) / 10 : 0, // 招聘成本占公司成本比
    note: '人均成本 = 公司口径总成本 ÷ 在职人数；社保公积金负担 ≈ 26%+7% 费率'
  })
})

// 部门列表（供前端下拉）
cost.get('/departments', (req, res) => {
  res.json(db.prepare('SELECT * FROM departments ORDER BY id').all())
})

// ── 预算维护 ──
cost.get('/budgets', (req, res) => {
  const { year_month } = req.query
  const rows = year_month
    ? db.prepare('SELECT * FROM cost_budgets WHERE year_month=? ORDER BY id').all(year_month)
    : db.prepare('SELECT * FROM cost_budgets ORDER BY year_month DESC, id').all()
  const deptNames = Object.fromEntries(db.prepare('SELECT id, name FROM departments').all().map(d => [d.id, d.name]))
  res.json(rows.map(b => ({ ...b, department: b.department_id ? deptNames[b.department_id] : '招聘（全公司）' })))
})
cost.post('/budgets', (req, res) => {
  const b = req.body || {}
  if (!b.year_month || !b.amount) return res.status(400).json({ error: '缺少月份或金额' })
  if (!COST_CATEGORIES.includes(b.category)) return res.status(400).json({ error: '非法成本类别' })
  const r = db.prepare('INSERT INTO cost_budgets(year_month,department_id,category,amount,note) VALUES(?,?,?,?,?)')
    .run(b.year_month, b.department_id || null, b.category, b.amount, b.note || '')
  res.json({ ok: true, id: r.lastInsertRowid })
})
cost.put('/budgets/:id', (req, res) => {
  const b = req.body || {}
  const r = db.prepare('UPDATE cost_budgets SET year_month=COALESCE(?,year_month), department_id=?, category=COALESCE(?,category), amount=COALESCE(?,amount), note=COALESCE(?,note) WHERE id=?')
    .run(b.year_month || null, b.department_id ?? null, b.category || null, b.amount ?? null, b.note || null, req.params.id)
  if (!r.changes) return res.status(404).json({ error: '预算不存在' })
  res.json({ ok: true, id: Number(req.params.id) })
})
cost.delete('/budgets/:id', (req, res) => {
  const r = db.prepare('DELETE FROM cost_budgets WHERE id=?').run(req.params.id)
  if (!r.changes) return res.status(404).json({ error: '预算不存在' })
  res.json({ ok: true })
})

// ── 编制计划维护（成本预测的数据源）──
cost.get('/headcount-plans', (req, res) => {
  const rows = db.prepare('SELECT h.*, d.name AS department FROM headcount_plan h LEFT JOIN departments d ON h.department_id=d.id ORDER BY h.year_month').all()
  res.json(rows)
})
cost.post('/headcount-plans', (req, res) => {
  const b = req.body || {}
  if (!b.department_id || !b.year_month || b.planned === undefined) return res.status(400).json({ error: '缺少部门/月份/编制数' })
  // 同部门同月 upsert
  db.prepare('INSERT INTO headcount_plan(department_id,year_month,planned,note) VALUES(?,?,?,?) ON CONFLICT(department_id,year_month) DO UPDATE SET planned=excluded.planned, note=excluded.note')
    .run(b.department_id, b.year_month, b.planned, b.note || '')
  res.json({ ok: true })
})
cost.delete('/headcount-plans/:id', (req, res) => {
  const r = db.prepare('DELETE FROM headcount_plan WHERE id=?').run(req.params.id)
  if (!r.changes) return res.status(404).json({ error: '编制记录不存在' })
  res.json({ ok: true })
})
