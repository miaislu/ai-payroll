import { Router } from 'express'
import { db } from '../db.js'
import { auth } from '../lib/auth.js'
import { OPS_ROLES } from '../lib/access.js'
import { companyCostRowsForPeriod } from '../lib/cost_store.js'
import { employeesForPeriod } from '../lib/employee_terms.js'
import { currentPeriod, isPeriod } from '../lib/periods.js'

export const dashboard = Router()

function periodTotal(period) {
  return companyCostRowsForPeriod(period).rows.reduce((sum, row) => sum + row.total, 0)
}
function bandOf(jobFamily) {
  return db.prepare('SELECT * FROM benchmarks WHERE direction=?').get(jobFamily)
}
function prevPeriod(period) {
  const [y, m] = period.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

dashboard.get('/dashboard/summary', auth(OPS_ROLES), (req, res) => {
  const period = req.query.period || currentPeriod()
  if (!isPeriod(period)) return res.status(400).json({ error: 'period 须为 YYYY-MM' })
  const prev = prevPeriod(period)
  const cur = periodTotal(period), before = periodTotal(prev)
  const mom = before ? Math.round((cur - before) / before * 1000) / 10 : 0
  const currentRows = companyCostRowsForPeriod(period).rows
  const previousRows = companyCostRowsForPeriod(prev).rows
  const employees = employeesForPeriod(period)
  const employeeMap = Object.fromEntries(employees.map(employee => [employee.id, employee]))
  const newHire = currentRows.filter(row => employeeMap[row.employee_id]?.hire_month === period).reduce((sum, row) => sum + row.total, 0)
  const severance = currentRows.reduce((sum, row) => sum + (row.severance || 0), 0)
  const previousByEmployee = Object.fromEntries(previousRows.map(row => [row.employee_id, row]))
  const socialAdj = currentRows.filter(row => employeeMap[row.employee_id]?.flag === '社保基数调整').reduce((sum, row) => {
    const previous = previousByEmployee[row.employee_id]
    return sum + row.social + row.fund - (previous ? previous.social + previous.fund : 0)
  }, 0)
  const other = cur - before - newHire - severance - socialAdj
  const emps = employees.filter(employee => employee.status === 'active')
  let over = 0
  for (const e of emps) {
    const b = bandOf(e.job_family)
    if (b && e.monthly_base * 12 > b.p75 * 10000 * 1.1) over++
  }
  const headcount = emps.length
  const wan = v => Math.round(v / 10000 * 10) / 10
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

dashboard.get('/dashboard/trend', auth(OPS_ROLES), (req, res) => {
  const months = Math.min(36, Math.max(1, Number(req.query.months) || 6))
  const end = isPeriod(req.query.end) ? req.query.end : currentPeriod()
  const periods = []
  let [year, month] = end.split('-').map(Number)
  for (let i = 0; i < months; i++) {
    periods.unshift(`${year}-${String(month).padStart(2, '0')}`)
    month--; if (month === 0) { month = 12; year-- }
  }
  res.json(periods.map(period => {
    const rows = companyCostRowsForPeriod(period).rows
    return { period, label: String(Number(period.slice(5))) + '月', value: Math.round(rows.reduce((sum, row) => sum + row.total, 0) / 10000 * 10) / 10, count: rows.length }
  }))
})

dashboard.get('/dashboard/distribution', auth(OPS_ROLES), (req, res) => {
  const category = req.query.category || 'all'
  const period = isPeriod(req.query.period) ? req.query.period : currentPeriod()
  const emps = employeesForPeriod(period).filter(employee => employee.status === 'active' && (category === 'all' || employee.category === category))
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

dashboard.get('/dashboard/attrition', auth(OPS_ROLES), (req, res) => {
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

dashboard.get('/dashboard/forecast', auth(OPS_ROLES), (req, res) => {
  const target = Number(req.query.target) || 60
  const period = isPeriod(req.query.period) ? req.query.period : currentPeriod()
  const cur = periodTotal(period)
  const headcount = db.prepare("SELECT COUNT(*) c FROM employees WHERE status='active'").get().c
  if (!headcount) return res.status(400).json({ error: '无在职员工，无法预测' })
  const monthly = Math.round(cur * target / headcount / 10000 * 10) / 10
  res.json({ target, currentHeadcount: headcount, monthlyCostWan: monthly, note: '线性外推：月成本 ≈ 当前月成本 × 目标人数 / 现有人数（未计入带宽结构变化）' })
})
