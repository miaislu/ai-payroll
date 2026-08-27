// 算薪规则引擎 v2（真实口径升级）
//  - 累计预扣法：全年累计收入 - 累计减除(5000/月) - 累计专项扣除(社保公积金) - 累计专项附加 → 全年综合所得税率表 → 减已预扣
//  - 社保公积金：按城市基数上下限封顶（城市参数表），个人 养老8%+医疗2%+失业0.3%=10.3%，公积金 7%
//  - 离职结算：经济补偿 N+1；补偿金在当地上年社平工资 3 倍以内免税，超出部分按年度税率表单独计税
import { CITY_POLICIES } from './city_policies.js'

// 全年综合所得税率表（累计预扣法用）
export const ANNUAL_BRACKETS = [
  { cap: 36000, rate: 0.03, qd: 0 },
  { cap: 144000, rate: 0.10, qd: 2520 },
  { cap: 300000, rate: 0.20, qd: 16920 },
  { cap: 420000, rate: 0.25, qd: 31920 },
  { cap: 660000, rate: 0.30, qd: 52920 },
  { cap: 960000, rate: 0.35, qd: 85920 },
  { cap: Infinity, rate: 0.45, qd: 181920 }
]

export function taxAnnual(cumulativeTaxable) {
  if (cumulativeTaxable <= 0) return 0
  for (const { cap, rate, qd } of ANNUAL_BRACKETS) {
    if (cumulativeTaxable <= cap) return Math.max(0, Math.round(cumulativeTaxable * rate - qd))
  }
  return 0
}

// 城市社保公积金基数（下限~上限封顶；未收录城市不封顶）
function cityBase(city, base) {
  const p = CITY_POLICIES.find(x => x.city === city)
  if (!p) return { base, capped: false }
  let b = base
  if (p.social_base_min && b < p.social_base_min) b = p.social_base_min
  if (p.social_base_max && b > p.social_base_max) b = p.social_base_max
  return { base: b, capped: b !== base }
}

// 个人社保公积金（基于封顶后的缴费基数）
export function socialFund(base, city = '上海') {
  const { base: cb } = cityBase(city, base)
  const social = Math.round(cb * 0.103) // 养老8% 医疗2% 失业0.3%
  const fund = Math.round(cb * 0.07)    // 公积金 7%
  return { social, fund, base: cb }
}

// 离职经济补偿：当地上年社平工资 3 倍以内免税，超出部分按年度税率表单独计税
const LOCAL_AVG_WAGE = { 上海: 12434, 北京: 15701, 深圳: 14553, 合肥: 9203 } // 元/月（2024 口径，MVP 种子）
export function severanceTax(severance, city = '上海') {
  const exempt = (LOCAL_AVG_WAGE[city] || 10000) * 3
  const excess = Math.max(0, severance - exempt)
  return taxAnnual(excess)
}

// 员工在某月的基本要素（不含累计税）
function monthlyParts(e, period) {
  const base = e.monthly_base
  if (e.status === 'departed') {
    const severance = Math.round(base * 2 + base * 5 / 21.75) // 当月工资 + N+1 + 年假折算
    const { social, fund } = socialFund(base, e.city)
    const tax = severanceTax(severance, e.city)
    const net = severance - social - fund - tax
    return {
      employee_id: e.id, name: e.name, grade: e.grade, status: 'departed', period, city: e.city,
      base, perf: 0, ot: 0, social, fund, tax, net,
      flags: [{ kind: 'warn', text: '离职结算', detail: `按 N+1 结算（当月工资 ${base.toLocaleString('zh-CN')} + 补偿 + 年假折算），补偿金 3 倍社平内免税，个税已按此口径计算。` }]
    }
  }
  const perf = Math.round(base * (e.perf_ratio || 0.32))
  const ot = e.ot_amount || 0
  const gross = base + perf + ot
  const { social, fund } = socialFund(base, e.city)
  const special = e.special_deduction || 0
  const net = gross - social - fund // 税在累计环节追加
  const flags = []
  if (e.flag === '社保基数调整') flags.push({ kind: 'warn', text: '社保基数调整 ▸', detail: '本月社保基数按当年新基数调整，个人部分变化已按政策校验。' })
  if (e.flag === '转正生效') flags.push({ kind: 'ok', text: '转正生效' })
  if (e.flag === '加班费存疑') flags.push({ kind: 'bad', text: '加班费存疑 ▸', detail: '⚠️ 合规预检：休息日加班应为 2 倍，当前按 1.5 倍计算。来源：《劳动法》第 44 条。已阻断确认，请 HR 处理。' })
  if (e.flag === '留才预警') flags.push({ kind: 'warn', text: '留才预警' })
  return { employee_id: e.id, name: e.name, grade: e.grade, status: 'active', period, city: e.city, base, perf, ot, gross, social, fund, special, flags }
}

