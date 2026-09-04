// 算薪规则引擎 v2（真实口径升级）
//  - 累计预扣法：全年累计收入 - 累计减除(5000/月) - 累计专项扣除(社保公积金) - 累计专项附加 → 全年综合所得税率表 → 减已预扣
//  - 社保公积金：按城市政策的基数上下限与逐险种费率计算
//  - 离职结算：经济补偿 N+1；补偿金在当地上年社平工资 3 倍以内免税，超出部分按年度税率表单独计税
import { getCityPolicy, capFundBase, capSocialBase } from './city_policies.js'
import { monthBounds, weekdaysInRange } from './periods.js'

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

/** 待入职 Offer 不计薪；离职员工计到 leave_month 当月（含） */
export function employedInPeriod(employee, period) {
  if (!employee || !period) return false
  if (employee.status === 'offer') return false
  const hired = employee.hire_month || `${String(period).slice(0, 4)}-01`
  if (hired > period) return false
  if (employee.leave_month && employee.leave_month < period) return false
  return true
}

// 个人社保公积金：社保与公积金分基数封顶，费率取城市政策（缺省全国默认）
export function socialFund(base, city = '上海', supplementalRate = 0, period = null) {
  const p = getCityPolicy(city, period)
  const socialBase = capSocialBase(base, city, period)
  const fundBase = capFundBase(base, city, period)
  const social = Math.round(socialBase * p.personal_social_rate)
  const fund = Math.round(fundBase * p.personal_fund_rate)
  const supplemental_fund = Math.round(fundBase * (supplementalRate || 0))
  return {
    social,
    fund,
    supplemental_fund,
    base: socialBase,
    social_base: socialBase,
    fund_base: fundBase,
    rates: {
      personal_pension: p.personal_pension_rate,
      personal_medical: p.personal_medical_rate,
      personal_unemployment: p.personal_unemployment_rate,
      personal_social: p.personal_social_rate,
      personal_fund: p.personal_fund_rate,
      employer_social: p.employer_social_rate,
      employer_fund: p.employer_fund_rate
    }
  }
}

// 离职经济补偿：当地上年社平工资 3 倍以内免税，超出部分按年度税率表单独计税
const PREVIEW_LOCAL_AVG_MONTHLY_WAGE = { 上海: 12434, 北京: 15701, 深圳: 14553, 合肥: 9203 } // 历史预览兜底，未核验时会阻断月结
export function severanceTax(severance, city = '上海', period = null) {
  // 财税〔2018〕164号：当地上年职工平均工资 3 倍以内免税；这里的“平均工资”为年平均工资。
  const policy = getCityPolicy(city, period)
  const exempt = (policy.local_avg_monthly_wage || PREVIEW_LOCAL_AVG_MONTHLY_WAGE[city] || 10000) * 12 * 3
  const excess = Math.max(0, severance - exempt)
  return taxAnnual(excess)
}

// 居民个人劳务报酬预扣：减 20%（>4000）或 800（≤4000）后，适用 20%/30%/40% 三级预扣率。
export function consultantTax(amount) {
  if (amount <= 0) return 0
  const taxable = amount > 4000 ? amount * 0.8 : Math.max(0, amount - 800)
  if (taxable <= 20000) return Math.round(taxable * 0.20)
  if (taxable <= 50000) return Math.round(taxable * 0.30 - 2000)
  return Math.round(taxable * 0.40 - 7000)
}

export const STANDARD_WORK_DAYS = 21.75
export const STANDARD_DAY_HOURS = 8

export function overtimePay(monthlyBase, rec) {
  if (!rec) return 0
  const hourly = Number(monthlyBase || 0) / STANDARD_WORK_DAYS / STANDARD_DAY_HOURS
  const weekday = Math.max(0, Number(rec.ot_weekday_hours) || 0)
  const rest = Math.max(0, Number(rec.ot_rest_hours) || 0)
  const holiday = Math.max(0, Number(rec.ot_holiday_hours) || 0)
  return Math.round(hourly * (weekday * 1.5 + rest * 2 + holiday * 3))
}

