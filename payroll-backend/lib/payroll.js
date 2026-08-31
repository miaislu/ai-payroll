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

// 个人社保公积金（基于封顶后的缴费基数）；含补充公积金（个人缴纳部分）
export function socialFund(base, city = '上海', supplementalRate = 0) {
  const { base: cb } = cityBase(city, base)
  const social = Math.round(cb * 0.103) // 养老8% 医疗2% 失业0.3%
  const fund = Math.round(cb * 0.07)    // 基本公积金 7%
  const supplemental_fund = Math.round(cb * (supplementalRate || 0)) // 补充公积金（个人，比例可配）
  return { social, fund, supplemental_fund, base: cb }
}

// 离职经济补偿：当地上年社平工资 3 倍以内免税，超出部分按年度税率表单独计税
const LOCAL_AVG_WAGE = { 上海: 12434, 北京: 15701, 深圳: 14553, 合肥: 9203 } // 元/月（2024 口径，MVP 种子）
export function severanceTax(severance, city = '上海') {
  const exempt = (LOCAL_AVG_WAGE[city] || 10000) * 3
  const excess = Math.max(0, severance - exempt)
  return taxAnnual(excess)
}

// 劳务报酬预扣（顾问/实习生统一口径）：减 20%（>4000）或 800（≤4000）后 ×20% 预扣率
// 注：统一 20% 预扣，不做三级超额累进；年度汇算补退税由个人自行办理
export function consultantTax(amount) {
  if (amount <= 0) return 0
  const taxable = amount > 4000 ? amount * 0.8 : Math.max(0, amount - 800)
  return Math.round(taxable * 0.20)
}

// 员工在某月的基本要素（不含累计税；顾问/实习生按各自口径）
function monthlyParts(e, period) {
  const type = e.employment_type || 'employee'
  const base = e.monthly_base
  if (e.status === 'departed') {
    const severance = Math.round(base * 2 + base * 5 / 21.75) // 当月工资 + N+1 + 年假折算
    const { social, fund, supplemental_fund } = socialFund(base, e.city, e.supplemental_fund_rate)
    const tax = severanceTax(severance, e.city)
    const net = severance - social - fund - supplemental_fund - tax
    return {
      employee_id: e.id, name: e.name, grade: e.grade, status: 'departed', period, city: e.city,
      base, perf: 0, ot: 0, social, fund, supplemental_fund, tax, net, employment_type: type,
      flags: [{ kind: 'warn', text: '离职结算', detail: `按 N+1 结算（当月工资 ${base.toLocaleString('zh-CN')} + 补偿 + 年假折算），补偿金 3 倍社平内免税，个税已按此口径计算。` }]
    }
  }
  // 顾问：劳务报酬，按月独立预扣 20%，不缴社保公积金，无绩效/加班
  if (type === 'consultant') {
    const amount = base
    const tax = consultantTax(amount)
    const net = amount - tax
    return {
      employee_id: e.id, name: e.name, grade: e.grade, status: 'active', period, city: e.city,
      base: amount, perf: 0, ot: 0, gross: amount, social: 0, fund: 0, supplemental_fund: 0, special: 0, tax, net,
      employment_type: 'consultant',
      flags: [{ kind: 'info', text: '顾问 · 劳务报酬', detail: '按劳务报酬统一预扣 20%（减 20% 或 800 后 ×20%），不缴社保公积金；年度汇算补退税由个人自行办理。' }]
    }
  }
  const perf = Math.round(base * (e.perf_ratio ?? 0.32))
  const ot = e.ot_amount || 0
  const gross = base + perf + ot
  const isIntern = type === 'intern'
  const { social, fund, supplemental_fund } = isIntern ? { social: 0, fund: 0, supplemental_fund: 0 } : socialFund(base, e.city, e.supplemental_fund_rate)
  const special = e.special_deduction || 0
  const net = gross - social - fund - supplemental_fund // 税在累计环节追加
  const flags = []
  if (isIntern) flags.push({ kind: 'info', text: '实习生 · 工资薪金', detail: '在校生实习按工资薪金累计预扣（每月 5000 减除 + 专项附加），不缴社保公积金。' })
  if (e.supplemental_fund_rate > 0) flags.push({ kind: 'info', text: '含补充公积金', detail: `补充公积金个人缴纳 ${(e.supplemental_fund_rate * 100).toFixed(0)}%（与基本公积金一并作为个税专项扣除）。` })
  if (e.flag === '社保基数调整') flags.push({ kind: 'warn', text: '社保基数调整 ▸', detail: '本月社保基数按当年新基数调整，个人部分变化已按政策校验。' })
  if (e.flag === '转正生效') flags.push({ kind: 'ok', text: '转正生效' })
  if (e.flag === '加班费存疑') flags.push({ kind: 'bad', text: '加班费存疑 ▸', detail: '⚠️ 合规预检：休息日加班应为 2 倍，当前按 1.5 倍计算。来源：《劳动法》第 44 条。已阻断确认，请 HR 处理。' })
  if (e.flag === '留才预警') flags.push({ kind: 'warn', text: '留才预警' })
  return { employee_id: e.id, name: e.name, grade: e.grade, status: 'active', period, city: e.city, base, perf, ot, gross, social, fund, supplemental_fund, special, flags, employment_type: type }
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
      if (parts.status === 'departed' || parts.employment_type === 'consultant') { allRows.push(parts); continue } // 离职结算/顾问劳务报酬 独立计税，不累计
      // 累计预扣
      const st = state.get(e.id) || { cumIncome: 0, cumDeduct: 0, cumSpecial: 0, withheld: 0, months: 0 }
      st.cumIncome += parts.gross
      st.cumDeduct += 5000 + parts.social + parts.fund + (parts.supplemental_fund || 0)
      st.cumSpecial += parts.special
      st.months++
      const cumTaxable = Math.max(0, st.cumIncome - st.cumDeduct - st.cumSpecial)
      const cumTax = taxAnnual(cumTaxable)
      const monthTax = cumTax - st.withheld
      st.withheld = cumTax
      state.set(e.id, st)
      allRows.push({ ...parts, tax: Math.max(0, monthTax), net: parts.gross - parts.social - parts.fund - (parts.supplemental_fund || 0) - monthTax })
    }
  }
  return allRows
}

// 生成月份序列 [start, end]（含端点，YYYY-MM）
export function monthRange(start, end) {
  const [sy, sm] = start.split('-').map(Number)
  const [ey, em] = end.split('-').map(Number)
  const out = []
  let y = sy, m = sm
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    m++
    if (m === 13) { m = 1; y++ }
    if (out.length > 120) break // 安全上限
  }
  return out
}

// 单月兜底（period 不在历史种子内时，同样按累计预扣法计算，保持口径一致）
export function computeMonthFallback(period, employees) {
  // 从 2025-01（种子起点）累计到目标月份，复用累计预扣逻辑，取目标月结果
  const start = '2025-01'
  if (period < start) return []
  const periods = monthRange(start, period)
  return computeCumulative(periods, employees).filter(r => r.period === period)
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