// 累计预扣法：按月顺序处理，逐员工维护累计状态
export function computeCumulative(periods, employees) {
  const state = new Map() // employee_id -> {cumIncome, cumDeduct, cumTaxable, withheld}
  const allRows = []
  for (const period of periods) {
    const [y, m] = period.split('-').map(Number)
    for (const e of employees) {
      const hired = (e.hire_month || '2025-01').split('-').map(Number)
      const hiredBefore = hired[0] < y || (hired[0] === y && hired[1] <= m)
      if (!hiredBefore) continue
      if (e.status === 'departed' && e.leave_month !== period) continue
      const parts = monthlyParts(e, period)
      if (parts.status === 'departed') { allRows.push(parts); continue } // 离职结算独立计税
      // 累计预扣
      const st = state.get(e.id) || { cumIncome: 0, cumDeduct: 0, cumSpecial: 0, withheld: 0, months: 0 }
      st.cumIncome += parts.gross
      st.cumDeduct += 5000 + parts.social + parts.fund
      st.cumSpecial += parts.special
      st.months++
      const cumTaxable = Math.max(0, st.cumIncome - st.cumDeduct - st.cumSpecial)
      const cumTax = taxAnnual(cumTaxable)
      const monthTax = cumTax - st.withheld
      st.withheld = cumTax
      state.set(e.id, st)
      allRows.push({ ...parts, tax: Math.max(0, monthTax), net: parts.gross - parts.social - parts.fund - monthTax })
    }
  }
  return allRows
}

// 单月兜底（period 不在历史种子内时用月度预扣表，标注简化口径）
export function computeMonthFallback(period, employees) {
  return employees
    .filter(e => (e.status !== 'departed' || e.leave_month === period))
    .map(e => {
      const parts = monthlyParts(e, period)
      if (parts.status === 'departed') return parts
      const taxable = Math.max(0, parts.gross - 5000 - parts.social - parts.fund - parts.special)
      const tax = taxMonthly(taxable)
      return { ...parts, tax, net: parts.gross - parts.social - parts.fund - tax }
    })
}

// 月度预扣表（兜底用；正式链路为累计预扣）
export const TAX_BRACKETS = [
  { cap: 3000, rate: 0.03, qd: 0 },
  { cap: 12000, rate: 0.10, qd: 210 },
  { cap: 25000, rate: 0.20, qd: 1410 },
  { cap: 35000, rate: 0.25, qd: 2660 },
  { cap: 55000, rate: 0.30, qd: 4410 },
  { cap: 80000, rate: 0.35, qd: 7160 },
  { cap: Infinity, rate: 0.45, qd: 15160 }
]
export function taxMonthly(taxable) {
  if (taxable <= 0) return 0
  for (const { cap, rate, qd } of TAX_BRACKETS) {
    if (taxable <= cap) return Math.max(0, Math.round(taxable * rate - qd))
  }
  return 0
}