export function unpaidLeaveAdjustedBase(monthlyBase, unpaidDays) {
  const unpaid = Math.max(0, Number(unpaidDays) || 0)
  if (unpaid <= 0) return monthlyBase
  return Math.max(0, Math.round(Number(monthlyBase || 0) * (1 - Math.min(unpaid, STANDARD_WORK_DAYS) / STANDARD_WORK_DAYS)))
}

/**
 * 计薪基本工资：有完整考勤时按“计薪天数/计划工作日”折算；否则按精确入离职日的
 * 工作日比例折算。旧数据没有这些字段时保持整月工资，仅沿用无薪假扣减。
 */
export function proratedMonthlyBase(monthlyBase, employee, period, rec) {
  const amount = Math.max(0, Number(monthlyBase) || 0)
  const scheduled = Number(rec?.scheduled_work_days)
  if (rec && Number.isFinite(scheduled) && scheduled > 0 && Number.isFinite(Number(rec.work_days))) {
    const payable = Math.max(0, Math.min(scheduled, Number(rec.work_days)))
    return Math.round(amount * payable / scheduled)
  }
  const bounds = monthBounds(period)
  if (bounds) {
    const start = employee?.hire_date && employee.hire_date.slice(0, 7) === period ? employee.hire_date : bounds.start
    const end = employee?.leave_date && employee.leave_date.slice(0, 7) === period ? employee.leave_date : bounds.end
    const total = weekdaysInRange(bounds.start, bounds.end)
    const active = weekdaysInRange(start, end)
    if (total > 0 && active >= 0 && (start !== bounds.start || end !== bounds.end)) return Math.round(amount * active / total)
  }
  return rec ? unpaidLeaveAdjustedBase(amount, rec.unpaid_leave_days) : amount
}

export function attachAttendance(employees, records) {
  const byEmp = {}
  for (const rec of records || []) {
    if (!rec || rec.employee_id == null || !rec.period) continue
    ;(byEmp[rec.employee_id] ||= {})[rec.period] = rec
  }
  return (employees || []).map(e => ({ ...e, attendanceByPeriod: { ...byEmp[e.id], ...e.attendanceByPeriod } }))
}

