export const SPECIAL_DEDUCTION_DEFS = [
  { key: 'child_education', label: '子女教育', defaultAmount: 2000, monthly: true },
  { key: 'infant_care', label: '3岁以下婴幼儿照护', defaultAmount: 2000, monthly: true },
  { key: 'continuing_education', label: '学历（学位）继续教育', defaultAmount: 400, monthly: true },
  { key: 'serious_illness', label: '大病医疗（年度汇算）', defaultAmount: 0, monthly: false },
  { key: 'housing_loan', label: '首套住房贷款利息', defaultAmount: 1000, monthly: true },
  { key: 'housing_rent', label: '住房租金', defaultAmount: 1500, monthly: true },
  { key: 'elderly_support', label: '赡养老人', defaultAmount: 3000, monthly: true },
  { key: 'other_declared', label: '既有已申报金额', defaultAmount: 0, monthly: true }
]

const KNOWN = new Set(SPECIAL_DEDUCTION_DEFS.map(item => item.key))
const rentDefault = city => ['苏州', '无锡'].includes(city) ? 1100 : 1500

export function normalizeSpecialDeductions(input, city = '上海', fallbackMonthly = 0) {
  let source = input
  if (typeof source === 'string') {
    try { source = JSON.parse(source) } catch { source = {} }
  }
  if (!source || typeof source !== 'object' || Array.isArray(source)) source = {}
  const items = {}
  const errors = []
  for (const def of SPECIAL_DEDUCTION_DEFS) {
    const raw = source[def.key]
    if (!raw || !raw.enabled) continue
    const defaultAmount = def.key === 'housing_rent' ? rentDefault(city) : def.defaultAmount
    const amount = Math.round(Number(raw.amount ?? defaultAmount))
    const max = def.key === 'serious_illness' ? 80000 : 10000
    if (!Number.isFinite(amount) || amount < 0 || amount > max) {
      errors.push(`${def.label}金额须在 0-${max} 元之间`)
      continue
    }
    items[def.key] = { enabled: true, amount }
  }
  if (items.housing_loan && items.housing_rent) errors.push('住房贷款利息与住房租金不能同时享受')
  if (!Object.keys(items).length && Number(fallbackMonthly) > 0) {
    items.other_declared = { enabled: true, amount: Math.round(Number(fallbackMonthly)) }
  }
  const monthly = SPECIAL_DEDUCTION_DEFS
    .filter(def => def.monthly && items[def.key]?.enabled)
    .reduce((sum, def) => sum + items[def.key].amount, 0)
  if (monthly > 10000) errors.push('每月专项附加扣除合计不能超过 10000 元')
  return { items, monthly, errors }
}