// 员工在某月的基本要素（不含累计税；顾问/实习生按各自口径）
function monthlyParts(e, period) {
  const type = e.employment_type || 'employee'
  const base = e.monthly_base
  const departing = Boolean(e.leave_month && e.leave_month === period)
  const severance = departing ? Math.max(0, Number(e.severance_amount) || 0) : 0
  // 顾问：劳务报酬，按月独立预扣 20%，不缴社保公积金，无绩效/加班
  if (type === 'consultant') {
    const amount = base
    const tax = consultantTax(amount)
    const net = amount - tax
    return {
      employee_id: e.id, name: e.name, grade: e.grade, status: departing ? 'departed' : 'active', period, city: e.city,
      base: amount, perf: 0, ot: 0, gross: amount, social: 0, fund: 0, supplemental_fund: 0, special: 0, tax, net,
      regular_tax: tax, severance_tax: 0,
      severance: 0, category: e.category, employment_type: 'consultant', special_deduction: 0, supplemental_fund_rate: 0,
      social_base: 0, fund_base: 0, id_number: e.id_number || null, bank_account: e.bank_account || null,
      personal_pension_rate: 0, personal_medical_rate: 0, personal_unemployment_rate: 0,
      flags: [{ kind: 'info', text: '顾问 · 劳务报酬', detail: '按劳务报酬预扣：减 20%（收入>4000）或 800 后，适用 20%/30%/40% 三级预扣率（速算扣除 0/2000/7000），不缴社保公积金；年度汇算补退税由个人自行办理。' }]
    }
  }
  const rec = e.attendanceByPeriod?.[period]
  const origBase = base
  const adjBase = proratedMonthlyBase(origBase, e, period, rec)
  const perf = Math.round(adjBase * (e.perf_ratio ?? 0.32))
  const ot = rec ? overtimePay(origBase, rec) : (e.ot_amount || 0)
  const gross = adjBase + perf + ot
  const isIntern = type === 'intern'
  const policy = getCityPolicy(e.city, period)
  const sf = isIntern
    ? { social: 0, fund: 0, supplemental_fund: 0, social_base: 0, fund_base: 0, rates: { personal_pension: 0, personal_medical: 0, personal_unemployment: 0 } }
    : socialFund(adjBase, e.city, e.supplemental_fund_rate, period)
  const { social, fund, supplemental_fund, social_base, fund_base } = sf
  const special = e.special_deduction || 0
  const net = gross - social - fund - supplemental_fund // 税在累计环节追加
  const flags = []
  if (!isIntern && !policy.payroll_ready) flags.push({ kind: 'bad', text: '政策参数未核验', detail: `${e.city} ${period} 的社保/公积金/最低工资参数尚未完成官方来源与逐险种复核；当前金额仅供预览，禁止正式月结。` })
  if (severance > 0 && policy.local_avg_monthly_wage == null) flags.push({ kind: 'bad', text: '离职补偿计税参数未核验', detail: `${e.city} ${period} 缺少经核验的当地上年职工月平均工资，禁止正式月结。` })
  if (policy.min_wage != null && adjBase < policy.min_wage) flags.push({ kind: 'bad', text: '低于最低工资', detail: `计薪基本工资 ${adjBase} 元低于政策表最低工资 ${policy.min_wage} 元。` })
  if (departing) flags.push({ kind: 'warn', text: '离职结算', detail: severance ? `离职补偿 ${severance.toLocaleString('zh-CN')} 元按显式录入金额单独计税。` : '未录入离职补偿金额，本月仅计算正常工资。' })
  if (isIntern) flags.push({ kind: 'info', text: '实习生 · 工资薪金', detail: '在校生实习按工资薪金累计预扣（每月 5000 减除 + 专项附加），不缴社保公积金。' })
  if (e.supplemental_fund_rate > 0) flags.push({ kind: 'info', text: '含补充公积金', detail: `补充公积金个人缴纳 ${(e.supplemental_fund_rate * 100).toFixed(0)}%（与基本公积金一并作为个税专项扣除）。` })
  if (e.flag === '社保基数调整') flags.push({ kind: 'warn', text: '社保基数调整 ▸', detail: '本月社保基数按当年新基数调整，个人部分变化已按政策校验。' })
  if (e.flag === '转正生效') flags.push({ kind: 'ok', text: '转正生效' })
  if (rec && ((Number(rec.ot_weekday_hours) || 0) + (Number(rec.ot_rest_hours) || 0) + (Number(rec.ot_holiday_hours) || 0)) > 0) {
    flags.push({
      kind: 'info', text: '考勤加班',
      detail: `工作日 ${Number(rec.ot_weekday_hours) || 0}h×1.5 / 休息日 ${Number(rec.ot_rest_hours) || 0}h×2 / 法定假 ${Number(rec.ot_holiday_hours) || 0}h×3；加班基数=月薪÷21.75÷8。`
    })
  }
  if (rec && Number(rec.unpaid_leave_days) > 0) {
    flags.push({ kind: 'warn', text: '事假/计薪天数', detail: `无薪假 ${rec.unpaid_leave_days} 天；基本工资按考勤中的计薪天数与计划工作日折算。` })
  }
  if (rec && Number(rec.scheduled_work_days) > 0 && Number(rec.work_days) < Number(rec.scheduled_work_days)) {
    flags.push({ kind: 'warn', text: '非整月计薪', detail: `计薪 ${rec.work_days} 天 / 计划 ${rec.scheduled_work_days} 天。` })
  }
  if (!rec && e.flag === '加班费存疑') {
    flags.push({ kind: 'bad', text: '加班费存疑 ▸', detail: '⚠️ 合规预检：休息日加班应为 2 倍，当前按 1.5 倍计算。来源：《劳动法》第 44 条。已阻断确认，请 HR 处理。' })
  }
  if (e.flag === '留才预警') flags.push({ kind: 'warn', text: '留才预警' })
  return {
    employee_id: e.id, name: e.name, grade: e.grade, status: departing ? 'departed' : 'active', period,
    city: e.city, category: e.category, base: adjBase, perf, ot, gross, severance, social, fund, social_base, fund_base,
    supplemental_fund, supplemental_fund_rate: e.supplemental_fund_rate || 0, special, special_deduction: special,
    id_number: e.id_number || null, bank_account: e.bank_account || null, flags, employment_type: type,
    personal_pension_rate: sf.rates.personal_pension,
    personal_medical_rate: sf.rates.personal_medical,
    personal_unemployment_rate: sf.rates.personal_unemployment
  }
}

// 累计预扣法：按月顺序处理，逐员工维护累计状态
export function computeCumulative(periods, employees, frozenRows = []) {
  const state = new Map() // employee_id -> {year, cumIncome, cumDeduct, cumSpecial, withheld}
  const allRows = []
  const frozenByEmployeePeriod = new Map((frozenRows || []).map(row => [`${row.period}:${row.employee_id}`, row]))
  for (const period of periods) {
    const y = Number(String(period).slice(0, 4))
    const employeesInPeriod = typeof employees === 'function' ? employees(period) : employees
    for (const e of employeesInPeriod || []) {
      const frozen = frozenByEmployeePeriod.get(`${period}:${e.id}`)
      if (!frozen && !employedInPeriod(e, period)) continue
      const parts = frozen
        ? {
            ...frozen,
            gross: frozen.gross ?? ((Number(frozen.base) || 0) + (Number(frozen.perf) || 0) + (Number(frozen.ot) || 0)),
            special: frozen.special_deduction ?? frozen.special ?? 0,
            flags: typeof frozen.flags === 'string' ? (() => { try { return JSON.parse(frozen.flags) } catch { return [] } })() : (frozen.flags || [])
          }
        : monthlyParts(e, period)
      if (parts.employment_type === 'consultant') { allRows.push(parts); continue } // 顾问劳务报酬独立计税，不累计
      let st = state.get(e.id)
      if (!st || st.year !== y) st = { year: y, cumIncome: 0, cumDeduct: 0, cumSpecial: 0, withheld: 0, months: 0 }
      st.cumIncome += parts.gross
      st.cumDeduct += 5000 + parts.social + parts.fund + (parts.supplemental_fund || 0)
      st.cumSpecial += parts.special
      st.months++
      const cumTaxable = Math.max(0, st.cumIncome - st.cumDeduct - st.cumSpecial)
      const cumTax = taxAnnual(cumTaxable)
      if (frozen) {
        const frozenSeveranceTax = frozen.severance_tax == null
          ? severanceTax(Number(parts.severance) || 0, parts.city || e.city, period)
          : Math.max(0, Number(frozen.severance_tax) || 0)
        const frozenRegularTax = frozen.regular_tax == null
          ? Math.max(0, (Number(frozen.tax) || 0) - frozenSeveranceTax)
          : Math.max(0, Number(frozen.regular_tax) || 0)
        st.withheld += frozenRegularTax
        state.set(e.id, st)
        allRows.push({ ...parts, regular_tax: frozenRegularTax, severance_tax: frozenSeveranceTax })
        continue
      }
      const regularTax = Math.max(0, cumTax - st.withheld)
      st.withheld += regularTax
      state.set(e.id, st)
      const separateSeveranceTax = severanceTax(parts.severance || 0, e.city, period)
      const tax = regularTax + separateSeveranceTax
      allRows.push({ ...parts, regular_tax: regularTax, severance_tax: separateSeveranceTax, tax, net: parts.gross + (parts.severance || 0) - parts.social - parts.fund - (parts.supplemental_fund || 0) - tax })
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

/** 个税累计预扣按自然年：从该年 1 月累计到目标月 */
export function taxYearStart(period) {
  const y = String(period || '').slice(0, 4)
  return /^\d{4}$/.test(y) ? `${y}-01` : null
}

export function computeMonthForPeriod(period, employees) {
  const start = taxYearStart(period)
  if (!start || period < start) return []
  return computeCumulative(monthRange(start, period), employees).filter(r => r.period === period)
}

// 兼容旧名：未提交月份的实时计算
export function computeMonthFallback(period, employees) {
  return computeMonthForPeriod(period, employees)
}
